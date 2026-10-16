import { create } from 'zustand';
import type { RepairTicket, RepairStatusHistoryEntry, HeldRepairDraft } from '../types';
import { repairService } from '../services/repairService';
import { activityLogService } from '../services/activityLogService';
import { customerLogService } from '../services/customerLogService';
import { useCustomerStore } from './customerStore';
import { useAuthStore } from './authStore';
import { useInventoryStore } from './inventoryStore';
import { formatCurrency } from '../utils/formatCurrency';
import { deduplicateTickets, isSameTicketContent } from '../utils/ticketDeduplication';

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
  statusFilter: RepairTicket['status'] | 'all';
  // Actions
  fetchTickets: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: RepairTicket['status'] | 'all') => void;
  updateStatus: (id: string, status: RepairTicket['status']) => Promise<void>;
  createTicket: (ticket: Omit<RepairTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'createdById' | 'createdByName' | 'statusHistory'>) => Promise<RepairTicket | undefined>;
  updateTicket: (id: string, updates: Partial<RepairTicket>) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  deleteDeviceFromCustomer: (customerId: string, customerPhone: string, deviceBrand: string, deviceModel: string) => Promise<number>;
  updateDeviceForCustomer: (customerId: string, customerPhone: string, oldBrand: string, oldModel: string, newBrand: string, newModel: string) => Promise<number>;
  reassignTicketsForMerge: (targetCustomerId: string, targetName: string, targetPhone: string, sourceCustomerId: string, sourcePhone?: string) => Promise<void>;
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

export const useRepairStore = create<RepairState>((set, get) => ({
  tickets: [],
  isLoading: false,
  isCreatingTicket: false,
  error: null,
  searchQuery: '',
  statusFilter: 'all',
  activeDraft: loadActiveDraft(),
  heldDrafts: loadHeldDrafts(),

  fetchTickets: async () => {
    set({ isLoading: true, error: null });
    try {
      const tickets = await repairService.getAll();
      set({ tickets: deduplicateTickets(tickets), isLoading: false });
    } catch {
      set({ error: 'Failed to load repair tickets', isLoading: false });
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),

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

    // 1. INSTANT OPTIMISTIC LOCAL UPDATE (Immediate 0ms UI transition)
    const optimisticTicket: RepairTicket = {
      ...ticket,
      status,
      statusHistory: updatedHistory,
      updatedAt: new Date().toISOString(),
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
               c.name.toLowerCase().trim() === ticket.customerName.toLowerCase().trim()
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

      // Problem 11 fix: Update customer statistics if completed directly
      if (status === 'completed' && ticket.status !== 'completed') {
        const custStore = useCustomerStore.getState();
        const customer = custStore.customers.find(
          c => (ticket.customerId && c.id === ticket.customerId) ||
               (ticket.customerPhone && c.phone === ticket.customerPhone)
        );
        if (customer) {
          const cost = ticket.actualCost ?? ticket.estimatedCost ?? 0;
          custStore.updateCustomer(customer.id, {
            totalPurchases: (customer.totalPurchases || 0) + 1,
            totalSpent: (customer.totalSpent || 0) + cost,
            lastVisitDate: new Date().toISOString(),
          }).catch(console.error);
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
               c.name.toLowerCase().trim() === ticket.customerName.toLowerCase().trim()
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

  updateTicket: async (id, updates) => {
    const existing = get().tickets.find(t => t.id === id);
    if (!existing) return;

    // Optimistic local update
    const optimistic: RepairTicket = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    set(state => ({
      tickets: state.tickets.map(t => t.id === id ? optimistic : t),
    }));

    try {
      const updated = await repairService.updateTicket(id, updates);
      set(state => ({
        tickets: state.tickets.map(t => t.id === id ? { ...t, ...updated } : t),
      }));
      const actor = useAuthStore.getState().user;
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
      await repairService.deleteTicket(id);
      set(state => ({
        tickets: state.tickets.filter(t => t.id !== id),
      }));
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

  discardHeldDraft: (id) => {
    const state = get();
    const updated = state.heldDrafts.filter(d => d.id !== id);
    set({ heldDrafts: updated });
    saveHeldDrafts(updated);
  },

  getFilteredTickets: () => {
    const { tickets, searchQuery, statusFilter } = get();
    let filtered = deduplicateTickets(tickets);
    if (statusFilter !== 'all') {
      filtered = filtered.filter(t => t.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.customerName.toLowerCase().includes(q) ||
        t.ticketNumber.toLowerCase().includes(q) ||
        t.deviceModel.toLowerCase().includes(q) ||
        t.deviceBrand.toLowerCase().includes(q) ||
        (t.customerPhone ?? '').toLowerCase().includes(q) ||
        (t.issueDescription ?? '').toLowerCase().includes(q)
      );
    }
    return filtered;
  },
}));
