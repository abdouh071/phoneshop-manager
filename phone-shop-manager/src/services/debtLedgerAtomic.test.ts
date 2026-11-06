/**
 * The credit ledger when two terminals write the same entry.
 *
 * `amountPaid` and `payments` are stored whole, so whoever writes last decides what the
 * entry says. The online path used to compute both from this device's localStorage
 * mirror and only fall back to a server read when the mirror had no row at all — which
 * meant the mirror was always preferred whenever it existed, however old it was. The
 * phone could take 3000 and the till would then write its own older total plus the new
 * payment, dropping the 3000 from the ledger while the customer had genuinely paid it.
 *
 * The fake here enforces Firestore's own precondition: a document read inside a
 * transaction may not move before that transaction commits. That turns a silent lost
 * update into an observable abort.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { debtService } from './debtService';
import type { CustomerDebtEntry } from '../types';

type FakeDoc = Record<string, unknown>;
interface FakeRef { id: string; key: string }
interface FakeTx {
  get: (ref: FakeRef) => Promise<{ exists: () => boolean; data: () => FakeDoc | undefined }>;
  update: (ref: FakeRef, data: FakeDoc) => void;
}

const fake = vi.hoisted(() => {
  const docs = new Map<string, FakeDoc>();
  const versions = new Map<string, number>();
  const stats = { commits: 0, aborts: 0, reads: 0 };

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
    /** Another terminal writes while our transaction is still open. */
    interleave: null as null | (() => void),
    seed(id: string, data: object): void {
      docs.set(`customer_debts/${id}`, { ...data } as FakeDoc);
      versions.set(`customer_debts/${id}`, 0);
    },
    entry(id: string): FakeDoc | undefined {
      return docs.get(`customer_debts/${id}`);
    },
    /** Write straight to the server, bypassing the transaction, as a second device would. */
    serverWrite(id: string, data: FakeDoc): void {
      writeOf(`customer_debts/${id}`, data);
    },
    reset(): void {
      docs.clear();
      versions.clear();
      stats.commits = 0;
      stats.aborts = 0;
      stats.reads = 0;
      this.interleave = null;
    },
    doc: (_db: unknown, collectionName: string, id: string): FakeRef => ({ id, key: `${collectionName}/${id}` }),
    updateDoc: async (ref: FakeRef, data: FakeDoc): Promise<void> => { writeOf(ref.key, data); },
    runTransaction: async (_db: unknown, fn: (tx: FakeTx) => Promise<unknown>) => {
      const reads = new Map<string, number>();
      const writes: Array<{ key: string; data: FakeDoc }> = [];

      const tx: FakeTx = {
        get: async (ref: FakeRef) => {
          reads.set(ref.key, versionOf(ref.key));
          stats.reads++;
          return snapshotOf(ref.key);
        },
        update: (ref: FakeRef, data: FakeDoc) => {
          if (!reads.has(ref.key)) throw new Error(`Fake transaction: update without read (${ref.key})`);
          writes.push({ key: ref.key, data });
        },
      };

      const result = await fn(tx);
      fake.interleave?.();

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

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    updateDoc: fake.updateDoc,
    runTransaction: fake.runTransaction,
  };
});

const mockStorage = new Map<string, string>();
const MIRROR_KEY = 'offline_customer_debts';

const mirror = (rows: Partial<CustomerDebtEntry>[]): void => {
  mockStorage.set(MIRROR_KEY, JSON.stringify(rows));
};

const readMirror = (): CustomerDebtEntry[] => JSON.parse(mockStorage.get(MIRROR_KEY) || '[]');

const entry = (overrides: Partial<CustomerDebtEntry> = {}): CustomerDebtEntry => ({
  id: 'debt_1',
  customerId: 'cust_1',
  customerName: 'Yacine',
  customerPhone: '0550000000',
  productOrService: 'Samsung A55',
  date: '2026-11-01T10:00:00.000Z',
  totalAmount: 10000,
  amountPaid: 2000,
  remainingBalance: 8000,
  status: 'partially_paid',
  payments: [{ id: 'pay_1', date: '2026-11-01T10:00:00.000Z', amount: 2000, method: 'cash' }],
  createdAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
} as CustomerDebtEntry);

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mockStorage.get(key) || null,
    setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  });
  mockStorage.clear();
  fake.reset();
});

describe('a payment recorded against the shop\'s ledger', () => {
  it('adds to what the server holds, not to what this device remembers', async () => {
    // The phone took 3000 after this till last refreshed. The mirror still says 2000.
    fake.seed('debt_1', entry({
      amountPaid: 5000,
      remainingBalance: 5000,
      payments: [
        { id: 'pay_1', date: '2026-11-01T10:00:00.000Z', amount: 2000, method: 'cash' },
        { id: 'pay_2', date: '2026-11-05T10:00:00.000Z', amount: 3000, method: 'cash' },
      ],
    }));
    mirror([entry()]);

    const updated = await debtService.recordPayment('debt_1', { amount: 1000, method: 'cash' });

    expect(fake.stats.reads).toBe(1);
    expect(updated.amountPaid).toBe(6000);
    expect(updated.remainingBalance).toBe(4000);
    expect(fake.entry('debt_1')?.amountPaid).toBe(6000);
    expect(fake.entry('debt_1')?.remainingBalance).toBe(4000);
  });

  it('keeps the payment another terminal recorded', async () => {
    fake.seed('debt_1', entry({
      amountPaid: 5000,
      remainingBalance: 5000,
      payments: [
        { id: 'pay_1', date: '2026-11-01T10:00:00.000Z', amount: 2000, method: 'cash' },
        { id: 'pay_2', date: '2026-11-05T10:00:00.000Z', amount: 3000, method: 'cash' },
      ],
    }));
    mirror([entry()]);

    const updated = await debtService.recordPayment('debt_1', { amount: 1000, method: 'cash' });

    const ids = (updated.payments || []).map(p => p.id);
    expect(ids).toContain('pay_2');
    expect(ids).toHaveLength(3);
    // The day's drawer reads these rows: dropping one loses the money from the reports
    // even when the balance happens to look right.
    const stored = fake.entry('debt_1')?.payments as Array<{ id: string }>;
    expect(stored.map(p => p.id)).toContain('pay_2');
  });

  it('settles the entry against the server balance, not the remembered one', async () => {
    fake.seed('debt_1', entry({ amountPaid: 9000, remainingBalance: 1000, payments: [] }));
    mirror([entry()]);

    const updated = await debtService.recordPayment('debt_1', { amount: 1000, method: 'cash' });

    expect(updated.amountPaid).toBe(10000);
    expect(updated.remainingBalance).toBe(0);
    expect(updated.status).toBe('paid');
  });

  it('refuses to write over an entry that moved while it was reading', async () => {
    fake.seed('debt_1', entry());
    mirror([entry()]);
    // A second terminal commits between this transaction's read and its write.
    fake.interleave = () => fake.serverWrite('debt_1', { amountPaid: 7000, remainingBalance: 3000 });

    await debtService.recordPayment('debt_1', { amount: 1000, method: 'cash' });

    expect(fake.stats.aborts).toBe(1);
    expect(fake.stats.commits).toBe(0);
    // The other terminal's money is still on the server: the aborted write took nothing.
    expect(fake.entry('debt_1')?.amountPaid).toBe(7000);
  });

  it('leaves the offline entry on this device, where the server has never seen it', async () => {
    mirror([entry({ id: 'offline_debt_9' })]);

    const updated = await debtService.recordPayment('offline_debt_9', { amount: 1000, method: 'cash' });

    expect(updated.amountPaid).toBe(3000);
    expect(fake.stats.reads).toBe(0);
    expect(readMirror()[0].amountPaid).toBe(3000);
  });
});

describe('an invoice total corrected on the credit entry', () => {
  it('keeps the balance from the server so a paid-down debt stays paid down', async () => {
    // The till's mirror still says 2000 paid; the phone has since taken 6000. Recomputing
    // the balance from the mirror would put 8000 back on the customer's name.
    fake.seed('debt_1', entry({ amountPaid: 6000, remainingBalance: 4000 }));
    mirror([entry()]);

    const updated = await debtService.updateDebtAmount('debt_1', 9000, 'Samsung A55 + case');

    expect(updated.totalAmount).toBe(9000);
    expect(updated.amountPaid).toBe(6000);
    expect(updated.remainingBalance).toBe(3000);
    expect(updated.productOrService).toBe('Samsung A55 + case');
    expect(fake.entry('debt_1')?.remainingBalance).toBe(3000);
  });

  it('marks the entry paid when the corrected total is already covered', async () => {
    fake.seed('debt_1', entry({ amountPaid: 6000, remainingBalance: 4000 }));
    mirror([entry()]);

    const updated = await debtService.updateDebtAmount('debt_1', 5000);

    expect(updated.remainingBalance).toBe(0);
    expect(updated.status).toBe('paid');
  });
});