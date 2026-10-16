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

  getAll: async (): Promise<SaleTransaction[]> => {
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
      return getLocalTransactions();
    }
  },

  getByDateRange: async (startDate: Date, endDate: Date): Promise<SaleTransaction[]> => {
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
    try {
      const docRef = await addDoc(collection(db, COLLECTION), tx);
      const created = { ...tx, id: docRef.id };
      saveLocalTransactions([created, ...local.filter(t => t.id !== created.id)]);
      return created;
    } catch (err) {
      console.warn('Failed to save transaction to Firestore, storing locally:', err);
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...tx, id: offlineId };
      saveLocalTransactions([created, ...local]);
      return created;
    }
  },

  refund: async (id: string): Promise<void> => {
    const local = getLocalTransactions();
    saveLocalTransactions(local.map(t => t.id === id ? { ...t, status: 'refunded' } : t));

    try {
      await updateDoc(doc(db, COLLECTION, id), { status: 'refunded' });
    } catch (err) {
      console.warn('Failed to update refund in Firestore, updated locally:', err);
    }
  },

  updateTransaction: async (id: string, updates: Partial<SaleTransaction>): Promise<void> => {
    const local = getLocalTransactions();
    saveLocalTransactions(local.map(t => t.id === id ? { ...t, ...updates } : t));

    try {
      await updateDoc(doc(db, COLLECTION, id), updates);
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
