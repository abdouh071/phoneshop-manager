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
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PhoneModel } from '../types';
import { offlineQueue } from './offlineQueue';

const COLLECTION = 'inventory';
const LOCAL_STORAGE_KEY = 'offline_inventory';
const PENDING_PRODUCTS_KEY = 'offline_pending_products';
const PENDING_STOCK_ADJUSTMENTS_KEY = 'offline_pending_stock_adjustments';

export interface PendingStockAdjustment {
  id: string;
  productId: string;
  delta: number;
  newStock?: number;
  timestamp: string;
}

const computeStockStatus = (stock: number, threshold: number): PhoneModel['stockStatus'] => {
  if (stock === 0) return 'out_of_stock';
  if (stock <= threshold) return 'low_stock';
  return 'in_stock';
};

const docToProduct = (id: string, data: Record<string, unknown>): PhoneModel => ({
  ...(data as Omit<PhoneModel, 'id'>),
  id,
});

const getLocalInventory = (): PhoneModel[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalInventory = (products: PhoneModel[]): void => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(products));
  } catch (err) {
    console.error('Failed to save inventory to local storage', err);
  }
};

const getPendingProducts = (): PhoneModel[] => {
  try {
    const raw = localStorage.getItem(PENDING_PRODUCTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const savePendingProducts = (products: PhoneModel[]): void => {
  try {
    localStorage.setItem(PENDING_PRODUCTS_KEY, JSON.stringify(products));
  } catch (err) {
    console.error('Failed to save pending products to local storage', err);
  }
};

const getPendingStockAdjustments = (): PendingStockAdjustment[] => {
  try {
    const raw = localStorage.getItem(PENDING_STOCK_ADJUSTMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const savePendingStockAdjustments = (adjustments: PendingStockAdjustment[]): void => {
  try {
    localStorage.setItem(PENDING_STOCK_ADJUSTMENTS_KEY, JSON.stringify(adjustments));
  } catch (err) {
    console.error('Failed to save pending stock adjustments to local storage', err);
  }
};

export const inventoryService = {
  // Export local storage accessors for the unified sync service
  getLocalInventory,
  saveLocalInventory,
  getPendingProducts,
  savePendingProducts,
  getPendingStockAdjustments,
  savePendingStockAdjustments,

  // Server-side query for retail products ONLY (Firestore excludes repair parts from the beginning)
  getRetailProducts: async (): Promise<PhoneModel[]> => {
    // If device is offline, return from local storage immediately with zero delay
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalInventory()
        .filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('category', '!=', 'repair_part')
      );
      const snap = await getDocs(q);
      const serverProducts = snap.docs
        .map(d => docToProduct(d.id, d.data() as Record<string, unknown>))
        .filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));

      // Merge any locally pending offline products
      const pending = getPendingProducts().filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));
      const serverIds = new Set(serverProducts.map(p => p.id));
      const merged = [...pending.filter(p => !serverIds.has(p.id)), ...serverProducts]
        .sort((a, b) => a.name.localeCompare(b.name));

      // Update local storage mirror (preserving parts)
      const local = getLocalInventory();
      const existingParts = local.filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-'));
      saveLocalInventory([...merged, ...existingParts]);

      return merged;
    } catch (err) {
      console.warn('Firestore getRetailProducts failed, using local cache:', err);
      return getLocalInventory()
        .filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  },

  // Server-side query for repair parts ONLY (Firestore returns only repair parts from the beginning)
  getRepairParts: async (): Promise<PhoneModel[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalInventory()
        .filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-'))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('category', '==', 'repair_part')
      );
      const snap = await getDocs(q);
      const serverParts = snap.docs
        .map(d => docToProduct(d.id, d.data() as Record<string, unknown>));

      // Merge any locally pending offline parts
      const pending = getPendingProducts().filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-'));
      const serverIds = new Set(serverParts.map(p => p.id));
      const merged = [...pending.filter(p => !serverIds.has(p.id)), ...serverParts]
        .sort((a, b) => a.name.localeCompare(b.name));

      // Update local storage mirror (preserving retail products)
      const local = getLocalInventory();
      const existingRetail = local.filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));
      saveLocalInventory([...existingRetail, ...merged]);

      return merged;
    } catch (err) {
      console.warn('Firestore getRepairParts failed, using local cache:', err);
      return getLocalInventory()
        .filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-'))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  },

  getAll: async (): Promise<PhoneModel[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalInventory().sort((a, b) => a.name.localeCompare(b.name));
    }

    try {
      const q = query(collection(db, COLLECTION), orderBy('name'));
      const snap = await getDocs(q);
      const serverItems = snap.docs.map(d => docToProduct(d.id, d.data() as Record<string, unknown>));

      const pending = getPendingProducts();
      const serverIds = new Set(serverItems.map(p => p.id));
      const merged = [...pending.filter(p => !serverIds.has(p.id)), ...serverItems]
        .sort((a, b) => a.name.localeCompare(b.name));

      saveLocalInventory(merged);
      return merged;
    } catch (err) {
      console.warn('Firestore getAll inventory failed, using local cache:', err);
      return getLocalInventory().sort((a, b) => a.name.localeCompare(b.name));
    }
  },

  getById: async (id: string): Promise<PhoneModel | undefined> => {
    const local = getLocalInventory();
    const fromLocal = local.find(p => p.id === id);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return fromLocal;
    }

    try {
      const snapPromise = getDoc(doc(db, COLLECTION, id));
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore getById timeout')), 1200)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      if (!snap.exists()) return fromLocal;
      const product = docToProduct(snap.id, snap.data() as Record<string, unknown>);
      saveLocalInventory(local.map(p => p.id === id ? product : p));
      return product;
    } catch (err) {
      console.warn(`Firestore getById for ${id} failed, returning local:`, err);
      return fromLocal;
    }
  },

  updateStock: async (id: string, newStock: number): Promise<PhoneModel> => {
    const local = getLocalInventory();
    const existing = local.find(p => p.id === id);
    const threshold = existing?.lowStockThreshold ?? 1;
    const stockStatus = computeStockStatus(newStock, threshold);
    const updatedLocal: PhoneModel = existing
      ? { ...existing, stock: newStock, stockStatus }
      : ({ id, stock: newStock, stockStatus, name: 'Product' } as PhoneModel);

    // Save to local storage immediately so UI is always updated
    saveLocalInventory(local.map(p => p.id === id ? updatedLocal : p));

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
      const pendingAdj = getPendingStockAdjustments();
      savePendingStockAdjustments([
        ...pendingAdj.filter(a => a.productId !== id),
        { id: `adj_${Date.now()}_${id}`, productId: id, delta: 0, newStock, timestamp: new Date().toISOString() }
      ]);
      return updatedLocal;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const updatePromise = updateDoc(ref, { stock: newStock, stockStatus });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateStock timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
      return updatedLocal;
    } catch (err) {
      console.warn(`Firestore updateStock failed for ${id}, queued for sync:`, err);
      const pendingAdj = getPendingStockAdjustments();
      savePendingStockAdjustments([
        ...pendingAdj.filter(a => a.productId !== id),
        { id: `adj_${Date.now()}_${id}`, productId: id, delta: 0, newStock, timestamp: new Date().toISOString() }
      ]);
      return updatedLocal;
    }
  },

  adjustStockAsync: async (id: string, delta: number): Promise<PhoneModel> => {
    const local = getLocalInventory();
    const existing = local.find(p => p.id === id);
    const currentStock = existing?.stock ?? 0;
    const newStock = Math.max(0, currentStock + delta);
    const threshold = existing?.lowStockThreshold ?? 1;
    const stockStatus = computeStockStatus(newStock, threshold);
    const updatedLocal: PhoneModel = existing
      ? { ...existing, stock: newStock, stockStatus }
      : ({ id, stock: newStock, stockStatus, name: 'Product' } as PhoneModel);

    // Update local storage mirror immediately
    saveLocalInventory(local.map(p => p.id === id ? updatedLocal : p));

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
      const pendingAdj = getPendingStockAdjustments();
      const existingAdj = pendingAdj.find(a => a.productId === id);
      if (existingAdj) {
        existingAdj.delta += delta;
        existingAdj.newStock = newStock;
        existingAdj.timestamp = new Date().toISOString();
        savePendingStockAdjustments([...pendingAdj]);
      } else {
        savePendingStockAdjustments([
          ...pendingAdj,
          { id: `adj_${Date.now()}_${id}`, productId: id, delta, newStock, timestamp: new Date().toISOString() }
        ]);
      }
      return updatedLocal;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const updatePromise = updateDoc(ref, { stock: newStock, stockStatus });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore adjustStock timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
      return updatedLocal;
    } catch (err) {
      console.warn(`Firestore adjustStockAsync failed for ${id}, queued for sync:`, err);
      const pendingAdj = getPendingStockAdjustments();
      const existingAdj = pendingAdj.find(a => a.productId === id);
      if (existingAdj) {
        existingAdj.delta += delta;
        existingAdj.newStock = newStock;
        existingAdj.timestamp = new Date().toISOString();
        savePendingStockAdjustments([...pendingAdj]);
      } else {
        savePendingStockAdjustments([
          ...pendingAdj,
          { id: `adj_${Date.now()}_${id}`, productId: id, delta, newStock, timestamp: new Date().toISOString() }
        ]);
      }
      return updatedLocal;
    }
  },

  addProduct: async (product: Omit<PhoneModel, 'id'>): Promise<PhoneModel> => {
    const threshold = product.lowStockThreshold ?? 1;
    const stockStatus = computeStockStatus(product.stock, threshold);
    const local = getLocalInventory();

    // If offline, save locally with an offline_prod_ prefix and queue for sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineId = `offline_prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created: PhoneModel = { ...product, id: offlineId, stockStatus };
      saveLocalInventory([created, ...local.filter(p => p.id !== offlineId)]);
      savePendingProducts([...getPendingProducts().filter(p => p.id !== offlineId), created]);
      return created;
    }

    try {
      const addDocPromise = addDoc(collection(db, COLLECTION), { ...product, stockStatus });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
      );
      const docRef = await Promise.race([addDocPromise, timeoutPromise]);
      const created: PhoneModel = { ...product, id: docRef.id, stockStatus };
      saveLocalInventory([created, ...local.filter(p => p.id !== created.id)]);
      return created;
    } catch (err) {
      console.warn('Failed to add product to Firestore, saving locally as offline pending:', err);
      const offlineId = `offline_prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created: PhoneModel = { ...product, id: offlineId, stockStatus };
      saveLocalInventory([created, ...local.filter(p => p.id !== offlineId)]);
      savePendingProducts([...getPendingProducts().filter(p => p.id !== offlineId), created]);
      return created;
    }
  },

  updateProduct: async (id: string, updates: Partial<Omit<PhoneModel, 'id'>>): Promise<PhoneModel> => {
    const local = getLocalInventory();
    const existing = local.find(p => p.id === id);

    // Strip undefined values to prevent Firestore 'Unsupported field value: undefined' errors
    const cleanUpdates = Object.entries(updates).reduce((acc, [key, val]) => {
      if (val !== undefined) {
        acc[key] = val;
      }
      return acc;
    }, {} as Record<string, any>);

    const merged = { ...(existing || ({} as PhoneModel)), ...cleanUpdates, id };
    if (cleanUpdates.stock !== undefined) {
      const threshold = merged.lowStockThreshold ?? 1;
      merged.stockStatus = computeStockStatus(merged.stock, threshold);
      cleanUpdates.stockStatus = merged.stockStatus;
    }

    // Save locally immediately
    saveLocalInventory(local.map(p => p.id === id ? merged : p));

    // If offline or id is an offline temp id, queue in offlineQueue
    if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
      offlineQueue.enqueue('UPDATE_PRODUCT', { id, updates: cleanUpdates });
      return merged;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const updatePromise = updateDoc(ref, cleanUpdates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateProduct timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
      return merged;
    } catch (err) {
      console.warn(`Failed to update product ${id} in Firestore, queued for sync:`, err);
      offlineQueue.enqueue('UPDATE_PRODUCT', { id, updates: cleanUpdates });
      return merged;
    }
  },

  deleteProduct: async (id: string): Promise<void> => {
    const local = getLocalInventory();
    saveLocalInventory(local.filter(p => p.id !== id));
    savePendingProducts(getPendingProducts().filter(p => p.id !== id));

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
      if (!id.startsWith('offline_')) {
        offlineQueue.enqueue('DELETE_PRODUCT', { id });
      }
      return;
    }

    try {
      await deleteDoc(doc(db, COLLECTION, id));
    } catch (err) {
      console.warn(`Failed to delete product ${id} in Firestore, queued for sync:`, err);
      offlineQueue.enqueue('DELETE_PRODUCT', { id });
    }
  },

  addProductsBulk: async (products: Omit<PhoneModel, 'id'>[]): Promise<PhoneModel[]> => {
    const local = getLocalInventory();
    const pending = getPendingProducts();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const createdList: PhoneModel[] = products.map((product, idx) => {
        const threshold = product.lowStockThreshold ?? 1;
        const stockStatus = computeStockStatus(product.stock, threshold);
        const offlineId = `offline_prod_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
        return { ...product, id: offlineId, stockStatus };
      });
      saveLocalInventory([...createdList, ...local]);
      savePendingProducts([...pending, ...createdList]);
      return createdList;
    }

    const BATCH_SIZE = 500;
    const results: PhoneModel[] = [];

    try {
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

      saveLocalInventory([...results, ...local]);
      return results;
    } catch (err) {
      console.warn('Failed to bulk add products to Firestore, saving locally:', err);
      const createdList: PhoneModel[] = products.map((product, idx) => {
        const threshold = product.lowStockThreshold ?? 1;
        const stockStatus = computeStockStatus(product.stock, threshold);
        const offlineId = `offline_prod_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
        return { ...product, id: offlineId, stockStatus };
      });
      saveLocalInventory([...createdList, ...local]);
      savePendingProducts([...pending, ...createdList]);
      return createdList;
    }
  },
};
