/**
 * Idempotency of the offline replay paths.
 *
 * The fake below is collection-aware and evaluates where() clauses, which is what makes
 * "add once, then adopt on re-run" testable: a duplicate sale is a second document in
 * `transactions`, and nothing less than a per-collection store can show it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addIdempotently, newIdempotencyKey, replayKeyOf } from './idempotentReplay';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';

type FakeDoc = Record<string, unknown>;
interface FakeWhere { field: string; op: string; value: unknown }
interface FakeCollectionRef { collection: string }
interface FakeQuery { collection: string; filters: FakeWhere[]; take?: number }

const fake = vi.hoisted(() => {
  const collections = new Map<string, Map<string, FakeDoc>>();
  const counters = { adds: 0, lookups: 0 };
  const flags = { failLookups: false };
  let seq = 0;

  const collOf = (name: string): Map<string, FakeDoc> => {
    let existing = collections.get(name);
    if (!existing) {
      existing = new Map<string, FakeDoc>();
      collections.set(name, existing);
    }
    return existing;
  };

  const matches = (actual: unknown, op: string, expected: unknown): boolean => {
    if (op === '==') return actual === expected;
    if (op === '!=') return actual !== expected;
    return false;
  };

  return {
    counters,
    flags,
    docsIn(name: string): Array<{ id: string; data: FakeDoc }> {
      return [...collOf(name).entries()].map(([id, data]) => ({ id, data }));
    },
    seed(name: string, id: string, data: FakeDoc): void {
      collOf(name).set(id, { ...data });
    },
    reset(): void {
      collections.clear();
      counters.adds = 0;
      counters.lookups = 0;
      flags.failLookups = false;
      seq = 0;
    },
    collection: (_db: unknown, name: string): FakeCollectionRef => ({ collection: name }),
    where: (field: string, op: string, value: unknown): FakeWhere => ({ field, op, value }),
    limit: (n: number): { take: number } => ({ take: n }),
    query: (base: FakeCollectionRef, ...clauses: Array<FakeWhere | { take: number }>): FakeQuery => {
      const filters: FakeWhere[] = [];
      let take: number | undefined;
      for (const clause of clauses) {
        if ('field' in clause) filters.push(clause);
        else take = clause.take;
      }
      return { collection: base.collection, filters, take };
    },
    getDocs: async (q: FakeQuery) => {
      counters.lookups++;
      if (flags.failLookups) throw new Error('Fake: duplicate lookup failed');
      const matched = [...collOf(q.collection).entries()].filter(([, data]) =>
        q.filters.every(f => matches(data[f.field], f.op, f.value))
      );
      const limited = q.take !== undefined ? matched.slice(0, q.take) : matched;
      const docs = limited.map(([id, data]) => ({ id, data: () => ({ ...data }) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
    addDoc: async (ref: FakeCollectionRef, data: FakeDoc) => {
      counters.adds++;
      const id = `srv_${++seq}`;
      collOf(ref.collection).set(id, { ...data });
      return { id };
    },
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    collection: fake.collection,
    query: fake.query,
    where: fake.where,
    limit: fake.limit,
    getDocs: fake.getDocs,
    addDoc: fake.addDoc,
  };
});

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

const OFFLINE_SALE = {
  id: 'offline_tx_1',
  total: 5000,
  cash: 5000,
  customerName: 'Karim',
  items: [],
};

describe('Offline replay idempotency', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('navigator', { onLine: true });
    localStorageMock.clear();
    fake.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('addIdempotently', () => {
    it('stamps the replay key and adopts the existing document on a second call', async () => {
      const first = await addIdempotently('transactions', 'offline_tx_1', { total: 5000 });
      const second = await addIdempotently('transactions', 'offline_tx_1', { total: 5000 });

      expect(second).toBe(first);
      expect(fake.counters.adds).toBe(1);
      expect(fake.docsIn('transactions')).toHaveLength(1);
      expect(fake.docsIn('transactions')[0].data.idempotencyKey).toBe('offline_tx_1');
    });

    it('lets a failed duplicate lookup propagate instead of adding a blind copy', async () => {
      fake.flags.failLookups = true;

      await expect(addIdempotently('transactions', 'offline_tx_1', { total: 5000 })).rejects.toThrow();
      expect(fake.counters.adds).toBe(0);
      expect(fake.docsIn('transactions')).toHaveLength(0);
    });
  });

  describe('the key a record replays under', () => {
    it('prefers the stamp the record was written with over the local temporary id', () => {
      expect(replayKeyOf({ idempotencyKey: 'tx_landed' }, 'offline_tx_1')).toBe('tx_landed');
    });

    it('falls back to the temporary id for records stored before the stamp existed', () => {
      expect(replayKeyOf({}, 'offline_tx_1')).toBe('offline_tx_1');
      expect(replayKeyOf({ idempotencyKey: '' }, 'offline_tx_1')).toBe('offline_tx_1');
      expect(replayKeyOf({ idempotencyKey: 42 }, 'offline_tx_1')).toBe('offline_tx_1');
    });

    it('gives two sales written in the same millisecond different keys', () => {
      const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey('tx')));
      expect(keys.size).toBe(50);
      for (const key of keys) expect(key).toMatch(/^tx_[a-z0-9]+_[a-z0-9]+$/);
    });
  });

  describe('syncOfflineTransactions', () => {
    const storedSales = (): Array<{ id: string }> =>
      JSON.parse(localStorage.getItem('offline_transactions') || '[]');

    it('does not double-post a sale killed between the write and the local rewrite', async () => {
      localStorage.setItem('offline_transactions', JSON.stringify([OFFLINE_SALE]));

      expect(await unifiedOfflineSyncService.syncOfflineTransactions()).toBe(1);
      expect(fake.docsIn('transactions')).toHaveLength(1);
      const realId = fake.docsIn('transactions')[0].id;
      expect(storedSales()[0].id).toBe(realId);

      // The app died after the Firestore write but before the local rewrite, so the sale
      // is still sitting under its temporary id. Re-running must repair, not re-post.
      localStorage.setItem('offline_transactions', JSON.stringify([OFFLINE_SALE]));

      expect(await unifiedOfflineSyncService.syncOfflineTransactions()).toBe(1);
      expect(fake.counters.adds).toBe(1);
      expect(fake.docsIn('transactions')).toHaveLength(1);
      expect(storedSales()[0].id).toBe(realId);
    });

    it('keeps the sale queued when the duplicate check cannot run', async () => {
      localStorage.setItem('offline_transactions', JSON.stringify([OFFLINE_SALE]));
      fake.flags.failLookups = true;

      expect(await unifiedOfflineSyncService.syncOfflineTransactions()).toBe(0);
      expect(fake.counters.adds).toBe(0);
      expect(storedSales()[0].id).toBe('offline_tx_1');
      expect(unifiedOfflineSyncService.getTotalPendingCount()).toBe(1);
    });

    it('adopts a sale the server committed while the counter was looking at a timeout', async () => {
      // transactionService.save races addDoc against 2.5s and stores the sale locally
      // when it loses — but the write often lands anyway. The document on the server
      // carries the key the sale was minted with, which is the only thing the replay
      // can find it by: the temporary id exists solely on this machine.
      fake.seed('transactions', 'srv_committed', {
        total: 5000,
        idempotencyKey: 'tx_landed',
      });
      localStorage.setItem(
        'offline_transactions',
        JSON.stringify([{ ...OFFLINE_SALE, idempotencyKey: 'tx_landed' }])
      );

      expect(await unifiedOfflineSyncService.syncOfflineTransactions()).toBe(1);
      expect(fake.counters.adds).toBe(0);
      expect(fake.docsIn('transactions')).toHaveLength(1);
      expect(storedSales()[0].id).toBe('srv_committed');
    });
  });

  describe('syncOfflineRepairs', () => {
    it('still adopts a ticket uploaded before replay keys existed, by ticket number', async () => {
      fake.seed('repairs', 'srv_legacy', { ticketNumber: 'TKT-0012', customerName: 'Karim' });
      localStorage.setItem('offline_repairs', JSON.stringify([
        { id: 'offline_tkt_9', ticketNumber: 'TKT-0012', customerName: 'Karim' },
      ]));

      expect(await unifiedOfflineSyncService.syncOfflineRepairs()).toBe(1);
      expect(fake.counters.adds).toBe(0);
      expect(JSON.parse(localStorage.getItem('offline_repairs') || '[]')[0].id).toBe('srv_legacy');
    });
  });
});
