import { create } from 'zustand';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  runTransaction
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { customerService } from '../services/customerService';
import { offlineSyncService } from '../services/offlineSyncService';
import { notificationService } from '../services/notificationService';
import type { RepairTicket, RepairStatus, RepairStatusHistoryEntry } from '../types';

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
  updateTicketStatus: (id: string, status: RepairStatus, changerName?: string, additionalUpdates?: any) => Promise<void>;
  settleAndClaimTicket: (params: SettleClaimParams) => Promise<void>;
  updateTicketRemark: (id: string, remark: string) => Promise<void>;
  createTicket: (ticket: Partial<RepairTicket>) => Promise<void>;
  fetchMyCompletedTickets: (technicianName: string) => Promise<RepairTicket[]>;
  updateTicketParts: (id: string, parts: { productId?: string; name: string; cost: number; quantity?: number }[]) => Promise<void>;
}

export const useRepairStore = create<RepairState>((set, get) => ({
  tickets: [],
  isLoading: true,
  error: null,

  subscribeToTickets: () => {
    // Immediately display cached tickets while fetching remote changes
    offlineSyncService.getCachedTickets().then((cached) => {
      if (cached && cached.length > 0 && get().tickets.length === 0) {
        set({ tickets: cached, isLoading: false });
      }
    });

    set({ isLoading: get().tickets.length === 0 });
    const q = query(collection(db, 'repairs'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const tickets: RepairTicket[] = [];
        snapshot.forEach((doc) => {
          tickets.push({ id: doc.id, ...doc.data() } as RepairTicket);
        });
        tickets.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
        });

        // Merge any pending offline tickets that are not yet on the server
        offlineSyncService.getCachedTickets().then((cached) => {
          const offlineOnes = (cached || []).filter(t => t.id && t.id.startsWith('offline_'));
          const serverIds = new Set(tickets.map(t => t.id));
          const merged = [...offlineOnes.filter(t => !serverIds.has(t.id)), ...tickets];
          set({ tickets: merged, isLoading: false, error: null });
          offlineSyncService.setCachedTickets(merged);
        });
      },
      (error) => {
        console.warn('[RepairStore] Snapshot listener failed (offline), loading cache:', error);
        offlineSyncService.getCachedTickets().then((cached) => {
          set({ tickets: cached || [], error: null, isLoading: false });
        });
      }
    );

    return unsubscribe;
  },

  updateTicketStatus: async (id: string, status: RepairStatus, changerName?: string, additionalUpdates?: any) => {
    try {
      const docRef = doc(db, 'repairs', id);
      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;
      const changerId = currentUser?.id || 'technician-app';
      const actorName = changerName || currentUser?.name || 'Technician';

      // Find local or current ticket state to safely preserve assignedTechnician & history
      let currentHistory: RepairStatusHistoryEntry[] = [];
      let currentAssignedTechnician: string | undefined = undefined;
      const localTicket = get().tickets.find(t => t.id === id);

      if (localTicket) {
        currentHistory = localTicket.statusHistory || [];
        currentAssignedTechnician = localTicket.assignedTechnician;
      } else {
        const currentSnap = await getDoc(docRef);
        if (currentSnap.exists()) {
          const data = currentSnap.data() as RepairTicket;
          currentHistory = data.statusHistory || [];
          currentAssignedTechnician = data.assignedTechnician;
        }
      }

      // Safe technician assignment: Never overwrite an existing technician when a sales agent updates status
      let assignedTechnician = currentAssignedTechnician;
      if (additionalUpdates?.assignedTechnician !== undefined) {
        assignedTechnician = additionalUpdates.assignedTechnician;
      } else if (!assignedTechnician && (status === 'in_progress' || status === 'ready')) {
        assignedTechnician = actorName;
      }

      const newHistoryEntry: RepairStatusHistoryEntry = {
        status,
        changedById: changerId,
        changedByName: actorName,
        at: now,
        timestamp: now,
        notes: additionalUpdates?.notes || `Status changed to ${status} via Technician App`
      };

      const updates: any = {
        status,
        assignedTechnician: assignedTechnician || null,
        statusHistory: [...currentHistory, newHistoryEntry],
        updatedAt: now,
        ...additionalUpdates
      };

      // Set timestamp based on status transition
      if (status === 'ready' && !updates.repairedAt) {
        updates.repairedAt = now;
      }
      if (status === 'completed' && !updates.completedAt) {
        updates.completedAt = now;
      }

      await updateDoc(docRef, updates);

      // Log to shared activityLogs collection
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
      await offlineSyncService.saveOfflineStatusUpdate(id, status, changerName, additionalUpdates);
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
      const ticketSnap = localTicket ? null : await getDoc(docRef);
      const ticket = localTicket || (ticketSnap?.data() as RepairTicket);

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const depositAlreadyPaid = ticket.depositAmount || 0;
      const effectiveTotalPaid = depositAlreadyPaid + (handoverAmountPaid || 0);
      const remainingDebt = Math.max(0, finalPrice - effectiveTotalPaid);
      const isZeroPrice = finalPrice === 0;

      const paymentStatus: RepairTicket['paymentStatus'] =
        remainingDebt <= 0 || isZeroPrice ? 'paid' : effectiveTotalPaid > 0 ? 'partial' : 'debt';

      // 1. Resolve customer
      const targetPhone = customerPhone || ticket.customerPhone || '';
      const targetName = customerName || ticket.customerName || 'Client';
      let customerId = ticket.customerId;

      if (!customerId && targetPhone) {
        try {
          const cust = await customerService.findOrCreate(targetName, targetPhone);
          customerId = cust.id;
        } catch (cErr) {
          console.warn('Customer resolution failed:', cErr);
        }
      }

      // 2. Create debt record in customer_debts if remaining balance > 0
      let debtEntryId: string | undefined = undefined;
      if (remainingDebt > 0 && customerId) {
        try {
          debtEntryId = await customerService.createDebtRecord({
            customerId,
            customerName: targetName,
            customerPhone: targetPhone,
            ticketNumber: ticket.ticketNumber,
            deviceDescription: `${ticket.deviceBrand} ${ticket.deviceModel}`,
            totalAmount: finalPrice,
            amountPaid: effectiveTotalPaid,
            paymentMethod,
            actorName,
            notes: settlementNotes,
          });
        } catch (debtErr) {
          console.error('Failed to register debt:', debtErr);
        }
      }

      // 3. Update customer total spending
      if (customerId) {
        await customerService.recordCustomerSpending(customerId, finalPrice);
      }

      // 4. Append status history
      const historyEntry: RepairStatusHistoryEntry = {
        status: 'completed',
        changedById: actorId,
        changedByName: actorName,
        at: now,
        timestamp: now,
        notes: settlementNotes || `Handed over to customer. Paid: ${effectiveTotalPaid} DA.`
      };

      // 5. Update repair document with full financial settlement
      const updates: any = {
        status: 'completed',
        actualCost: finalPrice,
        paidAmount: effectiveTotalPaid,
        handoverAmountPaid: handoverAmountPaid || 0,
        paymentStatus,
        completedAt: now,
        debtEntryId: debtEntryId || null,
        customerId: customerId || null,
        settlementNotes: settlementNotes || null,
        updatedAt: now,
        statusHistory: [...(ticket.statusHistory || []), historyEntry],
      };

      // Preserve existing assigned technician!
      if (ticket.assignedTechnician) {
        updates.assignedTechnician = ticket.assignedTechnician;
      }

      await updateDoc(docRef, updates);

      // 6. Activity log
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
    try {
      const docRef = doc(db, 'repairs', id);
      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;

      await updateDoc(docRef, {
        remark,
        updatedAt: now,
      });

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
      console.error('Failed to update remark:', error);
      throw error;
    }
  },

  updateTicketParts: async (id: string, parts: { productId?: string; name: string; cost: number; quantity?: number }[]) => {
    try {
      const docRef = doc(db, 'repairs', id);
      await updateDoc(docRef, {
        partsUsed: parts.map(p => ({
          name: p.name,
          cost: p.cost,
          quantity: p.quantity || 1,
          productId: p.productId || 'custom-mobile-part'
        })),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to update parts:', error);
      throw error;
    }
  },

  createTicket: async (ticket) => {
    try {
      // Atomic counter for sequential ticket numbers: TKT-XXXX (synchronized with desktop app)
      const counterRef = doc(db, 'counters', 'repairs');
      let ticketNumber: string;
      try {
        ticketNumber = await runTransaction(db, async (tx) => {
          const snap = await tx.get(counterRef);
          const current = snap.exists() ? (snap.data()?.lastNumber || 0) : 0;
          const nextNum = current + 1;
          tx.set(counterRef, { lastNumber: nextNum }, { merge: true });
          return `TKT-${String(nextNum).padStart(4, '0')}`;
        });
      } catch (counterErr) {
        console.warn('Failed atomic counter transaction, using fallback ticket number:', counterErr);
        ticketNumber = 'TKT-' + Math.floor(100000 + Math.random() * 900000);
      }

      // 4-character alphanumeric tracking PIN for customer tracking portal
      const trackingPin = Math.random().toString(36).substring(2, 6).toUpperCase();

      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;
      const creatorName = currentUser?.name || ticket.createdByName || 'Technician';
      const creatorId = currentUser?.id || ticket.createdById || 'technician-app';

      // Auto-link or create customer
      let customerId = ticket.customerId;
      if (!customerId && ticket.customerPhone) {
        try {
          const cust = await customerService.findOrCreate(
            ticket.customerName || 'Client',
            ticket.customerPhone
          );
          customerId = cust.id;
        } catch (cErr) {
          console.warn('Failed to link customer on ticket create:', cErr);
        }
      }

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
        trackingPin,
        customerId: customerId || null,
        status: 'pending',
        createdById: creatorId,
        createdByName: creatorName,
        createdAt: now,
        updatedAt: now,
        statusHistory: [initialHistory]
      };

      try {
        const createdDoc = await addDoc(collection(db, 'repairs'), newTicket);

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
      // Query tickets assigned to this technician that are ready OR completed
      const q = query(
        collection(db, 'repairs'),
        where('assignedTechnician', '==', technicianName)
      );
      const snapshot = await getDocs(q);
      const myTickets: RepairTicket[] = [];
      snapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() } as RepairTicket;
        if (data.status === 'completed' || data.status === 'ready') {
          myTickets.push(data);
        }
      });
      return myTickets;
    } catch (error) {
      console.error('Failed to fetch technician tickets:', error);
      return [];
    }
  }
}));
