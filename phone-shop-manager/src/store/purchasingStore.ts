import { create } from 'zustand';
import type { Supplier, PurchaseOrder } from '../types';
import { purchasingService } from '../services/purchasingService';
import { useActivityStore } from './activityStore';
import { useAuthStore } from './authStore';

interface PurchasingState {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;

  // Actions
  fetchData: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  
  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateSupplier: (id: string, updates: Partial<Omit<Supplier, 'id'>>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  addPO: (po: Omit<PurchaseOrder, 'id' | 'poNumber' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updatePO: (id: string, updates: Partial<Omit<PurchaseOrder, 'id' | 'poNumber' | 'createdAt'>>) => Promise<void>;
  deletePO: (id: string) => Promise<void>;
  
  // Derived
  getFilteredSuppliers: () => Supplier[];
  getFilteredPOs: () => PurchaseOrder[];
}

export const usePurchasingStore = create<PurchasingState>((set, get) => ({
  suppliers: [],
  purchaseOrders: [],
  isLoading: false,
  error: null,
  searchQuery: '',

  fetchData: async () => {
    set({ isLoading: true, error: null });
    try {
      const [suppliers, purchaseOrders] = await Promise.all([
        purchasingService.getSuppliers(),
        purchasingService.getPurchaseOrders(),
      ]);
      set({ suppliers, purchaseOrders, isLoading: false });
    } catch (error) {
      set({ error: 'Failed to fetch purchasing data', isLoading: false });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  addSupplier: async (supplier) => {
    try {
      const newSupplier = await purchasingService.addSupplier(supplier);
      set(state => ({ suppliers: [...state.suppliers, newSupplier] }));
      const user = useAuthStore.getState().user;
      useActivityStore.getState().logActivity('inventory', `Added supplier: ${supplier.name}`, newSupplier.id, user?.id);
    } catch (error) {
      set({ error: 'Failed to add supplier' });
      throw error;
    }
  },

  updateSupplier: async (id, updates) => {
    try {
      const updated = await purchasingService.updateSupplier(id, updates);
      set(state => ({
        suppliers: state.suppliers.map(s => s.id === id ? updated : s),
      }));
    } catch (error) {
      set({ error: 'Failed to update supplier' });
      throw error;
    }
  },

  deleteSupplier: async (id) => {
    try {
      await purchasingService.deleteSupplier(id);
      set(state => ({
        suppliers: state.suppliers.filter(s => s.id !== id),
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  addPO: async (po) => {
    try {
      const user = useAuthStore.getState().user;
      const poWithUser = {
        ...po,
        createdById: user?.id,
        createdByName: user?.name,
      };
      const newPO = await purchasingService.addPurchaseOrder(poWithUser);
      set(state => ({ purchaseOrders: [newPO, ...state.purchaseOrders] }));
      useActivityStore.getState().logActivity('inventory', `Created PO: ${newPO.poNumber}`, newPO.id, user?.id);
    } catch (error) {
      set({ error: 'Failed to create PO' });
      throw error;
    }
  },

  updatePO: async (id, updates) => {
    try {
      const updated = await purchasingService.updatePurchaseOrder(id, updates);
      set(state => ({
        purchaseOrders: state.purchaseOrders.map(p => p.id === id ? updated : p),
      }));
    } catch (error) {
      set({ error: 'Failed to update PO' });
      throw error;
    }
  },

  deletePO: async (id) => {
    try {
      await purchasingService.deletePurchaseOrder(id);
      set(state => ({
        purchaseOrders: state.purchaseOrders.filter(p => p.id !== id),
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  getFilteredSuppliers: () => {
    const { suppliers, searchQuery } = get();
    if (!searchQuery) return suppliers;
    const q = searchQuery.toLowerCase();
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(q) || 
      (s.contactName && s.contactName.toLowerCase().includes(q))
    );
  },

  getFilteredPOs: () => {
    const { purchaseOrders, searchQuery } = get();
    if (!searchQuery) return purchaseOrders;
    const q = searchQuery.toLowerCase();
    return purchaseOrders.filter(po => 
      po.poNumber.toLowerCase().includes(q) || 
      po.supplierName.toLowerCase().includes(q)
    );
  },
}));
