import { create } from 'zustand';
import type { CartItem, Customer, PaymentMethod, PhoneModel, SaleTransaction, SuspendedCart, CustomerDebtEntry } from '../types';
import { useInventoryStore } from './inventoryStore';
import { inventoryService, commitSaleStockEffects } from '../services/inventoryService';
import { transactionService, type SaleEditRequest } from '../services/transactionService';
import { offlineQueue } from '../services/offlineQueue';
import { computeStockStatus } from '../utils/stockStatus';
import { claimInvoiceNumber } from '../services/invoiceCounter';
import { activityLogService } from '../services/activityLogService';
import { customerLogService } from '../services/customerLogService';
import { useAuthStore } from './authStore';
import { useCustomerStore } from './customerStore';
import { cartService } from '../services/cartService';
import { mergeSuspendedFetchResult } from '../services/suspendedCartSync';
import { retailCheckoutService, type PendingRetailCheckout, type RetailCheckoutResult } from '../services/retailCheckoutService';
import { errorMessage } from '../utils/errorUtils';
import { formatCurrency } from '../utils/formatCurrency';
import { discountAmountOf, lineDiscountOf } from '../utils/discountPolicy';
import { planSaleEditStock } from '../utils/saleEditStock';
import { returnedUnits, soldUnits } from '../utils/saleEditLines';
import { saleStockDeltas } from '../utils/stockDeltas';
import { saleOpeningPayments } from '../utils/debtPayments';

const getInventoryProducts = () =>
  useInventoryStore.getState().products;

/**
 * A line as the shop writes it into a log or a debt note. The units a correction
 * hands back print with their minus, because a note that reads `2x Phone, 1x Phone`
 * does not tell the counter what happened to the invoice.
 */
const lineNote = (item: CartItem): string =>
  `${item.isReturn ? '−' : ''}${item.quantity}x ${item.product?.name ?? 'Item'} ${item.product?.model ?? ''}`.trim();

/**
 * Move the shelf for a settled invoice once, and leave a trail a crash can be healed from.
 *
 * Online: one transaction deducts the units and stamps the invoice (`commitSaleStockEffects`).
 * If it is interrupted the stamp stays false and the unfinished-sale sweep finishes it, so
 * nothing is queued here as well — that would deduct the same units a second time.
 *
 * Offline: the local copy is marked done BEFORE the shelf moves. The per-product queue then
 * carries the deltas to the server and the upload adopts the stamp instead of deducting again.
 * A crash before the stamp leaves it false with an empty queue, so the sync pass heals the
 * shelf from the invoice; a crash after it leaves the queue as the only deduction. Neither
 * path doubles, and the till's own shelf still updates immediately while there is no signal.
 */
const moveSaleStock = async (
  saved: SaleTransaction,
  items: CartItem[],
  saleType: 'retail' | 'parts_b2b'
): Promise<void> => {
  const deltas = saleStockDeltas(items, saleType);

  if (saved.id.startsWith('offline_')) {
    await transactionService.updateTransaction(saved.id, { stockApplied: true }).catch(console.error);
    saved.stockApplied = true;
    deltas.forEach(({ productId, delta }) => useInventoryStore.getState().adjustStockBy(productId, delta));
    return;
  }

  try {
    const { applied, missed } = await commitSaleStockEffects(saved.id, deltas);
    saved.stockApplied = true;
    if (applied.length) {
      const level = new Map(applied.map(a => [a.productId, a]));
      useInventoryStore.setState(state => ({
        products: state.products.map(p => { const a = level.get(p.id); return a ? { ...p, stock: a.stock, stockStatus: a.stockStatus } : p; }),
        parts: state.parts.map(p => { const a = level.get(p.id); return a ? { ...p, stock: a.stock, stockStatus: a.stockStatus } : p; }),
      }));
    }
    // A line whose product is on neither shelf is queued durably, as the per-product path did.
    for (const m of missed) useInventoryStore.getState().adjustStockBy(m.productId, m.delta);
  } catch (err) {
    // The stamp stays false; the sweep finishes this sale. Queueing here too would deduct twice.
    console.error('Failed to move stock on checkout:', err);
  }
};

const STORAGE_KEY_ACTIVE = 'pos_active_cart';
const STORAGE_KEY_SUSPENDED = 'pos_suspended_carts';

let cartsFetchGeneration = 0;
const suspendedFetchRemovals = new Set<Set<string>>();

const loadLocalActiveCart = (): { items: CartItem[]; customerName: string; customerPhone: string; customerId: string | null; discount: { type: 'percent' | 'flat'; value: number } | null } => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (!raw) return { items: [], customerName: '', customerPhone: '', customerId: null, discount: null };
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
      customerPhone: typeof parsed.customerPhone === 'string' ? parsed.customerPhone : '',
      customerId: typeof parsed.customerId === 'string' ? parsed.customerId : null,
      discount: parsed.discount || null,
    };
  } catch {
    return { items: [], customerName: '', customerPhone: '', customerId: null, discount: null };
  }
};

const loadLocalSuspendedCarts = (): SuspendedCart[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SUSPENDED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveLocalActiveCart = (
  items: CartItem[],
  customerName: string,
  customerPhone: string,
  discount: { type: 'percent' | 'flat'; value: number } | null,
  customerId: string | null = null
) => {
  try {
    if (items.length === 0 && !customerName && !customerPhone && !customerId) {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    } else {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify({ items, customerName, customerPhone, customerId, discount }));
    }
  } catch (e) {
    console.error('Failed to save active cart to localStorage', e);
  }
};

const saveLocalSuspendedCarts = (carts: SuspendedCart[]) => {
  try {
    if (carts.length === 0) {
      localStorage.removeItem(STORAGE_KEY_SUSPENDED);
    } else {
      localStorage.setItem(STORAGE_KEY_SUSPENDED, JSON.stringify(carts));
    }
  } catch (e) {
    console.error('Failed to save suspended carts to localStorage', e);
  }
};

export interface CheckoutOptions {
  refundType?: 'cash' | 'store_credit' | 'debt_deduction';
  storeCreditUsed?: number;
  customerAttached?: boolean;
  allowCreditLimitOverride?: boolean;
}

interface CartState {
  items: CartItem[];
  payments: { method: PaymentMethod; amount: number }[];
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  transactions: SaleTransaction[];
  isLoadingTransactions: boolean;
  error: string | null;
  discount: { type: 'percent' | 'flat'; value: number } | null;
  isCheckingOut: boolean;
  pendingCheckout: PendingRetailCheckout | null;
  checkoutRecoveryError: string | null;
  refreshPendingCheckout: () => void;
  resolvePendingCheckout: () => Promise<RetailCheckoutResult | null>;
  // Actions
  addToCart: (product: PhoneModel) => { success: boolean; reason?: 'out_of_stock' | 'max_reached'; availableStock?: number };
  addReturnItem: (
    product: PhoneModel,
    options?: { quantity?: number; returnReason?: string; restock?: boolean; customReturnPrice?: number }
  ) => void;
  removeFromCart: (productId: string, isReturn?: boolean) => void;
  updateQuantity: (productId: string, quantity: number, isReturn?: boolean) => { success: boolean; reason?: 'max_reached'; availableStock?: number };
  clearCart: () => void;
  setPayments: (payments: { method: PaymentMethod; amount: number }[]) => void;
  setCustomerId: (customerId: string | null) => void;
  setSelectedCustomer: (customer: Customer | null) => void;
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  setDiscount: (discount: { type: 'percent' | 'flat'; value: number } | null) => void;
  
  // Suspend Cart Actions
  suspendedCarts: SuspendedCart[];
  suspendCart: () => void;
  resumeCart: (id: string) => { success: boolean; warnings?: string[]; requiresCustomerSelection?: boolean };
  discardSuspendedCart: (id: string) => void;

  fetchCarts: () => Promise<void>;

  fetchTransactions: () => Promise<void>;
  checkout: (options?: CheckoutOptions) => Promise<SaleTransaction | null>;
  /**
   * @returns anything the refund could not finish — currently only a credit record it
   * failed to close, which the till has to say out loud rather than leave the customer
   * owing for goods he returned.
   */
  refundTransaction: (txId: string, expected?: SaleTransaction) => Promise<string[]>;
  /**
   * Rewrite a settled invoice in place. Lines absent from `tx.items` are treated as
   * products the counter is adding, so they deduct their whole quantity.
   * @throws when a line asks for more units than the shelf holds; nothing is written.
   */
  editTransaction: (
    txId: string,
    newItems: CartItem[],
    returnToStockOptions: Record<string, boolean>
  ) => Promise<void>;
  // Derived
  getPurchasesSubtotal: () => number;
  getReturnsSubtotal: () => number;
  getSubtotal: () => number;
  getDiscountAmount: () => number;
  getTotal: () => number;
  getItemCount: () => number;
  hasReturnItems: () => boolean;
}

const initialActive = loadLocalActiveCart();
const initialSuspended = loadLocalSuspendedCarts();

/**
 * The counter's money, worked out from a line list instead of the live cart. A
 * suspended basket is read by a screen that is not the till, and it has to show
 * the number the till will show when that customer walks back to the counter —
 * same purchases, same returns priced at what they come back for, one discount
 * measured on the purchases and rounded once.
 */
export const cartTotalsOf = (
  items: CartItem[],
  discount: { type: 'percent' | 'flat'; value: number } | null
): { purchases: number; returns: number; discountAmount: number; total: number } => {
  const purchases = items
    .filter(i => !i.isReturn)
    .reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const returns = items
    .filter(i => i.isReturn)
    .reduce((sum, item) => sum + (item.customReturnPrice ?? item.product.price) * item.quantity, 0);
  const discountAmount = discount
    ? discountAmountOf(purchases, { mode: discount.type, value: discount.value })
    : 0;
  return { purchases, returns, discountAmount, total: (purchases - discountAmount) - returns };
};

export const useCartStore = create<CartState>((set, get) => ({
  items: initialActive.items,
  payments: [{ method: 'cash', amount: 0 }],
  customerId: initialActive.customerId,
  customerName: initialActive.customerName,
  customerPhone: initialActive.customerPhone,
  transactions: [],
  isLoadingTransactions: false,
  error: null,
  discount: initialActive.discount,
  suspendedCarts: initialSuspended,
  isCheckingOut: false,
  pendingCheckout: null,
  checkoutRecoveryError: null,

  refreshPendingCheckout: () => {
    const actorId = useAuthStore.getState().user?.id || 'local-cashier';
    try {
      set({ pendingCheckout: retailCheckoutService.getPending(actorId), checkoutRecoveryError: null });
    } catch (error) {
      set({ pendingCheckout: null, checkoutRecoveryError: errorMessage(error) });
    }
  },

  resolvePendingCheckout: async () => {
    const actorId = useAuthStore.getState().user?.id || 'local-cashier';
    if (get().isCheckingOut) return null;
    set({ isCheckingOut: true });
    try {
      const result = await retailCheckoutService.resolve(actorId);
      if (result) {
        if (result.transaction) {
          const tx = result.transaction;
          useCartStore.setState(state => ({
            transactions: [tx, ...state.transactions.filter(existing => existing.id !== tx.id)],
          }));
        }
        if (result.stock.length) {
          const byId = new Map(result.stock.map(product => [product.id, product]));
          useInventoryStore.setState(state => ({
            products: state.products.map(product => byId.get(product.id) ?? product),
            parts: state.parts.map(product => byId.get(product.id) ?? product),
          }));
        }
        if (result.customer || result.debtEntry || result.updatedDebts?.length) {
          const updatedDebtMap = new Map((result.updatedDebts ?? []).map(d => [d.id, d]));
          useCustomerStore.setState(state => ({
            ...(result.customer ? { customers: state.customers.map(c => c.id === result.customer!.id ? result.customer! : c) } : {}),
            debts: [
              ...(result.debtEntry ? [result.debtEntry] : []),
              ...state.debts
                .filter(d => d.id !== result.debtEntry?.id)
                .map(d => updatedDebtMap.get(d.id) ?? d),
            ],
          }));
        }
        const current = get();
        const currentDraftKey = JSON.stringify({
          items: current.items.map(i => ({ id: i.product.id, quantity: i.quantity, isReturn: i.isReturn === true })),
          customerId: current.customerId,
          customerName: current.customerName,
          customerPhone: current.customerPhone,
          discount: current.discount,
        });
        if (result.transaction && currentDraftKey === result.pending.draftKey) {
          set({ items: [], customerId: null, customerName: '', customerPhone: '', discount: null, payments: [{ method: 'cash', amount: 0 }] });
          saveLocalActiveCart([], '', '', null, null);
          cartService.clearActiveCart().catch(console.error);
        }
        await retailCheckoutService.acknowledge(actorId, result.pending.transaction.id).catch(console.error);
      }
      get().refreshPendingCheckout();
      return result;
    } finally {
      set({ isCheckingOut: false });
    }
  },

  fetchCarts: async () => {
    const before = get().suspendedCarts;
    const generation = ++cartsFetchGeneration;
    const removedIds = new Set<string>();
    suspendedFetchRemovals.add(removedIds);
    try {
      const suspended = await cartService.getAllSuspendedCarts(before);
      if (generation !== cartsFetchGeneration) return;
      const finalSuspended = mergeSuspendedFetchResult(suspended, before, get().suspendedCarts, removedIds);
      set({ suspendedCarts: finalSuspended });
      saveLocalSuspendedCarts(finalSuspended);
    } catch (err) {
      console.error('Failed to fetch carts', err);
    } finally {
      suspendedFetchRemovals.delete(removedIds);
    }
  },

  // Deduct on Checkout architecture: Cart acts as clean draft. No premature DB modification.
  addToCart: (product) => {
    const invProduct = getInventoryProducts().find(p => p.id === product.id) || product;
    const state = get();
    const existing = state.items.find(item => item.product.id === product.id && !item.isReturn);
    const currentQty = existing ? existing.quantity : 0;

    if (invProduct.stock <= 0) {
      return { success: false, reason: 'out_of_stock', availableStock: 0 };
    }

    if (invProduct.stock <= currentQty) {
      return { success: false, reason: 'max_reached', availableStock: invProduct.stock };
    }

    let updatedItems: CartItem[];
    if (existing) {
      updatedItems = state.items.map(item =>
        item.product.id === product.id && !item.isReturn
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    } else {
      updatedItems = [...state.items, { product: invProduct, quantity: 1, isReturn: false }];
    }
    set({ items: updatedItems });
    saveLocalActiveCart(updatedItems, state.customerName, state.customerPhone, state.discount, state.customerId);
    cartService.saveActiveCart(updatedItems, state.customerName).catch(console.error);
    return { success: true, availableStock: invProduct.stock };
  },

  addReturnItem: (product, options) => {
    const state = get();
    const qty = Math.max(1, options?.quantity || 1);
    const customPrice = options?.customReturnPrice !== undefined ? options.customReturnPrice : product.price;
    const returnProduct = { ...product, price: customPrice };

    const existing = state.items.find(i => i.product.id === product.id && i.isReturn === true);
    let updatedItems: CartItem[];

    if (existing) {
      updatedItems = state.items.map(item =>
        item.product.id === product.id && item.isReturn === true
          ? {
              ...item,
              quantity: item.quantity + qty,
              returnReason: options?.returnReason || item.returnReason,
              restock: options?.restock !== undefined ? options.restock : item.restock,
            }
          : item
      );
    } else {
      updatedItems = [
        ...state.items,
        {
          product: returnProduct,
          quantity: qty,
          isReturn: true,
          returnReason: options?.returnReason || 'Exchange / Return',
          restock: options?.restock !== undefined ? options.restock : true,
          customReturnPrice: options?.customReturnPrice,
        },
      ];
    }

    set({ items: updatedItems });
    saveLocalActiveCart(updatedItems, state.customerName, state.customerPhone, state.discount, state.customerId);
    cartService.saveActiveCart(updatedItems, state.customerName).catch(console.error);
  },

  removeFromCart: (productId, isReturn) => {
    set(state => {
      const updated = state.items.filter(
        i => !(i.product.id === productId && (isReturn === undefined || Boolean(i.isReturn) === Boolean(isReturn)))
      );
      saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount, state.customerId);
      cartService.saveActiveCart(updated, state.customerName).catch(console.error);
      return { items: updated };
    });
  },

  updateQuantity: (productId, quantity, isReturn) => {
    const state = get();
    const existing = state.items.find(
      i => i.product.id === productId && (isReturn === undefined || Boolean(i.isReturn) === Boolean(isReturn))
    );
    if (!existing) return { success: false };

    if (quantity <= 0) {
      const updated = state.items.filter(
        i => !(i.product.id === productId && (isReturn === undefined || Boolean(i.isReturn) === Boolean(isReturn)))
      );
      set({ items: updated });
      saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount, state.customerId);
      cartService.saveActiveCart(updated, state.customerName).catch(console.error);
      return { success: true };
    }

    // For regular purchases, check available stock
    if (!existing.isReturn) {
      const invProduct = getInventoryProducts().find(p => p.id === productId) || existing.product;
      if (invProduct.stock < quantity) {
        return { success: false, reason: 'max_reached', availableStock: invProduct.stock };
      }
    }

    const updated = state.items.map(item =>
      item.product.id === productId && (isReturn === undefined || Boolean(item.isReturn) === Boolean(isReturn))
        ? { ...item, quantity }
        : item
    );
    set({ items: updated });
    saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount, state.customerId);
    cartService.saveActiveCart(updated, state.customerName).catch(console.error);
    return { success: true };
  },

  clearCart: () => {
    set({ items: [], customerId: null, customerName: '', customerPhone: '', discount: null, payments: [{ method: 'cash', amount: 0 }] });
    saveLocalActiveCart([], '', '', null, null);
    cartService.clearActiveCart().catch(console.error);
  },

  setPayments: (payments) => set({ payments }),

  setCustomerId: (customerId) => {
    const state = get();
    set({ customerId });
    saveLocalActiveCart(state.items, state.customerName, state.customerPhone, state.discount, customerId);
  },

  setSelectedCustomer: (customer) => {
    const state = get();
    const customerId = customer?.id ?? null;
    const customerName = customer?.name ?? '';
    const customerPhone = customer?.phone ?? '';
    set({ customerId, customerName, customerPhone });
    saveLocalActiveCart(state.items, customerName, customerPhone, state.discount, customerId);
    cartService.saveActiveCart(state.items, customerName).catch(console.error);
  },

  setCustomerName: (customerName) => {
    const state = get();
    set({ customerName, customerId: null });
    saveLocalActiveCart(state.items, customerName, state.customerPhone, state.discount, null);
    cartService.saveActiveCart(state.items, customerName).catch(console.error);
  },

  setCustomerPhone: (customerPhone) => {
    const state = get();
    set({ customerPhone });
    saveLocalActiveCart(state.items, state.customerName, customerPhone, state.discount, state.customerId);
  },

  setDiscount: (discount) => {
    const state = get();
    set({ discount });
    saveLocalActiveCart(state.items, state.customerName, state.customerPhone, discount, state.customerId);
  },

  suspendCart: () => {
    const state = get();
    if (state.items.length === 0) return;
    const newSuspended: SuspendedCart = {
      id: `pos_cart_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString(),
      items: [...state.items],
      customerId: state.customerId ?? null,
      customerName: state.customerName || '',
      customerPhone: state.customerPhone || '',
      discount: state.discount || null,
    };
    const updatedSuspended = [newSuspended, ...state.suspendedCarts];
    set({
      suspendedCarts: updatedSuspended,
      items: [],
      customerId: null,
      customerName: '',
      customerPhone: '',
      discount: null,
      payments: [{ method: 'cash', amount: 0 }],
    });
    saveLocalSuspendedCarts(updatedSuspended);
    saveLocalActiveCart([], '', '', null, null);

    Promise.all([
      cartService.saveSuspendedCart(newSuspended),
      cartService.clearActiveCart()
    ]).catch(console.error);
  },

  resumeCart: (id) => {
    const state = get();
    const cartToResume = state.suspendedCarts.find(c => c.id === id);
    if (!cartToResume) return { success: false, warnings: ['Cart not found'] };

    for (const removedIds of suspendedFetchRemovals) removedIds.add(id);
    let updatedSuspended = state.suspendedCarts.filter(c => c.id !== id);

    // If the current active cart has items, safely place it on hold instead of losing it
    if (state.items.length > 0) {
      const activeAsSuspended: SuspendedCart = {
        id: `pos_cart_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString(),
        items: [...state.items],
        customerId: state.customerId ?? null,
        customerName: state.customerName || '',
        customerPhone: state.customerPhone || '',
        discount: state.discount || null,
      };
      updatedSuspended = [activeAsSuspended, ...updatedSuspended];
      cartService.saveSuspendedCart(activeAsSuspended).catch(console.error);
    }

    // Revalidate live inventory stock (Problem 9 fix)
    const inventoryProducts = useInventoryStore.getState().products;
    const warnings: string[] = [];
    const validatedItems: CartItem[] = [];

    cartToResume.items.forEach(item => {
      if (item.isReturn) {
        validatedItems.push(item);
        return;
      }
      const liveProduct = inventoryProducts.find(p => p.id === item.product.id);
      if (!liveProduct || liveProduct.stock <= 0) {
        warnings.push(`"${item.product.name}" was removed because it is now OUT OF STOCK.`);
      } else if (liveProduct.stock < item.quantity) {
        warnings.push(`"${item.product.name}" quantity was reduced from ${item.quantity} to ${liveProduct.stock} (current stock).`);
        validatedItems.push({
          ...item,
          quantity: liveProduct.stock,
          product: liveProduct,
        });
      } else {
        validatedItems.push({
          ...item,
          product: liveProduct,
        });
      }
    });

    const matchedCustomer = cartToResume.customerId
      ? useCustomerStore.getState().customers.find(c => c.id === cartToResume.customerId && !c.mergedIntoId) ?? null
      : null;
    const customerId = matchedCustomer ? matchedCustomer.id : null;
    const customerName = matchedCustomer ? matchedCustomer.name : (cartToResume.customerName || '');
    const customerPhone = matchedCustomer?.phone ?? cartToResume.customerPhone ?? '';
    const requiresCustomerSelection = Boolean(
      (cartToResume.customerId && !matchedCustomer)
      || (cartToResume.customerId === undefined && cartToResume.customerName)
    );

    set({
      suspendedCarts: updatedSuspended,
      items: validatedItems,
      customerId,
      customerName,
      customerPhone,
      discount: cartToResume.discount || null,
      payments: [{ method: 'cash', amount: 0 }]
    });

    saveLocalSuspendedCarts(updatedSuspended);
    saveLocalActiveCart(validatedItems, customerName, customerPhone, cartToResume.discount || null, customerId);

    Promise.all([
      cartService.deleteSuspendedCart(id),
      cartService.saveActiveCart(validatedItems, customerName)
    ]).catch(console.error);

    return {
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      requiresCustomerSelection,
    };
  },

  discardSuspendedCart: (id) => {
    const state = get();
    const target = state.suspendedCarts.find(c => c.id === id);
    if (!target) return;
    for (const removedIds of suspendedFetchRemovals) removedIds.add(id);
    const updated = state.suspendedCarts.filter(c => c.id !== id);
    set({
      suspendedCarts: updated
    });
    saveLocalSuspendedCarts(updated);
    cartService.deleteSuspendedCart(id).catch(console.error);
  },

  fetchTransactions: async () => {
    set({ isLoadingTransactions: true, error: null });
    try {
      // Server-side query: strictly requests retail transactions only (no parts sales fetched)
      const transactions = await transactionService.getRetailTransactions();
      set({ transactions, isLoadingTransactions: false });
    } catch (err) {
      console.error('Failed to fetch retail transactions from server:', err);
      set({ error: 'Failed to load transactions', isLoadingTransactions: false });
    }
  },

  // Authoritative Stock Deduction & Restock: Executed exactly when checkout occurs
  checkout: async (options) => {
    // 0. Double-click & concurrency mutex guard
    if (get().isCheckingOut) {
      console.warn('Checkout already in progress, ignoring duplicate call');
      return null;
    }

    const { items, payments, customerName, customerPhone } = get();
    if (items.length === 0) return null;

    set({ isCheckingOut: true });

    try {
      // Immutable snapshot of items to process for this specific transaction
      const itemsSnapshot = [...items];
      const purchasesSubtotal = get().getPurchasesSubtotal();
      const returnsSubtotal = get().getReturnsSubtotal();
      const subtotal = get().getSubtotal();
      const discountAmount = get().getDiscountAmount();
      const total = get().getTotal();
      // A surplus is money leaving the shop, and the document has to name the door it
      // left by. Every surplus used to be stamped as negative cash, so an Avoir or a
      // debt deduction took the refund out of the drawer on paper while the same sum
      // was also granted on the customer's account — the day closed short twice, and
      // the receipt told the customer he had been handed cash he never got.
      const refundType = total < 0 ? (options?.refundType ?? 'cash') : undefined;
      const recordedPayments: SaleTransaction['payments'] = refundType
        ? [{
            method: refundType === 'store_credit' ? 'store_credit' : refundType === 'debt_deduction' ? 'debt' : 'cash',
            amount: total,
          }]
        : payments;
      const hasReturn = itemsSnapshot.some(i => i.isReturn === true);
      const actor = useAuthStore.getState().user;
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

      let matchedOrCreatedCustomer: Customer | null | undefined = null;
      const isDebt = recordedPayments.some(p => p.method === 'debt');
      const isCreditUsed = !!(options?.storeCreditUsed && options.storeCreditUsed > 0);
      const isSurplusAccount = total < 0 && !!(options?.refundType && options.refundType !== 'cash');

      // Only look up or create a customer profile if explicitly attached OR if transaction requires an account (debt/credit)
      const requiresCustomerAccount = options?.customerAttached || Boolean(get().customerId) || isDebt || isCreditUsed || isSurplusAccount;

      if (isOffline && (isCreditUsed || isSurplusAccount)) {
        throw new Error('Connect to the server before redeeming or issuing Store Credit (Avoir).');
      }

      const explicitCustomerId = get().customerId;
      if (explicitCustomerId) {
        matchedOrCreatedCustomer = useCustomerStore.getState().customers.find(
          c => c.id === explicitCustomerId && !c.mergedIntoId
        ) ?? null;
        if (!matchedOrCreatedCustomer && requiresCustomerAccount) {
          throw new Error('Select an active, synced customer account manually.');
        }
      } else if (customerName && customerName.trim() && requiresCustomerAccount) {
        matchedOrCreatedCustomer = await useCustomerStore.getState().findOrCreateCustomer({
          name: customerName.trim(),
          phone: customerPhone?.trim() || '',
          accountType: 'retail',
        });
      }

      // Avoir and debt deductions live on an account. With no account the settlement
      // below has nowhere to go and used to do nothing at all, filing a refund the
      // shop never gave. Refuse before anything is written.
      if (refundType && refundType !== 'cash' && !matchedOrCreatedCustomer) {
        throw new Error('Attach a customer to issue store credit or deduct a debt, or refund in cash.');
      }

      // Problem 2 fix: Pre-validate Credit Limit BEFORE transaction save
      const debtPayment = recordedPayments.find(p => p.method === 'debt');
      const debtAmount = debtPayment ? debtPayment.amount : 0;
      if (debtAmount > 0) {
        if (!matchedOrCreatedCustomer) {
          throw new Error('A customer profile is required to put an order on Credit Tab / Debt.');
        }
        if (matchedOrCreatedCustomer.creditLimit && matchedOrCreatedCustomer.creditLimit > 0) {
          const currentDebt = useCustomerStore.getState().getCustomerDebtTotal(matchedOrCreatedCustomer.id);
          const projectedBalance = currentDebt + debtAmount;
          if (projectedBalance > matchedOrCreatedCustomer.creditLimit && !options?.allowCreditLimitOverride && actor?.role !== 'admin') {
            throw new Error(
              `Credit limit exceeded for ${matchedOrCreatedCustomer.name}. Current debt: ${formatCurrency(currentDebt)}, added: ${formatCurrency(debtAmount)}, limit: ${formatCurrency(matchedOrCreatedCustomer.creditLimit)}. Admin approval required.`
            );
          }
        }
      }

      // The reference this sale is filed and searched under, and — since the till and
      // the phone share one sequence per day — the number a debt can be matched on.
      const moment = new Date();
      const { invoiceNumber, provisional: numberGuessed } = await claimInvoiceNumber('retail', moment);

      const txData: Omit<SaleTransaction, 'id'> = {
        date: moment.toISOString(),
        items: [...itemsSnapshot],
        subtotal,
        // The document holds the dinars the promise came to, not the promise: the
        // receipt re-expands a percentage without rounding while the total is
        // rounded, and then its own lines stop adding up to its own total.
        discount: discountAmount > 0 ? { type: 'flat', value: discountAmount } : undefined,
        total,
        payments: recordedPayments,
        customerName: matchedOrCreatedCustomer?.name || customerName || undefined,
        customerPhone: matchedOrCreatedCustomer?.phone || customerPhone || undefined,
        customerId: matchedOrCreatedCustomer?.id,
        saleType: 'retail',
        stockApplied: !isOffline,
        validationStatus: isOffline ? 'pending_validation' : 'confirmed',
        invoiceNumber,
        invoiceNumberProvisional: numberGuessed || undefined,
        status: 'completed',
        processedById: actor?.id || 'local-cashier',
        processedByName: actor?.name,
        exchangeSummary: hasReturn
          ? {
              hasReturn: true,
              returnedTotal: returnsSubtotal,
              purchasedTotal: purchasesSubtotal,
              netDifference: total,
              refundType,
              storeCreditUsed: options?.storeCreditUsed,
            }
          : undefined,
      };

      let saved: SaleTransaction;
      if (isOffline) {
        // Offline device cannot verify cross-device stock or Avoir availability; mark pending validation
        txData.stockApplied = false;
        txData.validationStatus = 'pending_validation';
        saved = await transactionService.save(txData);

        if (debtAmount > 0 && matchedOrCreatedCustomer) {
          const itemsSummary = itemsSnapshot
            .map(i => `${i.isReturn ? '[RETURN] ' : ''}${i.quantity}x ${i.product.name} ${i.product.model}`)
            .join(', ');
          const createdDebt = await useCustomerStore.getState().addDebt({
            customerId: matchedOrCreatedCustomer.id,
            customerName: matchedOrCreatedCustomer.name,
            customerPhone: matchedOrCreatedCustomer.phone || customerPhone || '',
            productOrService: itemsSummary || `POS Sale #${saved.id.slice(0, 6)}`,
            totalAmount: total,
            amountPaid: Math.max(0, total - debtAmount),
            date: txData.date,
            notes: `POS Sale Receipt #${saved.id}`,
            transactionId: saved.id,
            invoiceNumber: txData.invoiceNumber,
            payments: saleOpeningPayments(recordedPayments, txData.date, actor?.name),
            allowCreditLimitOverride: options?.allowCreditLimitOverride,
          });
          if (createdDebt) {
            const settlement = {
              type: Math.max(0, total - debtAmount) > 0 ? ('partial_payment' as const) : ('charged_to_account' as const),
              paidAmount: Math.max(0, total - debtAmount),
              chargedAmount: debtAmount,
              debtEntryId: createdDebt.id,
            };
            await transactionService.updateTransaction(saved.id, { accountSettlement: settlement });
            saved.accountSettlement = settlement;
          }
        }

        if (matchedOrCreatedCustomer) {
          useCustomerStore.getState().recalculateCustomer(matchedOrCreatedCustomer.id).catch(console.error);
        }
        await moveSaleStock(saved, itemsSnapshot, 'retail');
      } else {
        const draftKey = JSON.stringify({
          items: itemsSnapshot.map(i => ({ id: i.product.id, quantity: i.quantity, isReturn: i.isReturn === true })),
          customerId: explicitCustomerId,
          customerName,
          customerPhone,
          discount: get().discount,
        });

        let result: RetailCheckoutResult;
        try {
          result = await retailCheckoutService.checkout(txData, {
            draftKey,
            actorRole: actor?.role,
            refundType,
            storeCreditUsed: options?.storeCreditUsed,
            allowCreditLimitOverride: options?.allowCreditLimitOverride,
          });
        } finally {
          get().refreshPendingCheckout();
        }

        if (!result.transaction) {
          throw new Error('Checkout did not return a confirmed sale.');
        }
        saved = result.transaction;

        if (result.stock.length) {
          const byId = new Map(result.stock.map(product => [product.id, product]));
          useInventoryStore.setState(state => ({
            products: state.products.map(product => byId.get(product.id) ?? product),
            parts: state.parts.map(product => byId.get(product.id) ?? product),
          }));
        }
        if (result.customer || result.debtEntry || result.updatedDebts?.length) {
          const updatedDebtMap = new Map((result.updatedDebts ?? []).map(d => [d.id, d]));
          useCustomerStore.setState(state => ({
            ...(result.customer ? { customers: state.customers.map(c => c.id === result.customer!.id ? result.customer! : c) } : {}),
            debts: [
              ...(result.debtEntry ? [result.debtEntry] : []),
              ...state.debts
                .filter(d => d.id !== result.debtEntry?.id)
                .map(d => updatedDebtMap.get(d.id) ?? d),
            ],
          }));
        }

        await retailCheckoutService.acknowledge(txData.processedById!, saved.id).catch(console.error);
        get().refreshPendingCheckout();
      }

      set(state => ({
        transactions: [saved, ...state.transactions.filter(existing => existing.id !== saved.id)],
        items: [],
        customerId: null,
        customerName: '',
        customerPhone: '',
        discount: null,
        payments: [{ method: 'cash', amount: 0 }],
      }));

      // Clear active cart from local storage and DB after checkout
      saveLocalActiveCart([], '', '', null, null);
      cartService.clearActiveCart().catch(console.error);

      // 7. Log to Activity Log & Customer Audit Log
      const itemsDesc = itemsSnapshot
        .map(i => `${i.isReturn ? '[RETURN] ' : ''}${i.quantity}x ${i.product.name}`)
        .join(', ');

      const logTitle = hasReturn
        ? purchasesSubtotal > 0
          ? `Exchange completed — Net: ${formatCurrency(total)} (${returnsSubtotal} DA returned, ${purchasesSubtotal} DA bought)`
          : `Item return & refund — ${formatCurrency(Math.abs(total))}`
        : `Sale completed — ${formatCurrency(total)}`;

      activityLogService.log(
        'sales',
        `${logTitle}${customerName ? ` for ${customerName}` : ''}`,
        { detail: itemsDesc, entityId: saved.id, entityType: 'sale', userName: actor?.name, userId: actor?.id }
      ).catch(console.error);

      if (matchedOrCreatedCustomer) {
        const custAction = hasReturn ? (purchasesSubtotal > 0 ? 'item_exchange' : 'item_return') : 'sale_completed';
        customerLogService.log({
          customerId: matchedOrCreatedCustomer.id,
          customerName: matchedOrCreatedCustomer.name,
          actionType: custAction,
          actionTitle: hasReturn ? 'Item Return / Exchange Processed' : `POS Sale Completed (${itemsSnapshot.length} items)`,
          actionDescription: `${logTitle} by ${actor?.name || 'Staff'}. Items: ${itemsDesc}.`,
          actorId: actor?.id,
          actorName: actor?.name || 'Staff',
          actorRole: actor?.role,
          metadata: { transactionId: saved.id, total, itemsDesc, hasReturn },
        }).catch(console.error);
      }

      return saved;
    } finally {
      set({ isCheckingOut: false });
    }
  },

  refundTransaction: async (txId, expected) => {
    const actor = useAuthStore.getState().user;
    if (!actor) throw new Error('Sign in before refunding an invoice.');
    let sale = expected ?? get().transactions.find(t => t.id === txId);
    if (!sale) {
      const { usePartsCartStore } = await import('./partsCartStore');
      sale = usePartsCartStore.getState().invoices.find(t => t.id === txId);
    }
    if (!sale || sale.id !== txId) throw new Error('Refresh the invoice before refunding it.');
    // A cheap refusal on the copy this till holds; the service's transaction asks the
    // server. The phone closes a sale as `voided`, so that door counts as closed here.
    if (sale.status === 'refunded' || sale.status === 'voided' || sale.status === 'cancelled') {
      return ['This invoice was already closed. No new refund or account movement was made.'];
    }
    const result = await transactionService.refund(sale, { id: actor.id, name: actor.name || 'Staff', role: actor.role });
    if (useAuthStore.getState().user?.id !== actor.id) throw new Error('The refund was confirmed for the previous cashier. Refresh the invoice before continuing.');
    set(state => ({ transactions: state.transactions.map(t => t.id === txId ? result.transaction : t) }));
    const { usePartsCartStore } = await import('./partsCartStore');
    usePartsCartStore.setState(state => ({ invoices: state.invoices.map(t => t.id === txId ? result.transaction : t) }));
    const stock = new Map(result.stock.map(product => [product.id, product]));
    useInventoryStore.setState(state => ({
      products: state.products.map(product => stock.get(product.id) ?? product),
      parts: state.parts.map(product => stock.get(product.id) ?? product),
    }));
    if (result.customer || result.debt) {
      useCustomerStore.setState(state => ({
        customers: result.customer ? [result.customer, ...state.customers.filter(customer => customer.id !== result.customer!.id)] : state.customers,
        debts: result.debt ? [result.debt, ...state.debts.filter(debt => debt.id !== result.debt!.id)] : state.debts,
      }));
    }
    return result.outcome === 'already_closed' ? ['This invoice was already closed. No new refund or account movement was made.'] : [];
  },

  editTransaction: async (txId, newItems, returnToStockOptions) => {
    let tx = get().transactions.find(t => t.id === txId);
    let isPartsB2B = false;

    if (!tx) {
      const { usePartsCartStore } = await import('./partsCartStore');
      tx = usePartsCartStore.getState().invoices.find(t => t.id === txId);
      if (tx) isPartsB2B = true;
    }

    if (!tx) return;

    // The till's own arithmetic over the corrected basket: a line the customer handed
    // back comes off the invoice instead of being added to it, and the discount is
    // measured on what was bought — the two rules `checkoutCart` already applies to
    // the same exchange rung at the counter.
    const {
      purchases,
      returns,
      discountAmount: discountAmt,
      total,
    } = cartTotalsOf(newItems, tx.discount || null);
    const subtotal = purchases - returns;

    // A basket whose returns outweigh its purchases is an exchange surplus, and the
    // till is the only place that gets to ask where that money goes — back as cash,
    // onto the account as Avoir, or off what he owes. Flooring it here would eat the
    // difference in silence, so nothing is written and the edit is refused.
    if (total < 0) {
      throw new Error(
        `This correction leaves the receipt owing ${formatCurrency(Math.abs(total))} to the customer. ` +
          'Settle that exchange at the till, where the shop can record how it was paid back.'
      );
    }

    // Stock follows the diff, and a line the invoice never carried is a diff of its
    // whole quantity. The signs and the shelf check are `planSaleEditStock`'s.
    const { deltas, shortages } = planSaleEditStock(
      tx.items,
      newItems,
      returnToStockOptions,
      [...useInventoryStore.getState().products, ...useInventoryStore.getState().parts]
    );

    // Nothing has written yet, so a refused line cannot leave the rest of the edit
    // half-applied to the stock.
    if (shortages.length > 0) {
      const detail = shortages
        .map(s => `"${s.name}" (shelf ${s.available}, needs ${s.wanted})`)
        .join(', ');
      throw new Error(`Not enough stock to put on the invoice: ${detail}`);
    }

    let status: NonNullable<SaleTransaction['status']> = tx.status || 'completed';
    if (newItems.length === 0 || total === 0) {
      status = 'refunded';
    } else {
      /**
       * A correction no longer shrinks the sold line — the units that come back join the
       * invoice as their own `−` line — so the quantity written on a row can fall and yet
       * leave the customer holding the same goods. What decides the stamp is what he
       * leaves with: units bought less units handed back, on the document before and
       * after. A price-only correction moves money and no goods, and keeps its stamp.
       */
      const keptBefore = soldUnits(tx.items) - returnedUnits(tx.items);
      const keptAfter = soldUnits(newItems) - returnedUnits(newItems);
      if (keptAfter < keptBefore) status = 'partially_refunded';
    }

    // Split payments adjustment: preserve proportional ratio so payments sum strictly equals total
    let adjustedPayments: { method: PaymentMethod; amount: number }[] = [];
    if (!tx.payments) {
      // A document written before the till recorded tenders reads as cash everywhere;
      // the correction keeps that reading rather than inventing a split.
      adjustedPayments = [{ method: 'cash', amount: total }];
    } else if (tx.payments.length === 0) {
      // Nothing was tendered — the whole invoice sits on the account. A cash row here
      // would put money in the drawer that never changed hands.
      adjustedPayments = [];
    } else if (tx.payments.length === 1) {
      const only = tx.payments[0];
      if (only.method === 'debt') {
        // A charge row is not money received: it follows the corrected total.
        adjustedPayments = [{ ...only, amount: total }];
      } else if ((Number(only.amount) || 0) < (tx.total || 0)) {
        // One tender line that only partly paid the invoice (the parts-B2B shape): the
        // rest was charged to the account, not received. Money already handed over is a
        // fact — the correction can cap it at the new total but never grow it.
        adjustedPayments = [{ ...only, amount: Math.max(0, Math.min(Number(only.amount) || 0, total)) }];
      } else {
        adjustedPayments = [{ ...only, amount: total }];
      }
    } else {
      const oldSum = tx.payments.reduce((sum, p) => sum + p.amount, 0) || tx.total || 1;
      let running = 0;
      adjustedPayments = tx.payments.map((p, idx) => {
        if (idx === tx.payments.length - 1) {
          const remaining = Math.max(0, Math.round((total - running) * 100) / 100);
          return { ...p, amount: remaining };
        }
        const proportional = Math.max(0, Math.round((p.amount / oldSum) * total * 100) / 100);
        running += proportional;
        return { ...p, amount: proportional };
      });
    }

    // The statement and the account-statement print read `unitPrice`/`totalPrice` off
    // the stored line, so a corrected price that only reaches `product.price` prints
    // the old number — or nothing at all.
    const pricedItems = newItems.map(item => {
      const listed = Math.max(0, Number(item.product.price) || 0);
      const granted = item.customReturnPrice;
      const unitPrice = item.isReturn && typeof granted === 'number' && Number.isFinite(granted)
        ? Math.max(0, granted)
        : listed;
      return {
        ...item,
        unitPrice,
        totalPrice: Math.round(unitPrice * item.quantity * 100) / 100,
      };
    });

    const updates: Partial<SaleTransaction> = {
      items: pricedItems,
      subtotal,
      total,
      status,
      payments: adjustedPayments,
      financialRevision: (tx.financialRevision ?? 0) + 1,
    };

    /**
     * What this correction knocks off the invoice, line by line, measured against
     * the price the document carried for each line before it — a line that joined
     * the invoice is priced at what it was sold for, so it records nothing. The
     * concession lives inside the line's own price, invisible to anything adding
     * up the discount field, so the shop writes it down where its totals can see
     * it. A later correction that gives a price back leaves the record standing:
     * a till that over-counts money walked out of is the safer way to be wrong.
     *
     * The lines that came back off the invoice are not in it. A concession is money
     * let on what the customer BOUGHT; measured on a unit he handed back it would
     * record a giveaway the shop never made — and now that every correction writes
     * `−` lines, it would do that on every one.
     */
    const lineConcessions = pricedItems
      .filter(item => !item.isReturn && item.product?.id)
      .map(item => {
        const charged = item.unitPrice ?? item.product.price;
        const before = tx.items.find(orig =>
          orig.product.id === item.product.id && Boolean(orig.isReturn) === Boolean(item.isReturn)
        );
        const listUnit = before ? (before.unitPrice ?? before.product.price) : charged;
        return {
          productId: item.product.id,
          name: `${item.product.name} ${item.product.model || ''}`.trim(),
          ...lineDiscountOf(listUnit, charged, item.quantity),
        };
      })
      .filter(line => line.granted > 0);

    if (lineConcessions.length > 0) updates.lineDiscounts = lineConcessions;

    // A sale written before the till stored its discount in dinars still carries a
    // percentage, and re-expanding one at print time is exactly how a reprint came
    // out a dinar off its own lines. The corrected invoice gets written once, in
    // the dinars the customer was actually given.
    if (tx.discount?.type === 'percent' && discountAmt > 0) {
      updates.discount = { type: 'flat', value: discountAmt };
    }

    // If this transaction was linked to a debt entry, update the debt balance accordingly (Problem 8 fix)
    const customerStore = useCustomerStore.getState();
    const linkedDebt = customerStore.debts.find(d =>
      d.id === tx.accountSettlement?.debtEntryId ||
      d.transactionId === txId ||
      (tx.invoiceNumber && d.invoiceNumber === tx.invoiceNumber) ||
      (d.notes && d.notes.includes(txId))
    );
    // Money the customer already handed over is a fact; correcting the invoice
    // cannot un-pay it. What the account held before this edit and what it holds
    // after is the difference between the two over-collections, and the shop's
    // own rule for absorbed money — the one a void already uses — is to keep it
    // as Avoir rather than let `Math.max(0, …)` quietly eat it.
    const itemsSummary = newItems.map(lineNote).join(', ');
    const paid = linkedDebt?.amountPaid || 0;
    const surplusShift = linkedDebt
      ? Math.max(0, paid - total) - Math.max(0, paid - (tx.total || 0))
      : 0;
    const creditHolder = linkedDebt ? (tx.customerId || linkedDebt.customerId) : undefined;
    const receipt = tx.invoiceNumber || txId.slice(0, 8);

    // What the account owes is what the corrected tender lines declare as `debt`.
    // A parts invoice carries no such line — its charge lives in `accountSettlement`
    // alone — so silence in the payments is not evidence that a standing balance was
    // paid; there the account's own paid figure decides, as it does on the phone.
    let newCharged = 0;
    if (linkedDebt) {
      const accountLines = adjustedPayments.filter(p => p.method === 'debt');
      newCharged = accountLines.length > 0
        ? Math.round(accountLines.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) * 100) / 100
        : Math.max(0, total - (linkedDebt.amountPaid || 0));

      // The stamp describes this invoice's own split: `paidAmount` is what changed hands
      // at the till, which is what the account statement prints as paid upfront. The
      // account's running collections are a different figure and belong to the debt
      // entry alone. Both documents are told the same charged number so they cannot
      // disagree about what the customer still owes.
      const newPaid = Math.max(0, total - newCharged);
      const newSettlementType: 'paid_full' | 'charged_to_account' | 'partial_payment' =
        newCharged === 0
          ? 'paid_full'
          : newPaid === 0
            ? 'charged_to_account'
            : 'partial_payment';
      updates.accountSettlement = {
        ...tx.accountSettlement,
        type: newSettlementType,
        paidAmount: newPaid,
        chargedAmount: newCharged,
        debtEntryId: tx.accountSettlement?.debtEntryId ?? linkedDebt.id,
      };
    }

    // ── The writes ──
    // Online: the whole correction — invoice, shelf, credit record and Avoir — lands
    // in one server transaction keyed by the revision this till saw and a durable operationId.
    // Offline for an existing server invoice: queue ONE atomic EDIT_SALE_TRANSACTION action
    // and update local mirrors as `pending_validation` (never uncoordinated split mutations).
    // Offline for a local-only offline_tx_* invoice: await every financial change without swallowing errors.
    const nextRevision = (tx.financialRevision ?? 0) + 1;
    const stockDeltas = deltas.map(({ productId, delta }) => ({ productId, delta }));
    const creditShift = surplusShift !== 0 && creditHolder
      ? {
          customerId: creditHolder,
          amount: surplusShift,
          note: surplusShift > 0
            ? `Over-collection on corrected Receipt #${receipt} held as Avoir`
            : `Avoir released by corrected Receipt #${receipt}`,
        }
      : undefined;
    const debtUpdate = linkedDebt
      ? { debtId: linkedDebt.id, total, charged: newCharged, itemsSummary, expectedPaid: paid }
      : undefined;

    const existingJournal = transactionService.getPendingSaleEdits().find(
      e => e.transactionId === txId && (e.expected.financialRevision ?? 0) === (tx.financialRevision ?? 0)
    );
    const operationId = existingJournal?.operationId || `edit_${txId}_${nextRevision}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const isOfflineNow = typeof navigator !== 'undefined' && navigator.onLine === false;

    let confirmed: { transaction: SaleTransaction; stock: PhoneModel[]; customer?: Customer; debt?: CustomerDebtEntry } | null = null;
    let optimisticStatusOverride: Partial<SaleTransaction> = {};

    if (isOfflineNow && !txId.startsWith('offline_')) {
      const serverEditRequest: SaleEditRequest = {
        operationId,
        updates: { ...updates, validationStatus: 'confirmed' },
        stockDeltas,
        creditShift,
        debtUpdate,
      };
      transactionService.savePendingSaleEdit({
        operationId,
        transactionId: txId,
        expected: tx,
        edit: serverEditRequest,
        status: 'queued',
        createdAt: existingJournal?.createdAt || new Date().toISOString(),
      });
      await offlineQueue.enqueue({
        type: 'EDIT_SALE_TRANSACTION',
        payload: {
          transactionId: txId,
          operationId,
          expected: tx,
          edit: serverEditRequest,
        },
      });

      optimisticStatusOverride = { validationStatus: 'pending_validation' };
      await transactionService.updateTransaction(txId, { ...updates, ...optimisticStatusOverride });

      if (stockDeltas.length > 0) {
        const localInv = inventoryService.getLocalInventory();
        const deltaMap = new Map(stockDeltas.map(d => [d.productId, d.delta]));
        const nextLocalInv = localInv.map(p => {
          const d = deltaMap.get(p.id);
          if (!d) return p;
          const nextStock = Math.max(0, p.stock + d);
          return {
            ...p,
            stock: nextStock,
            stockStatus: computeStockStatus(nextStock, p.lowStockThreshold ?? 1),
          };
        });
        inventoryService.saveLocalInventory(nextLocalInv);
        const mapById = new Map(nextLocalInv.map(p => [p.id, p]));
        useInventoryStore.setState(state => ({
          products: state.products.map(p => mapById.get(p.id) ?? p),
          parts: state.parts.map(p => mapById.get(p.id) ?? p),
        }));
      }

      if (linkedDebt) {
        try {
          const rawDebts = localStorage.getItem('offline_customer_debts');
          const localDebts: CustomerDebtEntry[] = rawDebts ? JSON.parse(rawDebts) : [];
          const nextDebt: CustomerDebtEntry = {
            ...linkedDebt,
            totalAmount: Math.round(total * 100) / 100,
            remainingBalance: Math.max(0, Math.round(newCharged * 100) / 100),
            status: newCharged <= 0 ? 'paid' : (linkedDebt.amountPaid || 0) > 0 ? 'partially_paid' : 'unpaid',
            updatedAt: new Date().toISOString(),
            itemsSummary,
            productOrService: itemsSummary,
          };
          localStorage.setItem(
            'offline_customer_debts',
            JSON.stringify(localDebts.map(d => (d.id === linkedDebt.id ? nextDebt : d)))
          );
          customerStore.debts = customerStore.debts.map(d => (d.id === linkedDebt.id ? nextDebt : d));
          useCustomerStore.setState(state => ({
            debts: state.debts.map(d => (d.id === linkedDebt.id ? nextDebt : d)),
          }));
        } catch (err) {
          console.warn('Could not update optimistic debt mirror for queued edit:', err);
        }
      }
    } else if (txId.startsWith('offline_')) {
      if (deltas.length > 0) {
        await Promise.all(deltas.map(({ productId, delta }) => inventoryService.adjustStockAsync(productId, delta)));
        await useInventoryStore.getState().fetchProducts();
      }

      if (linkedDebt) {
        if (surplusShift > 0 && creditHolder) {
          await customerStore.addStoreCredit(
            creditHolder,
            surplusShift,
            `Over-collection on corrected Receipt #${receipt} held as Avoir`,
            `${txId}_edit_${nextRevision}_credit`
          );
        } else if (surplusShift < 0 && creditHolder) {
          await customerStore.useStoreCredit(
            creditHolder,
            Math.abs(surplusShift),
            `Avoir released by corrected Receipt #${receipt}`,
            `${txId}_edit_${nextRevision}_credit`
          );
        }
        await customerStore.updateDebtAmount(linkedDebt.id, total, itemsSummary, newCharged);
      }

      await transactionService.updateTransaction(txId, updates);
    } else {
      const serverEditRequest: SaleEditRequest = {
        operationId,
        updates,
        stockDeltas,
        creditShift,
        debtUpdate,
      };
      transactionService.savePendingSaleEdit({
        operationId,
        transactionId: txId,
        expected: tx,
        edit: serverEditRequest,
        status: 'pending',
        createdAt: existingJournal?.createdAt || new Date().toISOString(),
      });
      try {
        confirmed = await transactionService.editSale(tx, serverEditRequest);
        transactionService.removePendingSaleEdit(txId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? '');
        const definiteReject =
          msg.includes('changed on another device') ||
          msg.includes('closed') ||
          msg.includes('Not enough stock') ||
          msg.includes('already been spent') ||
          msg.includes('received a payment') ||
          msg.includes('no longer exists') ||
          msg.includes('permission-denied');
        if (definiteReject) {
          transactionService.removePendingSaleEdit(txId);
        } else {
          transactionService.savePendingSaleEdit({
            operationId,
            transactionId: txId,
            expected: tx,
            edit: serverEditRequest,
            status: 'uncertain',
            createdAt: existingJournal?.createdAt || new Date().toISOString(),
            errorMessage: msg,
          });
        }
        throw err;
      }
    }

    // If this transaction has an attached customer, recalculate stats authoritatively
    if (tx.customerId) {
      useCustomerStore.getState().recalculateCustomer(tx.customerId).catch(console.error);
    }

    const finalTx: SaleTransaction = confirmed?.transaction ?? { ...tx, ...updates, ...optimisticStatusOverride };
    if (isPartsB2B) {
      const { usePartsCartStore } = await import('./partsCartStore');
      usePartsCartStore.setState(state => ({
        invoices: state.invoices.map(t =>
          t.id === txId ? finalTx : t
        )
      }));
    } else {
      set(state => ({
        transactions: state.transactions.map(t =>
          t.id === txId ? finalTx : t
        )
      }));
    }

    if (confirmed) {
      const stock = new Map(confirmed.stock.map(product => [product.id, product]));
      useInventoryStore.setState(state => ({
        products: state.products.map(product => stock.get(product.id) ?? product),
        parts: state.parts.map(product => stock.get(product.id) ?? product),
      }));
      if (confirmed.customer || confirmed.debt) {
        useCustomerStore.setState(state => ({
          customers: confirmed.customer ? [confirmed.customer, ...state.customers.filter(c => c.id !== confirmed.customer!.id)] : state.customers,
          debts: confirmed.debt ? [confirmed.debt, ...state.debts.filter(d => d.id !== confirmed.debt!.id)] : state.debts,
        }));
      }
    }

    const actor = useAuthStore.getState().user;
    const itemsDetail = newItems
      .map(i => `${i.isReturn ? '−' : ''}${i.quantity}x ${i.product.name} @ ${formatCurrency(i.product.price)}`)
      .join(', ');
    activityLogService.log(
      'sales',
      `Transaction #${tx.invoiceNumber || txId} edited: ${formatCurrency(tx.total)} → ${formatCurrency(total)}`,
      { detail: `Updated items: ${itemsDetail}`, entityId: txId, userName: actor?.name, userId: actor?.id }
    ).catch(console.error);

    if (tx.customerId) {
      customerLogService.log({
        customerId: tx.customerId,
        customerName: tx.customerName || 'Customer',
        actionType: 'sale_completed',
        actionTitle: `Invoice #${tx.invoiceNumber || txId.slice(0, 8)} Modified`,
        actionDescription: `Invoice adjusted from ${formatCurrency(tx.total)} to ${formatCurrency(total)} by ${actor?.name || 'Staff'}. Items: ${itemsDetail}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: { transactionId: txId, oldTotal: tx.total, newTotal: total, itemsDetail },
      }).catch(console.error);
    }
  },

  getPurchasesSubtotal: () => cartTotalsOf(get().items, null).purchases,

  getReturnsSubtotal: () => cartTotalsOf(get().items, null).returns,

  getSubtotal: () =>
    get().getPurchasesSubtotal() - get().getReturnsSubtotal(),

  // Measured against the purchases, not the net basket: a returned phone coming
  // back onto the shelf must not shrink the discount a trade customer was owed on
  // what he took. One rule with the parts counter and the technician phone.
  getDiscountAmount: () => cartTotalsOf(get().items, get().discount).discountAmount,

  // Net difference: positive = customer pays, negative = shop owes refund/credit
  getTotal: () => cartTotalsOf(get().items, get().discount).total,

  getItemCount: () =>
    get().items.reduce((sum, item) => sum + item.quantity, 0),

  hasReturnItems: () =>
    get().items.some(i => i.isReturn === true),
}));
