import { beforeEach, describe, expect, it, vi } from 'vitest';
import { locks } from 'node:worker_threads';
import type { PhoneModel, SaleTransaction } from '../types';
import { partsCheckoutService } from './partsCheckoutService';

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
  const flags = { reject: false, loseAck: false, beforeCommit: null as (() => Promise<void>) | null };
  const write = (key: string, data: Data) => {
    docs.set(key, { ...docs.get(key), ...data });
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const ref = (key: string): Ref => ({ key, id: key.split('/').at(-1)! });
  return {
    docs, versions, flags, write,
    doc: (_db: unknown, collection: string, id: string) => ref(`${collection}/${id}`),
    collection: (_db: unknown, name: string) => name,
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    query: (name: string, filter: { field: string; value: unknown }) => ({ name, filter }),
    getDocsFromServer: async ({ name, filter }: { name: string; filter: { field: string; value: unknown } }) => ({
      docs: [...docs].filter(([key, data]) => key.startsWith(`${name}/`) && data[filter.field] === filter.value).map(([key]) => ({ ref: ref(key) })),
    }),
    runTransaction: vi.fn(async (_db: unknown, callback: (tx: Tx) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>();
        const writes: { key: string; data: Data }[] = [];
        const stage = (ref: Ref, data: Data) => { writes.push({ key: ref.key, data }); };
        const result = await callback({
          get: async ref => {
            if (writes.length) throw new Error('Read after write');
            reads.set(ref.key, versions.get(ref.key) ?? 0);
            const data = docs.get(ref.key);
            return { exists: () => data !== undefined, data: () => structuredClone(data ?? {}) };
          },
          update: (ref, data) => {
            if (!docs.has(ref.key)) throw new Error('Missing update target');
            stage(ref, data);
          },
          set: stage,
        });
        const gate = flags.beforeCommit;
        flags.beforeCommit = null;
        if (gate) await gate();
        if (flags.reject) throw new Error('permission-denied');
        if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) continue;
        for (const { key, data } of writes) write(key, data);
        if (flags.loseAck) { flags.loseAck = false; throw new Error('Acknowledgement lost'); }
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
const product = (id: string): PhoneModel => ({ id, name: id, stock: 999, price: 100, costPrice: 50, lowStockThreshold: 1 } as PhoneModel);
const sale = (actorId = 'cashier-A'): Omit<SaleTransaction, 'id'> => ({
  date: '2026-11-17T10:00:00Z', processedById: actorId, processedByName: 'Fixture cashier',
  invoiceNumber: 'FIXTURE-1', saleType: 'parts_b2b', status: 'completed',
  items: ['A', 'B'].map(id => ({ product: product(id), quantity: 1 })),
  subtotal: 200, total: 200, payments: [{ method: 'cash', amount: 200 }],
});
const creditSale = (actorId = 'cashier-A'): Omit<SaleTransaction, 'id'> => ({
  ...sale(actorId), customerId: 'customer-1', customerName: 'Fixture customer',
  payments: [{ method: 'card', amount: 50 }],
  accountSettlement: { type: 'partial_payment', paidAmount: 50, chargedAmount: 150 },
});
const checkout = (input = sale()) => partsCheckoutService.checkout(input, { draftKey: 'fixture-draft', actorRole: 'sales' });
const documents = (collection: string) => [...fake.docs].filter(([key]) => key.startsWith(`${collection}/`));
const stock = (id: string) => fake.docs.get(`inventory/${id}`)?.stock;

beforeEach(() => {
  fake.docs.clear(); fake.versions.clear(); fake.runTransaction.mockClear();
  fake.flags.reject = false; fake.flags.loseAck = false; fake.flags.beforeCommit = null;
  fake.write('inventory/A', { name: 'A', stock: 2, price: 100 });
  fake.write('inventory/B', { name: 'B', stock: 2, price: 100 });
  fake.write('customers/customer-1', { name: 'Fixture customer', phone: '0550000000', totalDebt: 0, creditLimit: 250 });
  storage = new Map();
  vi.stubGlobal('navigator', { onLine: true, locks });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});

describe('atomic Parts checkout', () => {
  it('commits the complete invoice, all stock and the receipt together', async () => {
    const result = await checkout();
    expect(result.transaction).toMatchObject({ stockApplied: true, total: 200 });
    expect(stock('A')).toBe(1); expect(stock('B')).toBe(1);
    expect(documents('transactions')).toHaveLength(1);
    expect(documents('operation_receipts')).toHaveLength(1);
    expect(documents('customer_debts')).toHaveLength(0);
    expect(partsCheckoutService.getPending('cashier-A')?.transaction.id).toBe(result.transaction?.id);
  });

  it('rejects the whole sale when any line lacks stock, without compensation', async () => {
    fake.write('inventory/B', { stock: 0 });
    await expect(checkout()).rejects.toThrow('INSUFFICIENT_STOCK');
    expect(stock('A')).toBe(2);
    expect(documents('transactions')).toHaveLength(0);
    expect(documents('operation_receipts')).toHaveLength(0);
  });

  it('folds repeated product lines into a single authoritative deduction', async () => {
    const input = sale(); input.items[1] = { product: product('A'), quantity: 1 };
    await checkout(input);
    expect(stock('A')).toBe(0); expect(stock('B')).toBe(2);
  });

  it('allows only one competing till to buy the last units', async () => {
    fake.write('inventory/A', { stock: 1 }); fake.write('inventory/B', { stock: 1 });
    const results = await Promise.allSettled([checkout(sale('A')), checkout(sale('B'))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(stock('A')).toBe(0); expect(stock('B')).toBe(0);
    expect(documents('transactions')).toHaveLength(1);
  });

  it('adopts the same checkout raced by two callers only once', async () => {
    const [one, two] = await Promise.all([checkout(), checkout()]);
    expect(one.transaction?.id).toBe(two.transaction?.id);
    expect(stock('A')).toBe(1);
    expect(documents('transactions')).toHaveLength(1);
  });

  it('refuses a checkout before writing when journal locking is unavailable', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await expect(checkout()).rejects.toThrow('cannot protect checkout recovery');
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(storage.has('parts_checkout_journal')).toBe(false);
  });

  it('waits for the shared journal lock before minting or clearing an identity', async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = locks.request('parts_checkout_journal', () => new Promise<void>(resolve => { release = resolve; entered(); }));
    await ready;
    const attempt = checkout();
    expect(storage.has('parts_checkout_journal')).toBe(false);
    expect(fake.runTransaction).not.toHaveBeenCalled();
    release();
    await gate;
    const result = await attempt;
    expect(partsCheckoutService.getPending('cashier-A')?.transaction.id).toBe(result.transaction?.id);
    await partsCheckoutService.acknowledge('cashier-A', 'other-operation');
    expect(partsCheckoutService.getPending('cashier-A')).not.toBeNull();
    await partsCheckoutService.acknowledge('cashier-A', result.transaction!.id);
    expect(partsCheckoutService.getPending('cashier-A')).toBeNull();
  });

  it('retains the operation identity through a lost acknowledgement and module restart', async () => {
    fake.flags.loseAck = true;
    await expect(checkout()).rejects.toThrow('Acknowledgement lost');
    const id = partsCheckoutService.getPending('cashier-A')!.transaction.id;
    vi.resetModules();
    const restarted = (await import('./partsCheckoutService')).partsCheckoutService;
    const result = await restarted.checkout({ ...sale(), date: '2026-11-18T12:00:00Z', invoiceNumber: 'IGNORED' }, { draftKey: 'fixture-draft' });
    expect(result.transaction?.id).toBe(id);
    expect(result.transaction?.invoiceNumber).toBe('FIXTURE-1');
    expect(stock('A')).toBe(1);
    expect(documents('transactions')).toHaveLength(1);
  });

  it('does not mistake a changed cart for a retry', async () => {
    fake.flags.loseAck = true;
    await expect(checkout()).rejects.toThrow();
    await expect(checkout({ ...sale(), customerName: 'Other customer' })).rejects.toThrow('previous checkout');
    expect(documents('transactions')).toHaveLength(1);
  });

  it('atomically creates the linked debt with actual opening tender', async () => {
    const result = await checkout(creditSale());
    expect(result.debtEntry).toMatchObject({ transactionId: result.transaction!.id, amountPaid: 50, remainingBalance: 150 });
    expect(result.transaction?.accountSettlement?.debtEntryId).toBe(result.debtEntry?.id);
    expect(result.debtEntry?.payments[0]).toMatchObject({ method: 'card', amount: 50, countedOn: 'sale' });
    expect(fake.docs.get('customers/customer-1')?.totalDebt).toBe(150);
    expect(documents('customer_activity_logs')).toHaveLength(1);
    await checkout(creditSale());
    expect(documents('customer_debts')).toHaveLength(1);
    expect(stock('A')).toBe(1);
  });

  it('uses current debts rather than a stale customer total for the credit limit', async () => {
    fake.write('customer_debts/previous', { customerId: 'customer-1', remainingBalance: 200, status: 'unpaid' });
    await expect(checkout(creditSale())).rejects.toThrow('Credit limit exceeded');
    expect(stock('A')).toBe(2);
    expect(documents('transactions')).toHaveLength(0);
    expect(documents('customer_debts')).toHaveLength(1);
  });

  it('serializes competing account sales against the credit limit', async () => {
    const results = await Promise.allSettled([checkout(creditSale('A')), checkout(creditSale('B'))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(documents('customer_debts')).toHaveLength(1);
    expect(fake.docs.get('customers/customer-1')?.totalDebt).toBe(150);
  });

  it('allows an explicitly approved over-limit sale', async () => {
    fake.write('customers/customer-1', { creditLimit: 100 });
    await partsCheckoutService.checkout(creditSale(), { draftKey: 'fixture', allowCreditLimitOverride: true, actorRole: 'sales' });
    expect(documents('customer_debts')).toHaveLength(1);
  });

  it('can approve a refused request without changing its retry identity', async () => {
    fake.write('customers/customer-1', { creditLimit: 100 });
    await expect(checkout(creditSale())).rejects.toThrow('Credit limit exceeded');
    const id = partsCheckoutService.getPending('cashier-A')!.transaction.id;
    const result = await partsCheckoutService.checkout(creditSale(), { draftKey: 'fixture-draft', allowCreditLimitOverride: true, actorRole: 'sales' });
    expect(result.transaction?.id).toBe(id);
    expect(documents('customer_debts')).toHaveLength(1);
  });

  it('reconciles confirmed invoice, debt, customer and inventory caches on recovery', async () => {
    storage.set('offline_transactions', JSON.stringify([{ id: 'older', total: 10 }]));
    storage.set('offline_inventory', JSON.stringify([{ id: 'A', stock: 999 }]));
    fake.flags.loseAck = true;
    await expect(checkout(creditSale())).rejects.toThrow();
    const result = await partsCheckoutService.resolve('cashier-A');
    const invoices = JSON.parse(storage.get('offline_transactions')!);
    expect(invoices).toHaveLength(2);
    expect(invoices[0].id).toBe(result?.transaction?.id);
    expect(JSON.parse(storage.get('offline_inventory')!).find((p: PhoneModel) => p.id === 'A').stock).toBe(1);
    expect(JSON.parse(storage.get('offline_customers')!)[0].totalDebt).toBe(150);
    expect(JSON.parse(storage.get('offline_customer_debts')!)[0].transactionId).toBe(result?.transaction?.id);
    await partsCheckoutService.resolve('cashier-A');
    expect(JSON.parse(storage.get('offline_transactions')!)).toHaveLength(2);
  });

  it('does not turn a cache failure into a refused committed sale', async () => {
    storage.set('offline_transactions', 'broken cache');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await checkout();
    expect(result.transaction).toBeDefined();
    expect(documents('transactions')).toHaveLength(1);
    expect(partsCheckoutService.getPending('cashier-A')).not.toBeNull();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it.each(['null', '[]', '{"cashier-A":{}}', 'invalid'])('refuses an unreadable journal: %s', async raw => {
    storage.set('parts_checkout_journal', raw);
    await expect(checkout()).rejects.toThrow();
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(storage.get('parts_checkout_journal')).toBe(raw);
  });

  it('never links a walk-in by a matching name', async () => {
    await checkout({ ...sale(), customerName: 'Fixture customer' });
    expect(documents('transactions')[0][1].customerId).toBeUndefined();
    expect(documents('customer_debts')).toHaveLength(0);
  });

  it('refuses missing or merged accounts without moving stock', async () => {
    fake.write('customers/customer-1', { mergedIntoId: 'other' });
    await expect(checkout(creditSale())).rejects.toThrow('manually');
    expect(stock('A')).toBe(2);
  });

  it('never returns a locally successful sale on server refusal or offline', async () => {
    fake.flags.reject = true;
    await expect(checkout(creditSale())).rejects.toThrow('permission-denied');
    expect(documents('transactions')).toHaveLength(0);
    expect(documents('customer_debts')).toHaveLength(0);
    expect(stock('A')).toBe(2);
    vi.stubGlobal('navigator', { onLine: false });
    fake.runTransaction.mockClear();
    await expect(checkout()).rejects.toThrow('Connect to the server');
    expect(fake.runTransaction).not.toHaveBeenCalled();
  });

  it('refuses to start if the retry identity cannot be persisted', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Disk full'); } });
    await expect(checkout()).rejects.toThrow('Disk full');
    expect(fake.runTransaction).not.toHaveBeenCalled();
  });

  it('resolves a committed attempt without cancelling or repeating it', async () => {
    fake.flags.loseAck = true;
    await expect(checkout(creditSale())).rejects.toThrow();
    const result = await partsCheckoutService.resolve('cashier-A');
    expect(result).toMatchObject({ cancelled: false, transaction: { total: 200 }, debtEntry: { remainingBalance: 150 } });
    expect(stock('A')).toBe(1);
    expect(documents('transactions')).toHaveLength(1);
  });

  it('cancels an uncommitted attempt without creating an invoice or moving stock', async () => {
    fake.flags.reject = true;
    await expect(checkout()).rejects.toThrow();
    fake.flags.reject = false;
    const result = await partsCheckoutService.resolve('cashier-A');
    expect(result?.cancelled).toBe(true);
    expect(stock('A')).toBe(2);
    expect(documents('transactions')).toHaveLength(0);
    await expect(checkout()).rejects.toThrow('cancelled');
    await partsCheckoutService.acknowledge('cashier-A', result!.pending.transaction.id);
    expect(partsCheckoutService.getPending('cashier-A')).toBeNull();
  });

  it('makes cancellation conflict with a late original commit', async () => {
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    fake.flags.beforeCommit = async () => { started(); await new Promise<void>(resolve => { release = resolve; }); };
    const attempt = checkout();
    const rejected = expect(attempt).rejects.toThrow('cancelled');
    await waiting;
    const resolved = await partsCheckoutService.resolve('cashier-A');
    expect(resolved?.cancelled).toBe(true);
    release();
    await rejected;
    expect(stock('A')).toBe(2);
    expect(documents('transactions')).toHaveLength(0);
  });

  it('refuses inconsistent settlement amounts before sending a transaction', async () => {
    await expect(checkout({ ...sale(), payments: [{ method: 'cash', amount: 300 }] })).rejects.toThrow('match the invoice');
    expect(fake.runTransaction).not.toHaveBeenCalled();
  });
});
