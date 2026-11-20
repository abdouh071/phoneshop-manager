/**
 * The refund at the server's door.
 *
 * The till's list is whatever it last fetched, so two tills can both hold `completed`
 * for an invoice one of them is closing. transactionService.refund reads the status
 * and the whole reversal in one transaction: the first claim wins, a later one adopts
 * the recorded outcome instead of moving anything again, and a half-finished refund
 * is either completed exactly once or refused without touching the shelf or account.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { transactionService } from './transactionService';
import type { PhoneModel, SaleTransaction } from '../types';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  const flags = { reject: false, loseAck: false };
  let queue = Promise.resolve() as Promise<unknown>;
  const write = (key: string, data: Record<string, unknown>) => {
    docs.set(key, { ...docs.get(key), ...data });
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const ref = (name: string, id: string) => ({ name, id, key: `${name}/${id}` });
  return {
    docs, versions, flags, write,
    doc: (_db: unknown, name: string, id: string) => ref(name, id),
    collection: (_db: unknown, name: string) => name,
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    query: (name: string, filter: { field: string; value: unknown }) => ({ name, filter }),
    getDocsFromServer: async ({ name, filter }: { name: string; filter: { field: string; value: unknown } }) => ({
      docs: [...docs].filter(([key, data]) => key.startsWith(`${name}/`) && data[filter.field] === filter.value).map(([key]) => ({ ref: ref(...(key.split('/') as [string, string])) })),
    }),
    runTransaction: vi.fn(async (_db: unknown, callback: (tx: {
      get: (ref: { key: string; id: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown>; id: string }>;
      update: (ref: { key: string }, patch: Record<string, unknown>) => void;
      set: (ref: { key: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>) => {
      // Serialize like Firestore's transaction runner, so concurrent refunds of one
      // invoice observe each other instead of both starting from the same snapshot.
      const run = queue.then(async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const reads = new Map<string, number>();
          const writes: { key: string; patch: Record<string, unknown> }[] = [];
          const result = await callback({
            get: async ref => {
              if (writes.length) throw new Error('Read after write');
              reads.set(ref.key, versions.get(ref.key) ?? 0);
              const data = docs.get(ref.key);
              return { exists: () => data !== undefined, data: () => structuredClone(data ?? {}), id: ref.id };
            },
            update: (ref, patch) => {
              if (!docs.has(ref.key)) throw new Error('Missing update target');
              writes.push({ key: ref.key, patch });
            },
            set: (ref, data) => { writes.push({ key: ref.key, patch: data }); },
          });
          if (flags.reject) throw new Error('permission-denied');
          if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) continue;
          for (const { key, patch } of writes) write(key, patch);
          if (flags.loseAck) { flags.loseAck = false; throw new Error('Acknowledgement lost'); }
          return result;
        }
        throw new Error('Contention');
      });
      queue = run.catch(() => undefined);
      return run;
    }),
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    collection: fake.collection,
    where: fake.where,
    query: fake.query,
    getDocsFromServer: fake.getDocsFromServer,
    runTransaction: fake.runTransaction,
    Timestamp: { now: () => 'fixture-timestamp' },
  };
});

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

const ACTOR = { id: 'staff-1', name: 'Counter', role: 'sales' };
const PHONE = { id: 'sku_phone', name: 'Samsung A55', model: '128GB', price: 10005, stock: 6, lowStockThreshold: 1 } as unknown as PhoneModel;
const EXCHANGE = (extra: Partial<SaleTransaction['exchangeSummary']> = {}): SaleTransaction['exchangeSummary'] => ({
  hasReturn: false, returnedTotal: 0, purchasedTotal: 0, netDifference: 0, ...extra,
});

const sale = (overrides: Partial<SaleTransaction> = {}): SaleTransaction => ({
  id: 'tx1', date: '2026-11-02T10:00:00.000Z', stockApplied: true, status: 'completed',
  items: [{ product: PHONE, quantity: 2 }], subtotal: 20000, total: 20000,
  payments: [{ method: 'debt', amount: 20000 }],
  invoiceNumber: 'INV-REFUND', customerId: 'cust_1', customerName: 'Fixture customer',
  ...overrides,
});

const refund = (expected: SaleTransaction = sale()) => transactionService.refund(expected, ACTOR);
const row = (name: string, id: string) => fake.docs.get(`${name}/${id}`);

beforeEach(() => {
  fake.docs.clear(); fake.versions.clear(); fake.runTransaction.mockClear();
  fake.flags.reject = false; fake.flags.loseAck = false;
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', localStorageMock);
  mockStorage.clear();
  fake.write('transactions/tx1', { ...sale() });
  fake.write('inventory/sku_phone', { name: 'Samsung A55', stock: 6, price: 10005 });
  fake.write('customers/cust_1', { name: 'Fixture customer', storeCredit: 0, totalDebt: 20000, totalSpent: 0, totalPurchases: 0, creditLimit: 25000 });
  fake.write('customer_debts/debt_1', {
    id: 'debt_1', customerId: 'cust_1', customerName: 'Fixture customer', totalAmount: 20000,
    amountPaid: 0, remainingBalance: 20000, status: 'unpaid', transactionId: 'tx1',
    invoiceNumber: 'INV-REFUND', payments: [],
  });
});

describe('transactionService.refund', () => {
  it('reverses the shelf, the debt and the invoice in one transaction', async () => {
    const result = await refund();
    expect(result.outcome).toBe('refunded');
    expect(result.stock).toEqual([expect.objectContaining({ id: 'sku_phone', stock: 8 })]);
    expect(result.debt).toMatchObject({ status: 'paid', remainingBalance: 0 });
    expect(result.customer).toMatchObject({ totalDebt: 0 });
    expect(row('transactions', 'tx1')).toMatchObject({ status: 'refunded', financialRevision: 1 });
    expect(row('operation_receipts', 'sale_refund_tx1')?.kind).toBe('sale_refund');
    expect(row('activityLogs', 'sale_refund_tx1')).toBeDefined();
    expect(JSON.parse(mockStorage.get('offline_transactions') || '[]')[0]).toMatchObject({ id: 'tx1', status: 'refunded' });
  });

  it('adopts a refund a lost acknowledgement actually committed, without moving again', async () => {
    fake.flags.loseAck = true;
    await expect(refund()).rejects.toThrow('Acknowledgement lost');
    const stock = row('inventory', 'sku_phone')?.stock;
    const result = await refund();
    expect(result.outcome).toBe('refunded');
    expect(row('inventory', 'sku_phone')?.stock).toBe(stock);
    expect(row('transactions', 'tx1')?.status).toBe('refunded');
  });

  it('adopts a refund the concurrent first caller committed, without moving again', async () => {
    const results = await Promise.allSettled([refund(), refund()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(row('inventory', 'sku_phone')?.stock).toBe(8);
    expect(fake.docs.get('operation_receipts/sale_refund_tx1')?.kind).toBe('sale_refund');
  });

  it('a sale the phone already voided is closed for the counter too', async () => {
    fake.write('transactions/tx1', { status: 'voided', voidedAt: '2026-11-04T11:00:00.000Z' });
    const result = await refund();
    expect(result.outcome).toBe('already_closed');
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
    expect(fake.docs.has('operation_receipts/sale_refund_tx1')).toBe(false);
  });

  it('a cancelled sale never took the money and cannot be refunded', async () => {
    fake.write('transactions/tx1', { status: 'cancelled' });
    const result = await refund();
    expect(result.outcome).toBe('already_closed');
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('a sale the server no longer holds is an error, not a silent local refund', async () => {
    fake.docs.delete('transactions/tx1');
    await expect(refund()).rejects.toThrow(/no longer exists/);
  });

  it('an invoice changed on another device is refused until the till refreshes', async () => {
    fake.write('transactions/tx1', { total: 18000 });
    await expect(refund()).rejects.toThrow(/changed on another device/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
    expect(row('customer_debts', 'debt_1')?.remainingBalance).toBe(20000);
  });

  it('an unfinished invoice whose shelf movement never landed is refused before the refund moves', async () => {
    fake.write('transactions/tx1', { stockApplied: false });
    await expect(refund(sale({ stockApplied: false }))).rejects.toThrow(/not fully processed/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('an offline till cannot refund, and nothing local is stamped', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(refund()).rejects.toThrow(/Connect and sync/);
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(mockStorage.get('offline_transactions')).toBeUndefined();
  });

  it('a server refusal leaves the invoice, shelf and account untouched', async () => {
    fake.flags.reject = true;
    await expect(refund()).rejects.toThrow('permission-denied');
    expect(row('transactions', 'tx1')?.status).toBe('completed');
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
    expect(row('customer_debts', 'debt_1')?.remainingBalance).toBe(20000);
    expect(fake.docs.has('operation_receipts/sale_refund_tx1')).toBe(false);
  });

  it('keeps money already collected on the debt as Avoir on the account', async () => {
    fake.write('customer_debts/debt_1', { amountPaid: 5000, remainingBalance: 15000, status: 'partially_paid' });
    const result = await refund();
    expect(result.customer).toMatchObject({ storeCredit: 5000, totalDebt: 0, totalSpent: 0 });
  });

  it('restores Avoir the customer spent on the sale', async () => {
    fake.write('transactions/tx1', { exchangeSummary: EXCHANGE({ storeCreditUsed: 3000 }) });
    const result = await refund(sale({ exchangeSummary: EXCHANGE({ storeCreditUsed: 3000 }) }));
    expect(result.customer).toMatchObject({ storeCredit: 3000 });
  });

  it('refuses when a charged invoice has no resolvable credit record', async () => {
    fake.docs.delete('customer_debts/debt_1');
    await expect(refund()).rejects.toThrow(/credit record is missing or ambiguous/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('refuses when the linked customer cannot be reached', async () => {
    fake.write('customers/cust_1', { mergedIntoId: 'other' });
    await expect(refund()).rejects.toThrow(/missing or merged/);
    expect(row('transactions', 'tx1')?.status).toBe('completed');
  });

  it('restores exchange lines off the shelf with their sign', async () => {
    const exchanged = sale({
      items: [
        { product: { ...PHONE, id: 'sku_a' }, quantity: 1 },
        { product: { ...PHONE, id: 'sku_b' }, quantity: 1, isReturn: true },
      ],
    });
    fake.write('inventory/sku_a', { name: 'A', stock: 2 });
    fake.write('inventory/sku_b', { name: 'B', stock: 2 });
    fake.write('transactions/tx1', { ...exchanged });
    const result = await refund(exchanged);
    expect(result.stock).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sku_a', stock: 3 }),
      expect.objectContaining({ id: 'sku_b', stock: 1 }),
    ]));
  });

  it('refuses an exchange surplus that deducted earlier debts without recorded payments', async () => {
    const deduction = sale({ total: -500, exchangeSummary: EXCHANGE({ refundType: 'debt_deduction', netDifference: -500 }) });
    fake.write('transactions/tx1', { ...deduction });
    await expect(refund(deduction)).rejects.toThrow(/earlier debts/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('refuses invalid item quantities before anything moves', async () => {
    const broken = sale({ items: [{ product: PHONE, quantity: 1.5 }] });
    fake.write('transactions/tx1', { ...broken });
    await expect(refund(broken)).rejects.toThrow(/invalid item quantities/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });
});
