import { create } from 'zustand';
import {
  collection,
  query,
  getDocs,
  getDoc,
  addDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { offlineSyncService } from '../services/offlineSyncService';
import { customerService } from '../services/customerService';
import { notificationService } from '../services/notificationService';
import type { PhoneModel, CartItem, SaleTransaction, Customer, PaymentMethod, CustomerDebtEntry, StockStatus } from '../types';

interface CheckoutParams {
  paymentMethod: PaymentMethod;
  amountPaid: number;
  discountValue?: number;
  discountType?: 'percent' | 'flat';
  customer?: Customer | null;
  notes?: string;
}

interface PosState {
  products: PhoneModel[];
  cart: CartItem[];
  customers: Customer[];
  selectedCustomer: Customer | null;
  isLoading: boolean;
  error: string | null;

  fetchProducts: () => Promise<void>;
  fetchCustomers: () => Promise<void>;
  setSelectedCustomer: (customer: Customer | null) => void;
  addCustomer: (name: string, phone: string) => Promise<Customer>;
  addToCart: (product: PhoneModel, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getCartTotal: () => { subtotal: number; totalItems: number };
  checkout: (params: CheckoutParams) => Promise<SaleTransaction>;
}

export const usePosStore = create<PosState>((set, get) => ({
  products: [],
  cart: [],
  customers: [],
  selectedCustomer: null,
  isLoading: false,
  error: null,

  fetchProducts: async () => {
    // 1. Immediately load cached products for instant offline access
    try {
      const cached = await offlineSyncService.getCachedProducts();
      if (cached && cached.length > 0 && get().products.length === 0) {
        set({ products: cached });
      }
    } catch {
      // ignore
    }

    set({ isLoading: get().products.length === 0 });

    try {
      // Query 'inventory' first (shared Firestore with desktop app), fallback to 'products'
      let snapshot = await getDocs(query(collection(db, 'inventory')));
      if (snapshot.empty) {
        snapshot = await getDocs(query(collection(db, 'products')));
      }
      const products: PhoneModel[] = [];
      snapshot.forEach(docSnap => {
        products.push({ id: docSnap.id, ...docSnap.data() } as PhoneModel);
      });

      set({ products, isLoading: false, error: null });
      await offlineSyncService.setCachedProducts(products);
    } catch (err: any) {
      console.warn('[PosStore] Products fetch failed (offline), falling back to cache:', err);
      const cached = await offlineSyncService.getCachedProducts();
      set({ products: cached || [], isLoading: false, error: null });
    }
  },

  fetchCustomers: async () => {
    try {
      const customers = await customerService.getAll();
      set({ customers });
    } catch (err) {
      console.warn('[PosStore] Failed to fetch customers (offline):', err);
    }
  },

  setSelectedCustomer: (customer) => set({ selectedCustomer: customer }),

  addCustomer: async (name: string, phone: string): Promise<Customer> => {
    const cust = await customerService.findOrCreate(name, phone);
    set(state => ({
      customers: [cust, ...state.customers.filter(c => c.id !== cust.id)],
      selectedCustomer: cust,
    }));
    return cust;
  },

  addToCart: (product: PhoneModel, quantity: number = 1) => {
    const safeQty = Math.max(1, Math.floor(quantity || 1));
    const { cart } = get();
    const existingIndex = cart.findIndex(item => item.product.id === product.id);

    if (existingIndex >= 0) {
      const updated = [...cart];
      updated[existingIndex].quantity += safeQty;
      set({ cart: updated });
    } else {
      set({ cart: [...cart, { product, quantity: safeQty }] });
    }
  },

  removeFromCart: (productId: string) => {
    set({ cart: get().cart.filter(item => item.product.id !== productId) });
  },

  updateQuantity: (productId: string, quantity: number) => {
    const safeQty = Math.floor(quantity || 0);
    if (safeQty <= 0) {
      get().removeFromCart(productId);
      return;
    }
    set({
      cart: get().cart.map(item =>
        item.product.id === productId ? { ...item, quantity: safeQty } : item
      ),
    });
  },

  clearCart: () => set({ cart: [], selectedCustomer: null }),

  getCartTotal: () => {
    const { cart } = get();
    const subtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    return { subtotal, totalItems };
  },

  checkout: async (params: CheckoutParams): Promise<SaleTransaction> => {
    const { cart, selectedCustomer } = get();
    if (cart.length === 0) {
      throw new Error('Cart is empty');
    }

    const { subtotal } = get().getCartTotal();
    let discountAmount = 0;
    if (params.discountValue && params.discountValue > 0) {
      discountAmount = params.discountType === 'percent'
        ? (subtotal * Math.min(100, Math.max(0, params.discountValue))) / 100
        : Math.min(subtotal, Math.max(0, params.discountValue));
    }
    const total = Math.max(0, subtotal - discountAmount);

    const currentUser = useAuthStore.getState().user;
    const now = new Date().toISOString();
    const cust = params.customer || selectedCustomer;
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

    // Calculate debt if payment method is 'debt' or partial payment
    const debtAmount = params.paymentMethod === 'debt' 
      ? total 
      : Math.max(0, total - (params.amountPaid || total));

    const settlement: SaleTransaction['accountSettlement'] = debtAmount > 0 ? {
      type: debtAmount === total ? 'charged_to_account' : 'partial_payment',
      paidAmount: params.paymentMethod === 'debt' ? 0 : (params.amountPaid || 0),
      chargedAmount: debtAmount,
      notes: `POS Mobile Sale #${invoiceNumber}`,
    } : undefined;

    // Standard items with unitPrice for desktop history compatibility
    const formattedItems: CartItem[] = cart.map(item => ({
      ...item,
      unitPrice: item.product.price,
    }));

    const newTx: SaleTransaction = {
      id: '',
      date: now,
      items: formattedItems,
      subtotal,
      discount: params.discountValue ? { type: params.discountType || 'flat', value: params.discountValue } : undefined,
      total,
      payments: [{ method: params.paymentMethod, amount: params.paymentMethod === 'debt' ? 0 : (params.amountPaid || total) }],
      customerName: cust?.name || 'Walk-in Customer',
      customerPhone: cust?.phone || undefined,
      customerId: cust?.id || undefined,
      saleType: 'retail', // Crucial: Enables desktop app POS history and analytics to find and display this transaction
      invoiceNumber,
      accountSettlement: settlement,
      processedById: currentUser?.id || 'technician-app',
      processedByName: currentUser?.name || 'Sales Agent',
      status: 'completed',
    };

    let realTx: SaleTransaction;

    try {
      const { id: _, ...dataToSave } = newTx;
      const docRef = await addDoc(collection(db, 'transactions'), dataToSave);
      realTx = { ...newTx, id: docRef.id };

      // Log sale activity
      await activityLogService.log(
        'sales',
        `New POS Sale: ${total} DA (${cart.length} item${cart.length > 1 ? 's' : ''})`,
        {
          entityId: docRef.id,
          entityType: 'sale',
          detail: `Payment: ${params.paymentMethod.toUpperCase()} · Customer: ${realTx.customerName}`,
          userName: currentUser?.name || 'Sales Agent',
          userId: currentUser?.id || 'technician-app',
        }
      );
    } catch (err) {
      console.warn('[PosStore] Failed to save transaction to Firestore (offline), queueing:', err);
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      realTx = { ...newTx, id: offlineId };
      await offlineSyncService.saveOfflineSale(realTx);
    }

    // Deduct stock in Firestore collection 'inventory' (with fallback to 'products')
    for (const item of cart) {
      try {
        const invRef = doc(db, 'inventory', item.product.id);
        const invSnap = await getDoc(invRef);
        if (invSnap.exists()) {
          const curData = invSnap.data();
          const currentStock = curData.stock ?? item.product.stock;
          const newStock = Math.max(0, currentStock - item.quantity);
          const threshold = curData.lowStockThreshold ?? item.product.lowStockThreshold ?? 1;
          const stockStatus = newStock === 0 ? 'out_of_stock' : newStock <= threshold ? 'low_stock' : 'in_stock';
          await updateDoc(invRef, { stock: newStock, stockStatus });

          if (newStock <= threshold) {
            notificationService.notifyLowStock(item.product.name, newStock)
              .catch(err => console.warn('[PosStore] Low stock notification error:', err));
          }
        } else {
          const prodRef = doc(db, 'products', item.product.id);
          const prodSnap = await getDoc(prodRef);
          if (prodSnap.exists()) {
            const curData = prodSnap.data();
            const currentStock = curData.stock ?? item.product.stock;
            const newStock = Math.max(0, currentStock - item.quantity);
            const threshold = curData.lowStockThreshold ?? item.product.lowStockThreshold ?? 1;
            const stockStatus = newStock === 0 ? 'out_of_stock' : newStock <= threshold ? 'low_stock' : 'in_stock';
            await updateDoc(prodRef, { stock: newStock, stockStatus });

            if (newStock <= threshold) {
              notificationService.notifyLowStock(item.product.name, newStock)
                .catch(err => console.warn('[PosStore] Low stock notification error:', err));
            }
          }
        }
      } catch (sErr) {
        console.warn(`[PosStore] Failed to update Firestore stock for ${item.product.name}:`, sErr);
      }
    }

    // If debt payment or partial payment, record customer debt entry
    if (debtAmount > 0 && cust) {
      const debtEntry: CustomerDebtEntry = {
        id: '',
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        productOrService: `POS Sale (${cart.map(i => `${i.product.name} x${i.quantity}`).join(', ')})`,
        totalAmount: total,
        amountPaid: params.paymentMethod === 'debt' ? 0 : (params.amountPaid || 0),
        remainingBalance: debtAmount,
        date: now,
        status: debtAmount === total ? 'unpaid' : 'partially_paid',
        type: 'sale',
        notes: `Receipt #${invoiceNumber}`,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const { id: _, ...debtToSave } = debtEntry;
        const debtDocRef = await addDoc(collection(db, 'customer_debts'), debtToSave);
        if (realTx.accountSettlement) {
          realTx.accountSettlement.debtEntryId = debtDocRef.id;
        }
      } catch (dErr) {
        console.warn('[PosStore] Offline customer debt queueing:', dErr);
        const offlineDebtId = `offline_debt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await offlineSyncService.saveOfflineDebt({ ...debtEntry, id: offlineDebtId });
      }
    }

    // Customer Activity Log
    if (cust) {
      try {
        await addDoc(collection(db, 'customer_activity_logs'), {
          customerId: cust.id,
          customerName: cust.name,
          actionType: 'sale_completed',
          actionTitle: `POS Sale Completed (${cart.length} items)`,
          actionDescription: `POS Sale of ${total} DA by ${currentUser?.name || 'Staff'}. Invoice: #${invoiceNumber}. Items: ${cart.map(i => `${i.quantity}x ${i.product.name}`).join(', ')}`,
          actorId: currentUser?.id,
          actorName: currentUser?.name || 'Staff',
          actorRole: currentUser?.role || 'sales_agent',
          metadata: { transactionId: realTx.id, invoiceNumber, total, itemsCount: cart.length },
          timestamp: now,
        });
      } catch (logErr) {
        console.warn('[PosStore] Failed to write customer activity log:', logErr);
      }
    }

    // Deduct stock locally in Zustand store
    set(state => {
      const updatedProducts = state.products.map(p => {
        const cartMatch = cart.find(c => c.product.id === p.id);
        if (cartMatch) {
          const newStock = Math.max(0, p.stock - cartMatch.quantity);
          const stockStatus: StockStatus = newStock <= 0 ? 'out_of_stock' : newStock <= p.lowStockThreshold ? 'low_stock' : 'in_stock';
          return {
            ...p,
            stock: newStock,
            stockStatus,
          };
        }
        return p;
      });
      // Update cached products as well
      offlineSyncService.setCachedProducts(updatedProducts).catch(() => {});
      return {
        products: updatedProducts,
        cart: [],
        selectedCustomer: null,
      };
    });

    return realTx;
  },
}));
