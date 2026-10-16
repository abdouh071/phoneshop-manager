import { create } from 'zustand';
import type { Customer, CustomerDebtEntry, CustomerDebtPayment, CustomerActivityLog } from '../types';
import { isShopCustomer, isRetailCustomer } from '../types';
import { customerService } from '../services/customerService';
import { debtService } from '../services/debtService';
import { customerLogService } from '../services/customerLogService';
import { activityLogService } from '../services/activityLogService';
import { useAuthStore } from './authStore';
import { formatCurrency } from '../utils/formatCurrency';

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
  /** Find an existing customer by phone or create a new one. Used by POS, repair tickets, etc. */
  findOrCreateCustomer: (data: { name: string; phone: string; email?: string; accountType?: 'retail' | 'shop_repairer'; shopName?: string }) => Promise<Customer>;
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
  }) => Promise<Customer>;
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
      const [customers, debts, logs] = await Promise.all([
        customerService.getAll(),
        debtService.getAll(),
        customerLogService.getAll(),
      ]);
      
      // Calculate totalDebt per customer
      const debtMap = debts.reduce((acc, d) => {
        if (d.status !== 'paid' && d.remainingBalance > 0) {
          acc[d.customerId] = (acc[d.customerId] || 0) + d.remainingBalance;
        }
        return acc;
      }, {} as Record<string, number>);

      const merged = customers.map(c => ({
        ...c,
        totalDebt: debtMap[c.id] || 0,
      }));

      set({ customers: merged, debts, customerLogs: logs, isLoading: false });
    } catch {
      set({ error: 'Failed to load customers', isLoading: false });
    }
  },

  fetchDebts: async () => {
    try {
      const debts = await debtService.getAll();
      
      // Recalculate customer debts
      const debtMap = debts.reduce((acc, d) => {
        if (d.status !== 'paid' && d.remainingBalance > 0) {
          acc[d.customerId] = (acc[d.customerId] || 0) + d.remainingBalance;
        }
        return acc;
      }, {} as Record<string, number>);

      set(state => ({
        debts,
        customers: state.customers.map(c => ({
          ...c,
          totalDebt: debtMap[c.id] || 0,
        })),
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
      set(state => ({ customers: [...state.customers, { ...newCustomer, totalDebt: 0 }] }));

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
        customers: [...state.customers, { ...newCustomer, totalDebt: debtBalance }],
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
        const newTotalDebt = updatedDebts
          .filter(d => d.customerId === debtData.customerId && d.status !== 'paid')
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
      }
    } catch (err) {
      console.error('Failed to delete debt', err);
      throw err;
    }
  },

  getCustomerDebtTotal: (customerId) => {
    return get()
      .debts.filter(d => d.customerId === customerId && d.status !== 'paid')
      .reduce((sum, d) => sum + d.remainingBalance, 0);
  },

  getCustomerDebts: (customerId) => {
    return get()
      .debts.filter(d => d.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  findOrCreateCustomer: async ({ name, phone, email, accountType = 'retail', shopName }) => {
    const trimmedName = name.trim().toLowerCase();
    const trimmedPhone = phone ? phone.trim() : '';

    // Match by BOTH name AND phone (both must match for same account)
    const normalizeDigits = (p: string) => p.replace(/\D/g, '');
    const phoneDigits = normalizeDigits(trimmedPhone);
    const key = `${trimmedName}_${phoneDigits || 'nophone'}`;

    if (inFlightCustomerCreations.has(key)) {
      return await inFlightCustomerCreations.get(key)!;
    }

    const runCreation = async (): Promise<Customer> => {
      const existing = get().customers.find(c => {
        const cDigits = normalizeDigits(c.phone || '');
        const cName = c.name.toLowerCase().trim();
        const phoneMatches = phoneDigits && cDigits && (cDigits === phoneDigits || (phoneDigits.length >= 9 && cDigits.endsWith(phoneDigits)));
        return phoneMatches && cName === trimmedName;
      });

      if (existing) {
        const updates: Partial<Customer> = {};
        if (!existing.phone && trimmedPhone) updates.phone = trimmedPhone;
        if (!existing.accountType && accountType) updates.accountType = accountType;
        if (Object.keys(updates).length > 0) {
          await get().updateCustomer(existing.id, updates);
          return { ...existing, ...updates };
        }
        return existing;
      }

      if (trimmedPhone) {
        const remote = await customerService.findByPhone(trimmedPhone);
        if (remote && remote.name.toLowerCase().trim() === trimmedName) {
          const debtTotal = get().getCustomerDebtTotal(remote.id);
          const withDebt = { ...remote, totalDebt: debtTotal };
          set(state => ({
            customers: state.customers.some(c => c.id === remote.id)
              ? state.customers.map(c => c.id === remote.id ? withDebt : c)
              : [...state.customers, withDebt],
          }));
          return withDebt;
        }
      }

      const newCustomer = await customerService.addCustomer({
        name: name.trim(),
        phone: trimmedPhone,
        email: email?.trim(),
        accountType,
        shopName: accountType === 'shop_repairer' ? shopName?.trim() : undefined,
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

  mergeCustomers: async ({ primaryCustomerId, secondaryCustomerId, keepAs, customName, customPhone, customShopName }) => {
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
    } catch (e) {
      console.warn('Could not reassign cart transactions during merge:', e);
    }

    // 5. Delete the absorbed secondary customer
    await customerService.deleteCustomer(secondary.id);

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
        .filter(c => c.id !== secondary.id)
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
      actionDescription: `Merged duplicate account "${secondary.name}" (${secondary.shopName ? 'Shop: ' + secondary.shopName : 'Retail'}) into "${mergedName}". Retained as ${destLabel}. Combined ${combinedPurchases} orders and transferred debts by ${actor?.name || 'Staff'}.`,
      actorId: actor?.id,
      actorName: actor?.name || 'Staff',
      actorRole: actor?.role,
      metadata: {
        absorbedCustomerId: secondary.id,
        absorbedCustomerName: secondary.name,
        keptAs: keepAs,
      },
    }).catch(console.error);

    return finalPrimary;
  },

  findDuplicates: () => {
    const { customers } = get();
    const normalizeDigits = (p: string) => (p || '').replace(/\D/g, '');
    const duplicates: Array<{ retail: Customer; shop: Customer; reason: string }> = [];
    const seenPairs = new Set<string>();

    // Helper to compare two customers for duplicate signals
    const comparePair = (a: Customer, b: Customer) => {
      if (a.id === b.id) return;
      const pairKey = [a.id, b.id].sort().join(':::');
      if (seenPairs.has(pairKey)) return;

      const aPhone = normalizeDigits(a.phone);
      const bPhone = normalizeDigits(b.phone);
      const aName = a.name.toLowerCase().trim();
      const bName = b.name.toLowerCase().trim();
      const bShop = (b.shopName || '').toLowerCase().trim();

      const phoneMatch = aPhone.length >= 7 && bPhone.length >= 7 && (
        aPhone === bPhone ||
        aPhone.endsWith(bPhone) ||
        bPhone.endsWith(aPhone)
      );

      const nameMatch = (aName === bName) || (bShop && bShop === aName) || (bShop && bShop.includes(aName));

      if (phoneMatch && nameMatch) {
        duplicates.push({ retail: a, shop: b, reason: 'Identical Name & Phone Number' });
        seenPairs.add(pairKey);
      } else if (phoneMatch) {
        duplicates.push({ retail: a, shop: b, reason: `Matching Phone (${a.phone})` });
        seenPairs.add(pairKey);
      } else if (nameMatch && aName.length >= 3) {
        duplicates.push({ retail: a, shop: b, reason: `Matching Name ("${a.name}")` });
        seenPairs.add(pairKey);
      }
    };

    const retails = customers.filter(isRetailCustomer);
    const shops = customers.filter(isShopCustomer);

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
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.shopName && c.shopName.toLowerCase().includes(q)) ||
      c.phone.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  },

  getRetailCustomers: () => {
    return get().customers.filter(isRetailCustomer);
  },

  getShopCustomers: () => {
    return get().customers.filter(isShopCustomer);
  },
}));
