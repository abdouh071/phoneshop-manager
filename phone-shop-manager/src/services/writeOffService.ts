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
import type { StockWriteOff } from '../types';

const COLLECTION = 'writeOffLogs';

const docToEntry = (id: string, data: Record<string, unknown>): StockWriteOff => {
  const ts = data.timestamp as Timestamp | null;
  return {
    id,
    productId: data.productId as string,
    productName: data.productName as string,
    productSku: data.productSku as string,
    quantityWrittenOff: data.quantityWrittenOff as number,
    stockBefore: data.stockBefore as number,
    stockAfter: data.stockAfter as number,
    reason: data.reason as StockWriteOff['reason'],
    note: data.note as string | undefined,
    performedById: data.performedById as string | undefined,
    performedByName: data.performedByName as string | undefined,
    date: ts ? ts.toDate().toISOString() : (data.date as string) ?? new Date().toISOString(),
  };
};

export const writeOffService = {
  /** Save a new write-off event to Firestore. */
  log: async (entry: Omit<StockWriteOff, 'id' | 'date'>): Promise<StockWriteOff> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ...entry, id: `offline_writeoff_${Date.now()}`, date: new Date().toISOString() };
    }
    try {
      const docRef = await addDoc(collection(db, COLLECTION), {
        ...entry,
        timestamp: serverTimestamp(),
      });
      return { ...entry, id: docRef.id, date: new Date().toISOString() };
    } catch {
      return { ...entry, id: `offline_writeoff_${Date.now()}`, date: new Date().toISOString() };
    }
  },

  /** Fetch all write-off logs, newest first. */
  getAll: async (): Promise<StockWriteOff[]> => {
    const q = query(collection(db, COLLECTION), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => docToEntry(d.id, d.data() as Record<string, unknown>));
  },

  /** Fetch write-off logs for a specific product. */
  getByProduct: async (productId: string): Promise<StockWriteOff[]> => {
    const q = query(
      collection(db, COLLECTION),
      where('productId', '==', productId),
      orderBy('timestamp', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => docToEntry(d.id, d.data() as Record<string, unknown>));
  },
};
