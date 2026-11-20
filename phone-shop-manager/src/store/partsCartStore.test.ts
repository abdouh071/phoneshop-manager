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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Customer, PhoneModel, SaleTransaction, SuspendedCart } from '../types';

const captured = vi.hoisted(() => ({
  transactions: [] as Record<string, unknown>[],
  stockMoves: [] as { productId: string; delta: number }[],
  /** Accounts the till knows about, and the ones a checkout actually touched. */
  customers: [] as Customer[],
  recalculated: [] as string[],
  /** The order of the awaited writes a checkout performs. */
  order: [] as string[],
  failStock: false,
  /** Fail only this product's deduction, to exercise a partial multi-line checkout. */
  failStockFor: null as string | null,
  partsRefetches: 0,
  user: { id: 'u1', name: 'Counter', role: 'admin' },
  fetchInvoices: vi.fn<() => Promise<SaleTransaction[]>>(),
  fetchSuspendedCarts: vi.fn<() => Promise<SuspendedCart[]>>(),
  saveSuspendedCart: vi.fn<(cart: SuspendedCart) => Promise<void>>(),
  /** What the till is handed when it asks for a reference. Real Firestore is not involved. */
  beforeNumber: null as (() => Promise<void>) | null,
  beforeCheckoutReturn: null as (() => void) | null,
  acknowledge: vi.fn(),
  getPending: vi.fn(),
  resolve: vi.fn(),
  counter: { invoiceNumber: 'INV-PARTS-261104-0003', provisional: false } as {
    invoiceNumber: string;
    provisional: boolean;
  },
}));

vi.mock('../services/invoiceCounter', () => ({
  claimInvoiceNumber: async () => {
    await captured.beforeNumber?.();
    return { ...captured.counter };
  },
}));

vi.mock('../services/transactionService', () => ({
  transactionService: {
    save: async (tx: Record<string, unknown>) => {
      captured.order.push('save');
      captured.transactions.push(tx);
      return { ...tx, id: `tx_${captured.transactions.length}` };
    },
    getPartsTransactions: captured.fetchInvoices,
  },
}));

vi.mock('../services/partsCheckoutService', () => ({
  partsCheckoutService: {
    getPending: captured.getPending,
    acknowledge: captured.acknowledge,
    resolve: captured.resolve,
    checkout: async (tx: SaleTransaction, options: { draftKey: string }) => {
      captured.order.push('commit');
      if (captured.failStock || tx.items.some(item => item.product.id === captured.failStockFor)) throw new Error('stock write failed');
      captured.transactions.push(tx as unknown as Record<string, unknown>);
      captured.stockMoves.push(...tx.items.map(item => ({ productId: item.product.id, delta: -item.quantity })));
      const transaction = { ...tx, id: `tx_${captured.transactions.length}` };
      captured.beforeCheckoutReturn?.();
      return {
        transaction, cancelled: false,
        debtEntry: tx.accountSettlement?.chargedAmount ? { id: 'debt_1', customerId: tx.customerId, remainingBalance: tx.accountSettlement.chargedAmount } : undefined,
        stock: tx.items.map(item => ({ ...item.product, stock: item.product.stock - item.quantity })),
        pending: { transaction, draftKey: options.draftKey },
      };
    },
  },
}));

vi.mock('../services/partsCartService', () => ({
  partsCartService: {
    saveSuspendedCart: captured.saveSuspendedCart,
    deleteSuspendedCart: async () => undefined,
    getAllSuspendedCarts: captured.fetchSuspendedCarts,
  },
}));

vi.mock('../services/activityLogService', () => ({
  activityLogService: { log: async () => undefined },
}));

vi.mock('../services/customerLogService', () => ({
  customerLogService: { log: async () => undefined },
}));

vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: captured.user }) },
}));

vi.mock('./customerStore', () => ({
  useCustomerStore: {
    setState: vi.fn(),
    getState: () => ({
      customers: captured.customers,
      recalculateCustomer: async (id: string) => {
        captured.recalculated.push(id);
      },
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
    setState: vi.fn(),
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
      fetchParts: async () => {
        captured.partsRefetches++;
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
    suspendedCarts: [],
  });

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  // The store mirrors the live cart to localStorage on every change.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  captured.transactions.length = 0;
  captured.stockMoves.length = 0;
  captured.customers.length = 0;
  captured.recalculated.length = 0;
  captured.order.length = 0;
  captured.failStock = false;
  captured.failStockFor = null;
  captured.beforeNumber = null;
  captured.beforeCheckoutReturn = null;
  captured.acknowledge.mockReset();
  captured.getPending.mockReset().mockReturnValue(null);
  captured.resolve.mockReset();
  captured.partsRefetches = 0;
  captured.user = { id: 'u1', name: 'Counter', role: 'admin' };
  captured.fetchInvoices.mockReset().mockResolvedValue([]);
  captured.fetchSuspendedCarts.mockReset().mockResolvedValue([]);
  captured.saveSuspendedCart.mockReset().mockResolvedValue(undefined);
  usePartsCartStore.setState({ invoices: [], isLoadingInvoices: false, invoicesError: null });
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

  it('preserves the per-unit concession when the line changes size', () => {
    // Before: updateQuantity cleared unitPrice, losing the negotiated price.
    // After fix (#3 audit): unitPrice survives quantity changes so the discount holds.
    cable(2);
    usePartsCartStore.getState().setLineDiscount(shelf.id, 100);
    usePartsCartStore.getState().updateQuantity(shelf.id, 4);

    // unitPrice preserved from when it was set at qty=2:
    // setLineDiscount(id, 100) distributes 100 across 2 units = 50/unit → 300-50 = 250 per unit.
    // After updateQuantity(4), concession is still 50/unit, so unitPrice = 250 and
    // concessionTotal = 4 × (300 - 250) = 200.
    expect(usePartsCartStore.getState().items[0].unitPrice).toBe(250);
    expect(usePartsCartStore.getState().getLinesConcessionTotal()).toBe(200);
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
  it('delegates the whole sale to one atomic commit', async () => {
    cable(2);
    usePartsCartStore.getState().addToCart(screen);
    await usePartsCartStore.getState().checkout();

    expect(captured.order).toEqual(['commit']);
  });

  it('stamps the written invoice as stock-applied so the sync adopts it instead of re-deducting', async () => {
    cable(1);
    await usePartsCartStore.getState().checkout();

    expect(captured.transactions[0]).toMatchObject({ stockApplied: true });
  });

  it('aborts before the write when a stock deduction cannot be made durable', async () => {
    cable(2);
    captured.failStock = true;

    await expect(usePartsCartStore.getState().checkout()).rejects.toThrow('stock write failed');
    expect(captured.order).toEqual(['commit']);
    expect(captured.stockMoves).toHaveLength(0);
    expect(captured.transactions).toHaveLength(0);
  });

  it('leaves every line untouched and keeps the draft when the commit fails', async () => {
    cable(1);
    usePartsCartStore.getState().addToCart(screen);
    captured.failStockFor = 'part_screen';

    await expect(usePartsCartStore.getState().checkout()).rejects.toThrow('stock write failed');
    expect(captured.order).toEqual(['commit']);
    expect(captured.stockMoves).toHaveLength(0);
    expect(usePartsCartStore.getState().items).toHaveLength(2);
    expect(captured.transactions).toHaveLength(0);
    expect(captured.partsRefetches).toBe(0);
  });

  it('delegates B2B stock, debt and invoice to the same commit', async () => {
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
    expect(captured.order).toEqual(['commit']);
    expect(captured.transactions[0]).toMatchObject({ stockApplied: true });
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

  it('a failed B2B commit never makes separate stock or debt writes', async () => {
    cable(1);
    usePartsCartStore.getState().addToCart(screen);
    captured.failStockFor = 'part_screen';

    const customer: Customer = { id: 'c1', name: 'Shop A', phone: '0550000000', shopName: 'Shop A' } as Customer;
    await expect(
      usePartsCartStore.getState().checkoutB2B({
        customer,
        settlementType: 'charged_to_account',
        paidAmount: 0,
        paymentMethod: 'cash',
        chargedAmount: 9300,
      })
    ).rejects.toThrow('stock write failed');
    expect(captured.order).toEqual(['commit']);
    expect(captured.stockMoves).toHaveLength(0);
    expect(usePartsCartStore.getState().items).toHaveLength(2);
    expect(captured.order).not.toContain('debt');
    expect(captured.transactions).toHaveLength(0);
    expect(captured.partsRefetches).toBe(0);
  });
});

describe('held parts cart customer identity', () => {
  const account = (id: string): Customer => ({
    id, name: `Contact ${id}`, shopName: `Shop ${id}`, phone: `055500000${id}`,
    totalPurchases: 0, totalSpent: 0, lastVisitDate: '', joinDate: '',
  });

  it('holds explicit identity and restores A while preserving active account B on hold', () => {
    const a = account('1');
    const b = account('2');
    captured.customers.push(a, b);
    cable(1);
    usePartsCartStore.getState().setSelectedCustomer(a);
    usePartsCartStore.getState().suspendCart();
    const heldA = usePartsCartStore.getState().suspendedCarts[0];
    expect(heldA).toMatchObject({ customerId: a.id, customerName: a.shopName, customerPhone: a.phone });
    expect(captured.saveSuspendedCart).toHaveBeenCalledWith(heldA);

    cable(2);
    usePartsCartStore.getState().setSelectedCustomer(b);
    usePartsCartStore.getState().resumeCart(heldA.id);
    expect(usePartsCartStore.getState()).toMatchObject({ selectedCustomer: a, customerName: a.shopName, customerPhone: a.phone });
    const heldB = usePartsCartStore.getState().suspendedCarts[0];
    expect(heldB).toMatchObject({ customerId: b.id, customerName: b.shopName, customerPhone: b.phone });
    usePartsCartStore.getState().resumeCart(heldB.id);
    expect(usePartsCartStore.getState()).toMatchObject({ selectedCustomer: b, customerName: b.shopName, customerPhone: b.phone });
  });

  it('clears the previous account and phone for a legacy named cart without guessing by name', () => {
    const a = account('1');
    captured.customers.push(a);
    usePartsCartStore.getState().setSelectedCustomer(a);
    usePartsCartStore.setState({ suspendedCarts: [{ id: 'legacy', date: '', items: [{ product: shelf, quantity: 1 }], customerName: a.shopName!, discount: null }] });
    const result = usePartsCartStore.getState().resumeCart('legacy');
    expect(usePartsCartStore.getState()).toMatchObject({ selectedCustomer: null, customerName: a.shopName, customerPhone: '' });
    expect(result).toMatchObject({ requiresCustomerSelection: true });
  });

  it('restores walk-in phone details but never infers a registered account', () => {
    const a = account('1');
    captured.customers.push(a);
    cable(1);
    usePartsCartStore.getState().setCustomerName(a.shopName!);
    usePartsCartStore.getState().setCustomerPhone(a.phone);
    usePartsCartStore.getState().suspendCart();
    const held = usePartsCartStore.getState().suspendedCarts[0];
    expect(held).toMatchObject({ customerId: null, customerPhone: a.phone });
    usePartsCartStore.getState().setSelectedCustomer(account('2'));
    const result = usePartsCartStore.getState().resumeCart(held.id);
    expect(usePartsCartStore.getState()).toMatchObject({ selectedCustomer: null, customerName: a.shopName, customerPhone: a.phone });
    expect(result).toMatchObject({ requiresCustomerSelection: false });
  });

  it.each(['missing', 'merged'])('requires manual selection when the saved account is %s', kind => {
    const a = account('1');
    captured.customers.push(a);
    cable(1);
    usePartsCartStore.getState().setSelectedCustomer(a);
    usePartsCartStore.getState().suspendCart();
    const held = usePartsCartStore.getState().suspendedCarts[0];
    if (kind === 'missing') captured.customers.length = 0;
    else a.mergedIntoId = 'other-account';
    const result = usePartsCartStore.getState().resumeCart(held.id);
    expect(usePartsCartStore.getState().selectedCustomer).toBeNull();
    expect(result).toMatchObject({ requiresCustomerSelection: true });
  });
});

describe('partsCartStore suspended carts sync', () => {
  const staleCart = (): SuspendedCart => ({
    id: 'parts_cart_stale',
    items: [],
    customerName: 'Shop X',
    discount: null,
    date: '2026-11-15T10:00:00Z',
  });

  it('hands its current carts to the service for reconciliation', async () => {
    const stale = staleCart();
    usePartsCartStore.setState({ suspendedCarts: [stale] });

    await usePartsCartStore.getState().fetchCarts();

    expect(captured.fetchSuspendedCarts).toHaveBeenCalledWith([stale]);
  });

  it('applies an empty authoritative list instead of keeping a stale local cart', async () => {
    usePartsCartStore.setState({ suspendedCarts: [staleCart()] });
    const removeItem = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem: vi.fn(), removeItem },
    });

    await usePartsCartStore.getState().fetchCarts();

    expect(usePartsCartStore.getState().suspendedCarts).toEqual([]);
    expect(removeItem).toHaveBeenCalledWith('parts_suspended_carts');
  });

  it.each(['discard', 'resume'])('does not resurrect a cart after %s during a fetch', async action => {
    const stale = staleCart();
    usePartsCartStore.setState({ suspendedCarts: [stale] });
    let finish!: (rows: SuspendedCart[]) => void;
    captured.fetchSuspendedCarts.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const request = usePartsCartStore.getState().fetchCarts();
    if (action === 'discard') usePartsCartStore.getState().discardSuspendedCart(stale.id);
    else usePartsCartStore.getState().resumeCart(stale.id);
    finish([stale]);
    await request;
    expect(usePartsCartStore.getState().suspendedCarts).toEqual([]);
  });

  it('does not resurrect a cart both held and discarded during a fetch', async () => {
    let finish!: (rows: SuspendedCart[]) => void;
    captured.fetchSuspendedCarts.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const request = usePartsCartStore.getState().fetchCarts();
    cable(1);
    usePartsCartStore.getState().suspendCart();
    const held = usePartsCartStore.getState().suspendedCarts[0];
    usePartsCartStore.getState().discardSuspendedCart(held.id);
    finish([held]);
    await request;
    expect(usePartsCartStore.getState().suspendedCarts).toEqual([]);
  });

  it('ignores an older fetch that finishes after a newer fetch', async () => {
    let finish!: (rows: SuspendedCart[]) => void;
    captured.fetchSuspendedCarts.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const older = usePartsCartStore.getState().fetchCarts();
    await usePartsCartStore.getState().fetchCarts();
    finish([staleCart()]);
    await older;
    expect(usePartsCartStore.getState().suspendedCarts).toEqual([]);
  });

  it('keeps a cart held while the read was in flight', async () => {
    let resolveRemote!: (carts: SuspendedCart[]) => void;
    captured.fetchSuspendedCarts.mockReturnValueOnce(new Promise(resolve => { resolveRemote = resolve; }));

    const fetchPromise = usePartsCartStore.getState().fetchCarts();
    cable(1);
    usePartsCartStore.getState().suspendCart();
    resolveRemote([]);
    await fetchPromise;

    const held = usePartsCartStore.getState().suspendedCarts;
    expect(held).toHaveLength(1);
    expect(held[0].customerName).toBe('');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parts invoice cache', () => {
  const invoice = (id: string, total = 300): SaleTransaction => ({
    id, subtotal: total, total, date: '2026-11-13T12:00:00Z', items: [], payments: [], saleType: 'parts_b2b', status: 'completed',
  });

  it('shares in-flight reads and reuses successful results for one minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolve!: (rows: SaleTransaction[]) => void;
    captured.fetchInvoices.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = usePartsCartStore.getState().fetchInvoices();
    const second = usePartsCartStore.getState().fetchInvoices();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(1);
    expect(usePartsCartStore.getState().isLoadingInvoices).toBe(true);
    resolve([invoice('one')]);
    await first;
    await usePartsCartStore.getState().fetchInvoices();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(1);
    vi.setSystemTime(60_000);
    await usePartsCartStore.getState().fetchInvoices();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(2);
  });

  it('starts TTL when a slow read succeeds, not when it starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolve!: (rows: SaleTransaction[]) => void;
    captured.fetchInvoices.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = usePartsCartStore.getState().fetchInvoices();
    await Promise.resolve();
    vi.setSystemTime(80_000);
    resolve([]);
    await pending;
    vi.setSystemTime(100_000);
    await usePartsCartStore.getState().fetchInvoices();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(1);
  });

  it('keeps previous invoices on failure and permits immediate retry', async () => {
    usePartsCartStore.setState({ invoices: [invoice('old')] });
    captured.fetchInvoices.mockRejectedValueOnce(new Error('Connection failed'));
    await usePartsCartStore.getState().fetchInvoices();
    expect(usePartsCartStore.getState().invoices[0].id).toBe('old');
    expect(usePartsCartStore.getState().invoicesError).toBe('Connection failed');
    expect(usePartsCartStore.getState().isLoadingInvoices).toBe(false);
    await usePartsCartStore.getState().fetchInvoices();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(2);
    expect(usePartsCartStore.getState().invoicesError).toBeNull();
  });

  it('allows an explicit refresh before expiry', async () => {
    await usePartsCartStore.getState().fetchInvoices();
    await usePartsCartStore.getState().fetchInvoices({ force: true });
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(2);
  });

  it('refreshes after invoice mutations rather than serving stale cached state', async () => {
    await usePartsCartStore.getState().fetchInvoices();
    usePartsCartStore.setState({ invoices: [invoice('local')] });
    await usePartsCartStore.getState().fetchInvoices();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(2);
  });

  it('preserves sales, refunds and removals made while a read is pending', async () => {
    const old = invoice('old');
    const removed = invoice('removed');
    usePartsCartStore.setState({ invoices: [old, removed] });
    let resolve!: (rows: SaleTransaction[]) => void;
    captured.fetchInvoices.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = usePartsCartStore.getState().fetchInvoices();
    await Promise.resolve();
    const refunded = { ...old, status: 'refunded' as const };
    const added = invoice('added');
    usePartsCartStore.setState({ invoices: [added, refunded] });
    resolve([old, removed, invoice('remote')]);
    await pending;
    expect(usePartsCartStore.getState().invoices).toEqual(expect.arrayContaining([added, refunded, invoice('remote')]));
    expect(usePartsCartStore.getState().invoices.some(tx => tx.id === 'removed')).toBe(false);
  });

  it('does not let an old session overwrite the current session result', async () => {
    let resolve!: (rows: SaleTransaction[]) => void;
    captured.fetchInvoices.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const oldRequest = usePartsCartStore.getState().fetchInvoices();
    await Promise.resolve();
    captured.user = { id: 'u2', name: 'Another counter', role: 'admin' };
    captured.fetchInvoices.mockResolvedValueOnce([invoice('new-session')]);
    await usePartsCartStore.getState().fetchInvoices();
    resolve([invoice('old-session')]);
    await oldRequest;
    expect(usePartsCartStore.getState().invoices.map(tx => tx.id)).toEqual(['new-session']);
  });

  it('does not cache an offline fallback as a successful server read', async () => {
    await usePartsCartStore.getState().fetchInvoices();
    captured.fetchInvoices.mockClear();
    vi.stubGlobal('navigator', { onLine: false });
    usePartsCartStore.setState({ invoices: [invoice('old')] });
    await usePartsCartStore.getState().fetchInvoices();
    expect(usePartsCartStore.getState().invoices.map(tx => tx.id)).toEqual(['old']);
    vi.stubGlobal('navigator', { onLine: true });
    await usePartsCartStore.getState().fetchInvoices();
    expect(captured.fetchInvoices).toHaveBeenCalledTimes(2);
  });
});

describe('who a walk-in parts sale belongs to', () => {
  const shopA = { id: 'c1', name: 'Shop A', phone: '0550000000', shopName: 'Boutique Amine' } as Customer;

  it('keeps a typed name as text when an account shares it', async () => {
    captured.customers.push(shopA);
    cable(1);
    usePartsCartStore.getState().setCustomerName('Shop A');
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as { customerId?: string; customerName?: string; shopName?: string };
    expect(tx.customerName).toBe('Shop A');
    expect(tx.customerId).toBeUndefined();
    expect(tx.shopName).toBeUndefined();
    expect(captured.recalculated).toEqual([]);
  });

  it('does not read a shop name as an account key either', async () => {
    captured.customers.push(shopA);
    cable(1);
    usePartsCartStore.getState().setCustomerName('Boutique Amine');
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as { customerId?: string };
    expect(tx.customerId).toBeUndefined();
    expect(captured.recalculated).toEqual([]);
  });

  it('bills an account the counter attached by hand, and moves its totals', async () => {
    captured.customers.push(shopA);
    cable(1);
    usePartsCartStore.getState().setSelectedCustomer(shopA);
    await usePartsCartStore.getState().checkout();

    const tx = captured.transactions[0] as { customerId?: string; shopName?: string };
    expect(tx.customerId).toBe('c1');
    expect(tx.shopName).toBe('Boutique Amine');
    expect(captured.recalculated).toEqual(['c1']);
  });

  it('uses the submitted account even if selection changes while claiming the invoice number', async () => {
    cable();
    usePartsCartStore.getState().setSelectedCustomer(shopA);
    const other = { ...shopA, id: 'c2' };
    captured.beforeNumber = async () => { usePartsCartStore.getState().setSelectedCustomer(other); };

    await usePartsCartStore.getState().checkout();

    expect(captured.transactions[0].customerId).toBe('c1');
    expect(usePartsCartStore.getState().selectedCustomer?.id).toBe('c2');
    expect(usePartsCartStore.getState().items).toHaveLength(1);
  });

  it('retains the submitted phone on a walk-in invoice', async () => {
    cable();
    usePartsCartStore.getState().setCustomerPhone('0551234567');
    await usePartsCartStore.getState().checkout();
    expect(captured.transactions[0].customerPhone).toBe('0551234567');
    expect(captured.transactions[0].customerId).toBeUndefined();
  });
});

describe('Parts checkout local recovery', () => {
  it('stops before submission when the cashier changes during the number claim', async () => {
    cable();
    captured.beforeNumber = async () => { captured.user = { ...captured.user, id: 'u2' }; };
    await expect(usePartsCartStore.getState().checkout()).rejects.toThrow('cashier changed');
    expect(captured.transactions).toHaveLength(0);
    expect(usePartsCartStore.getState().items).toHaveLength(1);
    expect(usePartsCartStore.getState().isCheckingOut).toBe(false);
  });

  it('does not clear the new cashier cart after an already-submitted checkout finishes', async () => {
    cable();
    captured.beforeCheckoutReturn = () => { captured.user = { ...captured.user, id: 'u2' }; };
    const saved = await usePartsCartStore.getState().checkout();
    expect(saved).toBeDefined();
    expect(usePartsCartStore.getState().items).toHaveLength(1);
    expect(captured.acknowledge).toHaveBeenCalledWith('u1', saved!.id);
  });

  it('keeps recovery identity when the confirmed cart cannot be removed from storage', async () => {
    cable();
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const saved = await usePartsCartStore.getState().checkout();
    expect(saved).toBeDefined();
    expect(usePartsCartStore.getState().invoices).toHaveLength(1);
    expect(usePartsCartStore.getState().items).toHaveLength(1);
    expect(captured.acknowledge).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
  });

  it('does not clear the cart when the server confirms cancellation', async () => {
    cable();
    const pending = { transaction: { id: 'attempt', processedById: 'u1' }, draftKey: 'old', requestKey: 'old' };
    captured.resolve.mockResolvedValue({ cancelled: true, stock: [], pending });
    await usePartsCartStore.getState().resolvePendingCheckout();
    expect(captured.transactions).toHaveLength(0);
    expect(usePartsCartStore.getState().items).toHaveLength(1);
    expect(captured.acknowledge).toHaveBeenCalledWith('u1', 'attempt');
  });

  it('retains the draft and pending identity when recovery fails', async () => {
    cable();
    const pending = { transaction: { id: 'attempt', processedById: 'u1' }, draftKey: 'old', requestKey: 'old' };
    captured.getPending.mockReturnValue(pending);
    captured.resolve.mockRejectedValue(new Error('unavailable'));
    await expect(usePartsCartStore.getState().resolvePendingCheckout()).rejects.toThrow('unavailable');
    expect(usePartsCartStore.getState().pendingCheckout).toBe(pending);
    expect(usePartsCartStore.getState().items).toHaveLength(1);
    expect(captured.acknowledge).not.toHaveBeenCalled();
    expect(usePartsCartStore.getState().isCheckingOut).toBe(false);
  });

  it('deduplicates the recovered invoice without submitting a new checkout', async () => {
    cable();
    const saved = (await usePartsCartStore.getState().checkout())!;
    const pending = { transaction: saved, draftKey: 'old', requestKey: 'old' };
    captured.resolve.mockResolvedValue({ transaction: saved, cancelled: false, stock: [shelf], pending });
    await usePartsCartStore.getState().resolvePendingCheckout();
    await usePartsCartStore.getState().resolvePendingCheckout();
    expect(captured.transactions).toHaveLength(1);
    expect(usePartsCartStore.getState().invoices).toHaveLength(1);
  });
});
