import { beforeEach, describe, expect, it, vi } from 'vitest';
import { locks } from 'node:worker_threads';
import type { PhoneModel, SaleTransaction } from '../types';
import { retailCheckoutService } from './retailCheckoutService';

type Data = Record<string, unknown>;
type Ref = { key: string; id: string };
type Tx = {
  get: (ref: Ref) => Promise<{ exists: () => boolean; data: () => Data }>;
  update: (ref: Ref, data: Data) => void;
  set: (ref: Ref, data: Data) => void;
};

const fake = vi.hoisted(() => {
  const docs = new Map<string, Data>();
  const versions = new Map<string, number>();
  const flags = {
    reject: false,
    loseAck: false,
    beforeCommit: null as (() => Promise<void>) | null,
  };
  const write = (key: string, data: Data) => {
    docs.set(key, { ...docs.get(key), ...data });
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const ref = (key: string): Ref => ({ key, id: key.split('/').at(-1)! });
  return {
    docs,
    versions,
    flags,
    write,
    doc: (_db: unknown, collection: string, id: string) => ref(`${collection}/${id}`),
    collection: (_db: unknown, name: string) => name,
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    query: (name: string, filter: { field: string; value: unknown }) => ({ name, filter }),
    getDocsFromServer: async ({ name, filter }: { name: string; filter: { field: string; value: unknown } }) => ({
      docs: [...docs]
        .filter(([key, data]) => key.startsWith(`${name}/`) && data[filter.field] === filter.value)
        .map(([key]) => ({ ref: ref(key) })),
    }),
    runTransaction: vi.fn(async (_db: unknown, callback: (tx: Tx) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>();
        const writes: { key: string; data: Data }[] = [];
        const stage = (r: Ref, data: Data) => { writes.push({ key: r.key, data }); };
        const result = await callback({
          get: async r => {
            if (writes.length) throw new Error('Read after write');
            reads.set(r.key, versions.get(r.key) ?? 0);
            const data = docs.get(r.key);
            return { exists: () => data !== undefined, data: () => structuredClone(data ?? {}) };
          },
          update: (r, data) => {
            if (!docs.has(r.key)) throw new Error('Missing update target');
            stage(r, data);
          },
          set: stage,
        });
        const gate = flags.beforeCommit;
        flags.beforeCommit = null;
        if (gate) await gate();
        if (flags.reject) throw new Error('permission-denied');
        if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) continue;
        for (const { key, data } of writes) write(key, data);
        if (flags.loseAck) {
          flags.loseAck = false;
          throw new Error('Acknowledgement lost');
        }
        return result;
      }
      throw new Error('Contention');
    }),
  };
});

vi.mock('firebase/firestore', () => ({ ...fake, Timestamp: { now: () => 'fixture-timestamp' } }));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('./offlineQueueMirror', () => ({ offlineQueueMirror: { write: vi.fn() } }));

let storage: Map<string, string>;
const phone = (id: string, price = 1000): PhoneModel =>
  ({ id, name: id, model: 'Std', stock: 999, price, costPrice: 500, lowStockThreshold: 1 } as PhoneModel);

const makeSale = (actorId = 'seller-1', overrides: Partial<Omit<SaleTransaction, 'id'>> = {}): Omit<SaleTransaction, 'id'> => ({
  date: '2026-11-18T10:00:00Z',
  processedById: actorId,
  processedByName: 'Retail Cashier',
  invoiceNumber: 'INV-261118-0001',
  saleType: 'retail',
  status: 'completed',
  items: [
    { product: phone('A', 1000), quantity: 1 },
    { product: phone('B', 500), quantity: 2 },
  ],
  subtotal: 2000,
  total: 2000,
  payments: [{ method: 'cash', amount: 2000 }],
  ...overrides,
});

const documents = (col: string) => [...fake.docs].filter(([k]) => k.startsWith(`${col}/`));
const stockOf = (id: string, col = 'inventory') => fake.docs.get(`${col}/${id}`)?.stock;

beforeEach(() => {
  fake.docs.clear();
  fake.versions.clear();
  fake.runTransaction.mockClear();
  fake.flags.reject = false;
  fake.flags.loseAck = false;
  fake.flags.beforeCommit = null;
  fake.write('inventory/A', { name: 'A', stock: 3, price: 1000, lowStockThreshold: 1 });
  fake.write('inventory/B', { name: 'B', stock: 4, price: 500, lowStockThreshold: 1 });
  fake.write('customers/cust-1', {
    name: 'Amine',
    phone: '0555000001',
    storeCredit: 1500,
    totalDebt: 2000,
    creditLimit: 5000,
    totalSpent: 0,
    totalPurchases: 0,
  });
  fake.write('customer_debts/debt-old', {
    id: 'debt-old',
    customerId: 'cust-1',
    customerName: 'Amine',
    date: '2026-11-01T10:00:00Z',
    totalAmount: 2000,
    amountPaid: 0,
    remainingBalance: 2000,
    status: 'unpaid',
    payments: [],
  });
  storage = new Map();
  vi.stubGlobal('navigator', { onLine: true, locks });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
});

describe('atomic retail checkout', () => {
  it('reads all product/account docs before writes and commits multi-product sale together', async () => {
    const result = await retailCheckoutService.checkout(makeSale(), { draftKey: 'd1', actorRole: 'sales_agent' });
    expect(result.transaction).toMatchObject({
      saleType: 'retail',
      stockApplied: true,
      validationStatus: 'confirmed',
      total: 2000,
    });
    expect(stockOf('A')).toBe(2);
    expect(stockOf('B')).toBe(2);
    expect(documents('transactions')).toHaveLength(1);
    expect(documents('operation_receipts')).toHaveLength(1);
  });

  it('rejects overselling any product instead of clamping to zero and leaves everything untouched', async () => {
    fake.write('inventory/B', { stock: 1 });
    await expect(
      retailCheckoutService.checkout(makeSale(), { draftKey: 'd1', actorRole: 'sales_agent' })
    ).rejects.toThrow('INSUFFICIENT_STOCK');
    expect(stockOf('A')).toBe(3);
    expect(stockOf('B')).toBe(1);
    expect(documents('transactions')).toHaveLength(0);
    expect(documents('operation_receipts')).toHaveLength(0);
  });

  it('prevents two competing tills from spending the same Avoir storeCredit balance', async () => {
    const txA = makeSale('till-A', {
      customerId: 'cust-1',
      customerName: 'Amine',
      payments: [{ method: 'store_credit', amount: 1000 }, { method: 'cash', amount: 1000 }],
      exchangeSummary: { hasReturn: false, returnedTotal: 0, purchasedTotal: 2000, netDifference: 2000, storeCreditUsed: 1000 },
    });
    const txB = makeSale('till-B', {
      customerId: 'cust-1',
      customerName: 'Amine',
      payments: [{ method: 'store_credit', amount: 1000 }, { method: 'cash', amount: 1000 }],
      exchangeSummary: { hasReturn: false, returnedTotal: 0, purchasedTotal: 2000, netDifference: 2000, storeCreditUsed: 1000 },
    });

    const results = await Promise.allSettled([
      retailCheckoutService.checkout(txA, { draftKey: 'd-A', actorRole: 'sales_agent', storeCreditUsed: 1000 }),
      retailCheckoutService.checkout(txB, { draftKey: 'd-B', actorRole: 'sales_agent', storeCreditUsed: 1000 }),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(fake.docs.get('customers/cust-1')?.storeCredit).toBe(500);
    expect(documents('transactions')).toHaveLength(1);
    expect(documents('customer_activity_logs')).toHaveLength(1);
  });

  it('treats lost acknowledgement / timeout as uncertain and adopts late commit once without double-deducting', async () => {
    fake.flags.loseAck = true;
    const saleInput = makeSale('seller-1', {
      customerId: 'cust-1',
      customerName: 'Amine',
      payments: [{ method: 'store_credit', amount: 500 }, { method: 'cash', amount: 1500 }],
      exchangeSummary: { hasReturn: false, returnedTotal: 0, purchasedTotal: 2000, netDifference: 2000, storeCreditUsed: 500 },
    });

    await expect(
      retailCheckoutService.checkout(saleInput, { draftKey: 'd1', actorRole: 'sales_agent', storeCreditUsed: 500 })
    ).rejects.toThrow();

    expect(stockOf('A')).toBe(2);
    expect(fake.docs.get('customers/cust-1')?.storeCredit).toBe(1000);
    expect(retailCheckoutService.getPending('seller-1')?.uncertain).toBe(true);

    const replay = await retailCheckoutService.checkout(saleInput, {
      draftKey: 'd1',
      actorRole: 'sales_agent',
      storeCreditUsed: 500,
    });
    expect(replay.transaction?.id).toBeDefined();
    expect(stockOf('A')).toBe(2);
    expect(fake.docs.get('customers/cust-1')?.storeCredit).toBe(1000);
    expect(documents('transactions')).toHaveLength(1);
  });

  it('applies exchange debt_deduction surplus atomically as noncash and spills extra surplus into Avoir once', async () => {
    const returnSale = makeSale('seller-1', {
      customerId: 'cust-1',
      customerName: 'Amine',
      items: [{ product: phone('A', 2500), quantity: 1, isReturn: true, restock: true, customReturnPrice: 2500 }],
      subtotal: -2500,
      total: -2500,
      payments: [{ method: 'debt', amount: -2500 }],
      exchangeSummary: { hasReturn: true, returnedTotal: 2500, purchasedTotal: 0, netDifference: -2500, refundType: 'debt_deduction' },
    });

    const result = await retailCheckoutService.checkout(returnSale, {
      draftKey: 'd-ret',
      actorRole: 'sales_agent',
      refundType: 'debt_deduction',
    });

    expect(result.transaction?.stockApplied).toBe(true);
    expect(stockOf('A')).toBe(4);
    expect(fake.docs.get('customer_debts/debt-old')).toMatchObject({ remainingBalance: 0, status: 'paid' });
    // 2000 cleared debt, remaining 500 added to existing 1500 storeCredit = 2000
    expect(fake.docs.get('customers/cust-1')).toMatchObject({ totalDebt: 0, storeCredit: 2000 });
  });
});
