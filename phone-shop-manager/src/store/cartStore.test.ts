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
import type { CartItem, PhoneModel, SaleTransaction } from '../types';
import { buildCorrectedLines } from '../utils/saleEditLines';
import { computeDayFigures } from '../utils/dayFigures';
import { toDateStr } from '../utils/localDate';

const captured = vi.hoisted(() => ({
  transactions: [] as Record<string, unknown>[],
  /** Every document write the edit path asked Firestore for, in the order it asked. */
  updates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
  /** Every stock move the edit path asked the shelf for, in the order it asked. */
  stock: [] as number[],
  /** The account entries the customer store reports — the edit path reads these cold. */
  debts: [] as Array<{ id: string; customerId: string; amountPaid: number; totalAmount: number; invoiceNumber: string }>,
  /** Every Avoir move the corrected invoice asked for, in the order it asked. */
  credit: [] as Array<{ kind: 'add' | 'use'; customerId: string; amount: number; note: string }>,
  /** Every surplus the till applied against an open debt balance. */
  debtDeductions: [] as Array<{ customerId: string; amount: number; note: string }>,
  /** Every account entry the till asked for, so a sale and its debt can be compared. */
  newDebts: [] as Record<string, unknown>[],
  /** Every balance the corrected invoice asked the account to hold, in order. */
  debtAmounts: [] as Array<{ debtId: string; total: number; charged: number | undefined }>,
  /** What the till is handed when it asks for a reference. Real Firestore is not involved. */
  counter: { invoiceNumber: 'INV-261104-0007', provisional: false } as {
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
      captured.transactions.push(tx);
      return { ...tx, id: `tx_${captured.transactions.length}` };
    },
    updateTransaction: async (id: string, updates: Record<string, unknown>) => {
      captured.updates.push({ id, updates });
      Object.assign(captured.transactions[captured.transactions.length - 1] ?? {}, updates);
      return true;
    },
    getRetailTransactions: async () => [],
    refund: async () => new Date().toISOString(),
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
    adjustStockAsync: async (_productId: string, delta: number) => {
      captured.stock.push(delta);
      return undefined;
    },
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
      debts: captured.debts,
      recalculateCustomer: async () => undefined,
      findOrCreateCustomer: async (who: { name: string; phone: string }) => ({
        id: 'cust_1',
        name: who.name,
        phone: who.phone,
      }),
      addDebt: async (entry: Record<string, unknown>) => {
        captured.newDebts.push(entry);
        return { id: 'debt_1' };
      },
      updateDebtAmount: async (debtId: string, total: number, _summary?: string, charged?: number) => {
        captured.debtAmounts.push({ debtId, total, charged });
        return undefined;
      },
      getCustomerDebtTotal: () => 0,
      addStoreCredit: async (customerId: string, amount: number, note = '') => {
        captured.credit.push({ kind: 'add', customerId, amount, note });
        return amount;
      },
      useStoreCredit: async (customerId: string, amount: number, note = '') => {
        captured.credit.push({ kind: 'use', customerId, amount, note });
        return amount;
      },
      deductFromDebt: async (customerId: string, amount: number, note = '') => {
        captured.debtDeductions.push({ customerId, amount, note });
        return amount;
      },
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

const { useCartStore, cartTotalsOf } = await import('./cartStore');

const emptyCart = () =>
  useCartStore.setState({
    items: [],
    discount: null,
    customerName: '',
    customerPhone: '',
    payments: [{ method: 'cash', amount: 0 }],
    isCheckingOut: false,
    suspendedCarts: [],
  });

beforeEach(() => {
  // The store mirrors the live cart to localStorage on every change.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  captured.transactions.length = 0;
  captured.updates.length = 0;
  captured.stock.length = 0;
  captured.debts.length = 0;
  captured.credit.length = 0;
  captured.debtDeductions.length = 0;
  captured.newDebts.length = 0;
  captured.debtAmounts.length = 0;
  captured.counter = { invoiceNumber: 'INV-261104-0007', provisional: false };
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

  it('files the sale under the number the counter handed out, and the account entry under the same one', async () => {
    add(cable);
    useCartStore.setState({
      customerName: 'Yacine',
      payments: [{ method: 'debt', amount: 300 }],
    });
    await useCartStore.getState().checkout();

    const tx = captured.transactions[0] as {
      invoiceNumber?: string;
      invoiceNumberProvisional?: boolean;
    };
    expect(tx.invoiceNumber).toBe('INV-261104-0007');
    expect(tx.invoiceNumberProvisional).toBeUndefined();

    // The statement and the timeline find an invoice's account entry by this number.
    // A debt written without it reads as a payment nobody made, on a receipt the
    // customer is holding.
    expect(captured.newDebts[0]).toMatchObject({ invoiceNumber: 'INV-261104-0007' });
  });

  it('says so on the document when the reference was guessed instead of claimed', async () => {
    captured.counter = { invoiceNumber: 'INV-482013', provisional: true };
    add(cable);
    await useCartStore.getState().checkout();

    const tx = captured.transactions[0] as { invoiceNumber?: string; invoiceNumberProvisional?: boolean };
    // A clock number repeats every sixteen and a half minutes, so the shop has to be
    // able to find the sales carrying one instead of trusting them to be unique.
    expect(tx.invoiceNumberProvisional).toBe(true);
  });
});

describe('a return that leaves the shop owing the customer', () => {
  const handBack = () => useCartStore.getState().addReturnItem(cable, { quantity: 1 });
  const savedDoc = () => captured.transactions[0] as unknown as SaleTransaction;
  const drawerWith = (docs: SaleTransaction[]) =>
    computeDayFigures({ transactions: docs, repairs: [], debts: [] }, toDateStr(new Date())).totalCash;
  const morningSale: SaleTransaction = {
    id: 'sale-1',
    date: new Date().toISOString(),
    items: [],
    subtotal: 1000,
    total: 1000,
    payments: [{ method: 'cash', amount: 1000 }],
    status: 'completed',
    saleType: 'retail',
  };

  it('takes a cash refund out of the drawer and names cash on the document', async () => {
    handBack();
    await useCartStore.getState().checkout({ refundType: 'cash' });

    const doc = savedDoc();
    expect(doc.total).toBe(-300);
    expect(doc.payments).toEqual([{ method: 'cash', amount: -300 }]);
    expect(doc.exchangeSummary?.refundType).toBe('cash');
    expect(drawerWith([morningSale, doc])).toBe(700);
  });

  it('keeps an Avoir out of the drawer while granting it on the account', async () => {
    handBack();
    useCartStore.setState({ customerName: 'Yacine' });
    await useCartStore.getState().checkout({ refundType: 'store_credit' });

    const doc = savedDoc();
    expect(doc.payments).toEqual([{ method: 'store_credit', amount: -300 }]);
    expect(doc.exchangeSummary?.refundType).toBe('store_credit');
    expect(captured.credit).toEqual([
      { kind: 'add', customerId: 'cust_1', amount: 300, note: expect.any(String) },
    ]);
    // The 300 was granted on the account, not handed over the counter, so the drawer
    // still holds the morning's 1 000. Stamping it as cash took the same 300 out twice:
    // once here and once when the Avoir was added to the customer.
    expect(drawerWith([morningSale, doc])).toBe(1000);
  });

  it('keeps a debt deduction out of the drawer and opens no new credit record', async () => {
    handBack();
    useCartStore.setState({ customerName: 'Yacine' });
    await useCartStore.getState().checkout({ refundType: 'debt_deduction' });

    const doc = savedDoc();
    expect(doc.payments).toEqual([{ method: 'debt', amount: -300 }]);
    expect(doc.exchangeSummary?.refundType).toBe('debt_deduction');
    expect(captured.debtDeductions).toEqual([
      { customerId: 'cust_1', amount: 300, note: expect.any(String) },
    ]);
    expect(captured.newDebts).toEqual([]);
    expect(drawerWith([morningSale, doc])).toBe(1000);
  });

  it('refuses an account settlement with nobody to hold it, before anything is written', async () => {
    handBack();
    await expect(
      useCartStore.getState().checkout({ refundType: 'store_credit' })
    ).rejects.toThrow(/Attach a customer/);

    expect(captured.transactions).toEqual([]);
    expect(captured.credit).toEqual([]);
    expect(useCartStore.getState().isCheckingOut).toBe(false);
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});

describe('a basket parked in the suspended drawer', () => {
  it('shows the money the counter will show when the customer walks back', () => {
    add(phone);
    useCartStore.getState().addReturnItem(cable, { quantity: 1, customReturnPrice: 250 });
    useCartStore.getState().setDiscount({ type: 'percent', value: 10 });
    const onCounter = useCartStore.getState().getTotal();

    useCartStore.getState().suspendCart();
    const parked = useCartStore.getState().suspendedCarts[0];
    const { discountAmount, total } = cartTotalsOf(parked.items, parked.discount);

    // The promise was 10% of what he took, and the exchange coming back onto the
    // shelf is priced at what the counter agreed to give for it — not at the new
    // price on the shelf, and not added to the basket as if it were another sale.
    expect(discountAmount).toBe(1001);
    expect(total).toBe(8754);
    expect(total).toBe(onCounter);
  });

  it('shows nothing as given away on a basket that gave nothing away', () => {
    add(cable);
    useCartStore.getState().suspendCart();
    const parked = useCartStore.getState().suspendedCarts[0];

    expect(cartTotalsOf(parked.items, parked.discount).discountAmount).toBe(0);
    expect(cartTotalsOf(parked.items, parked.discount).total).toBe(300);
  });
});

/**
 * What a downward correction does to money the customer already handed over.
 *
 * The invoice total drops, the collected amount does not, and the account entry's
 * balance is `Math.max(0, total - paid)` — so the surplus used to round down to
 * nothing. It is the shop's own money, owed to the customer, and it belonged in the
 * Avoir ledger the void path already writes to. These pin the move to the
 * *difference* between the surplus before and after, so correcting the same invoice
 * twice cannot grant the same 2 000 DA twice.
 */
describe('a corrected invoice that collected more than it now says', () => {
  const INVOICE = 'INV-123456';
  const line = (price: number): CartItem[] => [{ product: { ...phone, price }, quantity: 1 }];

  const park = (invoiceTotal: number, collected: number) => {
    useCartStore.setState({
      transactions: [
        {
          id: 'tx_debt',
          date: '2026-11-02T10:00:00.000Z',
          items: line(invoiceTotal),
          subtotal: invoiceTotal,
          total: invoiceTotal,
          payments: [{ method: 'debt', amount: invoiceTotal }],
          status: 'completed',
          invoiceNumber: INVOICE,
          customerId: 'cust_1',
        } as unknown as SaleTransaction,
      ],
    });
    captured.debts.push({
      id: 'debt_1',
      customerId: 'cust_1',
      amountPaid: collected,
      totalAmount: invoiceTotal,
      invoiceNumber: INVOICE,
    });
  };

  const edit = (newTotal: number) =>
    useCartStore.getState().editTransaction('tx_debt', line(newTotal), {});

  it('holds an over-collection as Avoir instead of letting it round down to nothing', async () => {
    park(10000, 10000);
    await edit(8000);

    expect(captured.credit).toEqual([
      { kind: 'add', customerId: 'cust_1', amount: 2000, note: `Over-collection on corrected Receipt #${INVOICE} held as Avoir` },
    ]);
  });

  it('does not grant the same over-collection twice on a second correction', async () => {
    // The surplus is already on the ledger from the first edit; re-deriving it from
    // what the customer paid would hand over the same 2 000 DA again.
    park(8000, 10000);
    await edit(8000);

    expect(captured.credit).toEqual([]);
  });

  it('releases the Avoir when a later correction asks for what was already paid', async () => {
    park(8000, 10000);
    await edit(10000);

    expect(captured.credit).toHaveLength(1);
    expect(captured.credit[0].kind).toBe('use');
    expect(captured.credit[0].amount).toBe(2000);
  });

  it('leaves an under-paid account alone', async () => {
    park(10000, 4000);
    await edit(8000);

    expect(captured.credit).toEqual([]);
  });
});

/**
 * An exchange invoice carries money in two directions, and the editor read it as
 * though every line were a purchase: the phone the customer handed back was ADDED to
 * the receipt he was already paying for, and the payments were then rescaled to the
 * inflated figure. `editTransaction` now runs the till's own `cartTotalsOf`, so a
 * corrected basket foots the way a fresh one does — the trade-in comes off, and the
 * discount is still measured on what was bought.
 *
 * A basket that comes out owed is refused rather than floored to zero. Flooring it is
 * how an exchange surplus disappeared while the sale flipped to `refunded`, and the
 * refusal happens before the shelf moves, so a rejected edit leaves nothing half-done.
 */
describe('a corrected invoice that carries a line back off the basket', () => {
  const tradeIn = (price: number): PhoneModel =>
    ({ ...phone, id: 'sku_trade_in', name: 'Old phone in trade', price }) as unknown as PhoneModel;

  /** One phone bought, one handed back in trade. */
  const basket = (salePrice: number, returnPrice = 5000): CartItem[] => [
    { product: { ...phone, price: salePrice }, quantity: 1 },
    {
      product: tradeIn(returnPrice),
      quantity: 1,
      isReturn: true,
      customReturnPrice: returnPrice,
    },
  ];

  const park = (
    items: CartItem[],
    fields: { subtotal: number; total: number; discount?: { type: 'percent' | 'flat'; value: number } }
  ) => {
    useCartStore.setState({
      transactions: [
        {
          id: 'tx_exchange',
          date: '2026-11-02T10:00:00.000Z',
          items,
          subtotal: fields.subtotal,
          discount: fields.discount,
          total: fields.total,
          payments: [{ method: 'cash', amount: fields.total }],
          status: 'completed',
          invoiceNumber: 'INV-777777',
        } as unknown as SaleTransaction,
      ],
    });
  };

  const edit = (newItems: CartItem[]) =>
    useCartStore.getState().editTransaction('tx_exchange', newItems, {});

  it('takes the line back off the receipt instead of billing it a second time', async () => {
    park(basket(20000), { subtotal: 15000, total: 15000 });
    await edit(basket(20000));

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    expect(written.subtotal).toBe(15000);
    expect(written.total).toBe(15000);
    expect(written.payments).toEqual([{ method: 'cash', amount: 15000 }]);
    expect(written.status).toBe('completed');
  });

  it('measures the discount on what was bought, not on the net of a return', async () => {
    park(basket(20000), { subtotal: 15000, total: 14000, discount: { type: 'flat', value: 1000 } });
    await edit(basket(20000));

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    expect(written.total).toBe(14000);
    // 20 000 bought − 1 000 given away − 5 000 taken back: the printed lines and the
    // printed total are the same arithmetic.
    expect(written.subtotal).toBe(15000);
  });

  it('prices a taken-back line at what the counter pays for it', async () => {
    park(basket(20000), { subtotal: 15000, total: 15000 });
    await edit(basket(20000, 3000));

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    expect(written.total).toBe(17000);
    expect(written.subtotal).toBe(17000);
  });

  it('refuses a correction that would leave the receipt owing the customer', async () => {
    // Only the trade-in line is left on the invoice, so nothing was bought to cover it.
    park(basket(20000), { subtotal: 15000, total: 15000 });

    await expect(edit([basket(20000)[1]])).rejects.toThrow(/leaves the receipt owing/);
    expect(captured.updates).toEqual([]);
    expect(captured.stock).toEqual([]);
  });
});

/**
 * A correction is a credit note, not an eraser.
 *
 * Lowering a line used to delete it, and the shop lost the product from the document:
 * a refunded invoice printed blank, a partial one lost the unit's row, and nothing in
 * the sales history said what had left the counter. The editor now hands the store the
 * sold line plus a `−` line for what came back, so these cases pin what the store
 * writes and stamps when the lines arrive that way — including the one thing a
 * quantity-based stamp could no longer see, which is that the goods, not the row, are
 * what a refund takes away.
 */
describe('a corrected invoice that hands units back', () => {
  const sold = (price: number, quantity = 2): CartItem[] => [
    { product: { ...phone, price }, quantity, unitPrice: price },
  ];

  const back = (price: number, quantity: number, restock = true): CartItem => ({
    product: { ...phone, price },
    quantity,
    unitPrice: price,
    customReturnPrice: price,
    isReturn: true,
    restock,
  });

  const park = (items: CartItem[], total: number) => {
    useCartStore.setState({
      transactions: [
        {
          id: 'tx_credit_note',
          date: '2026-11-02T10:00:00.000Z',
          items,
          subtotal: total,
          total,
          payments: [{ method: 'cash', amount: total }],
          status: 'completed',
          invoiceNumber: 'INV-999999',
        } as unknown as SaleTransaction,
      ],
    });
  };

  /** The same call the editor's preview makes, so the store is tested on the basket it
   *  is actually handed rather than on one written by hand. */
  const correct = (items: CartItem[], quantity: number, unitPrice?: number, restockChoices = {}) => {
    const edited = buildCorrectedLines(
      items,
      { sku_phone: { quantity, unitPrice: unitPrice ?? items[0].product.price } },
      restockChoices
    );
    return useCartStore.getState().editTransaction('tx_credit_note', edited, restockChoices);
  };

  const writtenLines = () => captured.updates[0]?.updates.items as CartItem[];
  const shape = (items: CartItem[]) =>
    items.map(item => `${item.isReturn ? '−' : ''}${item.quantity}× ${item.product.name}`);

  it('keeps every line when the whole invoice comes back, and stamps it refunded', async () => {
    park(sold(20000), 40000);
    await correct(sold(20000), 0);

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    expect(written.total).toBe(0);
    expect(written.status).toBe('refunded');
    expect(shape(writtenLines())).toEqual(['2× Samsung A55', '−2× Samsung A55']);
    expect(captured.stock).toEqual([2]);
  });

  it('stamps one unit handed back as a partial refund and puts it on the shelf', async () => {
    park(sold(20000), 40000);
    await correct(sold(20000), 1);

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    expect(written.total).toBe(20000);
    expect(written.status).toBe('partially_refunded');
    expect(shape(writtenLines())).toEqual(['2× Samsung A55', '−1× Samsung A55']);
    expect(captured.stock).toEqual([1]);
  });

  it('prices the giveaway on the sold line alone, not on the unit handed back', async () => {
    // An earlier correction already wrote the credit; this one only moves the price, so
    // the shop gave 1 000 DA on two units it sold — not 500 more on the one it took.
    const items = [...sold(20000), back(20000, 1)];
    park(items, 20000);
    await correct(items, 1, 19000);

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    expect(written.total).toBe(19000);
    const discounts = written.lineDiscounts as { productId: string; granted: number }[];
    expect(discounts).toHaveLength(1);
    expect(discounts[0]).toMatchObject({ productId: 'sku_phone', granted: 2000 });
  });

  it('moves the shelf when the counter changes his mind about a written-off unit', async () => {
    const items = [...sold(20000), back(20000, 1, false)];
    park(items, 20000);
    await correct(items, 1, 20000, { sku_phone: true });

    expect(captured.stock).toEqual([1]);
    expect(writtenLines()[1].restock).toBe(true);
  });

  it('takes the unit back off the shelf when he writes it off instead', async () => {
    const items = [...sold(20000), back(20000, 1, true)];
    park(items, 20000);
    await correct(items, 1, 20000, { sku_phone: false });

    expect(captured.stock).toEqual([-1]);
    expect(writtenLines()[1].restock).toBe(false);
  });

  it('leaves the shelf alone when a correction touches only the price', async () => {
    park(sold(20000), 40000);
    await correct(sold(20000), 2, 19000);

    expect(captured.stock).toEqual([]);
    expect(captured.updates[0]?.updates.status).toBe('completed');
  });

  it('prints what was put on the invoice and what came off it, each with its sign', async () => {
    park(sold(20000, 1), 20000);
    const edited = buildCorrectedLines(
      sold(20000, 1),
      { sku_phone: { quantity: 0, unitPrice: 20000 } },
      {},
      [{ product: { ...cable, price: 300 }, quantity: 2, unitPrice: 300 }]
    );
    await useCartStore.getState().editTransaction('tx_credit_note', edited, {});

    const written = captured.updates[0]?.updates as Record<string, unknown>;
    // The phone left and came back, and two cables joined: 600 DA of goods on a
    // document that still names every unit the counter moved.
    expect(written.total).toBe(600);
    expect(shape(writtenLines())).toEqual(['1× Samsung A55', '−1× Samsung A55', '2× Type-C cable']);
  });
});

/**
 * The account split a corrected invoice leaves behind.
 *
 * Two documents describe the same money: the credit entry's `remainingBalance` and
 * the invoice's `accountSettlement`, which is what the account statement prints.
 * The edit used to filter the tender lines on a method this till does not have
 * (`'account'` — the union calls it `'debt'`), so the sum was always nil and every
 * correction closed a debt the customer still owed. It then read the printed
 * "paid" figure from the account's running collections, which put money taken
 * weeks later onto the receipt as though it had changed hands at the till.
 *
 * A parts invoice carries no account line at all — its charge lives only in the
 * settlement stamp — so silence in the payments must never be read as "settled".
 */
describe('the account split a corrected invoice leaves behind', () => {
  const INVOICE = 'INV-261108-0011';
  const line = (price: number): CartItem[] => [{ product: { ...phone, price }, quantity: 1 }];

  const park = (
    invoiceTotal: number,
    payments: Array<{ method: string; amount: number }> | undefined,
    collected: number,
    settlement?: Record<string, unknown>
  ) => {
    useCartStore.setState({
      transactions: [
        {
          id: 'tx_split',
          date: '2026-11-02T10:00:00.000Z',
          items: line(invoiceTotal),
          subtotal: invoiceTotal,
          total: invoiceTotal,
          payments,
          status: 'completed',
          invoiceNumber: INVOICE,
          customerId: 'cust_1',
          ...(settlement ? { accountSettlement: settlement } : {}),
        } as unknown as SaleTransaction,
      ],
    });
    captured.debts.push({
      id: 'debt_1',
      customerId: 'cust_1',
      amountPaid: collected,
      totalAmount: invoiceTotal,
      invoiceNumber: INVOICE,
    });
  };

  const edit = (newTotal: number) =>
    useCartStore.getState().editTransaction('tx_split', line(newTotal), {});

  const stamp = () => {
    const written = captured.updates[0];
    if (!written) throw new Error('the correction wrote no invoice update');
    return written.updates.accountSettlement as Record<string, unknown>;
  };

  const writtenPayments = () => {
    const written = captured.updates[0];
    if (!written) throw new Error('the correction wrote no invoice update');
    return written.updates.payments as Array<{ method: string; amount: number }>;
  };

  it('keeps a mixed-tender balance open at the account portion the invoice declares', async () => {
    // 10 000 sold: 3 000 at the till, 7 000 on the account. Corrected to 12 000, the
    // tender lines rescale to 3 600 / 8 400 and that 8 400 is what the customer owes.
    park(10000, [{ method: 'cash', amount: 3000 }, { method: 'debt', amount: 7000 }], 5000, {
      type: 'partial_payment', paidAmount: 3000, chargedAmount: 7000, debtEntryId: 'debt_1',
    });

    await edit(12000);

    expect(captured.debtAmounts).toEqual([{ debtId: 'debt_1', total: 12000, charged: 8400 }]);
    expect(stamp()).toMatchObject({ type: 'partial_payment', paidAmount: 3600, chargedAmount: 8400 });
  });

  it('does not close a standing balance because the tender lines name no account', async () => {
    // The parts shape: nothing in `payments`, the whole charge in the stamp. Reading
    // a missing account line as zero is what erased these debts.
    park(10000, [], 0, {
      type: 'charged_to_account', paidAmount: 0, chargedAmount: 10000, debtEntryId: 'debt_1',
    });

    await edit(12000);

    expect(captured.debtAmounts).toEqual([{ debtId: 'debt_1', total: 12000, charged: 12000 }]);
    expect(stamp()).toMatchObject({ type: 'charged_to_account', paidAmount: 0, chargedAmount: 12000 });
  });

  it('prints what changed hands at the till, not what the account has since collected', async () => {
    // 9 000 of a 10 000 invoice has been collected, but only 3 000 of that was upfront.
    park(10000, [{ method: 'cash', amount: 3000 }, { method: 'debt', amount: 7000 }], 9000, {
      type: 'partial_payment', paidAmount: 3000, chargedAmount: 7000, debtEntryId: 'debt_1',
    });

    await edit(11000);

    expect(stamp()).toMatchObject({ paidAmount: 3300, chargedAmount: 7700 });
    expect(captured.debtAmounts[0].charged).toBe(7700);
  });

  it('tells the ledger and the printed stamp the same number', async () => {
    park(10000, [{ method: 'cash', amount: 2500 }, { method: 'debt', amount: 7500 }], 2500, {
      type: 'partial_payment', paidAmount: 2500, chargedAmount: 7500, debtEntryId: 'debt_1',
    });

    await edit(9000);

    expect(stamp().chargedAmount).toBe(captured.debtAmounts[0].charged);
    expect(Number(stamp().paidAmount) + Number(stamp().chargedAmount)).toBe(9000);
  });

  it('closes the stamp only when the tender lines declare nothing on account', async () => {
    park(10000, [{ method: 'cash', amount: 10000 }, { method: 'debt', amount: 0 }], 10000, {
      type: 'paid_full', paidAmount: 10000, chargedAmount: 0, debtEntryId: 'debt_1',
    });

    await edit(10000);

    expect(captured.debtAmounts[0].charged).toBe(0);
    expect(stamp()).toMatchObject({ type: 'paid_full', paidAmount: 10000, chargedAmount: 0 });
  });

  it('names the entry it corrected on an invoice that carried no stamp', async () => {
    park(10000, [{ method: 'debt', amount: 10000 }], 0);

    await edit(12000);

    expect(stamp()).toMatchObject({ debtEntryId: 'debt_1', chargedAmount: 12000, paidAmount: 0 });
  });

  it('a fully charged parts invoice writes no tender line at all', async () => {
    // The drawer reads the payments array as money received. Rewriting an empty one
    // to a full cash row put the whole charged invoice in the till on paper.
    park(10000, [], 0, {
      type: 'charged_to_account', paidAmount: 0, chargedAmount: 10000, debtEntryId: 'debt_1',
    });

    await edit(12000);

    expect(writtenPayments()).toEqual([]);
    expect(stamp()).toMatchObject({ type: 'charged_to_account', paidAmount: 0, chargedAmount: 12000 });
  });

  it('a lone card tender on a partly paid invoice keeps only what was received', async () => {
    // 3 000 of a 10 000 parts invoice was paid by card; the rest sat on the account.
    // Growing the invoice to 12 000 must not record 12 000 of card money taken.
    park(10000, [{ method: 'card', amount: 3000 }], 3000, {
      type: 'partial_payment', paidAmount: 3000, chargedAmount: 7000, debtEntryId: 'debt_1',
    });

    await edit(12000);

    expect(writtenPayments()).toEqual([{ method: 'card', amount: 3000 }]);
    expect(stamp()).toMatchObject({ paidAmount: 3000, chargedAmount: 9000 });
  });

  it('a correction below what was tendered caps the line at the new total', async () => {
    park(10000, [{ method: 'card', amount: 3000 }], 3000, {
      type: 'partial_payment', paidAmount: 3000, chargedAmount: 7000, debtEntryId: 'debt_1',
    });

    await edit(2000);

    expect(writtenPayments()).toEqual([{ method: 'card', amount: 2000 }]);
    // The 1 000 the customer over-paid is held as Avoir, not eaten.
    expect(captured.credit).toEqual([
      { kind: 'add', customerId: 'cust_1', amount: 1000, note: expect.any(String) },
    ]);
  });

  it('a fully paid single-tender invoice still rescales with the correction', async () => {
    park(10000, [{ method: 'cash', amount: 10000 }], 10000, {
      type: 'paid_full', paidAmount: 10000, chargedAmount: 0, debtEntryId: 'debt_1',
    });

    await edit(12000);

    expect(writtenPayments()).toEqual([{ method: 'cash', amount: 12000 }]);
  });

  it('a lone charge row follows the total without becoming money', async () => {
    park(10000, [{ method: 'debt', amount: 10000 }], 0);

    await edit(12000);

    expect(writtenPayments()).toEqual([{ method: 'debt', amount: 12000 }]);
  });

  it('a document with no recorded tenders keeps the legacy cash reading', async () => {
    park(10000, undefined, 0);

    await edit(12000);

    expect(writtenPayments()).toEqual([{ method: 'cash', amount: 12000 }]);
  });
});
