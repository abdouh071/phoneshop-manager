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
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PhoneModel } from '../types';

const COLLECTION = 'inventory';

const computeStockStatus = (stock: number, threshold: number): PhoneModel['stockStatus'] => {
  if (stock === 0) return 'out_of_stock';
  if (stock <= threshold) return 'low_stock';
  return 'in_stock';
};

const docToProduct = (id: string, data: Record<string, unknown>): PhoneModel => ({
  ...(data as Omit<PhoneModel, 'id'>),
  id,
});

export const inventoryService = {
  // Server-side query for retail products ONLY (Firestore excludes repair parts from the beginning)
  getRetailProducts: async (): Promise<PhoneModel[]> => {
    const q = query(
      collection(db, COLLECTION),
      where('category', '!=', 'repair_part')
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => docToProduct(d.id, d.data() as Record<string, unknown>))
      .filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // Server-side query for repair parts ONLY (Firestore returns only repair parts from the beginning)
  getRepairParts: async (): Promise<PhoneModel[]> => {
    const q = query(
      collection(db, COLLECTION),
      where('category', '==', 'repair_part')
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => docToProduct(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getAll: async (): Promise<PhoneModel[]> => {
    const q = query(collection(db, COLLECTION), orderBy('name'));
    const snap = await getDocs(q);
    return snap.docs.map(d => docToProduct(d.id, d.data() as Record<string, unknown>));
  },

  getById: async (id: string): Promise<PhoneModel | undefined> => {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return undefined;
    return docToProduct(snap.id, snap.data() as Record<string, unknown>);
  },

  updateStock: async (id: string, newStock: number): Promise<PhoneModel> => {
    const ref = doc(db, COLLECTION, id);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`Product ${id} not found`);
      const data = snap.data() as Omit<PhoneModel, 'id'>;
      const threshold = data.lowStockThreshold ?? 1;
      const stockStatus = computeStockStatus(newStock, threshold);
      tx.update(ref, { stock: newStock, stockStatus });
      return { ...data, id, stock: newStock, stockStatus };
    });
  },

  adjustStockAsync: async (id: string, delta: number): Promise<PhoneModel> => {
    const ref = doc(db, COLLECTION, id);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`Product ${id} not found`);
      const data = snap.data() as Omit<PhoneModel, 'id'>;
      const newStock = Math.max(0, data.stock + delta); // Prevent negative stock
      const threshold = data.lowStockThreshold ?? 1;
      const stockStatus = computeStockStatus(newStock, threshold);
      tx.update(ref, { stock: newStock, stockStatus });
      return { ...data, id, stock: newStock, stockStatus };
    });
  },

  addProduct: async (product: Omit<PhoneModel, 'id'>): Promise<PhoneModel> => {
    const threshold = product.lowStockThreshold ?? 1;
    const stockStatus = computeStockStatus(product.stock, threshold);
    const docRef = await addDoc(collection(db, COLLECTION), { ...product, stockStatus });
    return { ...product, id: docRef.id, stockStatus };
  },

  updateProduct: async (id: string, updates: Partial<Omit<PhoneModel, 'id'>>): Promise<PhoneModel> => {
    const ref = doc(db, COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error(`Product ${id} not found`);
    const existing = snap.data() as Omit<PhoneModel, 'id'>;

    // Strip undefined values to prevent Firestore 'Unsupported field value: undefined' errors (Gap 6 fix)
    const cleanUpdates = Object.entries(updates).reduce((acc, [key, val]) => {
      if (val !== undefined) {
        acc[key] = val;
      }
      return acc;
    }, {} as Record<string, any>);

    const merged = { ...existing, ...cleanUpdates };
    if (cleanUpdates.stock !== undefined) {
      const threshold = merged.lowStockThreshold ?? 1;
      merged.stockStatus = computeStockStatus(merged.stock, threshold);
      cleanUpdates.stockStatus = merged.stockStatus;
    }
    await updateDoc(ref, cleanUpdates);
    return { ...merged, id };
  },

  deleteProduct: async (id: string): Promise<void> => {
    await deleteDoc(doc(db, COLLECTION, id));
  },

  addProductsBulk: async (products: Omit<PhoneModel, 'id'>[]): Promise<PhoneModel[]> => {
    const BATCH_SIZE = 500;
    const results: PhoneModel[] = [];
    
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = products.slice(i, i + BATCH_SIZE);
      
      chunk.forEach(product => {
        const threshold = product.lowStockThreshold ?? 1;
        const stockStatus = computeStockStatus(product.stock, threshold);
        const docRef = doc(collection(db, COLLECTION));
        batch.set(docRef, { ...product, stockStatus });
        results.push({ ...product, id: docRef.id, stockStatus });
      });
      
      await batch.commit();
    }
    
    return results;
  },
};
