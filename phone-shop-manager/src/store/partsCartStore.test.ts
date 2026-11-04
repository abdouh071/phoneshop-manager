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
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PhoneModel } from '../types';

const captured = vi.hoisted(() => ({
  transactions: [] as Record<string, unknown>[],
  stockMoves: [] as { productId: string; delta: number }[],
}));

vi.mock('../services/transactionService', () => ({
  transactionService: {
    save: async (tx: Record<string, unknown>) => {
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
      addDebt: async () => ({ id: 'debt_1' }),
    }),
  },
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
    }),
  },
}));

const { usePartsCartStore } = await import('./partsCartStore');
const { lineDiscountOf } = await import('../utils/discountPolicy');

const emptyCart = () =>
  usePartsCartStore.setState({
    items: [],
    discount: 0,
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
    };
    expect(tx.items[0].product.price).toBe(250);
    expect(tx.items[0].unitPrice).toBe(250);
    expect(tx.items[0].totalPrice).toBe(500);
    // Every renderer multiplies the stored line out; it has to reach the stored total.
    const lines = tx.items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
    expect(lines).toBe(tx.subtotal);
    expect(tx.total).toBe(tx.subtotal);
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
    usePartsCartStore.getState().setDiscount(100);
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as { subtotal: number; total: number };
    expect(tx.subtotal).toBe(500);
    expect(tx.total).toBe(400);
  });
});
