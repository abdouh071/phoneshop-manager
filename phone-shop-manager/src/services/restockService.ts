import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RestockEntry } from '../types';

const COLLECTION = 'restockLogs';

const docToEntry = (id: string, data: Record<string, unknown>): RestockEntry => {
  const ts = data.timestamp as Timestamp | null;
  return {
    id,
    productId: data.productId as string,
    productName: data.productName as string,
    productSku: data.productSku as string,
    quantityAdded: data.quantityAdded as number,
    stockBefore: data.stockBefore as number,
    stockAfter: data.stockAfter as number,
    supplier: data.supplier as string | undefined,
    note: data.note as string | undefined,
    cost: data.cost as number | undefined,
    performedById: data.performedById as string | undefined,
    performedByName: data.performedByName as string | undefined,
    date: ts ? ts.toDate().toISOString() : (data.date as string) ?? new Date().toISOString(),
  };
};

export const restockService = {
  /** Log a new restock event to Firestore. */
  log: async (
    entry: Omit<RestockEntry, 'id' | 'date'>
  ): Promise<RestockEntry> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        ...entry,
        id: `offline_restock_${Date.now()}`,
        date: new Date().toISOString(),
      };
    }
    try {
      const docRef = await addDoc(collection(db, COLLECTION), {
        ...entry,
        timestamp: serverTimestamp(),
      });
      return {
        ...entry,
        id: docRef.id,
        date: new Date().toISOString(),
      };
    } catch {
      return {
        ...entry,
        id: `offline_restock_${Date.now()}`,
        date: new Date().toISOString(),
      };
    }
  },

  /** Fetch all restock logs, newest first. */
  getAll: async (): Promise<RestockEntry[]> => {
    const q = query(collection(db, COLLECTION), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => docToEntry(d.id, d.data() as Record<string, unknown>));
  },

  /** Fetch restock logs for a specific product. */
  getByProduct: async (productId: string): Promise<RestockEntry[]> => {
    const q = query(
      collection(db, COLLECTION),
      where('productId', '==', productId),
      orderBy('timestamp', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => docToEntry(d.id, d.data() as Record<string, unknown>));
  },
};
