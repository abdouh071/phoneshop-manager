import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { newIdempotencyKey } from './idempotentReplay';
import type { CustomerDebtEntry, CustomerDebtPayment } from '../types';

const COLLECTION = 'customer_debts';
const LOCAL_STORAGE_KEY = 'offline_customer_debts';

// Local storage fallback helpers
const getLocalDebts = (): CustomerDebtEntry[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalDebts = (debts: CustomerDebtEntry[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(debts));
  } catch (err) {
    console.error('Failed to save debts to local storage', err);
  }
};

const docToDebt = (id: string, data: Record<string, unknown>): CustomerDebtEntry => ({
  ...(data as Omit<CustomerDebtEntry, 'id'>),
  id,
  payments: (data.payments as CustomerDebtPayment[]) || [],
});

export const debtService = {
  /**
   * `allowLocalFallback: false` makes this read throw instead of answering from this device's
   * cache. A customer's `totalDebt` is written as an absolute figure from what the caller read,
   * so the caller has to know when the list it got is a cache and not the shop's ledger.
   */
  getAll: async (options?: { allowLocalFallback?: boolean }): Promise<CustomerDebtEntry[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!mayFallBack) throw new Error("Offline: the debts on this device are not the shop's ledger.");
      return getLocalDebts();
    }

    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      const snapPromise = getDocs(q);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore debts fetch timeout')), 2500)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      const items = snap.docs.map(d => docToDebt(d.id, d.data() as Record<string, unknown>));
      saveLocalDebts(items);
      return items;
    } catch (err) {
      console.warn('Firestore debts fetch failed, using local cache:', err);
      if (!mayFallBack) throw err;
      return getLocalDebts();
    }
  },

  getByCustomer: async (customerId: string): Promise<CustomerDebtEntry[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalDebts().filter(d => d.customerId === customerId);
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('customerId', '==', customerId),
        orderBy('createdAt', 'desc')
      );
      const snapPromise = getDocs(q);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore debts query by customer timeout')), 2500)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      return snap.docs.map(d => docToDebt(d.id, d.data() as Record<string, unknown>));
    } catch (err) {
      console.warn('Firestore query by customer failed, filtering local cache:', err);
      return getLocalDebts().filter(d => d.customerId === customerId);
    }
  },

  addDebt: async (
    entry: Omit<CustomerDebtEntry, 'id' | 'createdAt' | 'remainingBalance' | 'status' | 'payments'> & {
      payments?: CustomerDebtPayment[];
    }
  ): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();
    const remainingBalance = Math.max(0, entry.totalAmount - (entry.amountPaid || 0));
    const status: CustomerDebtEntry['status'] =
      remainingBalance <= 0
        ? 'paid'
        : entry.amountPaid > 0
          ? 'partially_paid'
          : 'unpaid';

    const initialPayments: CustomerDebtPayment[] = entry.payments && entry.payments.length > 0
      ? entry.payments
      : (entry.amountPaid && entry.amountPaid > 0
          ? [{
              id: `pay_down_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              date: entry.date || now,
              amount: entry.amountPaid,
              method: 'cash',
              note: 'Initial down payment',
              receivedByName: 'Staff',
            }]
          : []);

    const newDebt: Omit<CustomerDebtEntry, 'id'> = {
      ...entry,
      amountPaid: entry.amountPaid || 0,
      remainingBalance,
      status,
      payments: initialPayments,
      // Stamped before the first attempt, so an entry the server saved while this
      // race was giving up is still recognisable to the sync that follows.
      idempotencyKey: newIdempotencyKey('debt'),
      createdAt: now,
      updatedAt: now,
    };

    // If offline, store locally immediately with zero delay
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineId = `offline_debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...newDebt, id: offlineId };
      const local = getLocalDebts();
      saveLocalDebts([created, ...local]);
      return created;
    }

    try {
      const addDocPromise = addDoc(collection(db, COLLECTION), newDebt);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
      );
      const docRef = await Promise.race([addDocPromise, timeoutPromise]);
      const created = { ...newDebt, id: docRef.id };
      
      const local = getLocalDebts();
      saveLocalDebts([created, ...local]);
      return created;
    } catch (err) {
      console.warn('Failed to add debt to Firestore, storing locally:', err);
      const offlineId = `offline_debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...newDebt, id: offlineId };
      const local = getLocalDebts();
      saveLocalDebts([created, ...local]);
      return created;
    }
  },

  recordPayment: async (
    debtId: string,
    payment: Omit<CustomerDebtPayment, 'id' | 'date'> & { date?: string }
  ): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();
    const paymentEntry: CustomerDebtPayment = {
      ...payment,
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: payment.date || now,
    };

    // Fast-path: Offline or offline-generated ID
    if (debtId.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      const local = getLocalDebts();
      const debt = local.find(d => d.id === debtId);
      if (!debt) throw new Error('Debt entry not found locally');

      const updatedPayments = [...(debt.payments || []), paymentEntry];
      const newAmountPaid = (debt.amountPaid || 0) + payment.amount;
      const newRemainingBalance = Math.max(0, debt.totalAmount - newAmountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : newAmountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      const updatedDebt: CustomerDebtEntry = {
        ...debt,
        amountPaid: newAmountPaid,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        payments: updatedPayments,
        updatedAt: now,
      };

      saveLocalDebts(local.map(d => (d.id === debtId ? updatedDebt : d)));
      return updatedDebt;
    }

    try {
      const local = getLocalDebts();
      const localFound = local.find(d => d.id === debtId);
      const ref = doc(db, COLLECTION, debtId);
      let debtData: CustomerDebtEntry;

      if (localFound) {
        debtData = localFound;
      } else {
        const snapPromise = getDoc(ref);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore getDoc timeout')), 1200)
        );
        const snap = await Promise.race([snapPromise, timeoutPromise]);
        if (!snap.exists()) throw new Error('Debt entry not found');
        debtData = docToDebt(snap.id, snap.data() as Record<string, unknown>);
      }

      const updatedPayments = [...(debtData.payments || []), paymentEntry];
      const newAmountPaid = (debtData.amountPaid || 0) + payment.amount;
      const newRemainingBalance = Math.max(0, debtData.totalAmount - newAmountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : newAmountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      const updates = {
        amountPaid: newAmountPaid,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        payments: updatedPayments,
        updatedAt: now,
      };

      const updatePromise = updateDoc(ref, updates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateDoc timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);

      const updatedDebt: CustomerDebtEntry = {
        ...debtData,
        ...updates,
      };

      const updatedLocal = getLocalDebts().map(d => (d.id === debtId ? updatedDebt : d));
      saveLocalDebts(updatedLocal);

      return updatedDebt;
    } catch (err) {
      console.warn('Firestore payment record failed, updating locally:', err);
      const local = getLocalDebts();
      const debt = local.find(d => d.id === debtId);
      if (!debt) throw new Error('Debt entry not found locally');

      const updatedPayments = [...(debt.payments || []), paymentEntry];
      const newAmountPaid = (debt.amountPaid || 0) + payment.amount;
      const newRemainingBalance = Math.max(0, debt.totalAmount - newAmountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : newAmountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      const updatedDebt: CustomerDebtEntry = {
        ...debt,
        amountPaid: newAmountPaid,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        payments: updatedPayments,
        updatedAt: now,
      };

      saveLocalDebts(local.map(d => (d.id === debtId ? updatedDebt : d)));
      return updatedDebt;
    }
  },

  updateDebtAmount: async (
    debtId: string,
    newTotalAmount: number,
    newItemsSummary?: string
  ): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();

    // Fast-path: Offline or offline-generated ID
    if (debtId.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      const local = getLocalDebts();
      const debt = local.find(d => d.id === debtId);
      if (!debt) throw new Error('Debt entry not found');

      const amountPaid = debt.amountPaid || 0;
      const newRemainingBalance = Math.max(0, newTotalAmount - amountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : amountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      const updatedDebt: CustomerDebtEntry = {
        ...debt,
        totalAmount: newTotalAmount,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        updatedAt: now,
        ...(newItemsSummary ? { itemsSummary: newItemsSummary, productOrService: newItemsSummary } : {}),
      };

      saveLocalDebts(local.map(d => (d.id === debtId ? updatedDebt : d)));
      return updatedDebt;
    }

    try {
      const local = getLocalDebts();
      const localFound = local.find(d => d.id === debtId);
      const ref = doc(db, COLLECTION, debtId);
      let debtData: CustomerDebtEntry;

      if (localFound) {
        debtData = localFound;
      } else {
        const snapPromise = getDoc(ref);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore getDoc timeout')), 1200)
        );
        const snap = await Promise.race([snapPromise, timeoutPromise]);
        if (!snap.exists()) throw new Error('Debt entry not found');
        debtData = docToDebt(snap.id, snap.data() as Record<string, unknown>);
      }

      const amountPaid = debtData.amountPaid || 0;
      const newRemainingBalance = Math.max(0, newTotalAmount - amountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : amountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      const updates: Partial<CustomerDebtEntry> = {
        totalAmount: newTotalAmount,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        updatedAt: now,
      };
      if (newItemsSummary) {
        updates.itemsSummary = newItemsSummary;
        updates.productOrService = newItemsSummary;
      }

      const updatePromise = updateDoc(ref, updates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateDoc timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);

      const updatedDebt: CustomerDebtEntry = {
        ...debtData,
        ...updates,
      };

      const updatedLocal = getLocalDebts().map(d => (d.id === debtId ? updatedDebt : d));
      saveLocalDebts(updatedLocal);

      return updatedDebt;
    } catch (err) {
      console.warn('Firestore update debt amount failed:', err);
      const local = getLocalDebts();
      const debt = local.find(d => d.id === debtId);
      if (!debt) throw new Error('Debt entry not found');

      const amountPaid = debt.amountPaid || 0;
      const newRemainingBalance = Math.max(0, newTotalAmount - amountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : amountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      const updatedDebt: CustomerDebtEntry = {
        ...debt,
        totalAmount: newTotalAmount,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        updatedAt: now,
        ...(newItemsSummary ? { itemsSummary: newItemsSummary, productOrService: newItemsSummary } : {}),
      };

      saveLocalDebts(local.map(d => (d.id === debtId ? updatedDebt : d)));
      return updatedDebt;
    }
  },

  /**
   * Close a debt by settling it rather than by deleting it.
   *
   * A refund used to remove the row outright, which is the one write `firestore.rules`
   * reserves for an admin — so a sales agent refunding a credit sale failed on a
   * permission the interface never mentioned, and the customer went on owing for goods
   * he had already handed back. Zeroing the balance is an update, which every signed-in
   * till may do, and the row stays behind as the evidence that the sale existed at all.
   * The reason is not written here: the customer's own audit trail carries it.
   */
  settleDebt: async (debtId: string): Promise<void> => {
    const now = new Date().toISOString();
    const settled = {
      totalAmount: 0,
      amountPaid: 0,
      remainingBalance: 0,
      status: 'paid' as const,
      updatedAt: now,
    };

    saveLocalDebts(getLocalDebts().map(d => (d.id === debtId ? { ...d, ...settled } : d)));

    if (debtId.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    const ref = doc(db, COLLECTION, debtId);
    const updatePromise = updateDoc(ref, settled);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firestore settleDebt timeout')), 1500)
    );
    // Thrown on purpose: a refund that left the balance standing is not a completed
    // refund, and the till has to say so instead of logging it quietly.
    await Promise.race([updatePromise, timeoutPromise]);
  },

  deleteDebt: async (debtId: string): Promise<void> => {
    const local = getLocalDebts().filter(d => d.id !== debtId);
    saveLocalDebts(local);

    if (debtId.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    try {
      const ref = doc(db, COLLECTION, debtId);
      const delPromise = deleteDoc(ref);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore deleteDoc timeout')), 1200)
      );
      await Promise.race([delPromise, timeoutPromise]);
    } catch (err) {
      console.warn('Firestore delete failed:', err);
    }
  },

  deleteDebtsByCustomerId: async (customerId: string): Promise<void> => {
    const local = getLocalDebts();
    const toDelete = local.filter(d => d.customerId === customerId);
    try {
      await Promise.all(toDelete.map(d => deleteDoc(doc(db, COLLECTION, d.id)).catch(() => {})));
    } catch (err) {
      console.warn('Firestore delete customer debts failed:', err);
    }
    saveLocalDebts(local.filter(d => d.customerId !== customerId));
  },

  reassignDebtsForCustomer: async (
    targetCustomerId: string,
    targetCustomerName: string,
    targetCustomerPhone: string,
    sourceCustomerId: string
  ): Promise<void> => {
    const local = getLocalDebts();
    const updated = local.map(d => {
      if (d.customerId === sourceCustomerId) {
        return {
          ...d,
          customerId: targetCustomerId,
          customerName: targetCustomerName,
          customerPhone: targetCustomerPhone,
          updatedAt: new Date().toISOString(),
        };
      }
      return d;
    });
    saveLocalDebts(updated);

    try {
      const toUpdate = updated.filter(d => d.customerId === targetCustomerId);
      await Promise.all(
        toUpdate.map(d =>
          updateDoc(doc(db, COLLECTION, d.id), {
            customerId: targetCustomerId,
            customerName: targetCustomerName,
            customerPhone: targetCustomerPhone,
            updatedAt: new Date().toISOString(),
          }).catch(() => {})
        )
      );
    } catch (err) {
      console.warn('Firestore reassign debts failed:', err);
    }
  },
};
