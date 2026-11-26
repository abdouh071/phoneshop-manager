import { create } from 'zustand';
import type { RepairTicket, RepairStatusHistoryEntry, HeldRepairDraft } from '../types';
import { repairService, type RepairPatch } from '../services/repairService';
import { activityLogService } from '../services/activityLogService';
import { customerLogService } from '../services/customerLogService';
import { useCustomerStore } from './customerStore';
import { useAuthStore } from './authStore';
import { useInventoryStore } from './inventoryStore';
import { formatCurrency } from '../utils/formatCurrency';
import { deduplicateTickets, isSameTicketContent, findDuplicateTickets, type DuplicateTicketPair } from '../utils/ticketDeduplication';
import { mergeRepairPatch } from '../utils/repairPatchMerge';
import { isTicketActiveReturnPending, isTicketOverdue } from '../utils/phoneLifecycle';
import { normalizeArabic } from '../utils/normalizeText';

// --- Persistent Draft Storage (survives reload & logout) ---
const STORAGE_KEY_ACTIVE_DRAFT = 'repair_active_draft';
const STORAGE_KEY_HELD_DRAFTS = 'repair_held_drafts';

const loadActiveDraft = (): HeldRepairDraft | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_DRAFT);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const saveActiveDraft = (draft: HeldRepairDraft | null) => {
  try {
    if (!draft) { localStorage.removeItem(STORAGE_KEY_ACTIVE_DRAFT); return; }
    localStorage.setItem(STORAGE_KEY_ACTIVE_DRAFT, JSON.stringify(draft));
  } catch (e) { console.error('Failed to save active repair draft', e); }
};

const loadHeldDrafts = (): HeldRepairDraft[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HELD_DRAFTS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const saveHeldDrafts = (drafts: HeldRepairDraft[]) => {
  try {
    if (drafts.length === 0) { localStorage.removeItem(STORAGE_KEY_HELD_DRAFTS); return; }
    localStorage.setItem(STORAGE_KEY_HELD_DRAFTS, JSON.stringify(drafts));
  } catch (e) { console.error('Failed to save held repair drafts', e); }
};

interface RepairState {
  tickets: RepairTicket[];
  isLoading: boolean;
  isCreatingTicket: boolean;
  error: string | null;
  searchQuery: string;
  statusFilter: RepairTicket['status'] | 'all' | 'overdue';
  /** Ticket number of the existing ticket the last createTicket call refused to duplicate. */
  lastCreateDuplicate: string | null;
  // Actions
  fetchTickets: () => Promise<void>;
  subscribeLiveRepairs: () => () => void;
  applyLiveRepairPatch: (patch: RepairPatch) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: RepairTicket['status'] | 'all' | 'overdue') => void;
  updateStatus: (id: string, status: RepairTicket['status']) => Promise<void>;
  createTicket: (ticket: Omit<RepairTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'createdById' | 'createdByName' | 'statusHistory'>) => Promise<RepairTicket | undefined>;
  updateTicket: (id: string, updates: Partial<RepairTicket>) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  deleteDeviceFromCustomer: (customerId: string, customerPhone: string, deviceBrand: string, deviceModel: string) => Promise<number>;
  updateDeviceForCustomer: (customerId: string, customerPhone: string, oldBrand: string, oldModel: string, newBrand: string, newModel: string) => Promise<number>;
  reassignTicketsForMerge: (targetCustomerId: string, targetName: string, targetPhone: string, sourceCustomerId: string, sourcePhone?: string) => Promise<void>;
  mergeTickets: (primaryTicketId: string, secondaryTicketId: string, customUpdates?: Partial<RepairTicket>) => Promise<RepairTicket>;
  findDuplicates: () => DuplicateTicketPair[];
  // Draft Hold / Resume Actions
  activeDraft: HeldRepairDraft | null;
  heldDrafts: HeldRepairDraft[];
  saveActiveDraft: (draft: HeldRepairDraft) => void;
  clearActiveDraft: () => void;
  holdDraft: () => void;
  resumeDraft: (id: string) => void;
  discardHeldDraft: (id: string) => void;
  // Derived
  getFilteredTickets: () => RepairTicket[];
}

// The auto-heal below corrects tickets once; the server then returns them already completed, so
// re-issuing the write on every mount only bills Firestore for a no-op.
let staleHealRunThisSession = false;

// The single live repairs stream this terminal holds. See subscribeLiveRepairs.
let _liveUnsub: (() => void) | null = null;

export const useRepairStore = create<RepairState>((set, get) => ({
  tickets: [],
  isLoading: false,
  isCreatingTicket: false,
  error: null,
  searchQuery: '',
  statusFilter: 'all',
  lastCreateDuplicate: null,
  activeDraft: loadActiveDraft(),
  heldDrafts: loadHeldDrafts(),

  fetchTickets: async () => {
    // Keep the existing list on screen when re-visiting the tab; a spinner over data that is
    // already loaded is what made the switch feel like a cold start.
    if (get().tickets.length === 0) set({ isLoading: true });
    set({ error: null });
    try {
      const tickets = await repairService.getAll();
      const deduped = deduplicateTickets(tickets);

      // Auto-heal historical tickets stuck in 'returned' whose return child was completed
      const staleToHeal: { id: string; completedAt: string }[] = [];
      const healedTickets = deduped.map(t => {
        if (t.status === 'returned' && !isTicketActiveReturnPending(t, deduped)) {
          const completedAt = t.completedAt || new Date().toISOString();
          staleToHeal.push({ id: t.id, completedAt });
          return {
            ...t,
            status: 'completed' as const,
            completedAt,
          };
        }
        return t;
      });

      // Asynchronously persist to server so database is permanently clean. The
      // completion moment rides along: a healed row without its completedAt used
      // to lose the handover timestamp on every reload.
      if (staleToHeal.length > 0 && !staleHealRunThisSession) {
        staleHealRunThisSession = true;
        staleToHeal.forEach(({ id, completedAt }) => {
          repairService.updateStatus(id, 'completed', undefined, { completedAt }).catch(console.warn);
        });
      }

      set({ tickets: healedTickets, isLoading: false });
    } catch {
      set({ error: 'Failed to load repair tickets', isLoading: false });
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),

  /**
   * Merge another device's change into the list already on screen. See
   * utils/repairPatchMerge for the rules; they are unit-tested there.
   */
  applyLiveRepairPatch: (patch) => {
    set((state) => ({ tickets: mergeRepairPatch(state.tickets, patch) }));
  },

  /**
   * One live stream for the whole terminal, opened by AppShell. A page that calls
   * this while the stream is already up gets the same handle back, so a re-mount
   * cannot pile listeners on top of each other.
   */
  subscribeLiveRepairs: () => {
    if (!_liveUnsub) {
      _liveUnsub = repairService.subscribeToActive((patch) => {
        get().applyLiveRepairPatch(patch);
      });
    }
    const mine = _liveUnsub;
    return () => {
      if (_liveUnsub === mine) {
        mine();
        _liveUnsub = null;
      }
    };
  },

  updateStatus: async (id, status) => {
    const actor = useAuthStore.getState().user;
    const ticket = get().tickets.find(t => t.id === id);
    if (!ticket) return;

    // Build a new status history entry for this change
    const historyEntry: RepairStatusHistoryEntry = {
      status,
      changedById: actor?.id ?? 'unknown',
      changedByName: actor?.name ?? 'Unknown',
      at: new Date().toISOString(),
    };

    const currentHistory = ticket.statusHistory ?? [];
    const updatedHistory = [...currentHistory, historyEntry];

    const nowIso = new Date().toISOString();
    const repairedAt = (status === 'ready' && !ticket.repairedAt) ? nowIso : ticket.repairedAt;

    // 1. INSTANT OPTIMISTIC LOCAL UPDATE (Immediate 0ms UI transition)
    const optimisticTicket: RepairTicket = {
      ...ticket,
      status,
      statusHistory: updatedHistory,
      updatedAt: nowIso,
      ...(repairedAt ? { repairedAt } : {}),
    };

    set(state => ({
      tickets: state.tickets.map(t => t.id === id ? optimisticTicket : t),
    }));

    try {
      // Auto-restock parts ONLY if cancelled (parts stay inside returned devices)
      if (status === 'cancelled' && ticket.partsUsed && ticket.partsUsed.length > 0) {
        const inventoryStore = useInventoryStore.getState();
        const allItems = [...inventoryStore.products, ...inventoryStore.parts];
        ticket.partsUsed.forEach((part) => {
          if (part.productId && part.productId !== 'custom-mobile-part' && part.productId !== 'custom') {
            const exists = allItems.some(i => i.id === part.productId);
            if (exists) {
              inventoryStore.adjustStockBy(part.productId, part.quantity);
            }
          }
        });
      }

      // If transitioning from returned to in_progress, clear stale settlement data from previous cycle
      if (ticket.status === 'returned' && status === 'in_progress') {
        get().updateTicket(id, {
          paymentStatus: undefined,
          paidAmount: undefined,
          handoverAmountPaid: undefined,
          handoverPayments: undefined,
          completedAt: undefined,
          debtEntryId: undefined,
          settlementNotes: undefined,
        }).catch(console.error);
      }

      // 2. Persist to Firestore in background
      const updated = await repairService.updateStatus(id, status, updatedHistory);
      // Reconcile with server response — merge so local fields (e.g. issueDescription) are preserved
      set(state => ({
        tickets: state.tickets.map(t =>
          t.id === id
            ? { ...t, status: updated.status, statusHistory: updated.statusHistory, updatedAt: updated.updatedAt }
            : t
        ),
      }));

      const statusLabel: Record<string, string> = {
        pending: 'Pending', in_progress: 'In Progress',
        ready: 'Ready for Pickup', completed: 'Completed', cancelled: 'Cancelled',
        returned: 'Returned'
      };
      activityLogService.log(
        'repairs',
        `Repair ticket ${ticket.ticketNumber || id} status changed to ${statusLabel[status] || status}`,
        { detail: `Device: ${ticket.deviceBrand} ${ticket.deviceModel}`, entityId: ticket.id || id, entityType: 'repair', userName: actor?.name, userId: actor?.id }
      ).catch(console.error);

      // Customer audit log
      if (ticket.customerName) {
        const customer = useCustomerStore.getState().customers.find(
          c => (ticket.customerPhone && c.phone === ticket.customerPhone) ||
               (c.name ?? '').toLowerCase().trim() === ticket.customerName.toLowerCase().trim()
        );
        if (customer) {
          customerLogService.log({
            customerId: customer.id,
            customerName: customer.name,
            actionType: 'repair_updated',
            actionTitle: `Repair #${ticket.ticketNumber || id} Status: ${statusLabel[status] || status}`,
            actionDescription: `Repair ticket #${ticket.ticketNumber || id} (${ticket.deviceBrand} ${ticket.deviceModel}) marked "${statusLabel[status] || status}" by ${actor?.name || 'Staff'}.`,
            actorId: actor?.id,
            actorName: actor?.name || 'Staff',
            actorRole: actor?.role,
            metadata: { ticketId: ticket.id || id, ticketNumber: ticket.ticketNumber, status },
          }).catch(console.error);
        }
      }

      // Synchronize parent and return tickets when marked completed
      if (status === 'completed') {
        if (ticket.parentTicketId) {
          const parent = get().tickets.find(t => t.id === ticket.parentTicketId);
          if (parent && parent.status === 'returned') {
            get().updateStatus(parent.id, 'completed').catch(console.error);
          }
        } else if (ticket.activeReturnTicketId) {
          // Completing the parent means the customer took the device back: the
          // open return ticket was never worked and closes as cancelled, not as
          // a re-repair that never happened. A child already `ready` carries
          // real work and is left for the counter to settle.
          const child = get().tickets.find(t => t.id === ticket.activeReturnTicketId);
          if (child && (child.status === 'pending' || child.status === 'in_progress')) {
            get().updateStatus(child.id, 'cancelled').catch(console.error);
          }
        }
      }

      // Authoritative recalculation of customer statistics on status change
      if (status !== ticket.status) {
        const custStore = useCustomerStore.getState();
        const customer = custStore.customers.find(
          c => (ticket.customerId && c.id === ticket.customerId) ||
               (ticket.customerPhone && c.phone === ticket.customerPhone)
        );
        if (customer) {
          custStore.recalculateCustomer(customer.id).catch(console.error);
        }
      }
    } catch (err) {
      console.error('Failed to update ticket status on server:', err);
      // Rollback on failure
      set(state => ({
        tickets: state.tickets.map(t => t.id === id ? ticket : t),
        error: 'Failed to update ticket status',
      }));
    }
  },

  createTicket: async (ticket) => {
    // 1. Concurrency lock to prevent multiple rapid triggers
    if (get().isCreatingTicket) {
      console.warn('Ticket creation already in flight, skipping duplicate call');
      return;
    }

    // 2. State-level duplicate pre-check
    const currentTickets = get().tickets;
    const tempCheckTicket: RepairTicket = {
      ...ticket,
      id: 'precheck',
      ticketNumber: 'precheck',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: ticket.status ?? 'pending',
    };
    const matchingExisting = currentTickets.find(t => isSameTicketContent(t, tempCheckTicket));
    if (matchingExisting) {
      console.warn('Ticket with identical content already exists, preventing duplicate:', matchingExisting.ticketNumber);
      // The caller reads this to tell the counter the ticket was NOT created — the
      // board must never show a second device as "Ticket created!".
      set({ lastCreateDuplicate: matchingExisting.ticketNumber });
      return matchingExisting;
    }

    set({ isCreatingTicket: true });

    try {
      const actor = useAuthStore.getState().user;

      // Stamp with the creating worker's identity
      const ticketWithWorker = {
        ...ticket,
        createdById: actor?.id,
        createdByName: actor?.name,
        // First entry in status history
        statusHistory: [{
          status: ticket.status ?? 'pending',
          changedById: actor?.id ?? 'unknown',
          changedByName: actor?.name ?? 'Unknown',
          at: new Date().toISOString(),
        }] as RepairStatusHistoryEntry[],
      };

      const newTicket = await repairService.createTicket(ticketWithWorker);
      set(state => ({
        tickets: deduplicateTickets([newTicket, ...state.tickets]),
        searchQuery: '', // Clear search filter so newly added ticket is visible immediately
        lastCreateDuplicate: null,
      }));
      activityLogService.log(
        'repairs',
        `New repair ticket ${newTicket.ticketNumber} created for ${ticket.customerName}`,
        { detail: `${ticket.deviceBrand} ${ticket.deviceModel} — ${ticket.issueDescription}`, entityId: newTicket.id, entityType: 'repair', userName: actor?.name, userId: actor?.id }
      ).catch(console.error);

      // Customer audit log
      if (ticket.customerName) {
        const customer = useCustomerStore.getState().customers.find(
          c => (ticket.customerPhone && c.phone === ticket.customerPhone) ||
               (c.name ?? '').toLowerCase().trim() === ticket.customerName.toLowerCase().trim()
        );
        if (customer) {
          customerLogService.log({
            customerId: customer.id,
            customerName: customer.name,
            actionType: 'repair_created',
            actionTitle: `Repair Ticket #${newTicket.ticketNumber} Opened`,
            actionDescription: `Repair ticket #${newTicket.ticketNumber} opened for ${ticket.deviceBrand} ${ticket.deviceModel} (${ticket.issueDescription || 'Repair'}) by ${actor?.name || 'Staff'}. Estimated: ${ticket.estimatedCost ? formatCurrency(ticket.estimatedCost) : 'Pending'}.`,
            actorId: actor?.id,
            actorName: actor?.name || 'Staff',
            actorRole: actor?.role,
            metadata: { ticketId: newTicket.id, ticketNumber: newTicket.ticketNumber, device: `${ticket.deviceBrand} ${ticket.deviceModel}` },
          }).catch(console.error);
        }
      }

      return newTicket;
    } catch (err) {
      console.error('Failed to create ticket in store:', err);
      try {
        const fresh = await repairService.getAll();
        set(state => ({
          tickets: deduplicateTickets([...fresh, ...state.tickets]),
          searchQuery: '',
        }));
      } catch (recoverErr) {
        console.error('Could not recover tickets after error:', recoverErr);
      }
      return undefined;
    } finally {
      set({ isCreatingTicket: false });
    }
  },

  updateTicket: async (
    id,
    updates,
    options?: { onOutcome?: (outcome: 'committed' | 'queued') => void }
  ) => {
    const existing = get().tickets.find(t => t.id === id);
    if (!existing) return;

    // Optimistic local update
    const optimistic: RepairTicket = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    set(state => ({
      tickets: state.tickets.map(t => t.id === id ? optimistic : t),
    }));

    try {
      const updated = await repairService.updateTicket(id, updates, { onOutcome: options?.onOutcome });
      set(state => ({
        tickets: state.tickets.map(t => t.id === id ? { ...t, ...updated } : t),
      }));
      const actor = useAuthStore.getState().user;

      // Synchronize parent and return tickets when marked completed via updateTicket
      if (updates.status === 'completed') {
        if (existing.parentTicketId) {
          const parent = get().tickets.find(t => t.id === existing.parentTicketId);
          if (parent && parent.status === 'returned') {
            get().updateTicket(parent.id, {
              status: 'completed',
              completedAt: updates.completedAt || new Date().toISOString(),
              activeReturnTicketId: undefined,
            }).catch(console.error);
          }
        } else if (existing.activeReturnTicketId) {
          // Completing the parent means the customer took the device back: the
          // open return ticket was never worked and closes as cancelled, not as
          // a re-repair that never happened. A child already `ready` carries
          // real work and is left for the counter to settle.
          const child = get().tickets.find(t => t.id === existing.activeReturnTicketId);
          if (child && (child.status === 'pending' || child.status === 'in_progress')) {
            get().updateTicket(child.id, {
              status: 'cancelled',
              updatedAt: new Date().toISOString(),
            }).catch(console.error);
          }
        }
      }

      activityLogService.log(
        'repairs',
        `Repair ticket ${updated.ticketNumber || id} details updated`,
        { detail: `Customer: ${updated.customerName}, Device: ${updated.deviceBrand} ${updated.deviceModel}`, entityId: updated.id, entityType: 'repair', userName: actor?.name, userId: actor?.id }
      ).catch(console.error);
    } catch (err) {
      console.error('Failed to update ticket on server:', err);
      set(state => ({
        tickets: state.tickets.map(t => t.id === id ? existing : t),
        error: 'Failed to update ticket',
      }));
    }
  },

  // --- Draft Hold / Resume Actions ---
  saveActiveDraft: (draft) => {
    set({ activeDraft: draft });
    saveActiveDraft(draft);
  },

  clearActiveDraft: () => {
    set({ activeDraft: null });
    saveActiveDraft(null);
  },

  holdDraft: () => {
    const state = get();
    const draft = state.activeDraft;
    if (!draft) return;
    // Only hold if there is meaningful content
    const hasContent = draft.customerName.trim() || draft.customerPhone.trim() || draft.deviceBrand.trim() || draft.deviceModel.trim() || draft.issueDescription.trim();
    if (!hasContent) return;

    const heldDraft: HeldRepairDraft = {
      ...draft,
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      label: [draft.deviceBrand, draft.deviceModel, draft.customerName].filter(Boolean).join(' · ') || 'Untitled Draft',
    };
    const updatedHeld = [heldDraft, ...state.heldDrafts];
    set({ heldDrafts: updatedHeld, activeDraft: null });
    saveHeldDrafts(updatedHeld);
    saveActiveDraft(null);
  },

  resumeDraft: (id) => {
    const state = get();
    const draftToResume = state.heldDrafts.find(d => d.id === id);
    if (!draftToResume) return;

    let updatedHeld = state.heldDrafts.filter(d => d.id !== id);

    // If there's an active draft with content, hold it first
    if (state.activeDraft) {
      const hasContent = state.activeDraft.customerName.trim() || state.activeDraft.customerPhone.trim() || state.activeDraft.deviceBrand.trim();
      if (hasContent) {
        const currentAsHeld: HeldRepairDraft = {
          ...state.activeDraft,
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          label: [state.activeDraft.deviceBrand, state.activeDraft.deviceModel, state.activeDraft.customerName].filter(Boolean).join(' · ') || 'Untitled Draft',
        };
        updatedHeld = [currentAsHeld, ...updatedHeld];
      }
    }

    set({ heldDrafts: updatedHeld, activeDraft: draftToResume });
    saveHeldDrafts(updatedHeld);
    saveActiveDraft(draftToResume);
  },

  deleteTicket: async (id: string) => {
    try {
      const ticket = get().tickets.find(t => t.id === id);

      // 1. Instant optimistic state removal
      set(state => ({
        tickets: state.tickets.filter(t => t.id !== id),
      }));

      // 2. Clean up linked customer debt if one exists
      if (ticket?.debtEntryId) {
        try {
          const { useCustomerStore } = await import('./customerStore');
          await useCustomerStore.getState().deleteDebt(ticket.debtEntryId);
        } catch (dErr) {
          console.warn('Could not delete linked debt for deleted ticket:', dErr);
        }
      }

      // 3. Clean up return child / parent links
      if (ticket?.parentTicketId) {
        const parent = get().tickets.find(t => t.id === ticket.parentTicketId);
        if (parent) {
          const updatedRecords = (parent.returnRecords || []).filter(
            r => r.returnTicketId !== id && r.returnTicketNumber !== ticket.ticketNumber
          );
          const updates: Partial<RepairTicket> = {
            returnRecords: updatedRecords,
          };
          if (parent.activeReturnTicketId === id) {
            updates.activeReturnTicketId = undefined;
          }
          get().updateTicket(parent.id, updates).catch(console.error);
        }
      } else if (ticket?.activeReturnTicketId) {
        const childId = ticket.activeReturnTicketId;
        get().deleteTicket(childId).catch(console.error);
      }

      // 4. Delete from service (tombstones + local storage + firestore / offline queue)
      await repairService.deleteTicket(id);

      // 5. Activity log
      const actor = useAuthStore.getState().user;
      activityLogService.log(
        'repairs',
        `Repair ticket #${ticket?.ticketNumber || id} deleted`,
        {
          detail: `Customer: ${ticket?.customerName || 'Unknown'}, Device: ${ticket?.deviceBrand || ''} ${ticket?.deviceModel || ''}`,
          entityId: id,
          entityType: 'repair',
          userName: actor?.name,
          userId: actor?.id,
        }
      ).catch(console.error);

      // 6. Authoritative recalculation of customer financials on ticket delete
      if (ticket?.customerId) {
        try {
          const { useCustomerStore } = await import('./customerStore');
          useCustomerStore.getState().recalculateCustomer(ticket.customerId).catch(console.error);
        } catch (cErr) {
          console.warn('Could not recalculate customer stats on deleted ticket:', cErr);
        }
      }
    } catch (err) {
      console.error('Failed to delete ticket', err);
      throw err;
    }
  },

  deleteDeviceFromCustomer: async (customerId: string, customerPhone: string, deviceBrand: string, deviceModel: string) => {
    const cleanBrand = deviceBrand.toLowerCase().trim();
    const cleanModel = deviceModel.toLowerCase().trim();
    const cleanPhone = (customerPhone || '').replace(/\D/g, '');

    const state = get();
    const matchingTickets = state.tickets.filter(t => {
      const matchDevice = (t.deviceBrand || '').toLowerCase().trim() === cleanBrand &&
        (t.deviceModel || '').toLowerCase().trim() === cleanModel;
      const matchCust = (customerId && t.customerId === customerId) ||
        (cleanPhone && (t.customerPhone || '').replace(/\D/g, '') === cleanPhone);
      return matchDevice && matchCust;
    });

    if (matchingTickets.length === 0) return 0;

    const ids = matchingTickets.map(t => t.id);
    await repairService.deleteTicketsByIds(ids);

    const idSet = new Set(ids);
    set(state => ({
      tickets: state.tickets.filter(t => !idSet.has(t.id)),
    }));

    return ids.length;
  },

  updateDeviceForCustomer: async (customerId, customerPhone, oldBrand, oldModel, newBrand, newModel) => {
    const cleanOldBrand = (oldBrand || '').toLowerCase().trim();
    const cleanOldModel = (oldModel || '').toLowerCase().trim();
    const cleanPhone = (customerPhone || '').replace(/\D/g, '');

    const count = await repairService.updateDeviceForCustomer(
      customerId,
      customerPhone,
      oldBrand,
      oldModel,
      newBrand,
      newModel
    );

    set(state => ({
      tickets: state.tickets.map(t => {
        const matchDevice = (t.deviceBrand || '').toLowerCase().trim() === cleanOldBrand &&
          (t.deviceModel || '').toLowerCase().trim() === cleanOldModel;
        const matchCust = (customerId && t.customerId === customerId) ||
          (cleanPhone && (t.customerPhone || '').replace(/\D/g, '') === cleanPhone);
        if (matchDevice && matchCust) {
          return {
            ...t,
            deviceBrand: newBrand.trim(),
            deviceModel: newModel.trim(),
            updatedAt: new Date().toISOString(),
          };
        }
        return t;
      }),
    }));

    return count;
  },

  reassignTicketsForMerge: async (targetCustomerId, targetName, targetPhone, sourceCustomerId, sourcePhone) => {
    await repairService.reassignCustomerTickets(
      targetCustomerId,
      targetName,
      targetPhone,
      sourceCustomerId,
      sourcePhone
    );
    const cleanSourcePhone = (sourcePhone || '').replace(/\D/g, '');
    set(state => ({
      tickets: state.tickets.map(t => {
        const matches = t.customerId === sourceCustomerId ||
          (cleanSourcePhone && (t.customerPhone || '').replace(/\D/g, '') === cleanSourcePhone);
        if (matches) {
          return {
            ...t,
            customerId: targetCustomerId,
            customerName: targetName,
            customerPhone: targetPhone,
            updatedAt: new Date().toISOString(),
          };
        }
        return t;
      }),
    }));
  },

  mergeTickets: async (primaryTicketId, secondaryTicketId, customUpdates = {}) => {
    const { tickets } = get();
    const primary = tickets.find(t => t.id === primaryTicketId);
    const secondary = tickets.find(t => t.id === secondaryTicketId);

    if (!primary || !secondary) {
      throw new Error('Both repair tickets must exist to perform merge.');
    }

    // Combine partsUsed
    const mergedParts = [...(primary.partsUsed || [])];
    if (secondary.partsUsed && secondary.partsUsed.length > 0) {
      secondary.partsUsed.forEach(part => {
        if (!mergedParts.some(p => p.productId === part.productId)) {
          mergedParts.push(part);
        }
      });
    }

    const remarks = [primary.remark, secondary.remark].filter(Boolean);
    const fusedRemark = remarks.length > 0 ? Array.from(new Set(remarks)).join(' | ') : undefined;

    // The handover total is additive below, so the tender rows must add up the same way.
    const fusedHandoverPayments = [...(primary.handoverPayments || []), ...(secondary.handoverPayments || [])];

    const fusedSettlementNotes = [primary.settlementNotes, secondary.settlementNotes]
      .filter(Boolean)
      .join('\n---\nMerged Notes:\n') || undefined;

    // Combine status history
    const mergedHistory = [...(primary.statusHistory || []), ...(secondary.statusHistory || [])].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );

    const consolidatedUpdates: Partial<RepairTicket> = {
      ...customUpdates,
      partsUsed: mergedParts.length > 0 ? mergedParts : undefined,
      remark: customUpdates.remark !== undefined ? customUpdates.remark : fusedRemark,
      settlementNotes: customUpdates.settlementNotes !== undefined ? customUpdates.settlementNotes : fusedSettlementNotes,
      statusHistory: mergedHistory.length > 0 ? mergedHistory : undefined,
      // Money is additive, never a maximum: a duplicate pair that both took
      // deposits has been paid twice, and taking the larger number would make
      // the smaller payment vanish from the ledger and overcharge at settle.
      // The secondary's own debt row stays in the customer's ledger untouched —
      // only the ticket link follows the primary.
      depositAmount: (primary.depositAmount || 0) + (secondary.depositAmount || 0) || undefined,
      paidAmount: (primary.paidAmount || 0) + (secondary.paidAmount || 0) || undefined,
      handoverAmountPaid: (primary.handoverAmountPaid || 0) + (secondary.handoverAmountPaid || 0) || undefined,
      handoverPayments: fusedHandoverPayments.length > 0 ? fusedHandoverPayments : undefined,
      debtEntryId: primary.debtEntryId || secondary.debtEntryId,
      trackingPin: primary.trackingPin || secondary.trackingPin,
    };

    // 1. Call service to update primary and archive secondary (NEVER delete from DB)
    const finalPrimary = await repairService.mergeTickets(primary.id, secondary.id, consolidatedUpdates);

    // 2. Update in-memory state: secondary is hidden from active list
    set(state => ({
      tickets: state.tickets
        .filter(t => t.id !== secondary.id)
        .map(t => t.id === primary.id ? { ...t, ...consolidatedUpdates, ...finalPrimary } : t),
    }));

    // 3. Audit log
    const actor = useAuthStore.getState().user;
    activityLogService.log(
      'repairs',
      `Duplicate repair ticket #${secondary.ticketNumber} safely merged into #${primary.ticketNumber} by ${actor?.name || 'Staff'}.`,
      {
        detail: `secondaryTicketId=${secondary.id} secondaryTicketNumber=${secondary.ticketNumber}`,
        entityId: primary.id,
        entityType: 'repair',
        userName: actor?.name,
        userId: actor?.id,
      }
    ).catch(console.error);

    return finalPrimary;
  },

  findDuplicates: () => {
    return findDuplicateTickets(get().tickets);
  },

  discardHeldDraft: (id) => {
    const state = get();
    const updated = state.heldDrafts.filter(d => d.id !== id);
    set({ heldDrafts: updated });
    saveHeldDrafts(updated);
  },

  getFilteredTickets: () => {
    const { tickets, searchQuery, statusFilter } = get();
    let filtered = deduplicateTickets(tickets);
    if (statusFilter === 'overdue') {
      filtered = filtered.filter(t => isTicketOverdue(t));
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(t => t.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = normalizeArabic(searchQuery);
      // Every field can be missing on a legacy ticket; an unguarded toLowerCase()
      // here used to crash the whole search box on the first keystroke.
      filtered = filtered.filter(t =>
        normalizeArabic(t.customerName).includes(q) ||
        normalizeArabic(t.ticketNumber).includes(q) ||
        normalizeArabic(t.deviceModel).includes(q) ||
        normalizeArabic(t.deviceBrand).includes(q) ||
        normalizeArabic(t.customerPhone).includes(q) ||
        normalizeArabic(t.issueDescription).includes(q)
      );
    }
    return filtered;
  },
}));
