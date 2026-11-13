import { create } from 'zustand';
import type { PhoneModel, WriteOffReason } from '../types';
import { computeStockStatus } from '../utils/stockStatus';
import { normalizeArabic } from '../utils/normalizeText';
import { inventoryService } from '../services/inventoryService';
import type { ProductWriteOutcome } from '../services/inventoryService';
import { restockService } from '../services/restockService';
import { writeOffService } from '../services/writeOffService';
import { useActivityStore } from './activityStore';
import { useAuthStore } from './authStore';
import { generateSKU, resolveUniqueSKU } from '../features/inventory/AddProductModal';

/**
 * `committed` means the server document moved. `queued` means only this device moved and the
 * delta waits in the offline queue, so callers must not present it as saved.
 */
export type StockWriteOutcome = 'committed' | 'queued' | 'failed' | 'unchanged';

export interface StockWriteResult {
  outcome: StockWriteOutcome;
  /** Units the shelf actually moved by; 0 when nothing was applied. */
  applied: number;
}

/**
 * Every code a scan already answers to, across products and parts.
 *
 * A new product is given a distinct sku from this set, so the set has to hold the
 * legacy `barcode` field too: a scan reads either one, and a sku that lands on
 * another row's barcode is the same code saved twice — which is how one scan came to
 * sell the neighbour product.
 */
const codesAlreadyInUse = (rows: readonly PhoneModel[]): Set<string> => {
  const taken = new Set<string>();
  for (const row of rows) {
    if (row.sku) taken.add(row.sku.toUpperCase().trim());
    if (row.barcode) taken.add(row.barcode.toUpperCase().trim());
  }
  return taken;
};

/** The optimistic shelf update both adjustment actions share, so the UI moves instantly. */
const applyLocalStockDelta = (
  set: (fn: (state: InventoryState) => Partial<InventoryState>) => void,
  id: string,
  delta: number
): void => {
  set(state => ({
    products: state.products.map(p => {
      if (p.id !== id) return p;
      const newStock = Math.max(0, p.stock + delta);
      const stockStatus = computeStockStatus(newStock, p.lowStockThreshold);
      return { ...p, stock: newStock, stockStatus };
    }),
    parts: state.parts.map(p => {
      if (p.id !== id) return p;
      const newStock = Math.max(0, p.stock + delta);
      const stockStatus = computeStockStatus(newStock, p.lowStockThreshold);
      return { ...p, stock: newStock, stockStatus };
    }),
  }));
};

interface InventoryState {
  products: PhoneModel[]; // Retail products (Server excludes repair_part from the beginning)
  parts: PhoneModel[];    // Repair parts (Server sends only repair_part from the beginning)
  isLoading: boolean;
  isLoadingParts: boolean;
  error: string | null;
  searchQuery: string;
  // Actions
  fetchProducts: () => Promise<void>;
  fetchParts: () => Promise<void>;
  fetchAll: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  updateStock: (id: string, newStock: number) => Promise<void>;
  restockProduct: (id: string, quantityToAdd: number, opts?: { supplier?: string; note?: string; cost?: number }) => Promise<StockWriteResult>;
  writeOffStock: (id: string, quantity: number, reason: WriteOffReason, note?: string) => Promise<StockWriteResult>;
  adjustStockBy: (id: string, delta: number) => void;  // live adjustment (no async, no server call)
  /**
   * The awaited form of adjustStockBy: same optimistic update, but the promise settles
   * only when the shelf change is durable (committed, or parked in the offline queue)
   * and rejects when it is not. Checkouts that must not write an invoice ahead of the
   * stock it consumes wait on this.
   */
  adjustStockByAsync: (id: string, delta: number) => Promise<PhoneModel>;
  /** Like adjustStockByAsync but throws INSUFFICIENT_STOCK on oversell (for checkouts). */
  adjustStockByAsyncForSale: (id: string, delta: number) => Promise<PhoneModel>;
  addProduct: (product: Omit<PhoneModel, 'id'>) => Promise<void>;
  addProductsBulk: (products: Omit<PhoneModel, 'id'>[]) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Omit<PhoneModel, 'id'>>) => Promise<ProductWriteOutcome>;
  deleteProduct: (id: string) => Promise<ProductWriteOutcome>;
  // Derived
  getFilteredProducts: (excludeCategory?: string) => PhoneModel[];
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  products: [],
  parts: [],
  isLoading: false,
  isLoadingParts: false,
  error: null,
  searchQuery: '',

  // Server-side retail fetch: Firestore query excludes repair parts from the beginning
  fetchProducts: async () => {
    set({ isLoading: true, error: null });
    try {
      const rawProducts = await inventoryService.getRetailProducts();
      const products = rawProducts.filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));
      set({ products, isLoading: false });
    } catch (err) {
      console.error('Failed to load retail inventory from server:', err);
      set({ error: 'Failed to load retail inventory', isLoading: false });
    }
  },

  // Server-side parts fetch: Firestore query asks only for repair parts from the beginning
  fetchParts: async () => {
    set({ isLoadingParts: true, error: null });
    try {
      const parts = await inventoryService.getRepairParts();
      set({ parts, isLoadingParts: false });
    } catch (err) {
      console.error('Failed to load repair parts from server:', err);
      set({ error: 'Failed to load repair parts', isLoadingParts: false });
    }
  },

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const all = await inventoryService.getAll();
      const retail = all.filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));
      const parts = all.filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-'));
      set({ products: retail, parts, isLoading: false });
    } catch (err) {
      set({ error: 'Failed to load full inventory', isLoading: false });
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  updateStock: async (id, newStock) => {
    try {
      const existing = get().products.find(p => p.id === id) || get().parts.find(p => p.id === id);
      const updated = await inventoryService.updateStock(id, newStock);
      set(state => ({
        products: state.products.map(p => p.id === id ? updated : p),
        parts: state.parts.map(p => p.id === id ? updated : p),
      }));

      const user = useAuthStore.getState().user;
      const userName = user ? user.name : 'System';
      const delta = newStock - (existing?.stock || 0);
      const sign = delta > 0 ? '+' : '';
      useActivityStore.getState().logActivity(
        'inventory',
        `${sign}${delta} units stock updated by ${userName}`,
        id,
        user?.id
      );
    } catch (err) {
      set({ error: 'Failed to update stock' });
    }
  },

  restockProduct: async (id, quantityToAdd, opts = {}) => {
    try {
      const existing = get().products.find(p => p.id === id) || get().parts.find(p => p.id === id);
      if (!existing) {
        set({ error: 'Product not found in this till\'s inventory' });
        return { outcome: 'failed', applied: 0 };
      }
      // The delta is applied server-side, so two tills restocking the same part both count.
      const { updated, previousStock, atomic } = await inventoryService.applyStockDelta(id, quantityToAdd);
      const stockBefore = previousStock;
      const stockAfter = updated.stock;
      set(state => ({
        products: state.products.map(p => p.id === id ? updated : p),
        parts: state.parts.map(p => p.id === id ? updated : p),
      }));
      const user = useAuthStore.getState().user;
      // Persist the structured restock log
      await restockService.log({
        productId: id,
        productName: existing.name,
        productSku: existing.sku,
        quantityAdded: quantityToAdd,
        stockBefore,
        stockAfter,
        supplier: opts.supplier,
        note: opts.note,
        cost: opts.cost,
        performedById: user?.id,
        performedByName: user?.name,
      });
      useActivityStore.getState().logActivity(
        'inventory',
        `Restocked ${existing.name}: +${quantityToAdd} units (${stockBefore} → ${stockAfter})`,
        { entityId: id, entityType: existing.category === 'repair_part' ? 'part' : 'product', severity: 'success', userName: user?.name, userId: user?.id }
      );
      return { outcome: atomic ? 'committed' : 'queued', applied: quantityToAdd };
    } catch {
      set({ error: 'Failed to restock product' });
      return { outcome: 'failed', applied: 0 };
    }
  },

  writeOffStock: async (id, quantity, reason, note) => {
    try {
      const existing = get().products.find(p => p.id === id) || get().parts.find(p => p.id === id);
      if (!existing) {
        set({ error: 'Product not found in this till\'s inventory' });
        return { outcome: 'failed', applied: 0 };
      }
      // Same short-circuit as before: a zero quantity or an already-empty local stock writes nothing off.
      if (quantity <= 0 || existing.stock === 0) return { outcome: 'unchanged', applied: 0 };
      // The clamp at zero now happens inside the transaction, against the server's stock.
      const { updated, previousStock, atomic } = await inventoryService.applyStockDelta(id, -quantity);
      const stockBefore = previousStock;
      const stockAfter = updated.stock;
      const actualWrittenOff = stockBefore - stockAfter; // can't write off more than stock
      if (actualWrittenOff <= 0) return { outcome: 'unchanged', applied: 0 };
      set(state => ({
        products: state.products.map(p => p.id === id ? updated : p),
        parts: state.parts.map(p => p.id === id ? updated : p),
      }));
      const user = useAuthStore.getState().user;
      await writeOffService.log({
        productId: id,
        productName: existing.name,
        productSku: existing.sku,
        quantityWrittenOff: actualWrittenOff,
        stockBefore,
        stockAfter,
        reason,
        note,
        performedById: user?.id,
        performedByName: user?.name,
      });
      const reasonLabel = reason.charAt(0).toUpperCase() + reason.slice(1);
      useActivityStore.getState().logActivity(
        'inventory',
        `Write-off: -${actualWrittenOff} units of ${existing.name} [${reasonLabel}] (${stockBefore} → ${stockAfter})`,
        { entityId: id, entityType: existing.category === 'repair_part' ? 'part' : 'product', severity: 'danger', detail: note || undefined, userName: user?.name, userId: user?.id }
      );
      return { outcome: atomic ? 'committed' : 'queued', applied: actualWrittenOff };
    } catch {
      set({ error: 'Failed to write off stock' });
      return { outcome: 'failed', applied: 0 };
    }
  },

  // Stock adjustment: updates local state instantly AND persists to Firebase.
  adjustStockBy: (id, delta) => {
    applyLocalStockDelta(set, id, delta);

    // 2. Persist to Firebase so stock survives reload
    inventoryService.adjustStockAsync(id, delta)
      .then(updated => {
        // Reconcile local state with the authoritative DB value
        set(state => ({
          products: state.products.map(p => p.id === id ? updated : p),
          parts: state.parts.map(p => p.id === id ? updated : p),
        }));
      })
      .catch(err => console.error(`Failed to persist stock adjustment for ${id}:`, err));
  },

  adjustStockByAsync: async (id, delta) => {
    applyLocalStockDelta(set, id, delta);
    const updated = await inventoryService.adjustStockAsync(id, delta);
    set(state => ({
      products: state.products.map(p => p.id === id ? updated : p),
      parts: state.parts.map(p => p.id === id ? updated : p),
    }));
    return updated;
  },

  adjustStockByAsyncForSale: async (id, delta) => {
    applyLocalStockDelta(set, id, delta);
    const { updated } = await inventoryService.applyStockDeltaForSale(id, delta);
    set(state => ({
      products: state.products.map(p => p.id === id ? updated : p),
      parts: state.parts.map(p => p.id === id ? updated : p),
    }));
    return updated;
  },

  addProduct: async (product) => {
    try {
      // Safety net: resolve SKU against all existing products before persisting
      const systemSkus = codesAlreadyInUse([...get().products, ...get().parts]);
      const rawSku = (product.sku || '').trim() || generateSKU(product.name, product.model, product.storage || '', product.color || '');
      const safeSku = resolveUniqueSKU(rawSku, systemSkus);
      const safeProduct = { ...product, sku: safeSku };

      const newProduct = await inventoryService.addProduct(safeProduct);
      if (newProduct.category === 'repair_part' || newProduct.sku?.toUpperCase().startsWith('PRT-')) {
        set(state => ({ parts: [...state.parts, newProduct] }));
      } else {
        set(state => ({ products: [...state.products, newProduct] }));
      }
      
      const user = useAuthStore.getState().user;
      useActivityStore.getState().logActivity(
        'inventory',
        `Product created: ${product.name} ${product.model}`,
        { entityId: newProduct.id, entityType: newProduct.category === 'repair_part' ? 'part' : 'product', severity: 'success', userName: user?.name, userId: user?.id }
      );
    } catch (err) {
      set({ error: 'Failed to add product' });
    }
  },

  addProductsBulk: async (products) => {
    try {
      // Safety net: resolve every product's SKU against existing store + prior items in this batch
      const systemSkus = codesAlreadyInUse([...get().products, ...get().parts]);
      const safeProducts = products.map(product => {
        const rawSku = (product.sku || '').trim() || generateSKU(product.name, product.model, product.storage || '', product.color || '');
        const safeSku = resolveUniqueSKU(rawSku, systemSkus); // mutates systemSkus so next product sees this one
        return { ...product, sku: safeSku };
      });

      const newProducts = await inventoryService.addProductsBulk(safeProducts);
      const newParts = newProducts.filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-'));
      const newRetail = newProducts.filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));
      set(state => ({
        products: [...state.products, ...newRetail],
        parts: [...state.parts, ...newParts],
      }));
      
      const user = useAuthStore.getState().user;
      useActivityStore.getState().logActivity(
        'inventory',
        `Bulk import: Added ${products.length} products`,
        'bulk-import',
        user?.id
      );
    } catch (err) {
      set({ error: 'Failed to bulk import products' });
      throw err;
    }
  },

  updateProduct: async (id, updates) => {
    try {
      const { product: updated, outcome } = await inventoryService.updateProduct(id, updates);
      set(state => ({
        products: state.products
          .map(p => p.id === id ? updated : p)
          .filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-')),
        parts: state.parts
          .map(p => p.id === id ? updated : p)
          .filter(p => p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-')),
      }));

      if (outcome === 'failed') set({ error: 'Failed to update product' });

      const user = useAuthStore.getState().user;
      useActivityStore.getState().logActivity(
        'inventory',
        `Product updated by ${user ? user.name : 'System'}`,
        id,
        user?.id
      );
      return outcome;
    } catch {
      set({ error: 'Failed to update product' });
      return 'failed';
    }
  },

  deleteProduct: async (id) => {
    try {
      const existing = get().products.find(p => p.id === id) || get().parts.find(p => p.id === id);
      const outcome = await inventoryService.deleteProduct(id);
      set(state => ({
        products: state.products.filter(p => p.id !== id),
        parts: state.parts.filter(p => p.id !== id),
      }));
      const user = useAuthStore.getState().user;
      useActivityStore.getState().logActivity(
        'inventory',
        `Product deleted: ${existing?.name || id}`,
        { entityId: id, entityType: existing?.category === 'repair_part' ? 'part' : 'product', severity: 'danger', userName: user?.name, userId: user?.id }
      );
      return outcome;
    } catch {
      set({ error: 'Failed to delete product' });
      return 'failed';
    }
  },

  getFilteredProducts: (excludeCategory?: string) => {
    const { products, searchQuery } = get();
    
    let filtered = products.filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'));
    if (excludeCategory) {
      filtered = filtered.filter(p => p.category !== excludeCategory);
    }
    
    const query = normalizeArabic(searchQuery);
    if (!query) return filtered;

    const words = query.split(' ');
    return filtered.filter(p => {
      const full = normalizeArabic([p.name, p.model, p.sku, p.color, p.storage, p.location, p.supplier].filter(Boolean).join(' '));
      return words.every(word => full.includes(word));
    });
  },
}));
