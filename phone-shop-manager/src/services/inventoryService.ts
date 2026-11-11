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
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PhoneModel, StockStatus } from '../types';
import type { StockDelta } from '../utils/stockDeltas';
import { computeStockStatus } from '../utils/stockStatus';
import { withTimeout } from '../utils/withTimeout';
import { offlineQueue } from './offlineQueue';
import { offlineQueueMirror } from './offlineQueueMirror';
import { newIdempotencyKey } from './idempotentReplay';

const COLLECTION = 'inventory';
const LOCAL_STORAGE_KEY = 'offline_inventory';
const PENDING_PRODUCTS_KEY = 'offline_pending_products';
const PENDING_STOCK_ADJUSTMENTS_KEY = 'offline_pending_stock_adjustments';

/** Stock writes are read-modify-write; the transaction budget is wider than a plain write's. */
const STOCK_TX_TIMEOUT_MS = 2000;

/**
 * How many replay keys a product document carries. The list rides along in the write that
 * moves the shelf, so it costs no extra read — but it cannot grow without bound on a model
 * the shop sells all day. A replay follows its own write within one sync pass, so the keys
 * that matter are always the newest ones.
 */
const STOCK_REPLAY_KEYS_KEPT = 40;

export interface PendingStockAdjustment {
  /**
   * Also the replay key: minted before the first attempt and stamped on the product by the
   * transaction that applies the delta, so a write the server took while this device heard
   * a timeout is recognised on replay instead of moving the shelf a second time.
   */
  id: string;
  productId: string;
  delta: number;
  newStock?: number;
  /**
   * 'relative' — replay must add `delta` to the server's current stock.
   * 'absolute' — replay must set `newStock` verbatim (manual edits, write-offs).
   * Absent on records queued before this field existed: treated as 'absolute', the old behaviour.
   */
  mode?: 'relative' | 'absolute';
  timestamp: string;
}

/**
 * 'committed' — the server document was written.
 * 'queued'    — device was offline (or the id is local-only); the edit waits in the sync queue.
 * 'failed'    — the server rejected the write; the edit is still queued for retry, but nothing
 *               reached Firestore, so callers must not claim it was saved.
 */
export type ProductWriteOutcome = 'committed' | 'queued' | 'failed';

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
  const raw = JSON.stringify(products);
  try {
    localStorage.setItem(PENDING_PRODUCTS_KEY, raw);
  } catch (err) {
    console.error('Failed to save pending products to local storage', err);
  }
  offlineQueueMirror.write(PENDING_PRODUCTS_KEY, raw);
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
  const raw = JSON.stringify(adjustments);
  try {
    localStorage.setItem(PENDING_STOCK_ADJUSTMENTS_KEY, raw);
  } catch (err) {
    console.error('Failed to save pending stock adjustments to local storage', err);
  }
  // A queued delta is the one piece of offline inventory data that cannot be rebuilt: the
  // server never saw it, so if the local copy goes, the stock change goes with it.
  offlineQueueMirror.write(PENDING_STOCK_ADJUSTMENTS_KEY, raw);
};

/** True when the device cannot reach Firestore, or the id only exists on this device. */
const isLocalOnlyTarget = (id: string): boolean =>
  (typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_');

/**
 * Read the SERVER document and write `current + delta` inside one Firestore transaction.
 * Concurrent tills selling the same model therefore serialize instead of last-write-wins.
 * Throws on timeout or contention — callers fall back to the pending queue.
 *
 * `replayKey` names this movement. It is stamped in the same transaction that applies it,
 * so a write the server committed while the caller heard a timeout is recognised when the
 * queue replays it: the shelf moves once, not once per attempt.
 */
export const commitStockDelta = async (
  id: string,
  delta: number,
  replayKey?: string
): Promise<{ previousStock: number; stock: number; stockStatus: StockStatus }> =>
  withTimeout(
    runTransaction(db, async (tx) => {
      const ref = doc(db, COLLECTION, id);
      const snap = await tx.get(ref);
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      const currentStock = typeof data.stock === 'number' ? data.stock : 0;
      const threshold = typeof data.lowStockThreshold === 'number' ? data.lowStockThreshold : 1;
      // Read fresh on every attempt: Firestore re-runs this callback when the document
      // moves underneath it, and a list carried over from the last attempt would be stale.
      const stamped = Array.isArray(data.appliedStockKeys) ? (data.appliedStockKeys as unknown[]) : [];

      if (replayKey && stamped.includes(replayKey)) {
        return {
          previousStock: currentStock,
          stock: currentStock,
          stockStatus: computeStockStatus(currentStock, threshold),
        };
      }

      const nextStock = Math.max(0, currentStock + delta);
      const stockStatus = computeStockStatus(nextStock, threshold);
      tx.update(ref, {
        stock: nextStock,
        stockStatus,
        ...(replayKey
          ? { appliedStockKeys: [...stamped, replayKey].slice(-STOCK_REPLAY_KEYS_KEPT) }
          : {}),
      });
      return { previousStock: currentStock, stock: nextStock, stockStatus };
    }),
    STOCK_TX_TIMEOUT_MS,
    'stockTransaction'
  );

/** A sale's shelf movement needs a wider budget than one product: it reads the invoice
 *  and every line it carries before it can commit. */
const SALE_STOCK_TX_TIMEOUT_MS = 4000;

export interface SaleStockApplied {
  productId: string;
  previousStock: number;
  stock: number;
  stockStatus: StockStatus;
}

export interface SaleStockOutcome {
  applied: SaleStockApplied[];
  /** A line whose product is on neither shelf — reported, not thrown, so one deleted
   *  SKU cannot abort the rest of a settled sale. The caller queues these durably. */
  missed: { productId: string; delta: number; error: string }[];
  /** The invoice already carried the stamp, so nothing moved a second time. */
  adopted: boolean;
}

/**
 * Move the shelf for a whole invoice and stamp the invoice as moved, in ONE transaction.
 * =====================================================================================
 * The till used to write the sale and then fire the stock writes off separately. A crash
 * — or a closed tab — in the gap left an invoice the shelf never answered for, and nothing
 * replayed it: the sale was online, so the offline queue never saw it, and the stock queue
 * only holds deltas a write actually attempted. The invoice anchors the movement here: the
 * stamp is read and written inside the same transaction that deducts the units, so a retry
 * (the sync pass, the unfinished-sale sweep, a second till) adopts a finished sale instead
 * of deducting it again, and a half-finished one is completed exactly once.
 *
 * Signs are the caller's — `saleStockDeltas` decides what a retail return or a parts
 * dispatch owes the shelf — and the server's current stock is read inside the transaction,
 * so two tills selling the same model compose rather than clobber.
 */
export const commitSaleStockEffects = async (
  saleId: string,
  deltas: StockDelta[]
): Promise<SaleStockOutcome> => {
  let applied: SaleStockApplied[] = [];
  let missed: { productId: string; delta: number; error: string }[] = [];
  let adopted = false;

  await withTimeout(
    runTransaction(db, async (tx) => {
      // Firestore re-runs this callback when a document it read moves underneath it, so
      // every attempt starts from an empty report rather than appending to the last one.
      applied = [];
      missed = [];
      adopted = false;

      const saleRef = doc(db, 'transactions', saleId);
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error(`Sale ${saleId} no longer exists`);
      if ((saleSnap.data() as Record<string, unknown>).stockApplied === true) {
        adopted = true;
        return;
      }

      for (const { productId, delta } of deltas) {
        let ref = doc(db, COLLECTION, productId);
        let snap = await tx.get(ref);
        if (!snap.exists()) {
          ref = doc(db, 'products', productId);
          snap = await tx.get(ref);
          if (!snap.exists()) {
            missed.push({ productId, delta, error: `Product ${productId} not found in inventory or products` });
            continue;
          }
        }
        const data = snap.data() as Record<string, unknown>;
        const previousStock = typeof data.stock === 'number' ? data.stock : 0;
        const threshold = typeof data.lowStockThreshold === 'number' ? data.lowStockThreshold : 1;
        const stock = Math.max(0, previousStock + delta);
        const stockStatus = computeStockStatus(stock, threshold);
        tx.update(ref, { stock, stockStatus });
        applied.push({ productId, previousStock, stock, stockStatus });
      }

      tx.update(saleRef, { stockApplied: true });
    }),
    SALE_STOCK_TX_TIMEOUT_MS,
    'saleStockEffects'
  );

  // Reconcile this device's shelf mirror with what the server committed, so the till shows
  // the authoritative number rather than its own optimistic guess.
  if (applied.length) {
    const level = new Map(applied.map(a => [a.productId, a]));
    saveLocalInventory(
      getLocalInventory().map(p => {
        const a = level.get(p.id);
        return a ? { ...p, stock: a.stock, stockStatus: a.stockStatus } : p;
      })
    );
  }

  return { applied, missed, adopted };
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

    if (isLocalOnlyTarget(id)) {
      const pendingAdj = getPendingStockAdjustments();
      savePendingStockAdjustments([
        ...pendingAdj.filter(a => a.productId !== id),
        { id: newIdempotencyKey('tx'), productId: id, delta: 0, newStock, mode: 'absolute', timestamp: new Date().toISOString() }
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
        { id: newIdempotencyKey('tx'), productId: id, delta: 0, newStock, mode: 'absolute', timestamp: new Date().toISOString() }
      ]);
      return updatedLocal;
    }
  },

  /**
   * Apply a stock delta without trusting this device's mirror. The server document is read
   * inside the transaction, so two tills selling the same model compose instead of clobbering.
   * `previousStock` is the value the delta was applied to, and `atomic` says whether it came
   * from Firestore or from the local mirror (offline / write failed).
   */
  applyStockDelta: async (
    id: string,
    delta: number
  ): Promise<{ updated: PhoneModel; previousStock: number; atomic: boolean }> => {
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

    // Minted before the attempt, not at the replay: the transaction stamps this key on the
    // product, so a commit the till never heard about is recognised when the queue resends it.
    const replayKey = newIdempotencyKey('tx');

    // One entry per movement. Folding two deltas for the same product into one entry leaves
    // a single key naming both, and the replay cannot tell the one the server already took
    // from the one it never saw.
    const queueRelativeAdjustment = (): void => {
      savePendingStockAdjustments([
        ...getPendingStockAdjustments(),
        { id: replayKey, productId: id, delta, newStock, mode: 'relative', timestamp: new Date().toISOString() }
      ]);
    };

    if (isLocalOnlyTarget(id)) {
      queueRelativeAdjustment();
      return { updated: updatedLocal, previousStock: currentStock, atomic: false };
    }

    try {
      const authoritative = await commitStockDelta(id, delta, replayKey);
      const reconciled: PhoneModel = { ...updatedLocal, stock: authoritative.stock, stockStatus: authoritative.stockStatus };
      saveLocalInventory(getLocalInventory().map(p => (p.id === id ? reconciled : p)));
      return { updated: reconciled, previousStock: authoritative.previousStock, atomic: true };
    } catch (err) {
      console.warn(`Firestore applyStockDelta failed for ${id}, queued for sync:`, err);
      queueRelativeAdjustment();
      return { updated: updatedLocal, previousStock: currentStock, atomic: false };
    }
  },

  adjustStockAsync: async (id: string, delta: number): Promise<PhoneModel> => {
    const { updated } = await inventoryService.applyStockDelta(id, delta);
    return updated;
  },

  addProduct: async (product: Omit<PhoneModel, 'id'>): Promise<PhoneModel> => {
    const threshold = product.lowStockThreshold ?? 1;
    const stockStatus = computeStockStatus(product.stock, threshold);
    const local = getLocalInventory();
    // Minted before the first attempt, so a document the server wrote during a race the
    // counter gave up on carries the same key the replay will look the product up by.
    const keyed: Omit<PhoneModel, 'id'> = {
      ...product,
      stockStatus,
      idempotencyKey: newIdempotencyKey('product'),
    };

    // If offline, save locally with an offline_prod_ prefix and queue for sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineId = `offline_prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created: PhoneModel = { ...keyed, id: offlineId };
      saveLocalInventory([created, ...local.filter(p => p.id !== offlineId)]);
      savePendingProducts([...getPendingProducts().filter(p => p.id !== offlineId), created]);
      return created;
    }

    try {
      const addDocPromise = addDoc(collection(db, COLLECTION), keyed);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
      );
      const docRef = await Promise.race([addDocPromise, timeoutPromise]);
      const created: PhoneModel = { ...keyed, id: docRef.id };
      saveLocalInventory([created, ...local.filter(p => p.id !== created.id)]);
      return created;
    } catch (err) {
      console.warn('Failed to add product to Firestore, saving locally as offline pending:', err);
      const offlineId = `offline_prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created: PhoneModel = { ...keyed, id: offlineId };
      saveLocalInventory([created, ...local.filter(p => p.id !== offlineId)]);
      savePendingProducts([...getPendingProducts().filter(p => p.id !== offlineId), created]);
      return created;
    }
  },

  updateProduct: async (
    id: string,
    updates: Partial<Omit<PhoneModel, 'id'>>
  ): Promise<{ product: PhoneModel; outcome: ProductWriteOutcome }> => {
    const local = getLocalInventory();
    const existing = local.find(p => p.id === id);

    // Strip undefined values to prevent Firestore 'Unsupported field value: undefined' errors
    const cleanUpdates = Object.entries(updates).reduce((acc, [key, val]) => {
      if (val !== undefined) {
        acc[key] = val;
      }
      return acc;
    }, {} as Record<string, unknown>);

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
      return { product: merged, outcome: 'queued' };
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const updatePromise = updateDoc(ref, cleanUpdates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateProduct timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
      return { product: merged, outcome: 'committed' };
    } catch (err) {
      console.warn(`Failed to update product ${id} in Firestore, queued for sync:`, err);
      offlineQueue.enqueue('UPDATE_PRODUCT', { id, updates: cleanUpdates });
      return { product: merged, outcome: 'failed' };
    }
  },

  /**
   * `committed` only when the server document is really gone. `queued` means this device stopped
   * selling the product but the database still has it, which callers must not report as deleted.
   */
  deleteProduct: async (id: string): Promise<ProductWriteOutcome> => {
    const local = getLocalInventory();
    saveLocalInventory(local.filter(p => p.id !== id));
    savePendingProducts(getPendingProducts().filter(p => p.id !== id));

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
      if (!id.startsWith('offline_')) {
        offlineQueue.enqueue('DELETE_PRODUCT', { id });
        return 'queued';
      }
      // A product that only ever existed on this device has nothing to delete server-side.
      return 'committed';
    }

    try {
      await deleteDoc(doc(db, COLLECTION, id));
      return 'committed';
    } catch (err) {
      console.warn(`Failed to delete product ${id} in Firestore, queued for sync:`, err);
      offlineQueue.enqueue('DELETE_PRODUCT', { id });
      return 'queued';
    }
  },

  addProductsBulk: async (products: Omit<PhoneModel, 'id'>[]): Promise<PhoneModel[]> => {
    const local = getLocalInventory();
    const pending = getPendingProducts();

    const stamp = (product: Omit<PhoneModel, 'id'>): Omit<PhoneModel, 'id'> => ({
      ...product,
      stockStatus: computeStockStatus(product.stock, product.lowStockThreshold ?? 1),
      idempotencyKey: newIdempotencyKey('product'),
    });

    const tempId = (suffix: string) => `offline_prod_${Date.now()}_${suffix}_${Math.random().toString(36).slice(2, 6)}`;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const createdList: PhoneModel[] = products.map((product, idx) => ({
        ...stamp(product),
        id: tempId(String(idx)),
      }));
      saveLocalInventory([...createdList, ...local]);
      savePendingProducts([...pending, ...createdList]);
      return createdList;
    }

    const BATCH_SIZE = 500;
    const results: PhoneModel[] = [];

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      // Every row carries its key before the batch is sent, and keeps it on the copy this
      // device files when a commit is not heard. A failed chunk used to re-queue the whole
      // import sheet: the rows whose batch had already landed were written a second time,
      // splitting one SKU over two documents — and the stock the counter deducts from is
      // whichever copy the shelf happens to read first.
      const chunk = products.slice(i, i + BATCH_SIZE).map(stamp);
      const batch = writeBatch(db);
      const refs = chunk.map(() => doc(collection(db, COLLECTION)));
      chunk.forEach((row, idx) => batch.set(refs[idx], row));

      try {
        await batch.commit();
        chunk.forEach((row, idx) => results.push({ ...row, id: refs[idx].id }));
        continue;
      } catch (err) {
        console.warn('Failed to commit a bulk-import batch, filing only its own rows:', err);
      }

      // This chunk may be on the server already; the chunks after it certainly are not, since
      // the loop never reached them. Both are filed as pending under the key each row was sent with.
      const filedLocally: PhoneModel[] = [
        ...chunk.map((row, idx) => ({ ...row, id: tempId(String(i + idx)) })),
        ...products
          .slice(i + BATCH_SIZE)
          .map((product, offset) => ({ ...stamp(product), id: tempId(String(i + BATCH_SIZE + offset)) })),
      ];

      saveLocalInventory([...results, ...filedLocally, ...local]);
      savePendingProducts([...pending, ...filedLocally]);
      return [...results, ...filedLocally];
    }

    saveLocalInventory([...results, ...local]);
    return results;
  },
};
