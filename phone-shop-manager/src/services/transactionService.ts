import {
  collection,
  doc,
  getDocs,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { newIdempotencyKey } from './idempotentReplay';
import type { SaleTransaction } from '../types';

const COLLECTION = 'transactions';
const LOCAL_STORAGE_KEY = 'offline_transactions';

const docToTx = (id: string, data: Record<string, unknown>): SaleTransaction => ({
  ...(data as Omit<SaleTransaction, 'id'>),
  id,
});

const getLocalTransactions = (): SaleTransaction[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalTransactions = (txs: SaleTransaction[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(txs));
  } catch (err) {
    console.error('Failed to save transactions to local storage', err);
  }
};

export const transactionService = {
  // Server-side query: strictly retail POS sales only
  getRetailTransactions: async (): Promise<SaleTransaction[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalTransactions().filter(t => t.saleType === 'retail');
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('saleType', '==', 'retail')
      );
      const snap = await getDocs(q);
      const items = snap.docs
        .map(d => docToTx(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      const local = getLocalTransactions().filter(t => t.saleType === 'retail' && t.id.startsWith('offline_'));
      const serverIds = new Set(items.map(i => i.id));
      const merged = [...local.filter(l => !serverIds.has(l.id)), ...items];
      return merged;
    } catch (err) {
      console.warn('Firestore retail transactions fetch failed, using local cache:', err);
      return getLocalTransactions().filter(t => t.saleType === 'retail');
    }
  },

  // Server-side query: strictly repair parts B2B invoices / sales only
  getPartsTransactions: async (): Promise<SaleTransaction[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalTransactions().filter(t => t.saleType === 'parts_b2b');
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('saleType', '==', 'parts_b2b')
      );
      const snap = await getDocs(q);
      const items = snap.docs
        .map(d => docToTx(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const local = getLocalTransactions().filter(t => t.saleType === 'parts_b2b' && t.id.startsWith('offline_'));
      const serverIds = new Set(items.map(i => i.id));
      const merged = [...local.filter(l => !serverIds.has(l.id)), ...items];
      return merged;
    } catch (err) {
      console.warn('Firestore parts transactions fetch failed, using local cache:', err);
      return getLocalTransactions().filter(t => t.saleType === 'parts_b2b');
    }
  },

  /**
   * `allowLocalFallback: false` makes this read throw instead of quietly answering from this
   * device's cache. Screens may show a cache; a caller about to WRITE an absolute figure off
   * what it read has to know when it is not looking at the shop's real history.
   */
  getAll: async (options?: { allowLocalFallback?: boolean }): Promise<SaleTransaction[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!mayFallBack) throw new Error("Offline: the sale history on this device is not the shop's history.");
      return getLocalTransactions();
    }

    try {
      const q = query(collection(db, COLLECTION), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToTx(d.id, d.data() as Record<string, unknown>));

      const local = getLocalTransactions();
      const serverIds = new Set(items.map(i => i.id));
      const pendingLocal = local.filter(l => !serverIds.has(l.id) && l.id.startsWith('offline_'));
      const merged = [...pendingLocal, ...items].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      saveLocalTransactions(merged);
      return merged;
    } catch (err) {
      console.warn('Firestore transactions fetch failed, using local cache:', err);
      if (!mayFallBack) throw err;
      return getLocalTransactions();
    }
  },

  getByDateRange: async (startDate: Date, endDate: Date): Promise<SaleTransaction[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const local = getLocalTransactions();
      return local.filter(l => {
        const tMs = new Date(l.date).getTime();
        return tMs >= startDate.getTime() && tMs <= endDate.getTime();
      });
    }

    try {
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();
      const q = query(
        collection(db, COLLECTION),
        where('date', '>=', startIso),
        where('date', '<=', endIso),
        orderBy('date', 'desc')
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToTx(d.id, d.data() as Record<string, unknown>));

      const local = getLocalTransactions();
      const serverIds = new Set(items.map(i => i.id));
      const pendingLocal = local.filter(l => {
        if (serverIds.has(l.id) || !l.id.startsWith('offline_')) return false;
        const tMs = new Date(l.date).getTime();
        return tMs >= startDate.getTime() && tMs <= endDate.getTime();
      });

      return [...pendingLocal, ...items].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    } catch (err) {
      console.warn('Firestore transactions by date range fetch failed, using local cache:', err);
      const local = getLocalTransactions();
      return local.filter(l => {
        const tMs = new Date(l.date).getTime();
        return tMs >= startDate.getTime() && tMs <= endDate.getTime();
      });
    }
  },

  save: async (tx: Omit<SaleTransaction, 'id'>): Promise<SaleTransaction> => {
    const local = getLocalTransactions();
    // Minted before the first attempt and carried by every copy of this sale, so a
    // replay can recognise the document the counter only *thinks* it failed to write.
    const stamped: Omit<SaleTransaction, 'id'> = { ...tx, idempotencyKey: newIdempotencyKey('tx') };

    // If offline, store locally immediately with zero delay
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...stamped, id: offlineId };
      saveLocalTransactions([created, ...local]);
      return created;
    }

    try {
      const addDocPromise = addDoc(collection(db, COLLECTION), stamped);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
      );
      const docRef = await Promise.race([addDocPromise, timeoutPromise]);
      const created = { ...stamped, id: docRef.id };
      saveLocalTransactions([created, ...local.filter(t => t.id !== created.id)]);
      return created;
    } catch (err) {
      console.warn('Failed to save transaction to Firestore, storing locally:', err);
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...stamped, id: offlineId };
      saveLocalTransactions([created, ...local]);
      return created;
    }
  },

  /** Closes the sale and returns the moment it stamped, so the caller's in-memory copy
   *  carries the identical day rather than a second clock reading. */
  refund: async (id: string): Promise<string> => {
    // Without the moment, the day's figures can only put the money handed back on the
    // day the sale was rung up: Tuesday's drawer pays out and Monday's report shows it.
    // One patch for both writes, so the mirror and the server cannot name two moments.
    const patch = { status: 'refunded' as const, refundedAt: new Date().toISOString() };
    const local = getLocalTransactions();
    saveLocalTransactions(local.map(t => t.id === id ? { ...t, ...patch } : t));

    if (id.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return patch.refundedAt;
    }

    try {
      const updatePromise = updateDoc(doc(db, COLLECTION, id), patch);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore refund timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
    } catch (err) {
      console.warn('Failed to update refund in Firestore, updated locally:', err);
    }
    return patch.refundedAt;
  },

  updateTransaction: async (id: string, updates: Partial<SaleTransaction>): Promise<void> => {
    const local = getLocalTransactions();
    saveLocalTransactions(local.map(t => t.id === id ? { ...t, ...updates } : t));

    if (id.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    try {
      const updatePromise = updateDoc(doc(db, COLLECTION, id), updates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateTransaction timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
    } catch (err) {
      console.warn('Failed to update transaction in Firestore, updated locally:', err);
    }
  },

  /** Problem 4 fix: Batch-update Firestore transactions to reassign from one customer to another during merge */
  reassignTransactionsForCustomer: async (
    primaryId: string,
    mergedName: string,
    mergedPhone: string,
    secondaryId: string
  ): Promise<number> => {
    try {
      const q = query(
        collection(db, COLLECTION),
        where('customerId', '==', secondaryId)
      );
      const snap = await getDocs(q);
      if (snap.empty) return 0;

      // Firestore writeBatch limit is 500 per batch
      const docs = snap.docs;
      let count = 0;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 450);
        for (const txDoc of chunk) {
          batch.update(txDoc.ref, {
            customerId: primaryId,
            customerName: mergedName,
            customerPhone: mergedPhone,
          });
          count++;
        }
        await batch.commit();
      }

      // Also update local storage cache
      const local = getLocalTransactions();
      saveLocalTransactions(
        local.map(t =>
          t.customerId === secondaryId
            ? { ...t, customerId: primaryId, customerName: mergedName, customerPhone: mergedPhone }
            : t
        )
      );

      return count;
    } catch (err) {
      console.warn('Failed to reassign transactions in Firestore:', err);
      return 0;
    }
  },
};
