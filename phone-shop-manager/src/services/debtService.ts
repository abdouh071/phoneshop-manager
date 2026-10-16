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
  getAll: async (): Promise<CustomerDebtEntry[]> => {
    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToDebt(d.id, d.data() as Record<string, unknown>));
      saveLocalDebts(items);
      return items;
    } catch (err) {
      console.warn('Firestore debts fetch failed, using local cache:', err);
      return getLocalDebts();
    }
  },

  getByCustomer: async (customerId: string): Promise<CustomerDebtEntry[]> => {
    try {
      const q = query(
        collection(db, COLLECTION),
        where('customerId', '==', customerId),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
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

    const newDebt: Omit<CustomerDebtEntry, 'id'> = {
      ...entry,
      amountPaid: entry.amountPaid || 0,
      remainingBalance,
      status,
      payments: entry.payments || [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      const docRef = await addDoc(collection(db, COLLECTION), newDebt);
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

    try {
      const ref = doc(db, COLLECTION, debtId);
      const snap = await getDoc(ref);
      let debtData: CustomerDebtEntry;

      if (snap.exists()) {
        debtData = docToDebt(snap.id, snap.data() as Record<string, unknown>);
      } else {
        const local = getLocalDebts();
        const found = local.find(d => d.id === debtId);
        if (!found) throw new Error('Debt entry not found');
        debtData = found;
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

      if (snap.exists()) {
        await updateDoc(ref, updates);
      }

      const updatedDebt: CustomerDebtEntry = {
        ...debtData,
        ...updates,
      };

      const local = getLocalDebts().map(d => (d.id === debtId ? updatedDebt : d));
      saveLocalDebts(local);

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
    try {
      const ref = doc(db, COLLECTION, debtId);
      const snap = await getDoc(ref);
      let debtData: CustomerDebtEntry;

      if (snap.exists()) {
        debtData = docToDebt(snap.id, snap.data() as Record<string, unknown>);
      } else {
        const local = getLocalDebts();
        const found = local.find(d => d.id === debtId);
        if (!found) throw new Error('Debt entry not found');
        debtData = found;
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

      if (snap.exists()) {
        await updateDoc(ref, updates);
      }

      const updatedDebt: CustomerDebtEntry = {
        ...debtData,
        ...updates,
      };

      const local = getLocalDebts().map(d => (d.id === debtId ? updatedDebt : d));
      saveLocalDebts(local);

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

  deleteDebt: async (debtId: string): Promise<void> => {
    try {
      const ref = doc(db, COLLECTION, debtId);
      await deleteDoc(ref);
    } catch (err) {
      console.warn('Firestore delete failed:', err);
    }
    const local = getLocalDebts().filter(d => d.id !== debtId);
    saveLocalDebts(local);
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
