import { create } from 'zustand';
import { 
  collection, 
  query, 
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { customerService } from '../services/customerService';
import { offlineSyncService } from '../services/offlineSyncService';
import { notificationService } from '../services/notificationService';
import { commitPartsAllocation } from '../services/stockService';
import { writeTrackingMirror, refreshTrackingMirrorForTicket } from '../services/trackingMirrorService';
import type { TrackingMirrorSource } from '../utils/trackingMirror';
import { allocateTicketNumber } from '../services/ticketCounter';
import { appendHistory, buildStatusPatch, isSettleAlreadyRecorded, isOfflineCustomerId, type HistoryEntryLike } from '../services/offlineQueuePolicy';
import { createRefCountedSubscription, type RefCountedSubscription } from '../utils/liveSubscription';
import type { RepairTicket, RepairStatus, RepairStatusHistoryEntry } from '../types';

// Active statuses that must always be visible regardless of creation date
const ACTIVE_STATUSES: RepairStatus[] = ['pending', 'in_progress', 'ready', 'returned'];
// Closed statuses only shown for the recent retention window
const CLOSED_STATUSES: RepairStatus[] = ['completed', 'cancelled'];
// How many days of closed ticket history to stream to the mobile device
const CLOSED_RETENTION_DAYS = 60;

interface SettleClaimParams {
  ticketId: string;
  finalPrice: number;
  handoverAmountPaid: number;
  paymentMethod: string;
  settlementNotes?: string;
  customerPhone?: string;
  customerName?: string;
}

interface RepairState {
  tickets: RepairTicket[];
  isLoading: boolean;
  error: string | null;
  subscribeToTickets: () => () => void;
  refreshTickets: () => Promise<void>;
  updateTicketStatus: (id: string, status: RepairStatus, changerName?: string, additionalUpdates?: any) => Promise<void>;
  settleAndClaimTicket: (params: SettleClaimParams) => Promise<void>;
  updateTicketRemark: (id: string, remark: string) => Promise<void>;
  createTicket: (ticket: Partial<RepairTicket>) => Promise<void>;
  fetchMyCompletedTickets: (technicianName: string) => Promise<RepairTicket[]>;
  updateTicketParts: (id: string, parts: { productId?: string; name: string; cost: number; quantity?: number }[]) => Promise<void>;
}

type TicketsSetter = (partial: Partial<RepairState>) => void;
type TicketsGetter = () => RepairState;

// One pair of Firestore listeners serves the whole app, however many screens ask
// for tickets: a second live listener would double the billed reads on every change.
// `ticketStream` is the single holder of that pair; a pull-to-refresh settles on
// the next merged snapshot rather than a fixed timer, so the spinner cannot stop
// before the server's answer has landed.
let _ticketStream: RefCountedSubscription | null = null;
let _refreshResolvers: Array<() => void> = [];

const settleRefreshers = () => {
  const pending = _refreshResolvers;
  _refreshResolvers = [];
  pending.forEach((resolve) => resolve());
};

const attachTicketListeners = (set: TicketsSetter, get: TicketsGetter): (() => void) => {
  // Show cached tickets instantly while fresh data loads from Firestore
  offlineSyncService.getCachedTickets().then((cached) => {
    if (cached && cached.length > 0 && get().tickets.length === 0) {
      set({ tickets: cached, isLoading: false });
    }
  });

  set({ isLoading: get().tickets.length === 0 });

  // --- Bounded Query 1: All ACTIVE (open) tickets ---
  // No date limit: a 1-year-old "in_progress" ticket must still appear on the workbench.
  const activeQ = query(
    collection(db, 'repairs'),
    where('status', 'in', ACTIVE_STATUSES),
    orderBy('createdAt', 'desc')
  );

  // --- Bounded Query 2: Recent CLOSED tickets (last CLOSED_RETENTION_DAYS days) ---
  // Closed tickets older than the window are irrelevant to daily technician workflow
  // and are still fully accessible from the desktop admin app (which has no limit).
  const closedCutoff = new Date();
  closedCutoff.setDate(closedCutoff.getDate() - CLOSED_RETENTION_DAYS);
  const closedQ = query(
    collection(db, 'repairs'),
    where('status', 'in', CLOSED_STATUSES),
    where('updatedAt', '>=', closedCutoff.toISOString()),
    orderBy('updatedAt', 'desc'),
    limit(100)
  );

  // Shared mutable snapshot buffers — one per listener, merged on every update
  let activeBuffer: RepairTicket[] = [];
  let closedBuffer: RepairTicket[] = [];

  const mergeAndCommit = async () => {
    // Deduplicate across both buffers by document ID
    const seen = new Set<string>();
    const combined: RepairTicket[] = [];
    for (const t of [...activeBuffer, ...closedBuffer]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        combined.push(t);
      }
    }

    // Sort newest-first
    combined.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tB - tA;
    });

    // Inject any offline-created tickets that haven't synced to the server yet
    const cached = await offlineSyncService.getCachedTickets();
    const offlineOnly = (cached || []).filter(t => t.id?.startsWith('offline_'));
    const serverIds = new Set(combined.map(t => t.id));
    const merged = [
      ...offlineOnly.filter(t => !serverIds.has(t.id)),
      ...combined,
    ];

    set({ tickets: merged, isLoading: false, error: null });
    offlineSyncService.setCachedTickets(merged);
    settleRefreshers();
  };

  // Active tickets listener
  const unsubActive = onSnapshot(
    activeQ,
    (snapshot) => {
      activeBuffer = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RepairTicket));
      mergeAndCommit();
    },
    (error) => {
      console.warn('[RepairStore] Active tickets snapshot failed (offline):', error);
      offlineSyncService.getCachedTickets().then((cached) => {
        set({ tickets: cached || [], error: null, isLoading: false });
        settleRefreshers();
      });
    }
  );

  // Recent closed tickets listener (non-critical — active listener handles the must-have data)
  const unsubClosed = onSnapshot(
    closedQ,
    (snapshot) => {
      closedBuffer = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RepairTicket));
      mergeAndCommit();
    },
    (error) => {
      // Non-fatal: the technician still gets all active tickets from the first listener
      console.warn('[RepairStore] Recent closed tickets snapshot error (non-critical):', error);
    }
  );

  // Return a combined cleanup function
  return () => {
    unsubActive();
    unsubClosed();
  };
};

export const useRepairStore = create<RepairState>((set, get) => ({
  tickets: [],
  isLoading: true,
  error: null,

  /**
   * Reference-counted so the app can hold one live subscription for a whole
   * session while screens come and go. The first holder opens the listeners, the
   * last one closing them — which is also the logout path.
   */
  subscribeToTickets: () => {
    if (!_ticketStream) {
      _ticketStream = createRefCountedSubscription(() =>
        attachTicketListeners((partial) => set(partial), () => get())
      );
    }
    return _ticketStream.acquire();
  },

  /**
   * Re-opens the listeners so Firestore sends a full copy of both queries.
   * Resolves on the next merged snapshot; if nothing is subscribed (the app is on
   * the login screen) it settles immediately rather than spinning forever.
   */
  refreshTickets: () => {
    if (!_ticketStream?.isLive()) return Promise.resolve();
    const settled = new Promise<void>((resolve) => { _refreshResolvers.push(resolve); });
    _ticketStream.restart();
    return settled;
  },

  updateTicketStatus: async (id: string, status: RepairStatus, changerName?: string, additionalUpdates?: any) => {
    const currentUser = useAuthStore.getState().user;
    const changerId = currentUser?.id || 'technician-app';
    try {
      const docRef = doc(db, 'repairs', id);
      const now = new Date().toISOString();
      const actorName = changerName || currentUser?.name || 'Technician';

      // The patch is built against the LIVE document, not the phone's snapshot. A
      // whole-array `statusHistory: [...local, entry]` write used to erase every
      // entry the counter added after the last sync; the offline replay path merges
      // with the same builder, so both directions are now append-only.
      const currentSnap = await getDoc(docRef);
      const current = currentSnap.exists() ? (currentSnap.data() as Record<string, unknown>) : null;

      // A returned ticket reopened is a new cycle: the first cycle's settlement
      // must not leak into the second settle's math. The desktop clears the same
      // fields on this transition; a stale paidAmount here could otherwise make
      // the retry guard read a cycle-2 settle as "already recorded" and skip the
      // money, or count only the old deposit against the new total.
      const reopening = current?.status === 'returned' && status === 'in_progress';

      const patch = buildStatusPatch(current, {
        status,
        timestamp: now,
        actorId: changerId,
        actorName,
        notes: typeof additionalUpdates?.notes === 'string' ? additionalUpdates.notes : undefined,
        additionalUpdates: {
          ...((additionalUpdates as Record<string, unknown> | null) ?? null),
          ...(reopening
            ? {
                paymentStatus: null,
                paidAmount: null,
                handoverAmountPaid: null,
                completedAt: null,
                debtEntryId: null,
                settlementNotes: null,
              }
            : {}),
        },
      });

      await updateDoc(docRef, patch);

      if (current) {
        void writeTrackingMirror({ ...current, ...patch } as TrackingMirrorSource);
      }

      // Log to shared activityLogs collection
      const localTicket = get().tickets.find(t => t.id === id);
      const ticketNum = localTicket?.ticketNumber || id;
      await activityLogService.log(
        'repairs',
        `Repair #${ticketNum} status updated to ${status.toUpperCase()}`,
        {
          entityId: id,
          entityType: 'repair',
          detail: `Device: ${localTicket?.deviceBrand || ''} ${localTicket?.deviceModel || ''} by ${actorName}`,
          userName: actorName,
          userId: changerId,
        }
      );

      // Trigger push notifications
      if (status === 'ready') {
        const deviceName = `${localTicket?.deviceBrand || ''} ${localTicket?.deviceModel || ''}`.trim();
        notificationService.notifyRepairReady(ticketNum, deviceName, actorName, id)
          .catch(err => console.warn('[RepairStore] Push notify repair ready error:', err));
      }
    } catch (error) {
      console.warn('Failed to update ticket status on Firestore (offline), queuing for auto-sync:', error);
      await offlineSyncService.saveOfflineStatusUpdate(
        id,
        status,
        changerName || currentUser?.name || 'Technician',
        additionalUpdates,
        changerId
      );
    }
  },

  settleAndClaimTicket: async (params: SettleClaimParams) => {
    try {
      const { ticketId, finalPrice, handoverAmountPaid, paymentMethod, settlementNotes, customerPhone, customerName } = params;
      const docRef = doc(db, 'repairs', ticketId);
      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;
      const actorName = currentUser?.name || 'Staff';
      const actorId = currentUser?.id || 'technician-app';

      const localTicket = get().tickets.find(t => t.id === ticketId);
      const ticketSnap = await getDoc(docRef);
      const ticket = (ticketSnap.exists() ? ticketSnap.data() : localTicket) as RepairTicket | undefined;

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const depositAlreadyPaid = ticket.depositAmount || 0;
      const effectiveTotalPaid = depositAlreadyPaid + (handoverAmountPaid || 0);
      const remainingDebt = Math.max(0, finalPrice - effectiveTotalPaid);
      const isZeroPrice = finalPrice === 0;

      const paymentStatus: RepairTicket['paymentStatus'] =
        remainingDebt <= 0 || isZeroPrice ? 'paid' : effectiveTotalPaid > 0 ? 'partial' : 'debt';

      // 1. Resolve customer before anything is written.
      const targetPhone = customerPhone || ticket.customerPhone || '';
      const targetName = customerName || ticket.customerName || 'Client';
      let customerId = ticket.customerId;

      // A customer that only exists in this phone's cache must not be referenced by
      // the ticket or its debt row: upload it now when the network allows. When the
      // cached row is gone (reinstall, another phone created it), fall back to the
      // phone number — a settle used to write the debt against an offline_cust_ id
      // that does not exist on the server, and the money owed vanished with it.
      if (customerId && isOfflineCustomerId(customerId)) {
        const resolved = await customerService.resolveOfflineCustomer(customerId);
        customerId = resolved ?? undefined;
      }

      if (!customerId && targetPhone) {
        try {
          const cust = await customerService.findOrCreate(targetName, targetPhone);
          customerId = cust.id;
        } catch (cErr) {
          console.warn('Customer resolution failed:', cErr);
        }
      }

      // findOrCreate itself falls back to a phantom id when the network drops
      // mid-settle; nothing may be written against it.
      if (customerId && isOfflineCustomerId(customerId)) {
        customerId = undefined;
      }

      // An owed balance must land on a real account. Completing the ticket without
      // the debt row used to be the silent outcome, and the money owed left the
      // ledger; failing cleanly lets the technician settle again when the network
      // allows.
      if (remainingDebt > 0 && !customerId) {
        throw new Error('A customer account is required to record the remaining debt');
      }

      // A retried settle must not count the money twice. When the document already
      // carries this exact settlement and its debt row is linked (or there is none to
      // link), the side-effects below already ran on the first attempt — re-running
      // them would add a second debt row and spend the money a second time.
      const alreadySettled = isSettleAlreadyRecorded(ticket, effectiveTotalPaid, remainingDebt);

      if (!alreadySettled) {
        // 2. Write the ticket FIRST. A settle against an id that only exists on this
        // phone (`offline_tkt_…`) throws here, and a throw before any money moved is a
        // clean retry once the ticket uploads. The old order wrote the debt row and the
        // customer spending before this update, so every retry double-counted them.
        const historyEntry: RepairStatusHistoryEntry = {
          status: 'completed',
          changedById: actorId,
          changedByName: actorName,
          at: now,
          timestamp: now,
          notes: settlementNotes || `Handed over to customer. Paid: ${effectiveTotalPaid} DA.`
        };

        const updates: any = {
          status: 'completed',
          actualCost: finalPrice,
          paidAmount: effectiveTotalPaid,
          handoverAmountPaid: handoverAmountPaid || 0,
          paymentStatus,
          completedAt: now,
          customerId: customerId || null,
          settlementNotes: settlementNotes || null,
          updatedAt: now,
          statusHistory: appendHistory(
            (ticket.statusHistory || []) as unknown as HistoryEntryLike[],
            historyEntry as unknown as HistoryEntryLike
          ),
        };

        // Preserve existing assigned technician!
        if (ticket.assignedTechnician) {
          updates.assignedTechnician = ticket.assignedTechnician;
          if (ticket.assignedTechnicianId) updates.assignedTechnicianId = ticket.assignedTechnicianId;
        }

        await updateDoc(docRef, updates);

        void writeTrackingMirror({ ...ticket, ...updates } as TrackingMirrorSource);

        // 3. Debt row, idempotent by ticket number: a crash between the ticket write
        // and this write must not leave a second row behind on the retry. A debt the
        // retry cannot register is a failure, not a silent drop — the ticket already
        // says the money is owed.
        if (remainingDebt > 0 && customerId) {
          try {
            const debtEntryId = await customerService.createDebtRecord({
              customerId,
              customerName: targetName,
              customerPhone: targetPhone,
              ticketNumber: ticket.ticketNumber,
              ticketId: ticket.id,
              deviceDescription: `${ticket.deviceBrand} ${ticket.deviceModel}`,
              totalAmount: finalPrice,
              amountPaid: effectiveTotalPaid,
              paymentMethod,
              actorName,
              notes: settlementNotes,
            });
            await updateDoc(docRef, { debtEntryId });
          } catch (debtErr) {
            console.error('Failed to register debt:', debtErr);
            throw debtErr;
          }
        }

        // 4. Update customer total spending
        if (customerId) {
          await customerService.recordCustomerSpending(customerId, finalPrice);
        }

        // 4b. A return child settled here closes its parent, exactly as the
        // desktop does when it settles the child — otherwise the parent stays
        // "returned" until a desktop reload heals it, and the customer reads a
        // closed repair as open.
        if (ticket.parentTicketId) {
          try {
            const parentRef = doc(db, 'repairs', ticket.parentTicketId);
            const parentSnap = await getDoc(parentRef);
            const parent = parentSnap.exists() ? (parentSnap.data() as Record<string, unknown>) : null;
            if (parent && parent.status === 'returned') {
              const parentPatch = buildStatusPatch(parent, {
                status: 'completed',
                timestamp: now,
                actorId,
                actorName,
                notes: `Return ticket #${ticket.ticketNumber} settled on the technician app`,
                additionalUpdates: { activeReturnTicketId: null, activeReturnTicketNumber: null },
              });
              await updateDoc(parentRef, parentPatch);
              void writeTrackingMirror({ ...parent, ...parentPatch } as TrackingMirrorSource);
              set(state => ({
                tickets: state.tickets.map(t =>
                  t.id === ticket.parentTicketId && t.status === 'returned'
                    ? { ...t, status: 'completed' as const, completedAt: now, activeReturnTicketId: undefined, activeReturnTicketNumber: undefined }
                    : t
                ),
              }));
            }
          } catch (parentErr) {
            // The desktop's auto-heal closes the parent on its next load; the
            // settle itself is already recorded.
            console.warn('[RepairStore] Could not close parent of settled return:', parentErr);
          }
        }
      }

      // 5. Activity log
      const debtDesc = remainingDebt > 0 ? ` Paid: ${effectiveTotalPaid} DA. Debt: ${remainingDebt} DA.` : ` Paid in full: ${effectiveTotalPaid} DA.`;
      await activityLogService.log(
        'repairs',
        `Repair #${ticket.ticketNumber} marked as claimed/completed`,
        {
          entityId: ticket.id,
          entityType: 'repair',
          detail: `Device: ${ticket.deviceBrand} ${ticket.deviceModel}.${debtDesc}`,
          userName: actorName,
          userId: actorId,
        }
      );
    } catch (error) {
      console.error('Failed to settle and claim ticket:', error);
      throw error;
    }
  },

  updateTicketRemark: async (id: string, remark: string) => {
    const currentUser = useAuthStore.getState().user;
    try {
      const docRef = doc(db, 'repairs', id);
      const now = new Date().toISOString();

      await updateDoc(docRef, {
        remark,
        updatedAt: now,
      });

      void refreshTrackingMirrorForTicket(id);

      const localTicket = get().tickets.find(t => t.id === id);
      await activityLogService.log(
        'repairs',
        `Repair #${localTicket?.ticketNumber || id} remarks updated`,
        {
          entityId: id,
          entityType: 'repair',
          detail: `Remark: ${remark}`,
          userName: currentUser?.name || 'Technician',
          userId: currentUser?.id || 'technician-app',
        }
      );
    } catch (error) {
      // The remark queue existed but nothing ever wrote to it, so a note typed with
      // no signal was simply lost. Park it and let the optimistic UI stand.
      console.warn('Failed to update remark on Firestore (offline), queuing for auto-sync:', error);
      await offlineSyncService.saveOfflineRemark(id, remark);
    }
  },

  updateTicketParts: async (id: string, parts: { productId?: string; name: string; cost: number; quantity?: number }[]) => {
    const currentUser = useAuthStore.getState().user;
    const normalized = parts.map(p => ({
      name: p.name,
      cost: p.cost,
      quantity: p.quantity || 1,
      productId: p.productId || 'custom-mobile-part'
    }));

    try {
      const docRef = doc(db, 'repairs', id);
      // Diff against what the ticket already carried, so editing a list returns the
      // dropped part to the shelf instead of deducting the whole list a second time.
      const liveSnap = await getDoc(docRef);
      const previous = (liveSnap.data() as RepairTicket | undefined)?.partsUsed
        ?? get().tickets.find(t => t.id === id)?.partsUsed
        ?? [];

      // Stock moves and the ticket write land in one transaction; a crash between
      // them used to leave the ticket updated with the shelf never told, or the
      // shelf told with the ticket never updated.
      const actionId = `parts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const { failed } = await commitPartsAllocation(id, actionId, previous, {
        partsUsed: normalized,
        updatedAt: new Date().toISOString(),
      });
      for (const f of failed) {
        console.warn(`[RepairStore] Parts stock delta failed for ${f.delta.name}, queuing:`, f.error);
        await offlineSyncService.saveOfflineStockDelta({
          productId: f.delta.productId,
          name: f.delta.name,
          // A part added to the ticket leaves the shelf; a removed one returns to it.
          delta: -f.delta.delta,
          reason: `Repair #${liveSnap.data()?.ticketNumber || id} parts`,
        });
      }
    } catch (error) {
      console.warn('Failed to update parts on Firestore (offline), queuing for auto-sync:', error);
      await offlineSyncService.saveOfflineParts(id, normalized, {
        id: currentUser?.id,
        name: currentUser?.name,
      });
    }
  },

  createTicket: async (ticket) => {
    try {
      // Sequential TKT-#### from the shared counter, the same document the desktop
      // till advances. A random number used to be invented when the counter was
      // unreachable, and it stayed in the shop's ledger forever; now the ticket is
      // flagged provisional and the sync pass claims a real number as it uploads.
      let ticketNumber = 'TKT-PENDING';
      let ticketNumberProvisional = true;
      try {
        ticketNumber = await allocateTicketNumber();
        ticketNumberProvisional = false;
      } catch (counterErr) {
        console.warn('Counter unreachable — the ticket will be numbered when it syncs:', counterErr);
      }

      // 4-character alphanumeric tracking PIN for customer tracking portal
      const trackingPin = Math.random().toString(36).substring(2, 6).toUpperCase();

      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;
      const creatorName = currentUser?.name || ticket.createdByName || 'Technician';
      const creatorId = currentUser?.id || ticket.createdById || 'technician-app';

      // A ticket links to a customer only when the technician picks one — the
      // screen passes customerId from a manual tap. A phone typed freely stays on
      // the ticket as text; the phone used to findOrCreate by number here and a
      // placeholder profile could end up owning a stranger's repair.

      const initialHistory: RepairStatusHistoryEntry = {
        status: 'pending',
        changedById: creatorId,
        changedByName: creatorName,
        at: now,
        timestamp: now,
        notes: 'Created via Technician App'
      };

      const newTicket = {
        ...ticket,
        ticketNumber,
        ticketNumberProvisional,
        trackingPin,
        customerId: ticket.customerId || null,
        status: 'pending',
        createdById: creatorId,
        createdByName: creatorName,
        createdAt: now,
        updatedAt: now,
        statusHistory: [initialHistory]
      };

      try {
        const createdDoc = await addDoc(collection(db, 'repairs'), newTicket);

        void writeTrackingMirror(newTicket as TrackingMirrorSource);

        // Log activity
        await activityLogService.log(
          'repairs',
          `New Repair Ticket created: #${ticketNumber}`,
          {
            entityId: createdDoc.id,
            entityType: 'repair',
            detail: `Device: ${ticket.deviceBrand} ${ticket.deviceModel} for ${ticket.customerName}`,
            userName: creatorName,
            userId: creatorId,
          }
        );

        // Send push notification to repair agents
        const deviceName = `${ticket.deviceBrand || ''} ${ticket.deviceModel || ''}`.trim();
        notificationService.notifyNewRepair(
          ticketNumber,
          deviceName,
          ticket.issueDescription || 'Diagnostic requested'
        ).catch(err => console.warn('[RepairStore] Push notify new repair error:', err));
      } catch (error) {
        console.warn('Failed to create ticket on Firestore (offline), storing locally for auto-sync:', error);
        const offlineId = `offline_tkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const offlineTicket: RepairTicket = {
          ...newTicket,
          id: offlineId,
        } as RepairTicket;
        await offlineSyncService.saveOfflineTicket(offlineTicket);
        set(state => ({ tickets: [offlineTicket, ...state.tickets] }));
      }
    } catch (outerErr) {
      console.warn('Unexpected error in createTicket flow:', outerErr);
    }
  },

  fetchMyCompletedTickets: async (technicianName: string) => {
    try {
      const { getDocs } = await import('firebase/firestore');
      // Push both predicates to Firestore — uses composite index (assignedTechnician, status, createdAt)
      const q = query(
        collection(db, 'repairs'),
        where('assignedTechnician', '==', technicianName),
        where('status', 'in', ['completed', 'ready']),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RepairTicket));
    } catch (error) {
      console.error('Failed to fetch technician completed tickets:', error);
      return [];
    }
  }
}));
