/**
 * Correcting a settled invoice at the server's door.
 *
 * The editor computes a new basket, a shelf diff, a credit-record change and a
 * possible Avoir shift from the copy this till fetched. transactionService.editSale
 * applies the whole correction in one transaction keyed by the revision the till
 * saw: a stale till is refused before anything moves, a lost acknowledgement is
 * adopted instead of applied twice, and two tills editing the same invoice cannot
 * silently overwrite each other.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { transactionService, type SaleEditRequest } from './transactionService';
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

const PHONE = { id: 'sku_phone', name: 'Samsung A55', model: '128GB', price: 10005, stock: 6, lowStockThreshold: 1 } as unknown as PhoneModel;

const sale = (overrides: Partial<SaleTransaction> = {}): SaleTransaction => ({
  id: 'tx1', date: '2026-11-02T10:00:00.000Z', stockApplied: true, status: 'completed',
  financialRevision: 0,
  items: [{ product: PHONE, quantity: 2 }], subtotal: 20000, total: 20000,
  payments: [{ method: 'debt', amount: 20000 }],
  invoiceNumber: 'INV-EDIT', customerId: 'cust_1', customerName: 'Fixture customer',
  ...overrides,
});

const editRequest = (expected: SaleTransaction = sale()): SaleEditRequest => ({
  updates: { items: [{ product: PHONE, quantity: 1 }], subtotal: 10000, total: 10000, payments: [{ method: 'debt' as const, amount: 10000 }], financialRevision: (expected.financialRevision ?? 0) + 1 },
  stockDeltas: [{ productId: 'sku_phone', delta: 1 }],
  creditShift: { customerId: 'cust_1', amount: 10000, note: 'Over-collection held as Avoir' },
  debtUpdate: { debtId: 'debt_1', total: 10000, charged: 10000, itemsSummary: '1x Samsung A55', expectedPaid: 0 },
});

const edit = (expected: SaleTransaction = sale()) => transactionService.editSale(expected, editRequest(expected));
const row = (name: string, id: string) => fake.docs.get(`${name}/${id}`);

beforeEach(() => {
  fake.docs.clear(); fake.versions.clear(); fake.runTransaction.mockClear();
  fake.flags.reject = false; fake.flags.loseAck = false;
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', localStorageMock);
  mockStorage.clear();
  fake.write('transactions/tx1', { ...sale() });
  fake.write('inventory/sku_phone', { name: 'Samsung A55', stock: 6, price: 10005 });
  fake.write('customers/cust_1', { name: 'Fixture customer', storeCredit: 0, totalDebt: 20000, creditLimit: 25000 });
  fake.write('customer_debts/debt_1', {
    id: 'debt_1', customerId: 'cust_1', customerName: 'Fixture customer', totalAmount: 20000,
    amountPaid: 0, remainingBalance: 20000, status: 'unpaid', transactionId: 'tx1',
    invoiceNumber: 'INV-EDIT', payments: [],
  });
});

describe('transactionService.editSale', () => {
  it('commits the invoice, the shelf, the credit record and the Avoir together', async () => {
    const result = await edit();
    expect(result.transaction).toMatchObject({ total: 10000, financialRevision: 1 });
    expect(result.stock).toEqual([expect.objectContaining({ id: 'sku_phone', stock: 7 })]);
    expect(result.debt).toMatchObject({ totalAmount: 10000, remainingBalance: 10000 });
    expect(result.customer).toMatchObject({ storeCredit: 10000 });
    expect(row('transactions', 'tx1')).toMatchObject({ total: 10000, financialRevision: 1 });
    expect(row('operation_receipts', 'sale_edit_tx1_1')?.kind).toBe('sale_edit');
    expect(JSON.parse(mockStorage.get('offline_transactions') || '[]')[0]).toMatchObject({ id: 'tx1', total: 10000 });
  });

  it('adopts a correction a lost acknowledgement actually committed, without moving twice', async () => {
    fake.flags.loseAck = true;
    await expect(edit()).rejects.toThrow('Acknowledgement lost');
    const stock = row('inventory', 'sku_phone')?.stock;
    const result = await edit();
    expect(result.transaction.total).toBe(10000);
    expect(row('inventory', 'sku_phone')?.stock).toBe(stock);
  });

  it('refuses a stale till whose invoice moved on another device, before anything is written', async () => {
    fake.write('transactions/tx1', { financialRevision: 1, total: 15000 });
    await expect(edit()).rejects.toThrow(/changed on another device/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
    expect(row('customers', 'cust_1')?.storeCredit).toBe(0);
    expect(row('customer_debts', 'debt_1')?.remainingBalance).toBe(20000);
    expect(fake.docs.has('operation_receipts/sale_edit_tx1_1')).toBe(false);
  });

  it('two tills correcting the same revision serialize; the second adopts the first outcome', async () => {
    const results = await Promise.allSettled([edit(), edit()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(row('inventory', 'sku_phone')?.stock).toBe(7);
    expect(row('transactions', 'tx1')?.financialRevision).toBe(1);
  });

  it('refuses a closed invoice', async () => {
    fake.write('transactions/tx1', { status: 'refunded' });
    await expect(edit(sale({ status: 'refunded' }))).rejects.toThrow(/closed/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('refuses an invoice whose shelf movement never landed', async () => {
    fake.write('transactions/tx1', { stockApplied: false });
    await expect(edit(sale({ stockApplied: false }))).rejects.toThrow(/not finished syncing/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('refuses a credit record that received a payment on another device', async () => {
    fake.write('customer_debts/debt_1', { amountPaid: 3000, remainingBalance: 17000, status: 'partially_paid' });
    await expect(edit()).rejects.toThrow(/payment on another device/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('refuses when the Avoir needed for the correction was already spent', async () => {
    // The correction takes 10 000 back off the account (negative shift).
    const request = editRequest();
    request.creditShift = { customerId: 'cust_1', amount: -10000, note: 'Avoir released' };
    await expect(transactionService.editSale(sale(), request)).rejects.toThrow(/already been spent/);
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
  });

  it('refuses a missing product before anything moves', async () => {
    fake.docs.delete('inventory/sku_phone');
    await expect(edit()).rejects.toThrow(/no longer exists/);
    expect(row('transactions', 'tx1')?.financialRevision ?? 0).toBe(0);
    expect(row('customers', 'cust_1')?.storeCredit).toBe(0);
  });

  it('an offline till cannot edit, and nothing local is stamped', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(edit()).rejects.toThrow(/Connect and sync/);
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(mockStorage.get('offline_transactions')).toBeUndefined();
  });

  it('a server refusal leaves the invoice, shelf and account untouched', async () => {
    fake.flags.reject = true;
    await expect(edit()).rejects.toThrow('permission-denied');
    expect(row('transactions', 'tx1')).toMatchObject({ total: 20000 });
    expect(row('inventory', 'sku_phone')?.stock).toBe(6);
    expect(row('customers', 'cust_1')?.storeCredit).toBe(0);
    expect(fake.docs.has('operation_receipts/sale_edit_tx1_1')).toBe(false);
  });

  it('a price-only correction with no stock, debt or Avoir still commits atomically', async () => {
    const expected = sale({ payments: [{ method: 'cash', amount: 20000 }], customerId: undefined });
    fake.write('transactions/tx1', { ...expected });
    fake.docs.delete('customer_debts/debt_1');
    const request = editRequest(expected);
    request.stockDeltas = [];
    delete request.creditShift;
    delete request.debtUpdate;
    const result = await transactionService.editSale(expected, request);
    expect(result.transaction.total).toBe(10000);
    expect(row('operation_receipts', 'sale_edit_tx1_1')?.kind).toBe('sale_edit');
  });
});
