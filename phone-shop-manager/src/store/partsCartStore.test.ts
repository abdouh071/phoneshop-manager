/**
 * A part discounted at the counter.
 *
 * The parts till gives a discount on the whole basket, which is honest for a shop
 * that buys fifty cables at once but useless for the one screen a repairer argues
 * down. These tests pin what a single discounted line does to the money the till
 * keeps, and one rule above all: the concession belongs to the line, never to the
 * product on the shelf. A cart line's `product` is the live inventory object, so a
 * discount that wrote through it would quietly reprice the shop's stock — and the
 * receipt would be the only place the old price survived.
 *
 * The checkout-ordering tests at the bottom pin a second rule: the shelf moves
 * before the invoice exists, and a stock write that cannot be made durable aborts
 * the checkout before anything is billed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Customer, PhoneModel } from '../types';

const captured = vi.hoisted(() => ({
  transactions: [] as Record<string, unknown>[],
  stockMoves: [] as { productId: string; delta: number }[],
  /** The order of the awaited writes a checkout performs. */
  order: [] as string[],
  failStock: false,
  /** What the till is handed when it asks for a reference. Real Firestore is not involved. */
  counter: { invoiceNumber: 'INV-PARTS-261104-0003', provisional: false } as {
    invoiceNumber: string;
    provisional: boolean;
  },
}));

vi.mock('../services/invoiceCounter', () => ({
  claimInvoiceNumber: async () => ({ ...captured.counter }),
}));

vi.mock('../services/transactionService', () => ({
  transactionService: {
    save: async (tx: Record<string, unknown>) => {
      captured.order.push('save');
      captured.transactions.push(tx);
      return { ...tx, id: `tx_${captured.transactions.length}` };
    },
    getPartsTransactions: async () => [],
  },
}));

vi.mock('../services/partsCartService', () => ({
  partsCartService: {
    saveSuspendedCart: async () => undefined,
    deleteSuspendedCart: async () => undefined,
    getAllSuspendedCarts: async () => [],
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
      recalculateCustomer: async () => undefined,
      addDebt: async () => {
        captured.order.push('debt');
        return { id: 'debt_1' };
      },
    }),
  },
}));

vi.mock('./settingsStore', () => ({
  useSettingsStore: { getState: () => ({ currency: 'DZD', storeName: 'Shop' }) },
}));

vi.mock('./privacyStore', () => ({
  usePrivacyStore: { getState: () => ({ isPrivacyActive: false }) },
}));

const shelf: PhoneModel = {
  id: 'part_cable',
  name: 'Type-C cable',
  model: '1m',
  category: 'accessory',
  price: 300,
  costPrice: 150,
  stock: 40,
} as unknown as PhoneModel;

const screen: PhoneModel = {
  id: 'part_screen',
  name: 'Screen',
  model: 'A55',
  category: 'repair_part',
  price: 9000,
  costPrice: 6000,
  stock: 4,
} as unknown as PhoneModel;

vi.mock('./inventoryStore', () => ({
  useInventoryStore: {
    getState: () => ({
      parts: [shelf, screen],
      products: [shelf, screen],
      adjustStockBy: (productId: string, delta: number) => {
        captured.stockMoves.push({ productId, delta });
      },
      adjustStockByAsync: async (productId: string, delta: number) => {
        captured.order.push(`stock:${productId}:${delta}`);
        captured.stockMoves.push({ productId, delta });
        if (captured.failStock) throw new Error('stock write failed');
        return { id: productId, stock: 10 } as PhoneModel;
      },
    }),
  },
}));

const { heldBasketDiscountOf, usePartsCartStore } = await import('./partsCartStore');
const { lineDiscountOf } = await import('../utils/discountPolicy');

const emptyCart = () =>
  usePartsCartStore.setState({
    items: [],
    discount: null,
    customerName: '',
    customerPhone: '',
    selectedCustomer: null,
    payments: [{ method: 'cash', amount: 0 }],
  });

beforeEach(() => {
  // The store mirrors the live cart to localStorage on every change.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  captured.transactions.length = 0;
  captured.stockMoves.length = 0;
  captured.order.length = 0;
  captured.failStock = false;
  captured.counter = { invoiceNumber: 'INV-PARTS-261104-0003', provisional: false };
  emptyCart();
  (shelf as { price: number }).price = 300;
  (screen as { price: number }).price = 9000;
});

const cable = (quantity = 1) => {
  usePartsCartStore.getState().addToCart(shelf);
  if (quantity > 1) usePartsCartStore.getState().updateQuantity(shelf.id, quantity);
};

describe('a single part line discounted at the counter', () => {
  it('carries the concession on its own line and counts it in the basket', () => {
    cable(3);
    // 300 DA off a three-unit line at 300 each is 100 off every unit.
    usePartsCartStore.getState().setLineDiscount(shelf.id, 300);

    expect(usePartsCartStore.getState().items[0].unitPrice).toBe(200);
    expect(usePartsCartStore.getState().getSubtotal()).toBe(600);

    // A second number typed over the first replaces it, it does not stack.
    usePartsCartStore.getState().setLineDiscount(shelf.id, 150);
    expect(usePartsCartStore.getState().items[0].unitPrice).toBe(250);
    expect(usePartsCartStore.getState().getSubtotal()).toBe(750);
  });

  it('reads a cleared box as no discount, not as the last one left behind', () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 0);

    expect(usePartsCartStore.getState().items[0].unitPrice).toBeUndefined();
    expect(usePartsCartStore.getState().getSubtotal()).toBe(600);
  });

  it('leaves the shelf price where the shelf can still read it', () => {
    cable();
    usePartsCartStore.getState().setLineDiscount(shelf.id, 300);

    // The cart line and the inventory record are the same object until the sale is
    // written; a discount must not travel back along that reference.
    expect(shelf.price).toBe(300);
    expect(usePartsCartStore.getState().items[0].product.price).toBe(300);
  });

  it('reports the dinars and the share the gate judges a line by', () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);

    const [concession] = usePartsCartStore.getState().getLineConcessions();
    expect(concession.granted).toBe(100);
    expect(concession.percent).toBeCloseTo(lineDiscountOf(300, 250, 2).percent, 10);
    expect(usePartsCartStore.getState().getLinesConcessionTotal()).toBe(100);
  });

  it('gives the concession back when the line changes size', () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    usePartsCartStore.getState().updateQuantity(shelf.id, 4);

    expect(usePartsCartStore.getState().items[0].unitPrice).toBeUndefined();
    expect(usePartsCartStore.getState().getSubtotal()).toBe(1200);
    expect(usePartsCartStore.getState().getLinesConcessionTotal()).toBe(0);
  });

  it('cannot take a line below nothing', () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 99999);

    expect(usePartsCartStore.getState().items[0].unitPrice).toBe(0);
    expect(usePartsCartStore.getState().getSubtotal()).toBe(0);
    expect(usePartsCartStore.getState().getTotal()).toBe(0);
  });
});

describe('the sale as it is written down', () => {
  it('prices the stored line at what the customer was charged, on its own copy', async () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as {
      items: { product: { price: number }; quantity: number; unitPrice: number; totalPrice: number }[];
      subtotal: number;
      total: number;
      lineDiscounts?: { productId: string; granted: number; name: string }[];
    };
    expect(tx.items[0].product.price).toBe(250);
    expect(tx.items[0].unitPrice).toBe(250);
    expect(tx.items[0].totalPrice).toBe(500);
    // Every renderer multiplies the stored line out; it has to reach the stored total.
    const lines = tx.items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
    expect(lines).toBe(tx.subtotal);
    expect(tx.total).toBe(tx.subtotal);
    // The giveaway lives inside the line price now, so it is written down beside it
    // or the shop's "Discounts Given" reports money it handed over as revenue.
    const [recorded] = tx.lineDiscounts ?? [];
    expect(recorded?.productId).toBe(shelf.id);
    expect(recorded?.name).toBe('Type-C cable 1m');
    expect(recorded?.granted).toBe(100);
    // And the shelf never saw any of it.
    expect(shelf.price).toBe(300);
  });

  it('still moves the units it moved before discounts existed', async () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    usePartsCartStore.getState().addToCart(screen);
    await usePartsCartStore.getState().checkout();

    expect(captured.stockMoves).toEqual([
      { productId: shelf.id, delta: -2 },
      { productId: screen.id, delta: -1 },
    ]);
  });

  it('subtracts the basket discount from an already discounted subtotal, once', async () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    usePartsCartStore.getState().setDiscount({ type: 'flat', value: 100 });
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as { subtotal: number; total: number };
    expect(tx.subtotal).toBe(500);
    expect(tx.total).toBe(400);
  });

  it('files the invoice under the number the counter handed out', async () => {
    cable(1);
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as {
      invoiceNumber?: string;
      invoiceNumberProvisional?: boolean;
    };
    expect(tx.invoiceNumber).toBe('INV-PARTS-261104-0003');
    expect(tx.invoiceNumberProvisional).toBeUndefined();
  });
});

describe('the basket promise', () => {
  it('keeps a trade percentage a percentage instead of reading it as dinars', () => {
    cable(10);
    // A repairer's shop is owed 10% of whatever the basket turns out to be. Handed
    // over as a bare number, the till used to take it for ten dinars.
    usePartsCartStore.getState().setDiscount({ type: 'percent', value: 10 });

    expect(usePartsCartStore.getState().getSubtotal()).toBe(3000);
    expect(usePartsCartStore.getState().getDiscountAmount()).toBe(300);
    expect(usePartsCartStore.getState().getTotal()).toBe(2700);
  });

  it('grows and shrinks the promised percentage with the basket', () => {
    cable(2);
    usePartsCartStore.getState().setDiscount({ type: 'percent', value: 10 });
    expect(usePartsCartStore.getState().getDiscountAmount()).toBe(60);

    // Another part on the counter: the promise was 10% of the sale, not 10% of the
    // sale as it looked the moment the customer was attached.
    usePartsCartStore.getState().addToCart(screen);
    expect(usePartsCartStore.getState().getDiscountAmount()).toBe(960);
    expect(usePartsCartStore.getState().getTotal()).toBe(8640);
  });

  it('writes the dinars the percentage came to, so the printed lines still foot', async () => {
    cable(10);
    usePartsCartStore.getState().setDiscount({ type: 'percent', value: 10 });
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as {
      subtotal: number;
      total: number;
      discount?: { type: 'percent' | 'flat'; value: number };
      lineDiscounts?: unknown[];
    };
    expect(tx.discount).toEqual({ type: 'flat', value: 300 });
    expect(tx.total).toBe(tx.subtotal - 300);
    // Nothing was knocked off a line, so nothing is recorded as knocked off a line.
    expect(tx.lineDiscounts).toBeUndefined();
  });

  it('clears the promise rather than leaving a zero behind', () => {
    cable(2);
    usePartsCartStore.getState().setDiscount({ type: 'flat', value: 100 });
    usePartsCartStore.getState().setDiscount(null);

    expect(usePartsCartStore.getState().discount).toBeNull();
    expect(usePartsCartStore.getState().getDiscountAmount()).toBe(0);
    expect(usePartsCartStore.getState().getTotal()).toBe(600);
  });

  it('prices a held cart by the promise it was held with', () => {
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    const items = usePartsCartStore.getState().items;

    // 500 on the counter with 10% owed is 450 — not 490, which is what reading the
    // percentage as dinars gave a cart held by an earlier build.
    expect(heldBasketDiscountOf(items, { type: 'percent', value: 10 })).toBe(50);
    expect(heldBasketDiscountOf(items, 100)).toBe(100);
    expect(heldBasketDiscountOf(items, null)).toBe(0);
  });
});

describe('partsCartStore checkout ordering', () => {
  it('moves the shelf before the invoice exists', async () => {
    cable(2);
    usePartsCartStore.getState().addToCart(screen);
    await usePartsCartStore.getState().checkout();

    expect(captured.order).toEqual(['stock:part_cable:-2', 'stock:part_screen:-1', 'save']);
  });

  it('aborts before the write when a stock deduction cannot be made durable', async () => {
    cable(2);
    captured.failStock = true;

    await expect(usePartsCartStore.getState().checkout()).rejects.toThrow('stock write failed');
    expect(captured.order).toEqual(['stock:part_cable:-2']);
    expect(captured.transactions).toHaveLength(0);
  });

  it('keeps the B2B order: debt first, then the shelf, then the invoice', async () => {
    cable(1);
    const customer: Customer = { id: 'c1', name: 'Shop A', phone: '0550000000', shopName: 'Shop A' } as Customer;

    const result = await usePartsCartStore.getState().checkoutB2B({
      customer,
      settlementType: 'partial_payment',
      paidAmount: 500,
      paymentMethod: 'cash',
      chargedAmount: 500,
    });

    expect(result).not.toBeNull();
    expect(captured.order).toEqual(['debt', 'stock:part_cable:-1', 'save']);
  });

  it('a failed deduction in the B2B path also aborts before the invoice', async () => {
    cable(1);
    captured.failStock = true;

    const customer: Customer = { id: 'c1', name: 'Shop A', phone: '0550000000', shopName: 'Shop A' } as Customer;
    await expect(
      usePartsCartStore.getState().checkoutB2B({
        customer,
        settlementType: 'paid_full',
        paidAmount: 300,
        paymentMethod: 'cash',
        chargedAmount: 0,
      })
    ).rejects.toThrow('stock write failed');
    expect(captured.transactions).toHaveLength(0);
  });
});
