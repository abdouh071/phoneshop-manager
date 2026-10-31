import { create } from 'zustand';
import type { Customer, CustomerDebtEntry, CustomerDebtPayment, CustomerActivityLog, CustomerRegisteredDevice } from '../types';
import { isShopCustomer, isRetailCustomer } from '../types';
import { customerService } from '../services/customerService';
import { debtService } from '../services/debtService';
import { customerLogService } from '../services/customerLogService';
import { activityLogService } from '../services/activityLogService';
import { transactionService } from '../services/transactionService';
import { repairService } from '../services/repairService';
import { useAuthStore } from './authStore';
import { formatCurrency } from '../utils/formatCurrency';
import { isPhoneMatch, normalizePhoneDigits, isMoreDescriptiveName, formatStandardPhone, GENERIC_NAMES, isValidNameForDeduplication, isDummyPhone } from '../utils/phoneUtils';
import { calculateCustomerFinancials, matchesCustomer, isGenericCustomerName } from '../utils/customerFinancials';

interface CustomerState {
  customers: Customer[];
  debts: CustomerDebtEntry[];
  customerLogs: CustomerActivityLog[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  // Actions
  fetchCustomers: () => Promise<void>;
  fetchDebts: () => Promise<void>;
  fetchCustomerLogs: (customerId?: string) => Promise<void>;
  recalculateCustomer: (customerId: string) => Promise<void>;
  recalculateAllCustomerFinancials: () => Promise<void>;
  addCustomerAuditLog: (
    entry: Omit<CustomerActivityLog, 'id' | 'date'> & { date?: string }
  ) => Promise<CustomerActivityLog>;
  getCustomerLogs: (customerId: string) => CustomerActivityLog[];
  setSearchQuery: (query: string) => void;
  addCustomer: (customer: Omit<Customer, 'id' | 'totalPurchases' | 'totalSpent' | 'lastVisitDate' | 'joinDate' | 'totalDebt'>) => Promise<Customer>;
  addCustomerWithDebt: (
    customer: Omit<Customer, 'id' | 'totalPurchases' | 'totalSpent' | 'lastVisitDate' | 'joinDate' | 'totalDebt'>,
    openingDebt: {
      productOrService: string;
      totalAmount: number;
      amountPaid?: number;
      date?: string;
      dueDate?: string;
      notes?: string;
    }
  ) => Promise<{ customer: Customer; debt?: CustomerDebtEntry }>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  addDebt: (
    debt: Omit<CustomerDebtEntry, 'id' | 'createdAt' | 'remainingBalance' | 'status' | 'payments'> & {
      payments?: CustomerDebtPayment[];
      allowCreditLimitOverride?: boolean;
    }
  ) => Promise<CustomerDebtEntry>;
  recordDebtPayment: (
    debtId: string,
    payment: Omit<CustomerDebtPayment, 'id' | 'date'> & { date?: string }
  ) => Promise<CustomerDebtEntry>;
  updateDebtAmount: (
    debtId: string,
    newTotalAmount: number,
    newItemsSummary?: string
  ) => Promise<CustomerDebtEntry>;
  deleteDebt: (debtId: string) => Promise<void>;
  getCustomerDebtTotal: (customerId: string) => number;
  getCustomerDebts: (customerId: string) => CustomerDebtEntry[];
  /** Find an existing customer by phone or create a new one with seamless non-destructive auto-enrichment. */
  findOrCreateCustomer: (data: {
    name: string;
    phone: string;
    email?: string;
    accountType?: 'retail' | 'shop_repairer';
    shopName?: string;
    address?: string;
    rc?: string;
    nif?: string;
    nis?: string;
    art?: string;
    wholesaleDiscountPercent?: number;
    creditLimit?: number;
    notes?: string;
    device?: {
      brand: string;
      model: string;
      imei?: string;
      notes?: string;
    };
  }) => Promise<Customer>;
  /** Explicitly enriches an existing customer profile in the background without overwriting existing data. */
  enrichCustomer: (customerId: string, data: {
    name?: string;
    phone?: string;
    email?: string;
    shopName?: string;
    address?: string;
    rc?: string;
    nif?: string;
    nis?: string;
    art?: string;
    wholesaleDiscountPercent?: number;
    creditLimit?: number;
    notes?: string;
    device?: {
      brand: string;
      model: string;
      imei?: string;
      notes?: string;
    };
  }) => Promise<Customer>;
  // Store Credit (Avoir) and Exchange Debt Deductions
  addStoreCredit: (customerId: string, amount: number, note?: string) => Promise<number>;
  useStoreCredit: (customerId: string, amount: number, note?: string) => Promise<number>;
  deductFromDebt: (customerId: string, amount: number, note?: string) => Promise<{ amountDeducted: number; remainingSurplus: number }>;
  // Customer Management & Deduplication
  deleteCustomer: (id: string, options?: { deleteDebts?: boolean }) => Promise<void>;
  switchAccountType: (customerId: string, newType: 'retail' | 'shop_repairer', shopName?: string) => Promise<void>;
  mergeCustomers: (options: {
    primaryCustomerId: string;
    secondaryCustomerId: string;
    keepAs: 'retail' | 'shop_repairer';
    customName?: string;
    customPhone?: string;
    customShopName?: string;
    deleteSecondaryDoc?: boolean;
  }) => Promise<Customer>;
  autoResolveAllDuplicates: (options?: {
    deleteSecondary?: boolean;
  }) => Promise<{ mergedCount: number; deletedCount: number }>;
  findDuplicates: () => Array<{ retail: Customer; shop: Customer; reason: string }>;
  // Derived
  getFilteredCustomers: () => Customer[];
  getRetailCustomers: () => Customer[];
  getShopCustomers: () => Customer[];
}

// Concurrency guard to prevent duplicate customer profiles when simultaneous checkouts occur
const inFlightCustomerCreations = new Map<string, Promise<Customer>>();

export const useCustomerStore = create<CustomerState>((set, get) => ({
  customers: [],
  debts: [],
  customerLogs: [],
  isLoading: false,
  error: null,
  searchQuery: '',

  fetchCustomers: async () => {
    set({ isLoading: true, error: null });
    try {
      const [customers, debts, logs, transactions, tickets] = await Promise.all([
        customerService.getAll(),
        debtService.getAll(),
        customerLogService.getAll(),
        transactionService.getAll().catch(() => []),
        repairService.getAll().catch(() => []),
      ]);
      
      // 1. Enrich existing customer documents with financials and devices from their repair tickets
      const merged = customers.map(c => {
        const fin = calculateCustomerFinancials(c, tickets, transactions, debts);
        const cTickets = tickets.filter(t => matchesCustomer(c, t));
        
        // Merge registered devices from tickets into customer's profile if not already present
        const currentDevs = c.registeredDevices ? [...c.registeredDevices] : [];
        const seen = new Set(
          currentDevs.map(d => `${d.brand || ''}-${d.model || ''}-${d.imei || ''}`.toLowerCase().trim())
        );

        for (const t of cTickets) {
          if (t.deviceBrand || t.deviceModel || t.deviceImei) {
            const devKey = `${t.deviceBrand || ''}-${t.deviceModel || ''}-${t.deviceImei || ''}`.toLowerCase().trim();
            if (!seen.has(devKey)) {
              seen.add(devKey);
              currentDevs.push({
                brand: t.deviceBrand || '',
                model: t.deviceModel || '',
                imei: t.deviceImei || undefined,
                firstSeen: t.createdAt,
                lastSeen: t.createdAt,
              });
            }
          }
        }

        return {
          ...c,
          totalDebt: fin.totalDebt,
          totalSpent: fin.totalSpent,
          totalPurchases: fin.totalPurchases,
          lastVisitDate: fin.lastVisitDate || c.lastVisitDate,
          registeredDevices: currentDevs,
        };
      });

      // 2. Auto-discover repair clients that exist on tickets but have no standalone customer document
      const orphanTickets = tickets.filter(t => !customers.some(c => matchesCustomer(c, t)));
      const orphanGroups: Array<{
        tickets: typeof tickets;
        primaryTicket: typeof tickets[0];
      }> = [];

      orphanTickets.forEach(t => {
        const phone = (t.customerPhone || '').trim();
        const cleanPhone = phone ? normalizePhoneDigits(phone) : '';
        const name = (t.customerName || '').trim().toLowerCase();

        const group = orphanGroups.find(g => {
          if (cleanPhone && cleanPhone.length >= 7) {
            const gClean = g.primaryTicket.customerPhone ? normalizePhoneDigits(g.primaryTicket.customerPhone) : '';
            if (gClean && isPhoneMatch(gClean, cleanPhone)) return true;
          }
          if (name && !isGenericCustomerName(name) && name.length >= 3) {
            const gName = (g.primaryTicket.customerName || '').trim().toLowerCase();
            if (gName === name) return true;
          }
          return false;
        });

        if (group) {
          group.tickets.push(t);
        } else {
          orphanGroups.push({
            tickets: [t],
            primaryTicket: t,
          });
        }
      });

      const synthesizedCustomers: Customer[] = orphanGroups.map(group => {
        const pt = group.primaryTicket;
        const allDevices: CustomerRegisteredDevice[] = [];
        const seenDevs = new Set<string>();

        group.tickets.forEach(t => {
          if (t.deviceBrand || t.deviceModel || t.deviceImei) {
            const devKey = `${t.deviceBrand || ''}-${t.deviceModel || ''}-${t.deviceImei || ''}`.toLowerCase().trim();
            if (!seenDevs.has(devKey)) {
              seenDevs.add(devKey);
              allDevices.push({
                brand: t.deviceBrand || '',
                model: t.deviceModel || '',
                imei: t.deviceImei || undefined,
                firstSeen: t.createdAt,
                lastSeen: t.createdAt,
              });
            }
          }
        });

        const rawPhone = pt.customerPhone || '';
        const cleanPhone = rawPhone ? normalizePhoneDigits(rawPhone) : '';
        const formattedPhone = rawPhone ? formatStandardPhone(rawPhone) : '';

        const synthCustomer: Customer = {
          id: pt.customerId || `ticket_client_${cleanPhone || pt.id}`,
          name: pt.customerName?.trim() || `Client #${pt.ticketNumber || pt.id.slice(-4)}`,
          phone: formattedPhone || rawPhone,
          ...(cleanPhone ? { normalizedPhone: cleanPhone } : {}),
          accountType: (pt as any).accountType === 'shop_repairer' ? 'shop_repairer' : 'retail',
          shopName: (pt as any).shopName || undefined,
          totalPurchases: 0,
          totalSpent: 0,
          totalDebt: 0,
          joinDate: pt.createdAt || new Date().toISOString(),
          lastVisitDate: pt.createdAt || new Date().toISOString(),
          registeredDevices: allDevices,
        };

        const fin = calculateCustomerFinancials(synthCustomer, group.tickets, transactions, debts);
        return {
          ...synthCustomer,
          totalDebt: fin.totalDebt,
          totalSpent: fin.totalSpent,
          totalPurchases: fin.totalPurchases || group.tickets.length,
          lastVisitDate: fin.lastVisitDate || synthCustomer.lastVisitDate,
        };
      });

      const allMerged = [...merged, ...synthesizedCustomers];
      set({ customers: allMerged, debts, customerLogs: logs, isLoading: false });

      // Asynchronously repair any corrupted or stale records in Firestore in background
      setTimeout(() => {
        merged.forEach(c => {
          const original = customers.find(orig => orig.id === c.id);
          if (
            original &&
            (Math.abs((original.totalSpent || 0) - c.totalSpent) > 0.01 ||
              (original.totalDebt || 0) !== c.totalDebt ||
              (original.totalPurchases || 0) !== c.totalPurchases)
          ) {
            customerService.updateCustomer(c.id, {
              totalSpent: c.totalSpent,
              totalDebt: c.totalDebt,
              totalPurchases: c.totalPurchases,
              lastVisitDate: c.lastVisitDate,
            }).catch(console.warn);
          }
        });
      }, 1000);
    } catch {
      set({ error: 'Failed to load customers', isLoading: false });
    }
  },

  fetchDebts: async () => {
    try {
      const [debts, transactions, tickets] = await Promise.all([
        debtService.getAll(),
        transactionService.getAll().catch(() => []),
        repairService.getAll().catch(() => []),
      ]);
      
      set(state => ({
        debts,
        customers: state.customers.map(c => {
          const fin = calculateCustomerFinancials(c, tickets, transactions, debts);
          return {
            ...c,
            totalDebt: fin.totalDebt,
            totalSpent: fin.totalSpent,
            totalPurchases: fin.totalPurchases,
            lastVisitDate: fin.lastVisitDate || c.lastVisitDate,
          };
        }),
      }));
    } catch (err) {
      console.error('Failed to fetch debts', err);
    }
  },

  fetchCustomerLogs: async (customerId) => {
    try {
      const logs = customerId
        ? await customerLogService.getByCustomerId(customerId)
        : await customerLogService.getAll();
      
      set(state => {
        const others = customerId ? state.customerLogs.filter(l => l.customerId !== customerId) : [];
        return { customerLogs: [...logs, ...others] };
      });
    } catch (err) {
      console.error('Failed to fetch customer logs', err);
    }
  },

  addCustomerAuditLog: async (entry) => {
    const created = await customerLogService.log(entry);
    set(state => ({
      customerLogs: [created, ...state.customerLogs.filter(l => l.id !== created.id)],
    }));

    // Also forward to the central Activity Log so it shows in the Activity tab
    const actor = useAuthStore.getState().user;
    activityLogService.log('sales', `Customer: ${entry.actionTitle} — ${entry.customerName}`, {
      detail: entry.actionDescription,
      entityId: entry.customerId,
      entityType: 'customer',
      userName: entry.actorName || actor?.name,
      userId: entry.actorId || actor?.id,
    }).catch(console.error);

    return created;
  },

  getCustomerLogs: (customerId) => {
    return get()
      .customerLogs.filter(l => l.customerId === customerId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  addCustomer: async (customer) => {
    try {
      const newCustomer = await customerService.addCustomer(customer);
      set(state => ({
        customers: state.customers.some(c => c.id === newCustomer.id)
          ? state.customers.map(c => c.id === newCustomer.id ? { ...newCustomer, totalDebt: c.totalDebt || 0 } : c)
          : [...state.customers, { ...newCustomer, totalDebt: 0 }],
      }));

      // Append-only audit log
      const actor = useAuthStore.getState().user;
      get().addCustomerAuditLog({
        customerId: newCustomer.id,
        customerName: newCustomer.name,
        actionType: 'customer_created',
        actionTitle: 'Customer Profile Registered',
        actionDescription: `${newCustomer.name} was registered as a new customer by ${actor?.name || 'Staff'}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: { phone: newCustomer.phone, email: newCustomer.email },
      }).catch(console.error);

      return newCustomer;
    } catch (err) {
      set({ error: 'Failed to add customer' });
      throw err;
    }
  },

  addCustomerWithDebt: async (customerData, openingDebt) => {
    try {
      const newCustomer = await customerService.addCustomer(customerData);
      
      let createdDebt: CustomerDebtEntry | undefined;
      if (openingDebt && openingDebt.totalAmount > 0) {
        createdDebt = await debtService.addDebt({
          customerId: newCustomer.id,
          customerName: newCustomer.name,
          customerPhone: newCustomer.phone,
          productOrService: openingDebt.productOrService || 'Opening Balance',
          totalAmount: openingDebt.totalAmount,
          amountPaid: openingDebt.amountPaid || 0,
          date: openingDebt.date || new Date().toISOString(),
          dueDate: openingDebt.dueDate,
          notes: openingDebt.notes,
        });
      }

      const debtBalance = createdDebt ? createdDebt.remainingBalance : 0;

      set(state => ({
        customers: state.customers.some(c => c.id === newCustomer.id)
          ? state.customers.map(c => c.id === newCustomer.id ? { ...newCustomer, totalDebt: debtBalance } : c)
          : [...state.customers, { ...newCustomer, totalDebt: debtBalance }],
        debts: createdDebt ? [createdDebt, ...state.debts] : state.debts,
      }));

      // Append-only audit log
      const actor = useAuthStore.getState().user;
      const debtDesc = createdDebt
        ? ` with opening credit tab of ${formatCurrency(createdDebt.totalAmount)} for "${createdDebt.productOrService}"`
        : '';
      get().addCustomerAuditLog({
        customerId: newCustomer.id,
        customerName: newCustomer.name,
        actionType: createdDebt ? 'debt_added' : 'customer_created',
        actionTitle: createdDebt ? 'Profile Created with Opening Debt' : 'Customer Profile Registered',
        actionDescription: `${newCustomer.name} registered${debtDesc} by ${actor?.name || 'Staff'}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: { openingDebt, phone: newCustomer.phone },
      }).catch(console.error);

      return { customer: newCustomer, debt: createdDebt };
    } catch (err) {
      set({ error: 'Failed to add customer with debt' });
      throw err;
    }
  },

  updateCustomer: async (id, updates) => {
    try {
      const target = get().customers.find(c => c.id === id);
      const updated = await customerService.updateCustomer(id, updates);
      set(state => ({
        customers: state.customers.map(c => c.id === id ? { ...updated, totalDebt: c.totalDebt } : c),
      }));

      // Append-only audit log
      const actor = useAuthStore.getState().user;
      const changeKeys = Object.keys(updates).filter(k => (updates as any)[k] !== (target as any)?.[k]);
      get().addCustomerAuditLog({
        customerId: id,
        customerName: updated.name,
        actionType: 'customer_updated',
        actionTitle: 'Customer Profile Updated',
        actionDescription: `Profile of ${updated.name} edited by ${actor?.name || 'Staff'} (modified: ${changeKeys.join(', ') || 'details'}).`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: updates,
      }).catch(console.error);

      // Propagate name and phone updates to open debts and active repairs (Gap 7 fix)
      if (updates.name || updates.phone) {
        const newName = updates.name || target?.name || updated.name;
        const newPhone = updates.phone || target?.phone || updated.phone;

        // 1. Update in-memory debts and Firestore debts
        debtService.reassignDebtsForCustomer(id, newName, newPhone, id).catch(console.error);
        set(state => ({
          debts: state.debts.map(d =>
            d.customerId === id ? { ...d, customerName: newName, customerPhone: newPhone } : d
          ),
        }));

        // 2. Propagate to repair tickets for this customer
        try {
          const { useRepairStore } = await import('./repairStore');
          const repairStore = useRepairStore.getState();
          const custTickets = repairStore.tickets.filter(t => t.customerId === id);
          custTickets.forEach(t => {
            repairStore.updateTicket(t.id, { customerName: newName, customerPhone: newPhone }).catch(console.error);
          });
        } catch (repErr) {
          console.warn('Could not propagate customer updates to repairs:', repErr);
        }
      }
    } catch {
      set({ error: 'Failed to update customer' });
    }
  },

  addDebt: async (debtData) => {
    try {
      // Problem 3 fix: Enforce credit limit before adding debt
      const customer = get().customers.find(c => c.id === debtData.customerId);
      const actor = useAuthStore.getState().user;
      const isAdmin = actor?.role === 'admin';
      let isOverridden = false;

      if (customer?.creditLimit) {
        const currentDebt = get().getCustomerDebtTotal(debtData.customerId);
        const newDebtAmount = (debtData.totalAmount || 0) - (debtData.amountPaid || 0);
        const projectedBalance = currentDebt + newDebtAmount;
        if (projectedBalance > customer.creditLimit) {
          if (!debtData.allowCreditLimitOverride && !isAdmin) {
            throw new Error(
              `Credit limit exceeded. Current debt: ${formatCurrency(currentDebt)}, new debt: ${formatCurrency(newDebtAmount)}, limit: ${formatCurrency(customer.creditLimit)}. Admin override required.`
            );
          }
          isOverridden = true;
        }
      }

      const newDebt = await debtService.addDebt(debtData);
      set(state => {
        const updatedDebts = [newDebt, ...state.debts];
        // Strict customerId match only — avoids inflating debt via loose matchesCustomer heuristics
        const newTotalDebt = updatedDebts
          .filter(d => d.customerId === debtData.customerId && d.status !== 'paid' && d.remainingBalance > 0)
          .reduce((sum, d) => sum + d.remainingBalance, 0);

        return {
          debts: updatedDebts,
          customers: state.customers.map(c =>
            c.id === debtData.customerId ? { ...c, totalDebt: newTotalDebt } : c
          ),
        };
      });

      // Append-only audit log
      get().addCustomerAuditLog({
        customerId: newDebt.customerId,
        customerName: newDebt.customerName,
        actionType: 'debt_added',
        actionTitle: isOverridden ? 'Credit Tab Opened (Limit Overridden)' : 'Credit Tab Opened',
        actionDescription: `${newDebt.customerName}'s credit tab was opened for "${newDebt.productOrService}" (${formatCurrency(newDebt.totalAmount)}) by ${actor?.name || 'Staff'}${isOverridden ? ' [ADMIN OVERRIDE: Limit Exceeded]' : ''}${newDebt.dueDate ? ` (Due: ${newDebt.dueDate.slice(0, 10)})` : ''}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: { debtId: newDebt.id, totalAmount: newDebt.totalAmount, dueDate: newDebt.dueDate, isLimitOverridden: isOverridden },
      }).catch(console.error);

      return newDebt;
    } catch (err) {
      console.error('Failed to add debt', err);
      throw err;
    }
  },

  recordDebtPayment: async (debtId, paymentData) => {
    try {
      const updatedDebt = await debtService.recordPayment(debtId, paymentData);
      set(state => {
        const updatedDebts = state.debts.map(d => (d.id === debtId ? updatedDebt : d));
        const targetCust = state.customers.find(c => c.id === updatedDebt.customerId);
        const newTotalDebt = updatedDebts
          .filter(d => (d.customerId === updatedDebt.customerId || (targetCust && matchesCustomer(targetCust, d))) && d.status !== 'paid')
          .reduce((sum, d) => sum + d.remainingBalance, 0);

        return {
          debts: updatedDebts,
          customers: state.customers.map(c =>
            c.id === updatedDebt.customerId ? { ...c, totalDebt: newTotalDebt } : c
          ),
        };
      });

      // Append-only audit log
      const actor = useAuthStore.getState().user;
      const isSettled = updatedDebt.remainingBalance <= 0;
      const methodLabel = paymentData.method.toUpperCase();
      const desc = isSettled
        ? `${updatedDebt.customerName}'s debt for "${updatedDebt.productOrService}" was marked fully PAID & settled by ${actor?.name || 'Staff'} (+${formatCurrency(paymentData.amount)} via ${methodLabel}).`
        : `Payment of ${formatCurrency(paymentData.amount)} (${methodLabel}) for "${updatedDebt.productOrService}" recorded by ${actor?.name || 'Staff'}. Remaining balance: ${formatCurrency(updatedDebt.remainingBalance)}.`;

      get().addCustomerAuditLog({
        customerId: updatedDebt.customerId,
        customerName: updatedDebt.customerName,
        actionType: 'debt_payment',
        actionTitle: isSettled ? 'Debt Fully Settled' : 'Debt Payment Recorded',
        actionDescription: desc,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: {
          debtId: updatedDebt.id,
          productOrService: updatedDebt.productOrService,
          amountPaid: paymentData.amount,
          remainingBalance: updatedDebt.remainingBalance,
          method: paymentData.method,
          note: paymentData.note,
        },
      }).catch(console.error);

      // Sync payment status and paidAmount with linked Repair Ticket (Gap 2 fix)
      if (updatedDebt.type === 'repair' || updatedDebt.productOrService?.toLowerCase().includes('repair')) {
        try {
          const { useRepairStore } = await import('./repairStore');
          const repairStore = useRepairStore.getState();
          const matchingTicket = repairStore.tickets.find(t =>
            // Priority: explicit linkedTicketId → debtEntryId on ticket → legacy string match
            (updatedDebt.linkedTicketId && updatedDebt.linkedTicketId === t.id) ||
            (t.debtEntryId && t.debtEntryId === debtId) ||
            (t.ticketNumber && updatedDebt.productOrService?.includes(t.ticketNumber))
          );
          if (matchingTicket) {
            const finalCost = matchingTicket.actualCost ?? matchingTicket.estimatedCost ?? 0;
            const newTotalPaid = Math.max(0, finalCost - updatedDebt.remainingBalance);
            const newPaymentStatus = updatedDebt.remainingBalance <= 0 ? 'paid' : (newTotalPaid > 0 ? 'partial' : 'debt');
            await repairStore.updateTicket(matchingTicket.id, {
              paidAmount: newTotalPaid,
              paymentStatus: newPaymentStatus,
            });
          }
        } catch (repErr) {
          console.warn('Failed to sync repair ticket on debt payment:', repErr);
        }
      }

      get().recalculateCustomer(updatedDebt.customerId).catch(console.error);

      return updatedDebt;
    } catch (err) {
      console.error('Failed to record payment', err);
      throw err;
    }
  },

  updateDebtAmount: async (debtId, newTotalAmount, newItemsSummary) => {
    try {
      const target = get().debts.find(d => d.id === debtId);
      const updatedDebt = await debtService.updateDebtAmount(debtId, newTotalAmount, newItemsSummary);
      set(state => {
        const updatedDebts = state.debts.map(d => (d.id === debtId ? updatedDebt : d));
        const newTotalDebt = updatedDebts
          .filter(d => d.customerId === updatedDebt.customerId && d.status !== 'paid')
          .reduce((sum, d) => sum + d.remainingBalance, 0);

        return {
          debts: updatedDebts,
          customers: state.customers.map(c =>
            c.id === updatedDebt.customerId ? { ...c, totalDebt: newTotalDebt } : c
          ),
        };
      });

      if (target) {
        const actor = useAuthStore.getState().user;
        get().addCustomerAuditLog({
          customerId: target.customerId,
          customerName: target.customerName,
          actionType: 'debt_edited',
          actionTitle: 'Invoice / Debt Balance Adjusted',
          actionDescription: `Invoice total adjusted from ${formatCurrency(target.totalAmount)} to ${formatCurrency(newTotalAmount)} by ${actor?.name || 'Staff'}. New remaining balance: ${formatCurrency(updatedDebt.remainingBalance)}.`,
          actorId: actor?.id,
          actorName: actor?.name || 'Staff',
          actorRole: actor?.role,
          metadata: { debtId, oldTotal: target.totalAmount, newTotal: newTotalAmount, remainingBalance: updatedDebt.remainingBalance },
        }).catch(console.error);
        get().recalculateCustomer(updatedDebt.customerId).catch(console.error);
      }

      return updatedDebt;
    } catch (err) {
      console.error('Failed to update debt amount', err);
      throw err;
    }
  },

  deleteDebt: async (debtId) => {
    try {
      const target = get().debts.find(d => d.id === debtId);
      await debtService.deleteDebt(debtId);
      set(state => {
        const updatedDebts = state.debts.filter(d => d.id !== debtId);
        const newTotalDebt = target
          ? updatedDebts
              .filter(d => d.customerId === target.customerId && d.status !== 'paid')
              .reduce((sum, d) => sum + d.remainingBalance, 0)
          : 0;

        return {
          debts: updatedDebts,
          customers: target
            ? state.customers.map(c =>
                c.id === target.customerId ? { ...c, totalDebt: newTotalDebt } : c
              )
            : state.customers,
        };
      });

      // Append-only audit log
      if (target) {
        const actor = useAuthStore.getState().user;
        get().addCustomerAuditLog({
          customerId: target.customerId,
          customerName: target.customerName,
          actionType: 'debt_deleted',
          actionTitle: 'Credit Record Removed',
          actionDescription: `Debt record for "${target.productOrService}" (${formatCurrency(target.totalAmount)}) was deleted by ${actor?.name || 'Staff'}.`,
          actorId: actor?.id,
          actorName: actor?.name || 'Staff',
          actorRole: actor?.role,
          metadata: { debtId, productOrService: target.productOrService, totalAmount: target.totalAmount },
        }).catch(console.error);

        get().recalculateCustomer(target.customerId).catch(console.error);

        // If deleting a debt that was linked to a repair ticket, update the ticket
        if (target.type === 'repair' || target.productOrService?.toLowerCase().includes('repair')) {
          try {
            const { useRepairStore } = await import('./repairStore');
            const repairStore = useRepairStore.getState();
            const matchingTicket = repairStore.tickets.find(t => t.debtEntryId === debtId);
            if (matchingTicket) {
              await repairStore.updateTicket(matchingTicket.id, {
                paymentStatus: 'paid',
              });
            }
          } catch (e) {
            console.warn('Failed to update repair ticket on debt delete:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete debt', err);
      throw err;
    }
  },

  getCustomerDebtTotal: (customerId) => {
    const cust = get().customers.find(c => c.id === customerId);
    return get()
      .debts.filter(d => (d.customerId === customerId || (cust && matchesCustomer(cust, d))) && d.status !== 'paid')
      .reduce((sum, d) => sum + d.remainingBalance, 0);
  },

  getCustomerDebts: (customerId) => {
    const cust = get().customers.find(c => c.id === customerId);
    return get()
      .debts.filter(d => d.customerId === customerId || (cust && matchesCustomer(cust, d)))
      .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
  },

  recalculateCustomer: async (customerId: string) => {
    try {
      const state = get();
      const targetCustomer = state.customers.find(c => c.id === customerId);
      if (!targetCustomer) return;

      const [transactions, tickets] = await Promise.all([
        transactionService.getAll().catch(() => []),
        repairService.getAll().catch(() => []),
      ]);

      // Pull active in-memory transactions, invoices, and tickets to guarantee 100% real-time reflection
      let localCartTxs: any[] = [];
      let localInvoices: any[] = [];
      let localTickets: any[] = [];
      try {
        const { useCartStore } = await import('./cartStore');
        const { usePartsCartStore } = await import('./partsCartStore');
        const { useRepairStore } = await import('./repairStore');
        localCartTxs = useCartStore.getState().transactions || [];
        localInvoices = usePartsCartStore.getState().invoices || [];
        localTickets = useRepairStore.getState().tickets || [];
      } catch (storeErr) {
        // Fallback to server arrays
      }

      const txMap = new Map<string, any>();
      [...transactions, ...localCartTxs, ...localInvoices].forEach(tx => {
        if (tx && tx.id) txMap.set(tx.id, tx);
      });
      const allTransactions = Array.from(txMap.values());

      const ticketMap = new Map<string, any>();
      [...tickets, ...localTickets].forEach(tk => {
        if (tk && tk.id) ticketMap.set(tk.id, tk);
      });
      const allTickets = Array.from(ticketMap.values());

      const fin = calculateCustomerFinancials(targetCustomer, allTickets, allTransactions, state.debts);
      set({
        customers: state.customers.map(c =>
          c.id === customerId
            ? {
                ...c,
                totalSpent: fin.totalSpent,
                totalPurchases: fin.totalPurchases,
                totalDebt: fin.totalDebt,
                lastVisitDate: fin.lastVisitDate || c.lastVisitDate,
              }
            : c
        ),
      });

      // Background sync to Firestore
      customerService.updateCustomer(customerId, {
        totalSpent: fin.totalSpent,
        totalPurchases: fin.totalPurchases,
        totalDebt: fin.totalDebt,
        lastVisitDate: fin.lastVisitDate,
      }).catch(console.warn);
    } catch (err) {
      console.error('Failed to recalculate customer financials:', err);
    }
  },

  recalculateAllCustomerFinancials: async () => {
    try {
      const state = get();
      const [transactions, tickets] = await Promise.all([
        transactionService.getAll().catch(() => []),
        repairService.getAll().catch(() => []),
      ]);

      let localCartTxs: any[] = [];
      let localInvoices: any[] = [];
      let localTickets: any[] = [];
      try {
        const { useCartStore } = await import('./cartStore');
        const { usePartsCartStore } = await import('./partsCartStore');
        const { useRepairStore } = await import('./repairStore');
        localCartTxs = useCartStore.getState().transactions || [];
        localInvoices = usePartsCartStore.getState().invoices || [];
        localTickets = useRepairStore.getState().tickets || [];
      } catch (storeErr) {
        // Fallback
      }

      const txMap = new Map<string, any>();
      [...transactions, ...localCartTxs, ...localInvoices].forEach(tx => {
        if (tx && tx.id) txMap.set(tx.id, tx);
      });
      const allTransactions = Array.from(txMap.values());

      const ticketMap = new Map<string, any>();
      [...tickets, ...localTickets].forEach(tk => {
        if (tk && tk.id) ticketMap.set(tk.id, tk);
      });
      const allTickets = Array.from(ticketMap.values());

      const updated = state.customers.map(c => {
        const fin = calculateCustomerFinancials(c, allTickets, allTransactions, state.debts);
        return {
          ...c,
          totalSpent: fin.totalSpent,
          totalPurchases: fin.totalPurchases,
          totalDebt: fin.totalDebt,
          lastVisitDate: fin.lastVisitDate || c.lastVisitDate,
        };
      });

      set({ customers: updated });

      setTimeout(() => {
        updated.forEach(c => {
          customerService.updateCustomer(c.id, {
            totalSpent: c.totalSpent,
            totalPurchases: c.totalPurchases,
            totalDebt: c.totalDebt,
            lastVisitDate: c.lastVisitDate,
          }).catch(console.warn);
        });
      }, 500);
    } catch (err) {
      console.error('Failed to recalculate all customer financials:', err);
    }
  },

  findOrCreateCustomer: async ({ name, phone, email, accountType = 'retail', shopName, address, rc, nif, nis, art, wholesaleDiscountPercent, creditLimit, notes, device }) => {
    const rawInputName = (name || '').trim();
    const normalizedInputName = rawInputName.toLowerCase();
    const trimmedPhone = phone ? phone.trim() : '';
    const phoneDigits = normalizePhoneDigits(trimmedPhone);
    const hasValidPhone = phoneDigits.length >= 7;

    // Concurrency key: Lock by phone line if valid (>= 8 digits), otherwise by normalized name
    const key = hasValidPhone && phoneDigits.length >= 8
      ? `phone_${phoneDigits.slice(-9)}`
      : `name_${normalizedInputName || 'unnamed'}`;

    if (inFlightCustomerCreations.has(key)) {
      const existingPromiseCustomer = await inFlightCustomerCreations.get(key)!;
      if (rawInputName && isMoreDescriptiveName(rawInputName, existingPromiseCustomer.name)) {
        await get().updateCustomer(existingPromiseCustomer.id, { name: rawInputName });
        return { ...existingPromiseCustomer, name: rawInputName };
      }
      return existingPromiseCustomer;
    }

    const runCreation = async (): Promise<Customer> => {
      // 1. Search in-memory customers (Primary search)
      let existing: Customer | undefined;

      // 1A. If valid phone is provided, match by phone line (single source of truth)
      if (hasValidPhone) {
        existing = get().customers.find(c =>
          isPhoneMatch(c.phone, trimmedPhone) ||
          (c.normalizedPhone && (c.normalizedPhone === phoneDigits || isPhoneMatch(c.normalizedPhone, trimmedPhone)))
        );
      }

      // 1B. If no match found by phone (or phone wasn't provided), match by name if provided
      if (!existing && normalizedInputName) {
        existing = get().customers.find(c => c.name.trim().toLowerCase() === normalizedInputName);
      }

      // Helper to calculate and apply non-destructive customer enrichments
      const applyEnrichments = async (targetCustomer: Customer): Promise<Customer> => {
        const updates: Partial<Customer> = {};

        // 1. Name Enrichment
        if (rawInputName && isMoreDescriptiveName(rawInputName, targetCustomer.name)) {
          updates.name = rawInputName;
        }

        // 2. Phone Enrichment: if existing had no phone or an incomplete one, and new one is valid
        if (trimmedPhone && (!targetCustomer.phone || (!hasValidPhone && targetCustomer.phone.length < trimmedPhone.length))) {
          updates.phone = formatStandardPhone(trimmedPhone) || trimmedPhone;
          updates.normalizedPhone = phoneDigits;
        } else if (!targetCustomer.normalizedPhone && hasValidPhone) {
          updates.normalizedPhone = phoneDigits;
        }

        // 3. Email Enrichment
        if (!targetCustomer.email && email?.trim()) {
          updates.email = email.trim();
        }

        // 4. Shop Name Enrichment
        if (!targetCustomer.shopName && shopName?.trim()) {
          updates.shopName = shopName.trim();
        }

        // 5. Account Type Upgrade (retail -> shop_repairer)
        if (accountType === 'shop_repairer' && targetCustomer.accountType !== 'shop_repairer') {
          updates.accountType = 'shop_repairer';
          if (!targetCustomer.shopName && shopName?.trim()) {
            updates.shopName = shopName.trim();
          }
        }

        if (!targetCustomer.address && address?.trim()) {
          updates.address = address.trim();
        }
        if (!targetCustomer.rc && rc?.trim()) {
          updates.rc = rc.trim();
        }
        if (!targetCustomer.nif && nif?.trim()) {
          updates.nif = nif.trim();
        }
        if (!targetCustomer.nis && nis?.trim()) {
          updates.nis = nis.trim();
        }
        if (!targetCustomer.art && art?.trim()) {
          updates.art = art.trim();
        }
        if ((!targetCustomer.wholesaleDiscountPercent || targetCustomer.wholesaleDiscountPercent <= 0) && wholesaleDiscountPercent && wholesaleDiscountPercent > 0) {
          updates.wholesaleDiscountPercent = wholesaleDiscountPercent;
        }
        if ((!targetCustomer.creditLimit || targetCustomer.creditLimit <= 0) && creditLimit && creditLimit > 0) {
          updates.creditLimit = creditLimit;
        }

        // 7. Non-destructive Notes Merging
        const cleanNotes = notes?.trim();
        if (cleanNotes) {
          if (!targetCustomer.notes || !targetCustomer.notes.trim()) {
            updates.notes = cleanNotes;
          } else if (!targetCustomer.notes.includes(cleanNotes)) {
            const today = new Date().toLocaleDateString('fr-DZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
            updates.notes = `${targetCustomer.notes.trim()}\n[${today}]: ${cleanNotes}`;
          }
        }

        // 8. Registered Device Vault Enrichment
        if (device && device.brand?.trim() && device.model?.trim()) {
          const brandTrim = device.brand.trim();
          const modelTrim = device.model.trim();
          const imeiTrim = device.imei?.trim() || '';
          const devNotesTrim = device.notes?.trim() || '';

          const existingDevices = targetCustomer.registeredDevices || [];
          const matchedDeviceIndex = existingDevices.findIndex(d =>
            d.brand.toLowerCase() === brandTrim.toLowerCase() &&
            d.model.toLowerCase() === modelTrim.toLowerCase() &&
            (!imeiTrim || !d.imei || d.imei === imeiTrim)
          );

          if (matchedDeviceIndex === -1) {
            const newVaultDevice: CustomerRegisteredDevice = {
              id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              brand: brandTrim,
              model: modelTrim,
              imei: imeiTrim || undefined,
              notes: devNotesTrim || undefined,
              createdAt: new Date().toISOString(),
            };
            updates.registeredDevices = [newVaultDevice, ...existingDevices];
          } else {
            const existingDev = existingDevices[matchedDeviceIndex];
            const needsImei = imeiTrim && !existingDev.imei;
            const needsNotes = devNotesTrim && !existingDev.notes;
            if (needsImei || needsNotes) {
              const updatedDevices = [...existingDevices];
              updatedDevices[matchedDeviceIndex] = {
                ...existingDev,
                ...(needsImei ? { imei: imeiTrim } : {}),
                ...(needsNotes ? { notes: devNotesTrim } : {}),
              };
              updates.registeredDevices = updatedDevices;
            }
          }
        }

        if (Object.keys(updates).length > 0) {
          const updated = await get().updateCustomer(targetCustomer.id, updates);
          const fresh = get().customers.find(c => c.id === targetCustomer.id);
          const debtTotal = get().getCustomerDebtTotal(targetCustomer.id);
          return { ...(fresh || { ...targetCustomer, ...updates }), totalDebt: debtTotal };
        }

        const debtTotal = get().getCustomerDebtTotal(targetCustomer.id);
        return { ...targetCustomer, totalDebt: debtTotal };
      };

      if (existing) {
        return await applyEnrichments(existing);
      }

      // 2. Search remote Firestore fallback if phone was provided and online
      if (hasValidPhone && (typeof navigator === 'undefined' || navigator.onLine)) {
        const remote = await customerService.findByPhone(trimmedPhone);
        if (remote) {
          const enriched = await applyEnrichments(remote);
          set(state => ({
            customers: state.customers.some(c => c.id === enriched.id)
              ? state.customers.map(c => c.id === enriched.id ? enriched : c)
              : [...state.customers, enriched],
          }));
          return enriched;
        }
      }

      // 3. Customer account requires a valid phone number besides the name
      if (!hasValidPhone) {
        console.warn('Customer account requires a valid phone number. Cannot auto-create account for:', rawInputName);
        return undefined as any;
      }

      // Customer truly does not exist -> Create new customer profile
      const newDevices: CustomerRegisteredDevice[] = (device && device.brand?.trim() && device.model?.trim())
        ? [{
            id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            brand: device.brand.trim(),
            model: device.model.trim(),
            imei: device.imei?.trim() || undefined,
            notes: device.notes?.trim() || undefined,
            createdAt: new Date().toISOString(),
          }]
        : [];

      const newCustomer = await customerService.addCustomer({
        name: rawInputName || 'Client',
        phone: formatStandardPhone(trimmedPhone) || trimmedPhone,
        email: email?.trim(),
        accountType,
        shopName: accountType === 'shop_repairer' ? shopName?.trim() : undefined,
        address: address?.trim(),
        rc: rc?.trim(),
        nif: nif?.trim(),
        nis: nis?.trim(),
        art: art?.trim(),
        wholesaleDiscountPercent,
        creditLimit,
        notes: notes?.trim(),
        registeredDevices: newDevices.length > 0 ? newDevices : undefined,
      });

      const withDebt = { ...newCustomer, totalDebt: 0 };
      set(state => ({ customers: [...state.customers, withDebt] }));

      const actor = useAuthStore.getState().user;
      get().addCustomerAuditLog({
        customerId: newCustomer.id,
        customerName: newCustomer.name,
        actionType: 'customer_created',
        actionTitle: accountType === 'shop_repairer' ? 'Shop / Repairer Account Registered' : 'Customer Profile Registered',
        actionDescription: `${newCustomer.name} automatically registered${accountType === 'shop_repairer' ? ' as B2B Shop' : ''}.`,
        actorName: actor?.name || 'Staff',
        actorId: actor?.id,
        metadata: { phone: newCustomer.phone, accountType },
      }).catch(console.error);

      return withDebt;
    };

    const promise = runCreation();
    inFlightCustomerCreations.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlightCustomerCreations.delete(key);
    }
  },

  enrichCustomer: async (customerId, data) => {
    const customer = get().customers.find(c => c.id === customerId);
    if (!customer) throw new Error('Customer not found');

    const updates: Partial<Customer> = {};

    if (data.name && isMoreDescriptiveName(data.name, customer.name)) {
      updates.name = data.name.trim();
    }
    if (data.phone) {
      const cleanPhone = normalizePhoneDigits(data.phone);
      if (!customer.phone || customer.phone.length < data.phone.length) {
        updates.phone = formatStandardPhone(data.phone) || data.phone.trim();
        updates.normalizedPhone = cleanPhone;
      }
    }
    if (!customer.email && data.email?.trim()) {
      updates.email = data.email.trim();
    }
    if (!customer.shopName && data.shopName?.trim()) {
      updates.shopName = data.shopName.trim();
    }
    if (!customer.address && data.address?.trim()) {
      updates.address = data.address.trim();
    }
    if (!customer.rc && data.rc?.trim()) {
      updates.rc = data.rc.trim();
    }
    if (!customer.nif && data.nif?.trim()) {
      updates.nif = data.nif.trim();
    }
    if (!customer.nis && data.nis?.trim()) {
      updates.nis = data.nis.trim();
    }
    if (!customer.art && data.art?.trim()) {
      updates.art = data.art.trim();
    }
    if (data.wholesaleDiscountPercent !== undefined && data.wholesaleDiscountPercent > 0) {
      updates.wholesaleDiscountPercent = data.wholesaleDiscountPercent;
    }
    if (data.creditLimit !== undefined && data.creditLimit > 0) {
      updates.creditLimit = data.creditLimit;
    }
    const cleanNotes = data.notes?.trim();
    if (cleanNotes) {
      if (!customer.notes || !customer.notes.trim()) {
        updates.notes = cleanNotes;
      } else if (!customer.notes.includes(cleanNotes)) {
        const today = new Date().toLocaleDateString('fr-DZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
        updates.notes = `${customer.notes.trim()}\n[${today}]: ${cleanNotes}`;
      }
    }
    if (data.device && data.device.brand?.trim() && data.device.model?.trim()) {
      const brandTrim = data.device.brand.trim();
      const modelTrim = data.device.model.trim();
      const imeiTrim = data.device.imei?.trim() || '';
      const devNotesTrim = data.device.notes?.trim() || '';

      const existingDevices = customer.registeredDevices || [];
      const matchedDeviceIndex = existingDevices.findIndex(d =>
        d.brand.toLowerCase() === brandTrim.toLowerCase() &&
        d.model.toLowerCase() === modelTrim.toLowerCase() &&
        (!imeiTrim || !d.imei || d.imei === imeiTrim)
      );

      if (matchedDeviceIndex === -1) {
        const newVaultDevice: CustomerRegisteredDevice = {
          id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          brand: brandTrim,
          model: modelTrim,
          imei: imeiTrim || undefined,
          notes: devNotesTrim || undefined,
          createdAt: new Date().toISOString(),
        };
        updates.registeredDevices = [newVaultDevice, ...existingDevices];
      } else {
        const existingDev = existingDevices[matchedDeviceIndex];
        const needsImei = imeiTrim && !existingDev.imei;
        const needsNotes = devNotesTrim && !existingDev.notes;
        if (needsImei || needsNotes) {
          const updatedDevices = [...existingDevices];
          updatedDevices[matchedDeviceIndex] = {
            ...existingDev,
            ...(needsImei ? { imei: imeiTrim } : {}),
            ...(needsNotes ? { notes: devNotesTrim } : {}),
          };
          updates.registeredDevices = updatedDevices;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      const updated = await get().updateCustomer(customerId, updates);
      return updated;
    }
    return customer;
  },

  addStoreCredit: async (customerId, amount, note) => {
    const customer = get().customers.find(c => c.id === customerId);
    if (!customer) throw new Error('Customer not found');
    const newCredit = (customer.storeCredit || 0) + Math.max(0, amount);

    await customerService.updateCustomer(customerId, { storeCredit: newCredit });
    set(state => ({
      customers: state.customers.map(c => c.id === customerId ? { ...c, storeCredit: newCredit } : c),
    }));

    const actor = useAuthStore.getState().user;
    get().addCustomerAuditLog({
      customerId: customer.id,
      customerName: customer.name,
      actionType: 'store_credit_issued',
      actionTitle: 'Store Credit (Avoir) Issued',
      actionDescription: `Issued ${formatCurrency(amount)} Store Credit. New balance: ${formatCurrency(newCredit)}${note ? ` (${note})` : ''} by ${actor?.name || 'Staff'}.`,
      actorId: actor?.id,
      actorName: actor?.name || 'Staff',
      actorRole: actor?.role,
      metadata: { amount, newCredit, note },
    }).catch(console.error);

    return newCredit;
  },

  useStoreCredit: async (customerId, amount, note) => {
    const customer = get().customers.find(c => c.id === customerId);
    if (!customer) throw new Error('Customer not found');
    const available = customer.storeCredit || 0;
    const toDeduct = Math.min(available, Math.max(0, amount));
    const newCredit = Math.max(0, available - toDeduct);

    await customerService.updateCustomer(customerId, { storeCredit: newCredit });
    set(state => ({
      customers: state.customers.map(c => c.id === customerId ? { ...c, storeCredit: newCredit } : c),
    }));

    const actor = useAuthStore.getState().user;
    get().addCustomerAuditLog({
      customerId: customer.id,
      customerName: customer.name,
      actionType: 'store_credit_used',
      actionTitle: 'Store Credit (Avoir) Redeemed',
      actionDescription: `Redeemed ${formatCurrency(toDeduct)} Store Credit for POS sale. Remaining balance: ${formatCurrency(newCredit)}${note ? ` (${note})` : ''} by ${actor?.name || 'Staff'}.`,
      actorId: actor?.id,
      actorName: actor?.name || 'Staff',
      actorRole: actor?.role,
      metadata: { amount: toDeduct, newCredit, note },
    }).catch(console.error);

    return newCredit;
  },

  deductFromDebt: async (customerId, amount, note) => {
    const customerDebts = get().getCustomerDebts(customerId)
      .filter(d => d.status !== 'paid' && d.remainingBalance > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let remainingToDeduct = Math.max(0, amount);
    let totalDeducted = 0;

    for (const debt of customerDebts) {
      if (remainingToDeduct <= 0) break;
      const paymentAmount = Math.min(debt.remainingBalance, remainingToDeduct);
      await get().recordDebtPayment(debt.id, {
        amount: paymentAmount,
        method: 'cash',
        note: note || 'Exchange Surplus Credit Applied',
      });
      totalDeducted += paymentAmount;
      remainingToDeduct -= paymentAmount;
    }

    // Problem 5 fix: Auto-convert any remaining surplus to store credit
    if (remainingToDeduct > 0) {
      try {
        await get().addStoreCredit(
          customerId,
          remainingToDeduct,
          note ? `${note} (surplus auto-converted)` : 'Exchange surplus auto-converted to store credit'
        );
      } catch (creditErr) {
        console.warn('Could not auto-convert surplus to store credit:', creditErr);
      }
    }

    return { amountDeducted: totalDeducted, remainingSurplus: remainingToDeduct };
  },

  deleteCustomer: async (id: string, options) => {
    try {
      const target = get().customers.find(c => c.id === id);
      if (!target) return;

      if (options?.deleteDebts) {
        await debtService.deleteDebtsByCustomerId(id);
      }

      await customerService.deleteCustomer(id);

      set(state => ({
        customers: state.customers.filter(c => c.id !== id),
        debts: options?.deleteDebts ? state.debts.filter(d => d.customerId !== id) : state.debts,
        customerLogs: state.customerLogs.filter(l => l.customerId !== id),
      }));

      const actor = useAuthStore.getState().user;
      activityLogService.log('sales', `Customer Profile Deleted — ${target.name}`, {
        detail: `${target.name} (${target.shopName ? 'Shop: ' + target.shopName : 'Retail'}) was deleted by ${actor?.name || 'Staff'}.`,
        entityId: id,
        entityType: 'customer',
        severity: 'danger',
        userName: actor?.name,
        userId: actor?.id,
      }).catch(console.error);
    } catch (err) {
      console.error('Failed to delete customer', err);
      set({ error: 'Failed to delete customer' });
      throw err;
    }
  },

  switchAccountType: async (customerId: string, newType: 'retail' | 'shop_repairer', shopName?: string) => {
    try {
      const target = get().customers.find(c => c.id === customerId);
      if (!target) throw new Error('Customer not found');

      const isBecomingShop = newType === 'shop_repairer';
      const cleanShopName = isBecomingShop
        ? (shopName?.trim() || target.shopName?.trim() || `${target.name}'s Workshop`)
        : undefined;

      const updates: Partial<Customer> = {
        accountType: newType,
        shopName: cleanShopName,
      };

      await customerService.updateCustomer(customerId, updates);

      set(state => ({
        customers: state.customers.map(c =>
          c.id === customerId ? { ...c, ...updates } : c
        ),
      }));

      const actor = useAuthStore.getState().user;
      get().addCustomerAuditLog({
        customerId,
        customerName: target.name,
        actionType: 'customer_updated',
        actionTitle: isBecomingShop ? 'Switched to B2B Shop Account' : 'Switched to Retail Client Account',
        actionDescription: isBecomingShop
          ? `Account converted from Retail Client to B2B Shop "${cleanShopName}" by ${actor?.name || 'Staff'}.`
          : `Account converted from B2B Shop to Retail Client by ${actor?.name || 'Staff'}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: { previousAccountType: target.accountType, newType, shopName: cleanShopName },
      }).catch(console.error);
    } catch (err) {
      console.error('Failed to switch customer account type', err);
      throw err;
    }
  },

  mergeCustomers: async ({ primaryCustomerId, secondaryCustomerId, keepAs, customName, customPhone, customShopName, deleteSecondaryDoc = true }) => {
    const { customers, debts } = get();
    const primary = customers.find(c => c.id === primaryCustomerId);
    const secondary = customers.find(c => c.id === secondaryCustomerId);

    if (!primary || !secondary) {
      throw new Error('Both accounts must exist to perform merge.');
    }

    const mergedName = (customName || (keepAs === 'shop_repairer' ? (primary.name || secondary.name) : (primary.name || secondary.name))).trim();
    const mergedPhone = (customPhone || primary.phone || secondary.phone || '').trim();
    const mergedEmail = (primary.email || secondary.email || '').trim() || undefined;
    const mergedShopName = keepAs === 'shop_repairer'
      ? (customShopName || primary.shopName || secondary.shopName || `${mergedName}'s Shop`).trim()
      : undefined;

    const mergedNotes = [primary.notes, secondary.notes].filter(Boolean).join('\n---\nMerged Notes:\n');
    const combinedPurchases = (primary.totalPurchases || 0) + (secondary.totalPurchases || 0);
    const combinedSpent = (primary.totalSpent || 0) + (secondary.totalSpent || 0);
    const combinedCredit = (primary.storeCredit || 0) + (secondary.storeCredit || 0);

    // Merge registered devices without duplicates
    const existingDevices = primary.registeredDevices || [];
    const secondaryDevices = secondary.registeredDevices || [];
    const mergedDevices = [...existingDevices];
    for (const sDev of secondaryDevices) {
      const alreadyHas = mergedDevices.some(d =>
        (d.imei && sDev.imei && d.imei === sDev.imei) ||
        (d.brand.toLowerCase().trim() === sDev.brand.toLowerCase().trim() && d.model.toLowerCase().trim() === sDev.model.toLowerCase().trim())
      );
      if (!alreadyHas) {
        mergedDevices.push(sDev);
      }
    }

    const primaryUpdates: Partial<Customer> = {
      name: mergedName,
      phone: mergedPhone,
      email: mergedEmail,
      accountType: keepAs,
      shopName: mergedShopName,
      notes: mergedNotes || undefined,
      totalPurchases: combinedPurchases,
      totalSpent: combinedSpent,
      storeCredit: combinedCredit,
      registeredDevices: mergedDevices.length > 0 ? mergedDevices : undefined,
    };

    // 1. Update primary customer record
    await customerService.updateCustomer(primary.id, primaryUpdates);

    // 2. Reassign all debts from secondary to primary
    await debtService.reassignDebtsForCustomer(primary.id, mergedName, mergedPhone, secondary.id);

    // 3. Reassign all repair tickets from secondary to primary
    try {
      const { useRepairStore } = await import('./repairStore');
      await useRepairStore.getState().reassignTicketsForMerge(
        primary.id,
        mergedName,
        mergedPhone,
        secondary.id,
        secondary.phone
      );
    } catch (e) {
      console.warn('Could not reassign repair tickets during merge:', e);
    }

    // 4. Reassign sales transactions in Firestore + cartStore
    try {
      const { transactionService } = await import('../services/transactionService');
      await transactionService.reassignTransactionsForCustomer(
        primary.id,
        mergedName,
        mergedPhone,
        secondary.id
      );
      // Also update in-memory cartStore state for immediate UI reflection
      const { useCartStore } = await import('./cartStore');
      useCartStore.setState(state => ({
        transactions: state.transactions.map(t => {
          if (t.customerId === secondary.id) {
            return {
              ...t,
              customerId: primary.id,
              customerName: mergedName,
              customerPhone: mergedPhone,
            };
          }
          return t;
        }),
      }));

      // Also update in-memory partsCartStore state for immediate UI reflection
      const { usePartsCartStore } = await import('./partsCartStore');
      usePartsCartStore.setState(state => ({
        invoices: state.invoices.map(t => {
          if (t.customerId === secondary.id) {
            return {
              ...t,
              customerId: primary.id,
              customerName: mergedName,
              customerPhone: mergedPhone,
            };
          }
          return t;
        }),
      }));
    } catch (e) {
      console.warn('Could not reassign cart transactions during merge:', e);
    }

    // 5. Delete or Archive the absorbed secondary customer (only the duplicate customer record is removed; all debts, tickets, and transactions are preserved)
    if (deleteSecondaryDoc) {
      await customerService.deleteCustomer(secondary.id);
    } else {
      await customerService.updateCustomer(secondary.id, {
        mergedIntoId: primary.id,
        mergedAt: new Date().toISOString(),
      });
    }

    // 6. Update in-memory debts & calculate updated primary debt
    const updatedDebts = debts.map(d => {
      if (d.customerId === secondary.id) {
        return {
          ...d,
          customerId: primary.id,
          customerName: mergedName,
          customerPhone: mergedPhone,
        };
      }
      return d;
    });

    const primaryDebtTotal = updatedDebts
      .filter(d => d.customerId === primary.id && d.status !== 'paid')
      .reduce((sum, d) => sum + d.remainingBalance, 0);

    const finalPrimary: Customer = {
      ...primary,
      ...primaryUpdates,
      id: primary.id,
      totalDebt: primaryDebtTotal,
    };

    set(state => ({
      debts: updatedDebts,
      customers: state.customers
        .filter(c => c.id !== secondary.id)  // remove duplicate customer from active list
        .map(c => c.id === primary.id ? finalPrimary : c),
    }));

    // 7. Audit Logging
    const actor = useAuthStore.getState().user;
    const destLabel = keepAs === 'shop_repairer' ? 'B2B Shop' : 'Retail Client';
    get().addCustomerAuditLog({
      customerId: primary.id,
      customerName: mergedName,
      actionType: 'customer_updated',
      actionTitle: `Duplicate Accounts Merged (Kept as ${destLabel})`,
      actionDescription: `Merged duplicate account "${secondary.name}" (${secondary.shopName ? 'Shop: ' + secondary.shopName : 'Retail'}) into "${mergedName}". Retained as ${destLabel}. Combined ${combinedPurchases} orders and transferred debts by ${actor?.name || 'Staff'}.${deleteSecondaryDoc ? ' Redundant duplicate customer profile was deleted from database.' : ''}`,
      actorId: actor?.id,
      actorName: actor?.name || 'Staff',
      actorRole: actor?.role,
      metadata: {
        absorbedCustomerId: secondary.id,
        absorbedCustomerName: secondary.name,
        keptAs: keepAs,
        deletedSecondaryDoc: deleteSecondaryDoc,
      },
    }).catch(console.error);

    get().recalculateCustomer(primary.id).catch(console.error);

    return finalPrimary;
  },

  autoResolveAllDuplicates: async (options) => {
    const deleteSecondary = options?.deleteSecondary ?? true;
    let totalMerged = 0;
    let totalDeleted = 0;
    const maxPasses = 15;
    let pass = 0;

    while (pass < maxPasses) {
      pass++;
      const duplicates = get().findDuplicates();
      if (duplicates.length === 0) break;

      let mergedInPass = 0;
      const processedInPass = new Set<string>();

      for (const pair of duplicates) {
        const stateCustomers = get().customers;
        const cA = stateCustomers.find(c => c.id === pair.retail.id && !c.mergedIntoId);
        const cB = stateCustomers.find(c => c.id === pair.shop.id && !c.mergedIntoId);

        if (!cA || !cB || cA.id === cB.id) continue;
        if (processedInPass.has(cA.id) || processedInPass.has(cB.id)) continue;

        // Choose primary:
        // 1. Phone priority: real phone vs dummy/missing
        const aHasPhone = !isDummyPhone(cA.phone);
        const bHasPhone = !isDummyPhone(cB.phone);

        // 2. Shop priority: shop vs retail
        const aIsShop = isShopCustomer(cA);
        const bIsShop = isShopCustomer(cB);

        let primary = cA;
        let secondary = cB;

        if (!aHasPhone && bHasPhone) {
          primary = cB;
          secondary = cA;
        } else if (aHasPhone && !bHasPhone) {
          primary = cA;
          secondary = cB;
        } else if (!aIsShop && bIsShop) {
          primary = cB;
          secondary = cA;
        } else if (aIsShop && !bIsShop) {
          primary = cA;
          secondary = cB;
        } else if ((cB.totalPurchases || 0) > (cA.totalPurchases || 0)) {
          primary = cB;
          secondary = cA;
        } else if ((cB.totalSpent || 0) > (cA.totalSpent || 0)) {
          primary = cB;
          secondary = cA;
        }

        const keepAsType: 'shop_repairer' | 'retail' = (isShopCustomer(primary) || isShopCustomer(secondary))
          ? 'shop_repairer'
          : 'retail';

        const mergedName = isMoreDescriptiveName(secondary.name, primary.name)
          ? secondary.name.trim()
          : primary.name.trim();

        const mergedPhone = (!isDummyPhone(primary.phone) ? primary.phone : secondary.phone) || primary.phone || secondary.phone || '';

        const mergedShop = keepAsType === 'shop_repairer'
          ? (primary.shopName || secondary.shopName || `${mergedName}'s Workshop`).trim()
          : undefined;

        try {
          await get().mergeCustomers({
            primaryCustomerId: primary.id,
            secondaryCustomerId: secondary.id,
            keepAs: keepAsType,
            customName: mergedName,
            customPhone: mergedPhone,
            customShopName: mergedShop,
            deleteSecondaryDoc: deleteSecondary,
          });
          processedInPass.add(primary.id);
          processedInPass.add(secondary.id);
          mergedInPass++;
          totalMerged++;
          if (deleteSecondary) totalDeleted++;
        } catch (err) {
          console.error('Failed to merge duplicate pair in autoResolveAllDuplicates:', err);
        }
      }

      if (mergedInPass === 0) break;
    }

    try {
      await get().recalculateAllCustomerFinancials();
    } catch (e) {
      console.warn('Could not recalculate financials after auto-fusion:', e);
    }

    return { mergedCount: totalMerged, deletedCount: totalDeleted };
  },

  findDuplicates: () => {
    // Exclude already-merged / archived customers from duplicate detection
    const activeCustomers = get().customers.filter(c => !c.mergedIntoId);
    const duplicates: Array<{ retail: Customer; shop: Customer; reason: string }> = [];
    const seenPairs = new Set<string>();

    // Helper to compare two customers for duplicate signals
    const comparePair = (a: Customer, b: Customer) => {
      if (a.id === b.id) return;
      const pairKey = [a.id, b.id].sort().join(':::');
      if (seenPairs.has(pairKey)) return;

      const aPhone = a.phone || '';
      const bPhone = b.phone || '';
      const phoneMatch = isPhoneMatch(aPhone, bPhone);

      const aHasRealPhone = !isDummyPhone(aPhone);
      const bHasRealPhone = !isDummyPhone(bPhone);

      // If both have different REAL phone numbers, they are definitely different customers!
      if (aHasRealPhone && bHasRealPhone && !phoneMatch) {
        return;
      }

      const aName = (a.name || '').trim().toLowerCase();
      const bName = (b.name || '').trim().toLowerCase();
      const aShop = (a.shopName || '').trim().toLowerCase();
      const bShop = (b.shopName || '').trim().toLowerCase();

      const exactNameMatch = aName && bName && aName === bName;
      const exactShopMatch =
        (aShop && bShop && aShop === bShop) ||
        (aName && bShop && aName === bShop) ||
        (bName && aShop && bName === aShop);

      if (phoneMatch && (exactNameMatch || exactShopMatch)) {
        duplicates.push({ retail: a, shop: b, reason: 'Identical Name & Phone Number' });
        seenPairs.add(pairKey);
      } else if (phoneMatch) {
        duplicates.push({ retail: a, shop: b, reason: `Matching Phone (${a.phone})` });
        seenPairs.add(pairKey);
      } else if (exactNameMatch || exactShopMatch) {
        const targetName = exactNameMatch ? aName : (aShop || bShop);
        if (isValidNameForDeduplication(targetName)) {
          const isMultiWord = targetName.includes(' ') && targetName.trim().split(/\s+/).filter(Boolean).length >= 2;
          if (isMultiWord) {
            duplicates.push({ retail: a, shop: b, reason: `Matching Name ("${a.name || a.shopName}")` });
            seenPairs.add(pairKey);
          }
        }
      }
    };

    const retails = activeCustomers.filter(isRetailCustomer);
    const shops = activeCustomers.filter(isShopCustomer);

    // Cross-type: retail vs shop
    for (const r of retails) {
      for (const s of shops) {
        comparePair(r, s);
      }
    }

    // Same-type: retail vs retail
    for (let i = 0; i < retails.length; i++) {
      for (let j = i + 1; j < retails.length; j++) {
        comparePair(retails[i], retails[j]);
      }
    }

    // Same-type: shop vs shop
    for (let i = 0; i < shops.length; i++) {
      for (let j = i + 1; j < shops.length; j++) {
        comparePair(shops[i], shops[j]);
      }
    }

    return duplicates;
  },

  getFilteredCustomers: () => {
    const { customers, searchQuery } = get();
    // Exclude merged/archived customers from all active views
    const active = customers.filter(c => !c.mergedIntoId);
    if (!searchQuery.trim()) return active;
    const q = searchQuery.toLowerCase();
    return active.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.shopName && c.shopName.toLowerCase().includes(q)) ||
      c.phone.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  },

  getRetailCustomers: () => {
    return get().customers.filter(c => !c.mergedIntoId && isRetailCustomer(c));
  },

  getShopCustomers: () => {
    return get().customers.filter(c => !c.mergedIntoId && isShopCustomer(c));
  },
}));
