import { create } from 'zustand';
import type {
  CartItem,
  PaymentMethod,
  PhoneModel,
  SaleTransaction,
  SuspendedCart,
  B2BCheckoutOptions,
  CustomerDebtEntry,
  Customer,
} from '../types';
import { useInventoryStore } from './inventoryStore';
import { useAuthStore } from './authStore';
import { useCustomerStore } from './customerStore';

import { transactionService } from '../services/transactionService';
import { activityLogService } from '../services/activityLogService';
import { customerLogService } from '../services/customerLogService';
import { partsCartService } from '../services/partsCartService';
import { formatCurrency } from '../utils/formatCurrency';
import { discountAmountOf, lineDiscountOf, unitPriceAfterDiscount } from '../utils/discountPolicy';

const getInventoryProducts = () => {
  const { parts } = useInventoryStore.getState();
  return parts;
};

/**
 * The line as the document stores it. Every renderer — the till's ESC-POS server,
 * its browser receipt, the parts invoice, the reports — prices a line from the
 * product carried inside that line, so a concession is folded into that price
 * rather than left beside it, or the printed lines stop summing to the printed
 * total. The copy is the point: a cart line's `product` is the live inventory
 * object, and writing through it would reprice the shelf itself.
 */
const foldLineConcessions = (items: CartItem[]): CartItem[] =>
  items.map(item => {
    const charged = item.unitPrice ?? item.product.price;
    return {
      ...item,
      product: { ...item.product, price: charged },
      unitPrice: charged,
      totalPrice: Math.round(charged * item.quantity * 100) / 100,
    };
  });

const STORAGE_KEY_PARTS_ACTIVE = 'parts_active_cart';
const STORAGE_KEY_PARTS_SUSPENDED = 'parts_suspended_carts';

/**
 * What the basket discount is, kept as it was promised: a trade percentage stays a
 * percentage so it follows the basket as lines come and go, instead of freezing at
 * whatever the basket was worth the moment it was set.
 */
export interface PartsBasketDiscount {
  type: 'percent' | 'flat';
  value: number;
}

/** A cart saved by an earlier build holds a bare number of dinars; read it as flat. */
const readBasketDiscount = (raw: unknown): PartsBasketDiscount | null => {
  if (raw && typeof raw === 'object') {
    const { type, value } = raw as Partial<PartsBasketDiscount>;
    const num = Number(value);
    return Number.isFinite(num) && num > 0
      ? { type: type === 'percent' ? 'percent' : 'flat', value: num }
      : null;
  }
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? { type: 'flat', value: num } : null;
};

/**
 * What a held cart's stored promise is worth against a given basket, so a card
 * written before percentages were held as promises can no longer read a promised
 * 10% as ten dinars. Lines are priced as the cart carries them, because a part
 * given away at the counter is already cheaper than the shelf says.
 */
export const heldBasketDiscountOf = (items: CartItem[], raw: unknown): number => {
  const subtotal = items.reduce((sum, item) => sum + (item.unitPrice ?? item.product.price) * item.quantity, 0);
  const disc = readBasketDiscount(raw);
  return disc ? discountAmountOf(subtotal, { mode: disc.type, value: disc.value }) : 0;
};

interface LocalPartsActiveState {
  items: CartItem[];
  customerName: string;
  customerPhone: string;
  discount: PartsBasketDiscount | null;
}

const loadLocalActiveCart = (): LocalPartsActiveState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PARTS_ACTIVE);
    if (!raw) return { items: [], customerName: '', customerPhone: '', discount: null };
    const parsed = JSON.parse(raw);

    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
      customerPhone: typeof parsed.customerPhone === 'string' ? parsed.customerPhone : '',
      discount: readBasketDiscount(parsed.discount),
    };
  } catch {
    return { items: [], customerName: '', customerPhone: '', discount: null };
  }
};

const loadLocalSuspendedCarts = (): SuspendedCart[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PARTS_SUSPENDED);
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
  discount: PartsBasketDiscount | null
) => {
  try {
    if (items.length === 0 && !customerName && !customerPhone && !discount) {
      localStorage.removeItem(STORAGE_KEY_PARTS_ACTIVE);
    } else {
      localStorage.setItem(
        STORAGE_KEY_PARTS_ACTIVE,
        JSON.stringify({ items, customerName, customerPhone, discount })
      );
    }
  } catch (e) {
    console.error('Failed to save parts active cart to localStorage', e);
  }
};

const saveLocalSuspendedCarts = (carts: SuspendedCart[]) => {
  try {
    if (carts.length === 0) {
      localStorage.removeItem(STORAGE_KEY_PARTS_SUSPENDED);
    } else {
      localStorage.setItem(STORAGE_KEY_PARTS_SUSPENDED, JSON.stringify(carts));
    }
  } catch (e) {
    console.error('Failed to save parts suspended carts to localStorage', e);
  }
};

export interface PartsCartState {
  items: CartItem[];
  payments: { method: PaymentMethod; amount: number }[];
  customerName: string;
  customerPhone: string;
  selectedCustomer: Customer | null;
  discount: PartsBasketDiscount | null;
  suspendedCarts: SuspendedCart[];
  invoices: SaleTransaction[];

  // Actions
  fetchInvoices: () => Promise<void>;
  addToCart: (product: PhoneModel) => { success: boolean; reason?: 'out_of_stock' | 'max_reached'; availableStock?: number };
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => { success: boolean; reason?: 'max_reached'; availableStock?: number };
  clearCart: () => void;
  setPayments: (payments: { method: PaymentMethod; amount: number }[]) => void;
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  setSelectedCustomer: (customer: Customer | null) => void;
  setDiscount: (discount: PartsBasketDiscount | null) => void;
  /**
   * Take `amount` dinars off one line of the cart. The concession lands on that
   * line's own unit price, so a cashier who types a lower price instead is judged
   * by the same rule — there is no side door around the threshold.
   */
  setLineDiscount: (productId: string, amount: number) => void;

  // Suspend Cart Actions
  suspendCart: () => void;
  resumeCart: (id: string) => { success: boolean; warnings?: string[] };
  discardSuspendedCart: (id: string) => void;
  fetchCarts: () => Promise<void>;
  isCheckingOut: boolean;

  // Checkouts
  checkout: () => Promise<SaleTransaction | null>;
  checkoutB2B: (options: B2BCheckoutOptions) => Promise<{ transaction: SaleTransaction; debtEntry?: CustomerDebtEntry; invoiceNumber: string } | null>;

  // Derived Helpers
  getSubtotal: () => number;
  getDiscountAmount: () => number;
  getTotal: () => number;
  getItemCount: () => number;
  /** What each line gives away against the shelf price it was added at. */
  getLineConcessions: () => PartsLineConcession[];
  getLinesConcessionTotal: () => number;
}

/** One discounted line: the dinars it carries off, and how deep that is as a share. */
export interface PartsLineConcession {
  productId: string;
  name: string;
  granted: number;
  percent: number;
}

const initialActive = loadLocalActiveCart();
const initialSuspended = loadLocalSuspendedCarts();

export const usePartsCartStore = create<PartsCartState>((set, get) => ({
  items: initialActive.items,
  payments: [{ method: 'cash', amount: 0 }],
  customerName: initialActive.customerName,
  customerPhone: initialActive.customerPhone,
  selectedCustomer: null,
  discount: initialActive.discount,
  suspendedCarts: initialSuspended,
  invoices: [],
  isCheckingOut: false,

  fetchInvoices: async () => {
    try {
      // Server-side query: strictly requests repair parts B2B invoices/sales only
      const invoices = await transactionService.getPartsTransactions();
      set({ invoices });
    } catch (err) {
      console.error('Failed to fetch parts invoices from server:', err);
    }
  },

  fetchCarts: async () => {
    try {
      // Problem 7 fix: Suspended carts are synced across terminals, while active draft carts remain strictly local
      const suspended = await partsCartService.getAllSuspendedCarts();
      const currentSuspended = get().suspendedCarts;
      const finalSuspended = suspended && suspended.length > 0 ? suspended : currentSuspended;

      set(state => ({
        ...state,
        suspendedCarts: finalSuspended,
      }));
    } catch (err) {
      console.error('Failed to fetch parts carts', err);
    }
  },

  addToCart: (product) => {
    const invProduct = getInventoryProducts().find(p => p.id === product.id) || product;
    const state = get();
    const existing = state.items.find(item => item.product.id === product.id);
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
        item.product.id === product.id
          // One more unit on a line that carries a concession changes what that
          // concession is worth per unit, so the line goes back to its shelf price.
          ? { ...item, quantity: item.quantity + 1, unitPrice: undefined }
          : item
      );
    } else {
      updatedItems = [...state.items, { product: invProduct, quantity: 1 }];
    }

    set({ items: updatedItems });
    saveLocalActiveCart(updatedItems, state.customerName, state.customerPhone, state.discount);
    return { success: true, availableStock: invProduct.stock };
  },

  removeFromCart: (productId) => {
    set(state => {
      const updated = state.items.filter(i => i.product.id !== productId);
      saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
      return { items: updated };
    });
  },

  updateQuantity: (productId, quantity) => {
    const state = get();
    const existing = state.items.find(i => i.product.id === productId);
    if (!existing) return { success: false };

    if (quantity <= 0) {
      const updated = state.items.filter(i => i.product.id !== productId);
      set({ items: updated });
      saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
      return { success: true };
    }

    const invProduct = getInventoryProducts().find(p => p.id === productId) || existing.product;
    if (quantity > invProduct.stock) {
      return { success: false, reason: 'max_reached', availableStock: invProduct.stock };
    }

    const updated = state.items.map(i =>
      i.product.id === productId ? { ...i, quantity, unitPrice: undefined } : i
    );
    set({ items: updated });
    saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
    return { success: true };
  },

  clearCart: () => {
    set({
      items: [],
      customerName: '',
      customerPhone: '',
      selectedCustomer: null,
      discount: null,
      payments: [{ method: 'cash', amount: 0 }],
    });
    saveLocalActiveCart([], '', '', null);
  },

  setPayments: (payments) => set({ payments }),
  
  setCustomerName: (customerName) => {
    const state = get();
    set({ customerName });
    saveLocalActiveCart(state.items, customerName, state.customerPhone, state.discount);
  },

  setCustomerPhone: (customerPhone) => {
    const state = get();
    set({ customerPhone });
    saveLocalActiveCart(state.items, state.customerName, customerPhone, state.discount);
  },

  setSelectedCustomer: (selectedCustomer) => {
    const state = get();
    const customerName = selectedCustomer ? (selectedCustomer.shopName || selectedCustomer.name) : state.customerName;
    const customerPhone = selectedCustomer ? selectedCustomer.phone : state.customerPhone;
    set({ selectedCustomer, customerName, customerPhone });
    saveLocalActiveCart(state.items, customerName, customerPhone, state.discount);
  },

  setDiscount: (discountInput) => {
    const value = Number(discountInput?.value);
    // A percentage is kept as a percentage. Converting it to dinars here froze the
    // trade promise at whatever the basket was worth that second, so a repairer
    // owed 10% quietly lost the rest of it as soon as another part was added.
    const discount = discountInput && Number.isFinite(value) && value > 0
      ? { type: discountInput.type, value }
      : null;
    const state = get();
    set({ discount });
    saveLocalActiveCart(state.items, state.customerName, state.customerPhone, discount);
  },

  setLineDiscount: (productId, amount) => {
    const state = get();
    const updated = state.items.map(item => {
      if (item.product.id !== productId) return item;
      const charged = unitPriceAfterDiscount(item.product.price, amount, item.quantity);
      return charged < item.product.price ? { ...item, unitPrice: charged } : { ...item, unitPrice: undefined };
    });
    set({ items: updated });
    saveLocalActiveCart(updated, state.customerName, state.customerPhone, state.discount);
  },

  suspendCart: () => {
    const { items, customerName, discount } = get();
    if (items.length === 0) return;

    const newCart: SuspendedCart = {
      id: `parts_cart_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      items: [...items],
      customerName: customerName || '',
      discount: discount ?? null,
      date: new Date().toISOString(),
    };

    const updatedSuspended = [newCart, ...get().suspendedCarts];
    set({
      suspendedCarts: updatedSuspended,
      items: [],
      customerName: '',
      customerPhone: '',
      selectedCustomer: null,
      discount: null,
      payments: [{ method: 'cash', amount: 0 }],
    });

    saveLocalSuspendedCarts(updatedSuspended);
    saveLocalActiveCart([], '', '', null);
    partsCartService.saveSuspendedCart(newCart).catch(console.error);
  },

  resumeCart: (id) => {
    const state = get();
    const target = state.suspendedCarts.find(c => c.id === id);
    if (!target) return { success: false, warnings: ['Cart not found'] };

    let updatedSuspended = state.suspendedCarts.filter(c => c.id !== id);

    // If active cart has items, safely place it on hold instead of losing it
    if (state.items.length > 0) {
      const activeAsSuspended: SuspendedCart = {
        id: `parts_cart_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        items: [...state.items],
        customerName: state.customerName || '',
        discount: state.discount ?? null,
        date: new Date().toISOString(),
      };
      updatedSuspended = [activeAsSuspended, ...updatedSuspended];
      partsCartService.saveSuspendedCart(activeAsSuspended).catch(console.error);
    }

    // Problem 6 fix: Revalidate live inventory stock on resume
    const inventoryParts = getInventoryProducts();
    const warnings: string[] = [];
    const validatedItems: CartItem[] = [];

    target.items.forEach(item => {
      const livePart = inventoryParts.find(p => p.id === item.product.id);
      if (!livePart || livePart.stock <= 0) {
        warnings.push(`"${item.product.name} ${item.product.model}" was removed because it is now OUT OF STOCK.`);
      } else if (livePart.stock < item.quantity) {
        warnings.push(`"${item.product.name} ${item.product.model}" quantity was reduced from ${item.quantity} to ${livePart.stock} (current stock).`);
        validatedItems.push({
          ...item,
          quantity: livePart.stock,
          product: livePart,
        });
      } else {
        validatedItems.push({
          ...item,
          product: livePart,
        });
      }
    });

    // A cart held overnight by an older build carries its discount as bare dinars;
    // read that as a flat promise and keep a percentage as the percentage it was
    // promised in, so resuming does not quietly shrink the trade discount.
    const disc = readBasketDiscount(target.discount);
    set({
      suspendedCarts: updatedSuspended,
      items: validatedItems,
      customerName: target.customerName || '',
      discount: disc,
      payments: [{ method: 'cash', amount: 0 }],
    });

    saveLocalSuspendedCarts(updatedSuspended);
    saveLocalActiveCart(validatedItems, target.customerName || '', '', disc);
    partsCartService.deleteSuspendedCart(id).catch(console.error);

    return { success: true, warnings };
  },

  discardSuspendedCart: (id) => {
    const updated = get().suspendedCarts.filter(c => c.id !== id);
    set({ suspendedCarts: updated });
    saveLocalSuspendedCarts(updated);
    partsCartService.deleteSuspendedCart(id).catch(console.error);
  },

  // Random / Walk-in parts checkout
  checkout: async () => {
    if (get().isCheckingOut) return null;
    const { items, payments, customerName } = get();
    if (items.length === 0) return null;

    set({ isCheckingOut: true });
    const itemsSnapshot = foldLineConcessions(items);

    try {
      const subtotal = get().getSubtotal();
      const total = get().getTotal();
      const discount = get().getDiscountAmount();
      const actor = useAuthStore.getState().user;
      const now = new Date().toISOString();
      const invoiceNumber = `INV-PARTS-${Date.now().toString().slice(-6)}`;

      // Resolve matched or selected customer
      const customerStore = useCustomerStore.getState();
      let matchedCust = get().selectedCustomer;
      if (!matchedCust && customerName && customerName.trim()) {
        const q = customerName.toLowerCase().trim();
        matchedCust = customerStore.customers.find(c =>
          c.name.toLowerCase().trim() === q ||
          (c.shopName && c.shopName.toLowerCase().trim() === q)
        ) || null;
      }

      const txData: Omit<SaleTransaction, 'id'> = {
        date: now,
        items: itemsSnapshot,
        subtotal,
        discount: discount > 0 ? { type: 'flat', value: discount } : undefined,
        total,
        payments: payments.map(p => ({ ...p, amount: p.amount || total })),
        customerName: customerName || undefined,
        customerId: matchedCust?.id,
        shopName: matchedCust?.shopName,
        saleType: 'parts_b2b',
        invoiceNumber,
        status: 'completed',
        processedById: actor?.id,
        processedByName: actor?.name,
      };

      const saved = await transactionService.save(txData);

      // Authoritative update of customer statistics
      if (matchedCust) {
        customerStore.recalculateCustomer(matchedCust.id).catch(console.error);
      }

      // Immediate stock deduction in Inventory
      try {
        itemsSnapshot.forEach(item => {
          useInventoryStore.getState().adjustStockBy(item.product.id, -item.quantity);
        });
      } catch (err) {
        console.error('Failed to deduct parts stock:', err);
      }

      // Keep parts invoices isolated in partsCartStore
      set(s => ({
        invoices: [saved, ...s.invoices],
      }));

      // Reset parts active cart
      set({
        items: [],
        customerName: '',
        customerPhone: '',
        selectedCustomer: null,
        discount: null,
        payments: [{ method: 'cash', amount: 0 }],
      });

      saveLocalActiveCart([], '', '', null);

      // Audit logs
      const itemsDesc = itemsSnapshot.map(i => `${i.quantity}x ${i.product.name} ${i.product.model}`).join(', ');
      activityLogService.log(
        'sales',
        `Parts Walk-in Sale completed — ${formatCurrency(total)}${customerName ? ` (${customerName})` : ''}`,
        { detail: itemsDesc, entityId: saved.id, userName: actor?.name, userId: actor?.id }
      ).catch(console.error);

      return saved;
    } finally {
      set({ isCheckingOut: false });
    }
  },

  // B2B Commercial Phone Shop / Repairer checkout
  checkoutB2B: async (options: B2BCheckoutOptions) => {
    if (get().isCheckingOut) return null;
    const { items } = get();
    if (items.length === 0) return null;

    set({ isCheckingOut: true });
    const itemsSnapshot = foldLineConcessions(items);

    try {
      const subtotal = get().getSubtotal();
      const total = get().getTotal();
      const discount = get().getDiscountAmount();
      const actor = useAuthStore.getState().user;
      const now = new Date().toISOString();
      const invoiceNumber = `INV-PARTS-${Date.now().toString().slice(-6)}`;

      const { customer, settlementType, paidAmount, paymentMethod, chargedAmount, dueDate, notes, allowCreditLimitOverride } = options;

      const txPayments = paidAmount > 0
        ? [{ method: paymentMethod, amount: paidAmount }]
        : [];

      let createdDebtEntry: CustomerDebtEntry | undefined;

      // 1. If chargedAmount > 0, post to Customer Debt Ledger (Problem 1 fix)
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
            allowCreditLimitOverride,
          });
        } catch (err) {
          console.error('Failed to add debt for B2B checkout:', err);
          throw err; // Problem 1 fix: Do not swallow debt failure, halt checkout before saving tx or deducting stock
        }
      }

      // 2. Build and save SaleTransaction
      const txData: Omit<SaleTransaction, 'id'> = {
        date: now,
        items: itemsSnapshot,
        subtotal,
        discount: discount > 0 ? { type: 'flat', value: discount } : undefined,
        total,
        payments: txPayments,
        customerName: customer.name,
        customerId: customer.id,
        shopName: customer.shopName || customer.name,
        saleType: 'parts_b2b',
        invoiceNumber,
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

      // 4. Immediate Authoritative Stock Deduction in Inventory
      try {
        itemsSnapshot.forEach(item => {
          useInventoryStore.getState().adjustStockBy(item.product.id, -item.quantity);
        });
      } catch (err) {
        console.error('Failed to deduct parts stock:', err);
      }

      // 5. Keep parts invoices isolated in partsCartStore
      set(s => ({
        invoices: [saved, ...s.invoices],
      }));

      // 6. Reset parts active cart
      set({
        items: [],
        customerName: '',
        customerPhone: '',
        selectedCustomer: null,
        discount: null,
        payments: [{ method: 'cash', amount: 0 }],
      });

      saveLocalActiveCart([], '', '', null);

      // 7. Double Audit Logging
      const itemsSummary = itemsSnapshot.map(i => `${i.quantity}x ${i.product.name} ${i.product.model}`).join(', ');
      const settlementLabel =
        settlementType === 'paid_full'
          ? `Paid full (${formatCurrency(paidAmount)} ${paymentMethod.toUpperCase()})`
          : settlementType === 'charged_to_account'
          ? `Charged 100% to Account (${formatCurrency(chargedAmount)})`
          : `Partial: Paid ${formatCurrency(paidAmount)} ${paymentMethod.toUpperCase()}, Charged ${formatCurrency(chargedAmount)} to Account`;

      activityLogService.log(
        'sales',
        `B2B Parts Invoice #${invoiceNumber} completed for ${customer.shopName || customer.name} — Total ${formatCurrency(total)} (${settlementLabel})`,
        {
          detail: itemsSummary,
          entityId: saved.id,
          userName: actor?.name,
          userId: actor?.id,
        }
      ).catch(console.error);

      customerLogService.log({
        customerId: customer.id,
        customerName: customer.name,
        actionType: 'b2b_parts_sale',
        actionTitle: `B2B Parts Order #${invoiceNumber} (${itemsSnapshot.length} parts)`,
        actionDescription: `Dispatched ${itemsSnapshot.length} repair parts to ${customer.shopName || customer.name} for ${formatCurrency(total)}. Settlement: ${settlementLabel}. Processed by ${actor?.name || 'Staff'}.`,
        actorId: actor?.id,
        actorName: actor?.name || 'Staff',
        actorRole: actor?.role,
        metadata: {
          invoiceNumber,
          transactionId: saved.id,
          debtEntryId: createdDebtEntry?.id,
          total,
          paidAmount,
          chargedAmount,
          settlementType,
          itemsSummary,
        },
      }).catch(console.error);

      return { transaction: saved, debtEntry: createdDebtEntry, invoiceNumber };
    } finally {
      set({ isCheckingOut: false });
    }
  },

  // Derived calculations
  getSubtotal: () => {
    // A line's own unit price wins once a concession is on it; otherwise the shelf
    // price it was added at.
    return get().items.reduce((sum, item) => sum + ((item.unitPrice ?? item.product.price) * item.quantity), 0);
  },

  getLineConcessions: () =>
    get()
      .items.map(item => {
        const charged = item.unitPrice ?? item.product.price;
        return {
          productId: item.product.id,
          name: `${item.product.name} ${item.product.model || ''}`.trim(),
          ...lineDiscountOf(item.product.price, charged, item.quantity),
        };
      })
      .filter(line => line.granted > 0),

  getLinesConcessionTotal: () =>
    get().getLineConcessions().reduce((sum, line) => sum + line.granted, 0),

  getDiscountAmount: () => {
    const disc = get().discount;
    if (!disc) return 0;
    return discountAmountOf(get().getSubtotal(), { mode: disc.type, value: disc.value });
  },

  getTotal: () => {
    const sub = get().getSubtotal();
    const disc = get().getDiscountAmount();
    return Math.max(0, sub - disc);
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
