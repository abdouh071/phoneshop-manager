import { create } from 'zustand';
import {
  collection,
  query,
  getDocs,
  addDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { offlineSyncService } from '../services/offlineSyncService';
import { customerService } from '../services/customerService';
import { isOfflineCustomerId, newIdempotencyKey } from '../services/offlineQueuePolicy';
import { notificationService } from '../services/notificationService';
import { claimInvoiceNumber } from '../services/invoiceCounter';
import { commitPosSaleAtomic, type StockLine } from '../services/stockService';
import { discountAmountOf } from '../utils/discountPolicy';
import { checkCartStock, type CartStockResult } from '../utils/cartStock';
import { creditAmountOf, salePayments } from '../utils/salePayments';
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
  addToCart: (product: PhoneModel, quantity?: number) => CartStockResult;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => CartStockResult;
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
    const { cart, products } = get();
    // The shelf count is read from the live catalogue, not from the row the caller
    // was holding: a screen opened before the last sale still shows the old number.
    const live = products.find(p => p.id === product.id) || product;
    const existing = cart.find(item => item.product.id === product.id);
    const currentQty = existing?.quantity ?? 0;
    const safeQty = Math.max(1, Math.floor(quantity || 1));

    const check = checkCartStock(live.stock, currentQty + safeQty);
    if (!check.success) return check;

    // A new line takes the live row; an existing one keeps the price it was added
    // at, so a price edit elsewhere cannot reprice a basket mid-sale.
    set({
      cart: existing
        ? cart.map(item => item.product.id === product.id ? { ...item, quantity: currentQty + safeQty } : item)
        : [...cart, { product: live, quantity: safeQty }],
    });
    return check;
  },

  removeFromCart: (productId: string) => {
    set({ cart: get().cart.filter(item => item.product.id !== productId) });
  },

  updateQuantity: (productId: string, quantity: number) => {
    const { cart, products } = get();
    const existing = cart.find(item => item.product.id === productId);
    if (!existing) return { success: false };

    const safeQty = Math.floor(quantity || 0);
    if (safeQty <= 0) {
      get().removeFromCart(productId);
      return { success: true };
    }

    const live = products.find(p => p.id === productId) || existing.product;
    const check = checkCartStock(live.stock, safeQty);
    if (!check.success) return check;

    set({
      cart: cart.map(item =>
        item.product.id === productId ? { ...item, quantity: safeQty } : item
      ),
    });
    return check;
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
    const moment = new Date();
    const now = moment.toISOString();
    // A customer created on this phone while it had no signal exists only in the
    // cache: a sale referencing its id would point at a profile the server never
    // had. Upload it now when the network is back; when it is not, the queued sale
    // and debt rows resolve the id at the sync pass before they are written.
    let cust = params.customer || selectedCustomer;
    if (cust && isOfflineCustomerId(cust.id)) {
      const resolvedId = await customerService.resolveOfflineCustomer(cust.id);
      if (resolvedId) cust = { ...cust, id: resolvedId };
    }
    // Before a number is claimed or anything is written: a sale on account needs
    // the account it is owed on, or the debt entry below would be silently skipped.
    const debtAmount = creditAmountOf(params.paymentMethod, total, params.amountPaid, cust);
    // One reference per sale, drawn from the counter's own daily book — the same
    // document the till's desktop reads — so a phone and the counter cannot print the
    // same number twice. `invoiceNumber` is also the key both apps match a debt to its
    // invoice on, so the account entry written below carries this exact string.
    const { invoiceNumber, provisional: numberGuessed } = await claimInvoiceNumber(moment);
    // Minted here, before either document is attempted, and stamped on both. A
    // replay looks a record up by this key, so it is the only thing that can tell
    // "the server saved this sale and the phone never heard" apart from "this sale
    // never happened" — and a document written without it cannot be found at all.
    const saleKey = newIdempotencyKey('sale');
    const debtKey = newIdempotencyKey('debt');

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
      invoiceNumberProvisional: numberGuessed || undefined,
      idempotencyKey: saleKey,
      accountSettlement: settlement,
      processedById: currentUser?.id || 'technician-app',
      processedByName: currentUser?.name || 'Sales Agent',
      status: 'completed',
      // Born owing the shelf — and the customer's own record — a movement. commitSaleEffects
      // stamps these true in the same transaction that moves them; a crash before it leaves
      // them false for the unfinished-sale sweep to finish once, so the invoice is never
      // left on the server with the units still on the shelf.
      stockApplied: false,
      ...(cust ? { profileApplied: false } : {}),
      ...(params.notes ? { notes: params.notes } : {}),
    };

    let realTx: SaleTransaction;
    let saleUploaded = false;
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const hasUnresolvedCustomer = Boolean(cust && isOfflineCustomerId(cust.id));

    const debtEntry: CustomerDebtEntry | undefined =
      debtAmount > 0 && cust
        ? {
            id: '',
            customerId: cust.id,
            customerName: cust.name,
            customerPhone: cust.phone,
            productOrService: `POS Sale (${cart.map(i => `${i.product.name} x${i.quantity}`).join(', ')})`,
            itemsSummary: cart.map(i => `${i.quantity}x ${i.product.name} ${i.product.model || ''}`.trim()).join(', '),
            totalAmount: total,
            amountPaid: params.paymentMethod === 'debt' ? 0 : (params.amountPaid || 0),
            remainingBalance: debtAmount,
            date: now,
            status: debtAmount === total ? 'unpaid' : 'partially_paid',
            type: 'sale',
            notes: `Receipt #${invoiceNumber}`,
            invoiceNumber,
            idempotencyKey: debtKey,
            createdAt: now,
            updatedAt: now,
          }
        : undefined;

    const lines: StockLine[] = cart.map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      quantity: Math.max(1, Math.trunc(item.quantity || 1)),
    }));

    if (!isOffline && !hasUnresolvedCustomer) {
      try {
        const { id: _, ...dataToSave } = newTx;
        const debtPayload = debtEntry
          ? (() => {
              const { id: _debtId, ...rest } = debtEntry;
              return rest;
            })()
          : undefined;

        const atomicResult = await commitPosSaleAtomic({
          lines,
          saleData: dataToSave as Record<string, unknown>,
          profile: cust
            ? { customerId: cust.id, paid: Math.max(0, total - debtAmount), charged: debtAmount }
            : undefined,
          debtData: debtPayload as Record<string, unknown> | undefined,
        });

        realTx = {
          ...newTx,
          id: atomicResult.saleId,
          stockApplied: true,
          ...(cust ? { profileApplied: true } : {}),
          financialRevision: 0,
          ...(atomicResult.debtEntryId && newTx.accountSettlement
            ? {
                accountSettlement: {
                  ...newTx.accountSettlement,
                  debtEntryId: atomicResult.debtEntryId,
                },
              }
            : {}),
        };
        saleUploaded = true;

        for (const a of atomicResult.applied) {
          if (a.result.stockStatus !== 'in_stock') {
            notificationService.notifyLowStock(a.line.name, a.result.stock)
              .catch(err => console.warn('[PosStore] Low stock notification error:', err));
          }
        }

        // Log sale activity
        await activityLogService.log(
          'sales',
          `New POS Sale: ${total} DA (${cart.length} item${cart.length > 1 ? 's' : ''})`,
          {
            entityId: atomicResult.saleId,
            entityType: 'sale',
            detail: `Payment: ${params.paymentMethod.toUpperCase()} · Customer: ${realTx.customerName}`,
            userName: currentUser?.name || 'Sales Agent',
            userId: currentUser?.id || 'technician-app',
          }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err ?? '');
        const code = (err as { code?: unknown })?.code;
        if (msg.includes('INSUFFICIENT_STOCK') || code === 'permission-denied' || msg.includes('permission-denied')) {
          throw err;
        }
        console.warn('[PosStore] Failed atomic transaction (offline/network), queueing:', err);
        const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        realTx = { ...newTx, id: offlineId };
        await offlineSyncService.saveOfflineSale(realTx);
      }
    } else {
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      realTx = { ...newTx, id: offlineId };
      await offlineSyncService.saveOfflineSale(realTx);
    }

    // Offline queued credit sales still queue their debt document for the sync pass.
    if (!saleUploaded && debtEntry && cust) {
      const offlineDebtId = `offline_debt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await offlineSyncService.saveOfflineDebt({ ...debtEntry, id: offlineDebtId });
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
