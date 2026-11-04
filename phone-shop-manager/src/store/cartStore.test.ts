/**
 * The till's basket discount, as one rule.
 *
 * A discount is a promise — either a share of the sale or a number of dinars — and
 * the shop has been burned by both readings of it: a repairer's 10% taken as ten
 * dinars, and a percentage frozen into dinars the moment it was set so the rest of
 * it vanished when another box joined the counter. These tests pin the promise to
 * the basket it was made against, and pin what reaches the invoice: whole dinars,
 * because the printer re-expands a percentage without rounding while the total is
 * rounded, and then a receipt prints lines that do not add up to its own total.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PhoneModel } from '../types';

const captured = vi.hoisted(() => ({
  transactions: [] as Record<string, unknown>[],
}));

vi.mock('../services/transactionService', () => ({
  transactionService: {
    save: async (tx: Record<string, unknown>) => {
      captured.transactions.push(tx);
      return { ...tx, id: `tx_${captured.transactions.length}` };
    },
    updateTransaction: async (_id: string, updates: Record<string, unknown>) => {
      Object.assign(captured.transactions[captured.transactions.length - 1] ?? {}, updates);
      return true;
    },
    getRetailTransactions: async () => [],
    refund: async () => undefined,
  },
}));

vi.mock('../services/cartService', () => ({
  cartService: {
    saveActiveCart: async () => undefined,
    clearActiveCart: async () => undefined,
    saveSuspendedCart: async () => undefined,
    deleteSuspendedCart: async () => undefined,
    getAllSuspendedCarts: async () => [],
  },
}));

vi.mock('../services/inventoryService', () => ({
  inventoryService: {
    adjustStockAsync: async () => undefined,
  },
}));

vi.mock('../services/activityLogService', () => ({
  activityLogService: { log: async () => undefined },
}));

vi.mock('../services/customerLogService', () => ({
  customerLogService: { log: async () => undefined },
}));

vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u1', name: 'Counter', role: 'admin' } }) },
}));

vi.mock('./customerStore', () => ({
  useCustomerStore: {
    getState: () => ({
      customers: [],
      debts: [],
      recalculateCustomer: async () => undefined,
      addDebt: async () => ({ id: 'debt_1' }),
      getCustomerDebtTotal: () => 0,
    }),
  },
}));

// A price that does not divide by ten, so a percentage that has to be rounded shows
// up as the dinar it would have been printed wrong.
const phone: PhoneModel = {
  id: 'sku_phone',
  name: 'Samsung A55',
  model: '128GB',
  category: 'smartphone',
  price: 10005,
  costPrice: 8000,
  stock: 6,
} as unknown as PhoneModel;

const cable: PhoneModel = {
  id: 'sku_cable',
  name: 'Type-C cable',
  model: '1m',
  category: 'accessory',
  price: 300,
  costPrice: 150,
  stock: 40,
} as unknown as PhoneModel;

const shelf = { items: [phone, cable] };

vi.mock('./inventoryStore', () => ({
  useInventoryStore: {
    getState: () => ({
      products: shelf.items,
      parts: shelf.items,
      fetchProducts: async () => undefined,
      adjustStockBy: () => undefined,
    }),
  },
}));

const { useCartStore } = await import('./cartStore');

const emptyCart = () =>
  useCartStore.setState({
    items: [],
    discount: null,
    customerName: '',
    customerPhone: '',
    payments: [{ method: 'cash', amount: 0 }],
    isCheckingOut: false,
  });

beforeEach(() => {
  // The store mirrors the live cart to localStorage on every change.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  captured.transactions.length = 0;
  emptyCart();
  (phone as { price: number }).price = 10005;
});

const add = (product: PhoneModel, quantity = 1) => {
  useCartStore.getState().addToCart(product);
  if (quantity > 1) useCartStore.getState().updateQuantity(product.id, quantity);
};

describe('a percentage promised to the basket', () => {
  it('follows the basket instead of freezing where it was set', () => {
    add(phone);
    useCartStore.getState().setDiscount({ type: 'percent', value: 10 });
    expect(useCartStore.getState().getDiscountAmount()).toBe(1001);

    // Another box on the counter: the promise was 10% of the sale, not 10% of the
    // sale as it looked the second the customer was attached.
    add(cable);
    expect(useCartStore.getState().getDiscountAmount()).toBe(1031);
    expect(useCartStore.getState().getTotal()).toBe(9274);
  });

  it('is a share, so it cannot eat the sale it was taken from', () => {
    add(cable);
    useCartStore.getState().setDiscount({ type: 'percent', value: 400 });
    expect(useCartStore.getState().getDiscountAmount()).toBe(300);
    expect(useCartStore.getState().getTotal()).toBe(0);

    useCartStore.getState().setDiscount({ type: 'flat', value: 99999 });
    expect(useCartStore.getState().getDiscountAmount()).toBe(300);
  });

  it('counts the money given on what was bought, not on the net of a return', () => {
    add(phone);
    useCartStore.getState().addReturnItem(cable, { quantity: 1 });
    useCartStore.getState().setDiscount({ type: 'percent', value: 10 });

    // The exchange takes 300 back off what the customer pays; it must not also
    // shrink the 10% he was promised on the phone he took.
    expect(useCartStore.getState().getDiscountAmount()).toBe(1001);
    expect(useCartStore.getState().getTotal()).toBe(8704);
  });
});

describe('the sale as it is written down', () => {
  it('leaves the invoice holding whole dinars, so its lines foot its total', async () => {
    add(phone);
    useCartStore.getState().setDiscount({ type: 'percent', value: 10 });
    await useCartStore.getState().checkout();

    const tx = captured.transactions[0] as {
      subtotal: number;
      total: number;
      discount?: { type: 'percent' | 'flat'; value: number };
    };
    // A percentage left on the document is re-expanded by the printer without
    // rounding while the total is rounded: the receipt would print its own lines
    // one dinar off its own total.
    expect(tx.discount).toEqual({ type: 'flat', value: 1001 });
    expect(tx.subtotal).toBe(10005);
    expect(tx.total).toBe(tx.subtotal - 1001);
  });

  it('leaves no discount field behind when nothing was given', async () => {
    add(cable);
    await useCartStore.getState().checkout();

    const tx = captured.transactions[0] as { discount?: unknown; subtotal: number; total: number };
    expect(tx.discount).toBeUndefined();
    expect(tx.total).toBe(tx.subtotal);
  });

  it('gives the cart a clean slate, promise and all', async () => {
    add(phone);
    useCartStore.getState().setDiscount({ type: 'percent', value: 10 });
    await useCartStore.getState().checkout();

    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().discount).toBeNull();
  });
});
