/**
 * Atomicity of purchase-order reception.
 *
 * `receivePurchaseOrder` writes the order lines, the stock of every product and one restock log
 * per line inside a single Firestore transaction. The fake below enforces the precondition
 * Firestore enforces — a document read by a transaction may not move before it commits — so a
 * double submit becomes an observable abort instead of stock counted twice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { receivePurchaseOrder } from './purchasingService';
import { usePurchasingStore } from '../store/purchasingStore';
import type { PurchaseOrder } from '../types';

type FakeDoc = Record<string, unknown>;
interface FakeRef { key: string }
interface FakeColl { coll: string }

const storeMocks = vi.hoisted(() => ({
  fetchProducts: vi.fn(async () => {}),
  fetchParts: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
  user: { id: 'u_1', name: 'Amina' },
}));

vi.mock('../store/inventoryStore', () => ({
  useInventoryStore: {
    getState: () => ({
      fetchProducts: storeMocks.fetchProducts,
      fetchParts: storeMocks.fetchParts,
    }),
  },
}));

vi.mock('../store/activityStore', () => ({
  useActivityStore: { getState: () => ({ logActivity: storeMocks.logActivity }) },
}));

vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ user: storeMocks.user }) },
}));

const fake = vi.hoisted(() => {
  const docs = new Map<string, FakeDoc>();
  const versions = new Map<string, number>();
  const stats = { commits: 0, aborts: 0 };
  let autoId = 0;

  const versionOf = (key: string): number => versions.get(key) ?? 0;

  const snapshotOf = (key: string) => ({
    exists: () => docs.has(key),
    data: () => {
      const d = docs.get(key);
      return d ? { ...d } : undefined;
    },
  });

  const writeOf = (key: string, data: FakeDoc): void => {
    docs.set(key, { ...(docs.get(key) || {}), ...data });
    versions.set(key, versionOf(key) + 1);
  };

  return {
    docs,
    stats,
    seed(key: string, data: FakeDoc): void {
      docs.set(key, { ...data });
      versions.set(key, 0);
    },
    reset(): void {
      docs.clear();
      versions.clear();
      stats.commits = 0;
      stats.aborts = 0;
      autoId = 0;
    },
    logs(): Array<FakeDoc | undefined> {
      return [...docs.entries()]
        .filter(([key]) => key.startsWith('restockLogs/'))
        .map(([, data]) => data);
    },
    stockOf(productId: string): number | undefined {
      return docs.get(`inventory/${productId}`)?.stock as number | undefined;
    },
    receivedQtyOf(poId: string, productId: string): number | undefined {
      const items = docs.get(`purchaseOrders/${poId}`)?.items as Array<{ productId: string; receivedQty: number }>;
      return items.find(i => i.productId === productId)?.receivedQty;
    },
    statusOf(poId: string): unknown {
      return docs.get(`purchaseOrders/${poId}`)?.status;
    },
    collection: (_db: unknown, name: string): FakeColl => ({ coll: name }),
    doc: (parent: unknown, name?: string, id?: string): FakeRef => {
      const asColl = parent as FakeColl;
      if (asColl && typeof asColl === 'object' && 'coll' in asColl) {
        autoId += 1;
        return { key: `${asColl.coll}/gen_${autoId}` };
      }
      return { key: `${name}/${id}` };
    },
    runTransaction: async (_db: unknown, fn: (tx: FakeTx) => Promise<unknown>) => {
      const reads = new Map<string, number>();
      const writes: Array<{ key: string; data: FakeDoc }> = [];

      const tx: FakeTx = {
        get: async (ref: FakeRef) => {
          if (writes.length) throw new Error('Read after write');
          reads.set(ref.key, versionOf(ref.key));
          return snapshotOf(ref.key);
        },
        update: (ref: FakeRef, data: FakeDoc) => {
          if (!reads.has(ref.key)) throw new Error(`Fake transaction: update without read (${ref.key})`);
          writes.push({ key: ref.key, data });
        },
        set: (ref: FakeRef, data: FakeDoc) => {
          writes.push({ key: ref.key, data });
        },
      };

      const result = await fn(tx);

      for (const [key, readVersion] of reads) {
        if (versionOf(key) !== readVersion) {
          stats.aborts++;
          throw new Error(`Fake transaction aborted: ${key} changed underneath it`);
        }
      }
      for (const w of writes) writeOf(w.key, w.data);
      stats.commits++;
      return result;
    },
  };
});

interface FakeTx {
  get: (ref: FakeRef) => Promise<{ exists: () => boolean; data: () => FakeDoc | undefined }>;
  update: (ref: FakeRef, data: FakeDoc) => void;
  set: (ref: FakeRef, data: FakeDoc) => void;
}

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    collection: fake.collection,
    doc: fake.doc,
    runTransaction: fake.runTransaction,
  };
});

const po = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po_1',
  poNumber: 'PO-481516',
  supplierId: 'sup_1',
  supplierName: 'Atlas Distributors',
  status: 'sent',
  orderDate: '2026-10-01T09:00:00.000Z',
  items: [
    { productId: 'prod_a', productName: 'iPhone 13', productSku: 'IPH13', requestedQty: 4, receivedQty: 0, unitCost: 600 },
    { productId: 'prod_b', productName: 'USB-C Cable', productSku: 'ACC-USB', requestedQty: 10, receivedQty: 0, unitCost: 2 },
  ],
  totalAmount: 2620,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

/** The server documents a reception reads: the order plus the live stock of its products. */
const seed = (order: PurchaseOrder, stock: Record<string, { stock: number; threshold?: number }>): void => {
  fake.seed(`purchaseOrders/${order.id}`, { ...order } as unknown as FakeDoc);
  for (const [id, value] of Object.entries(stock)) {
    fake.seed(`inventory/${id}`, { stock: value.stock, lowStockThreshold: value.threshold ?? 1 });
  }
};

describe('receivePurchaseOrder', () => {
  beforeEach(() => {
    fake.reset();
  });

  it('writes stock, order lines and restock logs in one commit', async () => {
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0, threshold: 5 } });

    const result = await receivePurchaseOrder('po_1', [
      { productId: 'prod_a', qty: 4 },
      { productId: 'prod_b', qty: 10 },
    ]);

    expect(fake.stats.commits).toBe(1);
    expect(result.status).toBe('completed');
    expect(result.poNumber).toBe('PO-481516');
    expect(fake.stockOf('prod_a')).toBe(6);
    expect(fake.stockOf('prod_b')).toBe(10);
    expect(fake.statusOf('po_1')).toBe('completed');
    expect(fake.receivedQtyOf('po_1', 'prod_a')).toBe(4);

    // stockStatus follows the threshold that lives on the server document, not the caller's copy.
    expect(fake.docs.get('inventory/prod_b')?.stockStatus).toBe('in_stock');
    expect(fake.logs()).toHaveLength(2);
    const cable = fake.logs().find(l => l?.productName === 'USB-C Cable');
    expect(cable).toMatchObject({
      quantityAdded: 10,
      stockBefore: 0,
      stockAfter: 10,
      supplier: 'Atlas Distributors',
      note: 'Received from PO-481516',
      cost: 2,
    });
  });

  it('keeps the order partially received when a line arrives short', async () => {
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0 } });

    const result = await receivePurchaseOrder('po_1', [{ productId: 'prod_a', qty: 3 }]);

    expect(result.status).toBe('partially_received');
    expect(fake.stockOf('prod_a')).toBe(5);
    expect(fake.stockOf('prod_b')).toBe(0);
    expect(fake.logs()).toHaveLength(1);
    expect(result.received[0]).toEqual({
      productId: 'prod_a',
      productName: 'iPhone 13',
      productSku: 'IPH13',
      qty: 3,
      stockBefore: 2,
      stockAfter: 5,
    });
  });

  it('rejects an over-receipt and leaves every document untouched', async () => {
    // The till thinks 1 unit is still owed; the server already has all 4.
    seed(po({ items: [
      { productId: 'prod_a', productName: 'iPhone 13', productSku: 'IPH13', requestedQty: 4, receivedQty: 4, unitCost: 600 },
      { productId: 'prod_b', productName: 'USB-C Cable', productSku: 'ACC-USB', requestedQty: 10, receivedQty: 0, unitCost: 2 },
    ] }), { prod_a: { stock: 4 }, prod_b: { stock: 0 } });

    await expect(receivePurchaseOrder('po_1', [
      { productId: 'prod_a', qty: 1 },
      { productId: 'prod_b', qty: 10 },
    ])).rejects.toThrow(/Cannot receive 1 × iPhone 13/);

    expect(fake.stats.commits).toBe(0);
    // Nothing landed: not the cables that were perfectly valid, and not the order status.
    expect(fake.stockOf('prod_a')).toBe(4);
    expect(fake.stockOf('prod_b')).toBe(0);
    expect(fake.logs()).toHaveLength(0);
    expect(fake.statusOf('po_1')).toBe('sent');
  });

  it('counts a double submit once', async () => {
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0 } });
    const receipts = [{ productId: 'prod_a', qty: 4 }, { productId: 'prod_b', qty: 10 }];

    const settled = await Promise.allSettled([
      receivePurchaseOrder('po_1', receipts),
      receivePurchaseOrder('po_1', receipts),
    ]);

    const fulfilled = settled.filter(r => r.status === 'fulfilled');
    const rejected = settled.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fake.stats.commits).toBe(1);
    expect(fake.stats.aborts).toBe(1);
    expect(fake.stockOf('prod_a')).toBe(6);
    expect(fake.logs()).toHaveLength(2);
  });

  it('aborts when a product was deleted between opening the order and confirming', async () => {
    seed(po(), { prod_a: { stock: 2 } });

    await expect(receivePurchaseOrder('po_1', [
      { productId: 'prod_a', qty: 1 },
      { productId: 'prod_b', qty: 2 },
    ])).rejects.toThrow(/prod_b no longer exists/);

    expect(fake.stockOf('prod_a')).toBe(2);
    expect(fake.logs()).toHaveLength(0);
  });

  it('refuses a receipt that names nothing but zero quantities', async () => {
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0 } });

    await expect(receivePurchaseOrder('po_1', [{ productId: 'prod_a', qty: 0 }])).rejects.toThrow(/Nothing to receive/);
    expect(fake.stats.commits).toBe(0);
  });

  it('refuses a line that is no longer on the order', async () => {
    // prod_ghost is real stock but was taken off this order, so it has nothing to receive into.
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0 } });
    fake.seed('inventory/prod_ghost', { stock: 7, lowStockThreshold: 1 });

    await expect(receivePurchaseOrder('po_1', [{ productId: 'prod_ghost', qty: 5 }]))
      .rejects.toThrow(/no longer on the order/);

    expect(fake.stockOf('prod_a')).toBe(2);
    expect(fake.stockOf('prod_ghost')).toBe(7);
    expect(fake.logs()).toHaveLength(0);
  });
});

describe('purchasingStore.receivePO', () => {
  beforeEach(() => {
    fake.reset();
    storeMocks.fetchProducts.mockClear();
    storeMocks.fetchParts.mockClear();
    storeMocks.logActivity.mockClear();
    usePurchasingStore.setState({ purchaseOrders: [po()], error: null });
  });

  it('puts the received quantities on the order this till shows and reloads inventory', async () => {
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0 } });

    const result = await usePurchasingStore.getState().receivePO('po_1', [
      { productId: 'prod_a', qty: 4 },
      { productId: 'prod_b', qty: 10 },
    ]);

    expect(result.poNumber).toBe('PO-481516');
    const stored = usePurchasingStore.getState().purchaseOrders[0];
    expect(stored.status).toBe('completed');
    expect(stored.items.map(i => i.receivedQty)).toEqual([4, 10]);

    // The transaction bypassed inventoryStore, so the till has to re-read stock from the server.
    expect(storeMocks.fetchProducts).toHaveBeenCalledTimes(1);
    expect(storeMocks.fetchParts).toHaveBeenCalledTimes(1);
    expect(storeMocks.logActivity).toHaveBeenCalledTimes(1);
  });

  it('keeps the order untouched and reloads nothing when the transaction aborts', async () => {
    seed(po(), { prod_a: { stock: 2 }, prod_b: { stock: 0 } });
    const before = usePurchasingStore.getState().purchaseOrders[0];

    await expect(
      usePurchasingStore.getState().receivePO('po_1', [{ productId: 'prod_a', qty: 99 }])
    ).rejects.toThrow(/Cannot receive 99/);

    const after = usePurchasingStore.getState().purchaseOrders[0];
    expect(after).toEqual(before);
    expect(storeMocks.fetchProducts).not.toHaveBeenCalled();
    expect(storeMocks.fetchParts).not.toHaveBeenCalled();
    expect(storeMocks.logActivity).not.toHaveBeenCalled();
    expect(fake.stockOf('prod_a')).toBe(2);
  });
});
