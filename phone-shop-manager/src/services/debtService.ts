import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { newIdempotencyKey } from './idempotentReplay';
import { offlineQueue, UnrecoverableSyncActionError } from './offlineQueue';
import { invalidateReportsCache } from './reportCacheInvalidation';
import { withTimeout } from '../utils/withTimeout';
import type { CustomerDebtEntry, CustomerDebtPayment } from '../types';

const COLLECTION = 'customer_debts';
const LOCAL_STORAGE_KEY = 'offline_customer_debts';

/** A debt entry is read-modify-write, so it gets the stock write's wider budget. */
const DEBT_TX_TIMEOUT_MS = 2000;

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

/**
 * Read the SERVER entry and write the change inside one transaction.
 *
 * `amountPaid` and `payments` are both written whole, so they have to be computed from
 * the same document the write lands on. Deriving them from this device's mirror erased
 * whatever another terminal had recorded since that mirror was taken: the phone took
 * 3000, the till then wrote its own older total plus the new payment, and the 3000 was
 * gone from the ledger while the customer had genuinely paid it. The transaction makes
 * two terminals writing the same entry serialize instead of the last one winning.
 */
const commitDebtChange = async (
  debtId: string,
  change: (debt: CustomerDebtEntry) => Partial<CustomerDebtEntry> | null
): Promise<CustomerDebtEntry> =>
  withTimeout(
    runTransaction(db, async (tx) => {
      const ref = doc(db, COLLECTION, debtId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Debt entry not found');
      const debt = docToDebt(snap.id, snap.data() as Record<string, unknown>);
      const updates = change(debt);
      if (!updates) return debt;
      tx.update(ref, updates);
      return { ...debt, ...updates };
    }),
    DEBT_TX_TIMEOUT_MS,
    'debtTransaction'
  ).then((res) => {
    invalidateReportsCache();
    return res;
  });

export const debtService = {
  /**
   * `allowLocalFallback: false` makes this read throw instead of answering from this device's
   * cache. A customer's `totalDebt` is written as an absolute figure from what the caller read,
   * so the caller has to know when the list it got is a cache and not the shop's ledger.
   */
  getAll: async (options?: { allowLocalFallback?: boolean }): Promise<CustomerDebtEntry[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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
      invalidateReportsCache();
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
      invalidateReportsCache();
      return created;
    } catch (err) {
      console.warn('Failed to add debt to Firestore, storing locally:', err);
      const offlineId = `offline_debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...newDebt, id: offlineId };
      const local = getLocalDebts();
      saveLocalDebts([created, ...local]);
      invalidateReportsCache();
      return created;
    }
  },

  recordPayment: async (
    debtId: string,
    payment: Omit<CustomerDebtPayment, 'id' | 'date'> & { id?: string; date?: string }
  ): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();
    const stableId =
      typeof payment.id === 'string' && payment.id.trim()
        ? payment.id.trim()
        : `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const paymentEntry: CustomerDebtPayment = {
      ...payment,
      id: stableId,
      date: payment.date || now,
    };

    const applyLocalPayment = (shouldEnqueue: boolean): CustomerDebtEntry => {
      const local = getLocalDebts();
      const debt = local.find(d => d.id === debtId);
      if (!debt) throw new Error('Debt entry not found locally');

      const alreadyRecorded = (debt.payments || []).some(p => p.id === paymentEntry.id);
      const updatedPayments = alreadyRecorded ? debt.payments : [...(debt.payments || []), paymentEntry];
      const newAmountPaid = alreadyRecorded ? (debt.amountPaid || 0) : (debt.amountPaid || 0) + paymentEntry.amount;
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
      if (shouldEnqueue && !debtId.startsWith('offline_')) {
        void offlineQueue.enqueue({
          type: 'RECORD_DEBT_PAYMENT',
          payload: { debtId, payment: paymentEntry, operationId: paymentEntry.id },
        });
      }
      return updatedDebt;
    };

    // Fast-path: Offline or offline-generated ID
    if (debtId.startsWith('offline_') || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return applyLocalPayment(true);
    }

    try {
      const updatedDebt = await commitDebtChange(debtId, debt => {
        // Strictly idempotent: if this payment ID already landed on Firestore (e.g., retry after lost ack),
        // adopt the server record without deducting or appending twice.
        if ((debt.payments || []).some(p => p.id === paymentEntry.id)) {
          return null;
        }
        const newAmountPaid = (debt.amountPaid || 0) + paymentEntry.amount;
        const newRemainingBalance = Math.max(0, debt.totalAmount - newAmountPaid);
        const newStatus: CustomerDebtEntry['status'] =
          newRemainingBalance <= 0
            ? 'paid'
            : newAmountPaid > 0
              ? 'partially_paid'
              : 'unpaid';

        return {
          amountPaid: newAmountPaid,
          remainingBalance: newRemainingBalance,
          status: newStatus,
          payments: [...(debt.payments || []), paymentEntry],
          updatedAt: now,
        };
      });

      const updatedLocal = getLocalDebts().map(d => (d.id === debtId ? updatedDebt : d));
      saveLocalDebts(updatedLocal);

      return updatedDebt;
    } catch (err) {
      console.warn('Firestore payment record failed, updating locally & queueing:', err);
      return applyLocalPayment(true);
    }
  },

  replayQueuedPayment: async (debtId: string, paymentEntry: CustomerDebtPayment): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();
    const updatedDebt = await commitDebtChange(debtId, debt => {
      if ((debt.payments || []).some(p => p.id === paymentEntry.id)) {
        return null;
      }
      const remaining = debt.remainingBalance ?? Math.max(0, debt.totalAmount - (debt.amountPaid || 0));
      if (paymentEntry.amount > remaining + 0.01) {
        throw new UnrecoverableSyncActionError(
          `Queued debt payment of ${paymentEntry.amount} exceeds current server balance (${remaining}) on ${debtId}. Review before applying.`
        );
      }
      const newAmountPaid = (debt.amountPaid || 0) + paymentEntry.amount;
      const newRemainingBalance = Math.max(0, debt.totalAmount - newAmountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : newAmountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      return {
        amountPaid: newAmountPaid,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        payments: [...(debt.payments || []), paymentEntry],
        updatedAt: now,
      };
    }).catch(err => {
      if (err instanceof Error && err.message === 'Debt entry not found') {
        throw new UnrecoverableSyncActionError(`Debt entry ${debtId} no longer exists on the server.`);
      }
      throw err;
    });

    const local = getLocalDebts();
    const hasLocal = local.some(d => d.id === debtId);
    saveLocalDebts(hasLocal ? local.map(d => (d.id === debtId ? updatedDebt : d)) : [updatedDebt, ...local]);
    return updatedDebt;
  },

  updateDebtAmount: async (
    debtId: string,
    newTotalAmount: number,
    newItemsSummary?: string,
    newChargedAmount?: number,
    options?: { skipQueue?: boolean; operationId?: string }
  ): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();
    const operationId = options?.operationId || `debt_upd_${debtId}_${Date.now().toString(36)}`;

    // A caller that knows the account portion of the corrected invoice hands it over;
    // one that does not leaves the account's own paid figure to decide the balance.
    // A non-finite override is not knowledge — treating it as zero would close a debt
    // the customer still owes.
    const chargedOverride = typeof newChargedAmount === 'number' && Number.isFinite(newChargedAmount)
      ? Math.max(0, Math.round(newChargedAmount * 100) / 100)
      : null;

    const applyLocalDebtUpdate = (shouldEnqueue: boolean): CustomerDebtEntry => {
      const local = getLocalDebts();
      const debt = local.find(d => d.id === debtId);
      if (!debt) throw new Error('Debt entry not found');

      const amountPaid = debt.amountPaid || 0;
      const newRemainingBalance = chargedOverride ?? Math.max(0, newTotalAmount - amountPaid);
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
      if (shouldEnqueue && !options?.skipQueue && !debtId.startsWith('offline_')) {
        void offlineQueue.enqueue({
          type: 'UPDATE_DEBT_AMOUNT',
          payload: {
            debtId,
            newTotalAmount,
            newItemsSummary,
            newChargedAmount: chargedOverride ?? undefined,
            expectedPaid: amountPaid,
            operationId,
          },
        });
      }
      return updatedDebt;
    };

    // Fast-path: Offline or offline-generated ID
    if (debtId.startsWith('offline_') || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return applyLocalDebtUpdate(true);
    }

    try {
      const updatedDebt = await commitDebtChange(debtId, debt => {
        const amountPaid = debt.amountPaid || 0;
        const newRemainingBalance = chargedOverride ?? Math.max(0, newTotalAmount - amountPaid);
        const newStatus: CustomerDebtEntry['status'] =
          newRemainingBalance <= 0
            ? 'paid'
            : amountPaid > 0
              ? 'partially_paid'
              : 'unpaid';

        return {
          totalAmount: newTotalAmount,
          remainingBalance: newRemainingBalance,
          status: newStatus,
          updatedAt: now,
          ...(newItemsSummary ? { itemsSummary: newItemsSummary, productOrService: newItemsSummary } : {}),
        };
      });

      const updatedLocal = getLocalDebts().map(d => (d.id === debtId ? updatedDebt : d));
      saveLocalDebts(updatedLocal);

      return updatedDebt;
    } catch (err) {
      console.warn('Firestore update debt amount failed:', err);
      return applyLocalDebtUpdate(true);
    }
  },

  replayQueuedDebtAmount: async (payload: {
    debtId: string;
    newTotalAmount: number;
    newItemsSummary?: string;
    newChargedAmount?: number;
    expectedPaid?: number;
  }): Promise<CustomerDebtEntry> => {
    const now = new Date().toISOString();
    const chargedOverride = typeof payload.newChargedAmount === 'number' && Number.isFinite(payload.newChargedAmount)
      ? Math.max(0, Math.round(payload.newChargedAmount * 100) / 100)
      : null;

    const updatedDebt = await commitDebtChange(payload.debtId, debt => {
      const amountPaid = debt.amountPaid || 0;
      if (typeof payload.expectedPaid === 'number' && Math.abs(amountPaid - payload.expectedPaid) > 0.01) {
        throw new UnrecoverableSyncActionError(
          `Debt ${payload.debtId} received a payment on another device while offline. Review before adjusting.`
        );
      }
      const newRemainingBalance = chargedOverride ?? Math.max(0, payload.newTotalAmount - amountPaid);
      const newStatus: CustomerDebtEntry['status'] =
        newRemainingBalance <= 0
          ? 'paid'
          : amountPaid > 0
            ? 'partially_paid'
            : 'unpaid';

      return {
        totalAmount: payload.newTotalAmount,
        remainingBalance: newRemainingBalance,
        status: newStatus,
        updatedAt: now,
        ...(payload.newItemsSummary ? { itemsSummary: payload.newItemsSummary, productOrService: payload.newItemsSummary } : {}),
      };
    }).catch(err => {
      if (err instanceof Error && err.message === 'Debt entry not found') {
        throw new UnrecoverableSyncActionError(`Debt entry ${payload.debtId} no longer exists on the server.`);
      }
      throw err;
    });

    const local = getLocalDebts();
    saveLocalDebts(local.some(d => d.id === payload.debtId) ? local.map(d => (d.id === payload.debtId ? updatedDebt : d)) : [updatedDebt, ...local]);
    return updatedDebt;
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
