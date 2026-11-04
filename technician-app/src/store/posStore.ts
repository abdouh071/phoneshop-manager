import { create } from 'zustand';
import {
  collection,
  query,
  getDocs,
  addDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { offlineSyncService } from '../services/offlineSyncService';
import { customerService } from '../services/customerService';
import { newIdempotencyKey } from '../services/offlineQueuePolicy';
import { notificationService } from '../services/notificationService';
import { applyStockLines, type StockLine } from '../services/stockService';
import { discountAmountOf } from '../utils/discountPolicy';
import { salePayments } from '../utils/salePayments';
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
    // One arithmetic for the discount, shared with the till screen. It used to
    // recompute the percent unrounded here, so the stored total and the total the
    // customer were shown could differ by a dinar.
    const discountAmount = discountAmountOf(subtotal, {
      mode: params.discountType ?? 'flat',
      value: params.discountValue ?? 0,
    });
    const total = Math.max(0, subtotal - discountAmount);

    const currentUser = useAuthStore.getState().user;
    const now = new Date().toISOString();
    const cust = params.customer || selectedCustomer;
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    // Minted here, before either document is attempted, and stamped on both. A
    // replay looks a record up by this key, so it is the only thing that can tell
    // "the server saved this sale and the phone never heard" apart from "this sale
    // never happened" — and a document written without it cannot be found at all.
    const saleKey = newIdempotencyKey('sale');
    const debtKey = newIdempotencyKey('debt');

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
      // Whole dinars, not the percentage: the counter's printer re-expands a share
      // without rounding while the total is rounded, so a receipt of this sale would
      // print its own lines a dinar off its own total. The dinars the promise came
      // to is the money the shop gave, and it is the only number that reconciles.
      discount: discountAmount > 0 ? { type: 'flat', value: discountAmount } : undefined,
      total,
      // One line per tender, and they add up to the invoice: the counter reads the
      // `debt` lines to know what the shop is owed today, so an account sale written
      // as a single zero would report a day of free goods.
      payments: salePayments(params.paymentMethod, total, debtAmount),
      customerName: cust?.name || 'Walk-in Customer',
      customerPhone: cust?.phone || undefined,
      customerId: cust?.id || undefined,
      saleType: 'retail', // Crucial: Enables desktop app POS history and analytics to find and display this transaction
      invoiceNumber,
      idempotencyKey: saleKey,
      accountSettlement: settlement,
      processedById: currentUser?.id || 'technician-app',
      processedByName: currentUser?.name || 'Sales Agent',
      status: 'completed',
    };

    let realTx: SaleTransaction;
    let saleUploaded = false;

    try {
      const { id: _, ...dataToSave } = newTx;
      const docRef = await addDoc(collection(db, 'transactions'), dataToSave);
      realTx = { ...newTx, id: docRef.id };
      saleUploaded = true;

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

    // Stock moves only for a sale this device actually wrote. A queued sale is
    // deducted by the sync pass that creates its document — deducting here as well
    // would take the units off the shelf twice.
    if (saleUploaded) {
      const lines: StockLine[] = cart.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        quantity: Math.max(1, Math.trunc(item.quantity || 1)),
      }));

      const { ok, failed } = await applyStockLines(lines, -1);

      for (const applied of ok) {
        if (applied.result.stockStatus !== 'in_stock') {
          notificationService.notifyLowStock(applied.line.name, applied.result.stock)
            .catch(err => console.warn('[PosStore] Low stock notification error:', err));
        }
      }
      // A delta the server never took is not lost: the stock queue replays it.
      for (const f of failed) {
        console.warn(`[PosStore] Stock delta failed for ${f.line.name}, queued:`, f.error);
        await offlineSyncService.saveOfflineStockDelta({
          productId: f.line.productId,
          name: f.line.name,
          delta: -f.line.quantity,
          reason: `Sale ${invoiceNumber}`,
        });
      }
    }

    // The profile of the man this sale was written on gains what it took in. A sale
    // this phone could not write is recorded by the sync pass that creates its
    // document instead, so an invoice is never counted on the customer twice.
    if (saleUploaded && cust) {
      await customerService.recordSaleOnProfile(cust.id, total - debtAmount, debtAmount);
    }

    // If debt payment or partial payment, record customer debt entry
    if (debtAmount > 0 && cust) {
      const itemsSummary = cart.map(i => `${i.quantity}x ${i.product.name} ${i.product.model || ''}`.trim()).join(', ');
      const debtEntry: CustomerDebtEntry = {
        id: '',
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        productOrService: `POS Sale (${cart.map(i => `${i.product.name} x${i.quantity}`).join(', ')})`,
        itemsSummary,
        totalAmount: total,
        amountPaid: params.paymentMethod === 'debt' ? 0 : (params.amountPaid || 0),
        remainingBalance: debtAmount,
        date: now,
        status: debtAmount === total ? 'unpaid' : 'partially_paid',
        type: 'sale',
        notes: `Receipt #${invoiceNumber}`,
        // Both keys, because each one outlives a different failure. The transaction id
        // is the strongest link and the counter matches on it; the invoice number is
        // minted at the till before the phone has a server id, so it is the only one
        // that survives a sale that was written while the shop had no network. Without
        // either, nothing in either app could find this debt again from the invoice.
        invoiceNumber,
        idempotencyKey: debtKey,
        transactionId: saleUploaded ? realTx.id : undefined,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const { id: _, ...debtToSave } = debtEntry;
        const debtDocRef = await addDoc(collection(db, 'customer_debts'), debtToSave);
        if (realTx.accountSettlement) {
          realTx.accountSettlement.debtEntryId = debtDocRef.id;
          // The link has to exist on the invoice too, or the next device to read it —
          // this phone replaying an edit, the counter refunding the sale — has to guess.
          // A queued sale has no document to point at yet; its sync pass writes the
          // settlement from this same object when it creates the transaction.
          if (saleUploaded) {
            await updateDoc(
              doc(db, 'transactions', realTx.id),
              { 'accountSettlement.debtEntryId': debtDocRef.id }
            ).catch(err => console.warn('[PosStore] Debt link could not be written back:', err));
          }
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
