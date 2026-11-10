import { create } from 'zustand';
import type { CartItem, Customer, PaymentMethod, PhoneModel, SaleTransaction, SuspendedCart, B2BCheckoutOptions, CustomerDebtEntry } from '../types';
import { useInventoryStore } from './inventoryStore';
import { inventoryService } from '../services/inventoryService';
import { transactionService } from '../services/transactionService';
import { claimInvoiceNumber } from '../services/invoiceCounter';
import { activityLogService } from '../services/activityLogService';
import { customerLogService } from '../services/customerLogService';
import { useAuthStore } from './authStore';
import { useCustomerStore } from './customerStore';
import { cartService } from '../services/cartService';
import { formatCurrency } from '../utils/formatCurrency';
import { discountAmountOf, lineDiscountOf } from '../utils/discountPolicy';
import { planSaleEditStock } from '../utils/saleEditStock';
import { returnedUnits, soldUnits } from '../utils/saleEditLines';
import { foldStockDeltas } from '../utils/stockDeltas';
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

const STORAGE_KEY_ACTIVE = 'pos_active_cart';
const STORAGE_KEY_SUSPENDED = 'pos_suspended_carts';

const loadLocalActiveCart = (): { items: CartItem[]; customerName: string; customerPhone: string; discount: { type: 'percent' | 'flat'; value: number } | null } => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (!raw) return { items: [], customerName: '', customerPhone: '', discount: null };
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
      customerPhone: typeof parsed.customerPhone === 'string' ? parsed.customerPhone : '',
      discount: parsed.discount || null,
    };
  } catch {
    return { items: [], customerName: '', customerPhone: '', discount: null };
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

const saveLocalActiveCart = (items: CartItem[], customerName: string, customerPhone: string, discount: { type: 'percent' | 'flat'; value: number } | null) => {
  try {
    if (items.length === 0 && !customerName && !customerPhone) {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    } else {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify({ items, customerName, customerPhone, discount }));
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
  customerName: string;
  customerPhone: string;
  transactions: SaleTransaction[];
  isLoadingTransactions: boolean;
  error: string | null;
  discount: { type: 'percent' | 'flat'; value: number } | null;
  isCheckingOut: boolean;
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
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  setDiscount: (discount: { type: 'percent' | 'flat'; value: number } | null) => void;
  
  // Suspend Cart Actions
  suspendedCarts: SuspendedCart[];
  suspendCart: () => void;
  resumeCart: (id: string) => { success: boolean; warnings?: string[] };
  discardSuspendedCart: (id: string) => void;

  fetchCarts: () => Promise<void>;

  fetchTransactions: () => Promise<void>;
  checkout: (options?: CheckoutOptions) => Promise<SaleTransaction | null>;
  checkoutB2B: (options: B2BCheckoutOptions) => Promise<{ transaction: SaleTransaction; debtEntry?: CustomerDebtEntry; invoiceNumber: string } | null>;
  /**
   * @returns anything the refund could not finish — currently only a credit record it
   * failed to close, which the till has to say out loud rather than leave the customer
   * owing for goods he returned.
   */
  refundTransaction: (txId: string) => Promise<string[]>;
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
  customerName: initialActive.customerName,
  customerPhone: initialActive.customerPhone,
  transactions: [],
  isLoadingTransactions: false,
  error: null,
  discount: initialActive.discount,
  suspendedCarts: initialSuspended,
  isCheckingOut: false,

  fetchCarts: async () => {
    try {
      // Problem 13 fix: Suspended carts are synced across terminals, while active draft carts remain strictly local
      const suspended = await cartService.getAllSuspendedCarts();
      const currentSuspended = get().suspendedCarts;
      const finalSuspended = suspended && suspended.length > 0 ? suspended : currentSuspended;

      set(state => ({
        ...state,
        suspendedCarts: finalSuspended,
      }));
    } catch (err) {
      console.error('Failed to fetch carts', err);
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
    saveLocalActiveCart(updatedItems, state.customerName, state.customerPhone, state.discount);
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
    saveLocalActiveCart(updatedItems, state.customerName, state.customerPhone, state.discount);
    cartService.saveActiveCart(updatedItems, state.customerName).catch(console.error);
  },

  removeFromCart: (productId, isReturn) => {
    set(state => {
      const updated = state.items.filter(
        i => !(i.product.id === productId && (isReturn === undefined || Boolean(i.isReturn) === Boolean(isReturn)))
      );
      saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
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
      saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
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
    saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
    cartService.saveActiveCart(updated, state.customerName).catch(console.error);
    return { success: true };
  },

  clearCart: () => {
    set({ items: [], customerName: '', customerPhone: '', discount: null, payments: [{ method: 'cash', amount: 0 }] });
    saveLocalActiveCart([], '', '', null);
    cartService.clearActiveCart().catch(console.error);
  },

  setPayments: (payments) => set({ payments }),

  setCustomerName: (customerName) => {
    set({ customerName });
    saveLocalActiveCart(get().items, customerName, get().customerPhone, get().discount);
    cartService.saveActiveCart(get().items, customerName).catch(console.error);
  },

  setCustomerPhone: (customerPhone) => {
    set({ customerPhone });
    saveLocalActiveCart(get().items, get().customerName, customerPhone, get().discount);
  },

  setDiscount: (discount) => {
    set({ discount });
    saveLocalActiveCart(get().items, get().customerName, get().customerPhone, discount);
  },

  suspendCart: () => {
    const state = get();
    if (state.items.length === 0) return;
    const newSuspended: SuspendedCart = {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      items: [...state.items],
      customerName: state.customerName || '',
      discount: state.discount || null,
    };
    const updatedSuspended = [newSuspended, ...state.suspendedCarts];
    set({
      suspendedCarts: updatedSuspended,
      items: [],
      customerName: '',
      customerPhone: '',
      discount: null,
      payments: [{ method: 'cash', amount: 0 }],
    });
    saveLocalSuspendedCarts(updatedSuspended);
    saveLocalActiveCart([], '', '', null);
    
    Promise.all([
      cartService.saveSuspendedCart(newSuspended),
      cartService.clearActiveCart()
    ]).catch(console.error);
  },

  resumeCart: (id) => {
    const state = get();
    const cartToResume = state.suspendedCarts.find(c => c.id === id);
    if (!cartToResume) return { success: false, warnings: ['Cart not found'] };
    
    let updatedSuspended = state.suspendedCarts.filter(c => c.id !== id);

    // If the current active cart has items, safely place it on hold instead of losing it
    if (state.items.length > 0) {
      const activeAsSuspended: SuspendedCart = {
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        items: [...state.items],
        customerName: state.customerName || '',
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

    set({
      suspendedCarts: updatedSuspended,
      items: validatedItems,
      customerName: cartToResume.customerName || '',
      customerPhone: '',
      discount: cartToResume.discount || null,
      payments: [{ method: 'cash', amount: 0 }]
    });

    saveLocalSuspendedCarts(updatedSuspended);
    saveLocalActiveCart(validatedItems, cartToResume.customerName || '', '', cartToResume.discount || null);
    
    Promise.all([
      cartService.deleteSuspendedCart(id),
      cartService.saveActiveCart(validatedItems, cartToResume.customerName || '')
    ]).catch(console.error);

    return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
  },

  discardSuspendedCart: (id) => {
    const state = get();
    const target = state.suspendedCarts.find(c => c.id === id);
    if (!target) return;
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

      let matchedOrCreatedCustomer: Customer | null | undefined = null;
      const isDebt = recordedPayments.some(p => p.method === 'debt');
      const isCreditUsed = !!(options?.storeCreditUsed && options.storeCreditUsed > 0);
      const isSurplusAccount = total < 0 && !!(options?.refundType && options.refundType !== 'cash');

      // Only look up or create a customer profile if explicitly attached OR if transaction requires an account (debt/credit)
      const requiresCustomerAccount = options?.customerAttached || isDebt || isCreditUsed || isSurplusAccount;

      if (customerName && customerName.trim() && requiresCustomerAccount) {
        try {
          matchedOrCreatedCustomer = await useCustomerStore.getState().findOrCreateCustomer({
            name: customerName.trim(),
            phone: customerPhone?.trim() || '',
            accountType: 'retail',
          });
        } catch (err) {
          console.error('Failed to find or create customer:', err);
        }
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
        customerName: customerName || matchedOrCreatedCustomer?.name || undefined,
        customerPhone: customerPhone || matchedOrCreatedCustomer?.phone || undefined,
        customerId: matchedOrCreatedCustomer?.id,
        saleType: 'retail',
        invoiceNumber,
        invoiceNumberProvisional: numberGuessed || undefined,
        status: 'completed',
        processedById: actor?.id,
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
      
      // 1. Save transaction to Firebase
      const saved = await transactionService.save(txData);

      // 2. Handle Surplus Settlement (When Shop owes customer, total < 0)
      if (total < 0 && matchedOrCreatedCustomer) {
        const refundAmount = Math.abs(total);

        if (refundType === 'store_credit') {
          await useCustomerStore.getState().addStoreCredit(
            matchedOrCreatedCustomer.id,
            refundAmount,
            `Exchange Surplus from Receipt #${saved.id.slice(0, 8)}`
          ).catch(console.error);
        } else if (refundType === 'debt_deduction') {
          await useCustomerStore.getState().deductFromDebt(
            matchedOrCreatedCustomer.id,
            refundAmount,
            `Exchange Surplus applied from Receipt #${saved.id.slice(0, 8)}`
          ).catch(console.error);
        }
      }

      // 3. Handle Store Credit Used on Checkout (total > 0)
      if (options?.storeCreditUsed && options.storeCreditUsed > 0 && matchedOrCreatedCustomer) {
        await useCustomerStore.getState().useStoreCredit(
          matchedOrCreatedCustomer.id,
          options.storeCreditUsed,
          `POS Sale #${saved.id.slice(0, 8)}`
        ).catch(console.error);
      }

      // 4. If any amount was put on Debt / Credit Tab, automatically log it in the Customer Debt Ledger (Problem 2 & 8 fix)
      let createdDebt: CustomerDebtEntry | undefined;
      if (debtAmount > 0 && matchedOrCreatedCustomer) {
        try {
          const itemsSummary = itemsSnapshot
            .map(i => `${i.isReturn ? '[RETURN] ' : ''}${i.quantity}x ${i.product.name} ${i.product.model}`)
            .join(', ');
          createdDebt = await useCustomerStore.getState().addDebt({
            customerId: matchedOrCreatedCustomer.id,
            customerName: matchedOrCreatedCustomer.name,
            customerPhone: matchedOrCreatedCustomer.phone || customerPhone || '',
            productOrService: itemsSummary || `POS Sale #${saved.id.slice(0, 6)}`,
            totalAmount: total,
            amountPaid: Math.max(0, total - debtAmount),
            date: txData.date,
            notes: `POS Sale Receipt #${saved.id}`,
            transactionId: saved.id,
            // The receipt's own reference, so a retail balance is findable by the
            // number printed on the paper the customer holds — not only by the
            // document id, which nobody in the shop reads.
            invoiceNumber: txData.invoiceNumber,
            // The down payment in the tender it was actually given in; the drawer
            // counts it on the sale above, not again on this ledger row.
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
            await transactionService.updateTransaction(saved.id, {
              accountSettlement: settlement
            }).catch(console.error);
            saved.accountSettlement = settlement;
          }
        } catch (err) {
          console.error('Failed to log customer debt on checkout:', err);
          throw err;
        }
      }

      // 5. Update Retail Customer Statistics (Authoritative recalculation)
      if (matchedOrCreatedCustomer) {
        useCustomerStore.getState().recalculateCustomer(matchedOrCreatedCustomer.id).catch(console.error);
      }
      
      // 6. Authoritative Stock Adjustments in Zustand & Firestore (executed ONCE per transaction):
      // Regular purchases -> deduct stock (-qty)
      // Returned items -> restock into inventory (+qty)
      // One movement per product, because an exchange puts a sale row and a return row
      // of the same model on one document and two writes on one product abort each other.
      try {
        foldStockDeltas(
          itemsSnapshot.map(item => ({
            productId: item.product?.id,
            delta: item.isReturn ? (item.restock !== false ? item.quantity : 0) : -item.quantity,
          }))
        ).forEach(({ productId, delta }) => {
          useInventoryStore.getState().adjustStockBy(productId, delta);
        });
      } catch (err) {
        console.error('Failed to adjust stock on checkout:', err);
      }

      set(state => ({
        transactions: [saved, ...state.transactions],
        items: [],
        customerName: '',
        customerPhone: '',
        discount: null,
        payments: [{ method: 'cash', amount: 0 }],
      }));
      
      // 7. Clear active cart from local storage and DB after checkout
      saveLocalActiveCart([], '', '', null);
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

  checkoutB2B: async (options: B2BCheckoutOptions) => {
    if (get().isCheckingOut) {
      console.warn('B2B checkout already in progress, ignoring duplicate call');
      return null;
    }

    const { items, discount } = get();
    if (items.length === 0) return null;

    set({ isCheckingOut: true });

    try {
      const itemsSnapshot = [...items];
      const subtotal = get().getSubtotal();
      const total = get().getTotal();
      const actor = useAuthStore.getState().user;
      const moment = new Date();
      const now = moment.toISOString();
      const { invoiceNumber, provisional: numberGuessed } = await claimInvoiceNumber('parts', moment);

      const { customer, settlementType, paidAmount, paymentMethod, chargedAmount, dueDate, notes } = options;

      const txPayments = paidAmount > 0
        ? [{ method: paymentMethod, amount: paidAmount }]
        : [];

      let createdDebtEntry: CustomerDebtEntry | undefined;

      // 1. If chargedAmount > 0, post to Customer Debt Ledger
      if (chargedAmount > 0) {
        try {
          const itemsSummary = itemsSnapshot.map(i => `${i.quantity}x ${i.product.name} ${i.product.model}`).join(', ');
          createdDebtEntry = await useCustomerStore.getState().addDebt({
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            productOrService: itemsSummary || `Parts Invoice #${invoiceNumber}`,
            totalAmount: total,
            amountPaid: paidAmount,
            date: now,
            dueDate: dueDate || undefined,
            notes: notes ? `${notes} (Invoice #${invoiceNumber})` : `Parts Invoice #${invoiceNumber}`,
            invoiceNumber,
            itemsSummary,
            type: 'parts_b2b',
            // Real tender, counted once on the invoice — not a fabricated cash row.
            payments: saleOpeningPayments(txPayments, now, actor?.name),
          });
        } catch (err) {
          console.error('Failed to add debt for B2B checkout:', err);
          throw err;
        }
      }

      // 2. Build and save SaleTransaction
      const txData: Omit<SaleTransaction, 'id'> = {
        date: now,
        items: [...itemsSnapshot],
        subtotal,
        discount: discount || undefined,
        total,
        payments: txPayments,
        customerName: customer.name,
        customerId: customer.id,
        shopName: customer.shopName || customer.name,
        saleType: 'parts_b2b',
        invoiceNumber,
        invoiceNumberProvisional: numberGuessed || undefined,
        accountSettlement: {
          type: settlementType,
          paidAmount,
          chargedAmount,
          debtEntryId: createdDebtEntry?.id,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        },
        status: 'completed',
        processedById: actor?.id,
        processedByName: actor?.name,
      };

      const saved = await transactionService.save(txData);

      // 3. Update customer purchase stats (Authoritative recalculation)
      try {
        useCustomerStore.getState().recalculateCustomer(customer.id).catch(console.error);
      } catch (err) {
        console.error('Failed to update customer purchase stats:', err);
      }

      // 4. Immediate Authoritative Stock Deduction in Zustand & Firestore (executed ONCE per snapshot)
      try {
        foldStockDeltas(
          itemsSnapshot.map(item => ({ productId: item.product?.id, delta: -item.quantity }))
        ).forEach(({ productId, delta }) => {
          useInventoryStore.getState().adjustStockBy(productId, delta);
        });
      } catch (err) {
        console.error('Failed to deduct stock:', err);
      }

      // 5. Clear active cart
      set(state => ({
        transactions: [saved, ...state.transactions],
        items: [],
        customerName: '',
        customerPhone: '',
        discount: null,
        payments: [{ method: 'cash', amount: 0 }],
      }));

      saveLocalActiveCart([], '', '', null);
      cartService.clearActiveCart().catch(console.error);

      // 6. Log to Activity Log & Customer Audit Log
      const itemsDesc = itemsSnapshot.map(i => `${i.quantity}x ${i.product.name}`).join(', ');
      const shopDisplayName = customer.shopName ? `${customer.shopName} (${customer.name})` : customer.name;
      const settlementSummary = settlementType === 'paid_full'
        ? `Fully Paid (${formatCurrency(paidAmount)} via ${paymentMethod.toUpperCase()})`
        : settlementType === 'charged_to_account'
          ? `100% Charged to Account Tab (${formatCurrency(chargedAmount)})`
          : `Partial: Paid ${formatCurrency(paidAmount)} (${paymentMethod.toUpperCase()}), Charged ${formatCurrency(chargedAmount)} to Account`;

      activityLogService.log(
        'sales',
        `B2B Parts Sale [${invoiceNumber}] — ${formatCurrency(total)} for ${shopDisplayName} (${settlementSummary})`,
        { detail: itemsDesc, entityId: saved.id, entityType: 'sale', userName: actor?.name, userId: actor?.id }
      ).catch(console.error);

      customerLogService.log({
        customerId: customer.id,
        customerName: customer.name,
        actionType: 'b2b_parts_sale',
        actionTitle: `B2B Parts Invoice #${invoiceNumber}`,
        actionDescription: `Commercial parts dispatch to ${shopDisplayName} (${itemsSnapshot.length} parts: ${itemsDesc}). Total: ${formatCurrency(total)} — ${settlementSummary} processed by ${actor?.name || 'Staff'}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: {
          transactionId: saved.id,
          invoiceNumber,
          total,
          settlementType,
          paidAmount,
          chargedAmount,
          debtEntryId: createdDebtEntry?.id,
          dueDate,
        },
      }).catch(console.error);

      return { transaction: saved, debtEntry: createdDebtEntry, invoiceNumber };
    } finally {
      set({ isCheckingOut: false });
    }
  },

  refundTransaction: async (txId) => {
    const warnings: string[] = [];
    let tx = get().transactions.find(t => t.id === txId);
    let isPartsB2B = false;
    if (!tx) {
      const { usePartsCartStore } = await import('./partsCartStore');
      tx = usePartsCartStore.getState().invoices.find(t => t.id === txId);
      if (tx) isPartsB2B = true;
    }
    if (!tx || tx.status === 'refunded') return warnings;
    
    // 1. Authoritative stock reversal (Problem 4 fix):
    // Regular purchases -> return to stock (+qty)
    // Returned items from customer previously -> deduct from stock (-qty)
    try {
      foldStockDeltas(
        tx.items.map(item => ({
          productId: item.product?.id,
          delta: item.isReturn ? (item.restock !== false ? -item.quantity : 0) : item.quantity,
        }))
      ).forEach(({ productId, delta }) => {
        useInventoryStore.getState().adjustStockBy(productId, delta);
      });
    } catch (err) {
      console.error('Failed to restore stock on refund:', err);
    }

    const customerStore = useCustomerStore.getState();

    // 2. Void or remove linked customer debt if this transaction was put on debt (Problem 4 fix)
    // The invoice number is a clause of its own because the phone records it on both sides
    // and has no transaction id to offer a credit sale it wrote while off the network.
    const linkedDebt = customerStore.debts.find(d =>
      d.id === tx.accountSettlement?.debtEntryId ||
      d.transactionId === txId ||
      (tx.invoiceNumber && d.invoiceNumber === tx.invoiceNumber) ||
      (d.notes && d.notes.includes(txId))
    );
    if (linkedDebt) {
      // If customer had already paid part of this debt, convert collected amount to store credit so funds are not lost
      if (linkedDebt.amountPaid > 0 && tx.customerId) {
        await customerStore.addStoreCredit(
          tx.customerId,
          linkedDebt.amountPaid,
          `Refund of partial payment made on voided debt (Receipt #${tx.invoiceNumber || txId.slice(0, 8)})`
        ).catch(console.error);
      }
      await customerStore.settleDebt(
        linkedDebt.id,
        `Receipt #${tx.invoiceNumber || txId.slice(0, 8)} was refunded.`
      ).catch(debtErr => {
        // A refund that leaves the balance standing is not finished, and the till has
        // to hear that: it used to be a console line, so the customer kept owing for
        // goods he had already handed back.
        console.error('Refund closed the sale but not the credit record:', debtErr);
        warnings.push(
          `${tx.customerName || 'The customer'} still owes ${formatCurrency(linkedDebt.remainingBalance)}. ` +
          `Clear that credit record from the Customers tab.`
        );
      });
    }

    // 3. Restore store credit if customer spent store credit on this sale
    if (tx.exchangeSummary?.storeCreditUsed && tx.exchangeSummary.storeCreditUsed > 0 && tx.customerId) {
      await customerStore.addStoreCredit(
        tx.customerId,
        tx.exchangeSummary.storeCreditUsed,
        `Refund Restoration for Receipt #${tx.invoiceNumber || txId.slice(0, 8)}`
      ).catch(console.error);
    }

    // 4. Reverse surplus store credit if this was an exchange that granted store credit (avoir)
    if (tx.total < 0 && tx.exchangeSummary?.refundType === 'store_credit' && tx.customerId) {
      await customerStore.useStoreCredit(
        tx.customerId,
        Math.abs(tx.total),
        `Voided Exchange Surplus from Receipt #${tx.invoiceNumber || txId.slice(0, 8)}`
      ).catch(console.error);
    }

    // 5. Deduct from customer's totalSpent & totalPurchases
    // 6. Process refund in Firebase
    const refundedAt = await transactionService.refund(txId);

    // 5. Authoritative recalculation of customer financials on refund
    if (tx.customerId) {
      customerStore.recalculateCustomer(tx.customerId).catch(console.error);
    }

    if (isPartsB2B) {
      const { usePartsCartStore } = await import('./partsCartStore');
      usePartsCartStore.setState(state => ({
        invoices: state.invoices.map(t =>
          t.id === txId ? { ...t, status: 'refunded' as const, refundedAt } : t
        )
      }));
    } else {
      set(state => ({
        transactions: state.transactions.map(t =>
          t.id === txId ? { ...t, status: 'refunded' as const, refundedAt } : t
        )
      }));
    }

    // 7. Log the refund to the store-wide Activity Log
    const actor = useAuthStore.getState().user;
    activityLogService.log(
      'sales',
      `Refund processed for transaction #${txId} — ${formatCurrency(tx.total)}`,
      { entityId: txId, entityType: 'sale', userName: actor?.name, userId: actor?.id }
    ).catch(console.error);

    // 8. Customer audit timeline log
    if (tx.customerId) {
      const itemsDesc = tx.items
        .map(i => `${i.quantity}x ${i.product.name}`)
        .join(', ');
      customerLogService.log({
        customerId: tx.customerId,
        customerName: tx.customerName || 'Customer',
        actionType: 'item_return',
        actionTitle: `Full Refund — Receipt #${tx.invoiceNumber || txId.slice(0, 8)}`,
        actionDescription: `Full refund of ${formatCurrency(tx.total)} processed by ${actor?.name || 'Staff'}. Items: ${itemsDesc}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: { transactionId: txId, refundedTotal: tx.total, itemsDesc },
      }).catch(console.error);
    }

    return warnings;
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

    const stockPromises = deltas.map(({ productId, delta }) =>
      inventoryService.adjustStockAsync(productId, delta)
    );

    if (stockPromises.length > 0) {
      await Promise.all(stockPromises).catch(console.error);
      await useInventoryStore.getState().fetchProducts().catch(console.error);
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
    if (!tx.payments || tx.payments.length <= 1) {
      const method = tx.payments?.[0]?.method || 'cash';
      adjustedPayments = [{ method, amount: total }];
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
    const customerStore = useCustomerStore.getState();    const linkedDebt = customerStore.debts.find(d =>
      d.id === tx.accountSettlement?.debtEntryId ||
      d.transactionId === txId ||
      (tx.invoiceNumber && d.invoiceNumber === tx.invoiceNumber) ||
      (d.notes && d.notes.includes(txId))
    );
    if (linkedDebt) {
      const itemsSummary = newItems.map(lineNote).join(', ');
      // Money the customer already handed over is a fact; correcting the invoice
      // cannot un-pay it. What the account held before this edit and what it holds
      // after is the difference between the two over-collections, and the shop's
      // own rule for absorbed money — the one a void already uses — is to keep it
      // as Avoir rather than let `Math.max(0, …)` quietly eat it.
      const paid = linkedDebt.amountPaid || 0;
      const surplusShift = Math.max(0, paid - total) - Math.max(0, paid - (tx.total || 0));
      const creditHolder = tx.customerId || linkedDebt.customerId;
      const receipt = tx.invoiceNumber || txId.slice(0, 8);

      if (surplusShift > 0 && creditHolder) {
        await customerStore
          .addStoreCredit(
            creditHolder,
            surplusShift,
            `Over-collection on corrected Receipt #${receipt} held as Avoir`
          )
          .catch(console.error);
      } else if (surplusShift < 0 && creditHolder) {
        // The invoice came back up to what was already paid, so the Avoir written
        // by the earlier correction is money the shop has now handed over twice.
        await customerStore
          .useStoreCredit(
            creditHolder,
            Math.abs(surplusShift),
            `Avoir released by corrected Receipt #${receipt}`
          )
          .catch(console.error);
      }

      // What the account owes is what the corrected tender lines declare as `debt`.
      // A parts invoice carries no such line — its charge lives in `accountSettlement`
      // alone — so silence in the payments is not evidence that a standing balance was
      // paid; there the account's own paid figure decides, as it does on the phone.
      const accountLines = adjustedPayments.filter(p => p.method === 'debt');
      const newCharged = accountLines.length > 0
        ? Math.round(accountLines.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) * 100) / 100
        : Math.max(0, total - (linkedDebt.amountPaid || 0));
      customerStore.updateDebtAmount(linkedDebt.id, total, itemsSummary, newCharged).catch(console.error);

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

    await transactionService.updateTransaction(txId, updates);

    // If this transaction has an attached customer, recalculate stats authoritatively
    if (tx.customerId) {
      useCustomerStore.getState().recalculateCustomer(tx.customerId).catch(console.error);
    }

    if (isPartsB2B) {
      const { usePartsCartStore } = await import('./partsCartStore');
      usePartsCartStore.setState(state => ({
        invoices: state.invoices.map(t =>
          t.id === txId ? { ...t, ...updates } : t
        )
      }));
    } else {
      set(state => ({
        transactions: state.transactions.map(t =>
          t.id === txId ? { ...t, ...updates } : t
        )
      }));
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
