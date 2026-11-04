/**
 * Idempotency of the offline replay paths.
 *
 * The fake below is collection-aware and evaluates where() clauses, which is what makes
 * "add once, then adopt on re-run" testable: a duplicate sale is a second document in
 * `transactions`, and nothing less than a per-collection store can show it.
 *
 * `loseTheWrite` and `failBulkCommitAfter` exist because the failure this file is about is
 * not "the write failed" — it is "the write succeeded and this device was told otherwise",
 * which is what a 2.5-second race against a slow line actually leaves behind.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addIdempotently, newIdempotencyKey, replayKeyOf } from './idempotentReplay';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';
import { customerLogService } from './customerLogService';
import { inventoryService } from './inventoryService';
import { repairService } from './repairService';

type FakeDoc = Record<string, unknown>;
interface FakeWhere { field: string; op: string; value: unknown }
interface FakeCollectionRef { collection: string }
interface FakeDocRef { collection: string; id: string }
interface FakeQuery { collection: string; filters: FakeWhere[]; take?: number }

const fake = vi.hoisted(() => {
  const collections = new Map<string, Map<string, FakeDoc>>();
  const counters = { adds: 0, lookups: 0, bulkCommits: 0 };
  const flags = {
    failLookups: false,
    /** The document is written, then the caller is told the write failed. */
    loseTheWrite: false,
    /** Commit #k lands and then reports failure for every k above this count; null never fails. */
    failBulkCommitAfter: null as number | null,
  };
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
      counters.bulkCommits = 0;
      flags.failLookups = false;
      flags.loseTheWrite = false;
      flags.failBulkCommitAfter = null;
      seq = 0;
    },
    collection: (_db: unknown, name: string): FakeCollectionRef => ({ collection: name }),
    // `doc(db, 'counters', 'repairs')` and `doc(collection(db, 'inventory'))` both appear.
    doc: (target: unknown, pathOrDb?: unknown, id?: string): FakeDocRef => {
      if (typeof target === 'string') return { collection: target, id: String(pathOrDb) };
      const ref = target as FakeCollectionRef;
      return { collection: ref.collection, id: id ?? `srv_auto_${++seq}` };
    },
    // The ticket counter is unreachable here, so intake falls back to local numbering —
    // the path a shop takes whenever the line is slow.
    getDoc: async (): Promise<never> => {
      throw new Error('Fake: the counter is unreachable');
    },
    runTransaction: async (): Promise<never> => {
      throw new Error('Fake: the counter is unreachable');
    },
    writeBatch: () => {
      const writes: FakeDocRef[] = [];
      const payloads: FakeDoc[] = [];
      return {
        set: (ref: FakeDocRef, data: FakeDoc) => {
          writes.push(ref);
          payloads.push(data);
        },
        commit: async () => {
          const attempt = ++counters.bulkCommits;
          writes.forEach((ref, idx) => collOf(ref.collection).set(ref.id, { ...payloads[idx] }));
          const mustFail = flags.failBulkCommitAfter !== null && attempt > flags.failBulkCommitAfter;
          if (mustFail) throw new Error('Fake: batch commit was not acknowledged');
        },
      };
    },
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
      if (flags.loseTheWrite) throw new Error('Fake: Firestore addDoc timeout');
      return { id };
    },
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    collection: fake.collection,
    doc: fake.doc,
    getDoc: fake.getDoc,
    runTransaction: fake.runTransaction,
    writeBatch: fake.writeBatch,
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
    const localTickets = (): Array<{ id: string; ticketNumber?: string }> =>
      JSON.parse(localStorage.getItem('offline_repairs') || '[]');

    it('uploads a ticket whose number already belongs to another device', async () => {
      // Two intakes minted TKT-0042 while each device was cut off. Matching an existing
      // document by that number used to hand this ticket over to the other device's
      // document: the sync reported it as synced, the counter's own job was never
      // uploaded, and the phone left the bench unrecorded.
      fake.seed('repairs', 'srv_other_device', { ticketNumber: 'TKT-0042', customerName: 'Sofiane' });
      localStorage.setItem('offline_repairs', JSON.stringify([
        { id: 'offline_tkt_9', ticketNumber: 'TKT-0042', customerName: 'Karim' },
      ]));

      expect(await unifiedOfflineSyncService.syncOfflineRepairs()).toBe(1);
      expect(fake.counters.adds).toBe(1);
      expect(fake.docsIn('repairs')).toHaveLength(2);
      expect(localTickets()[0].id).not.toBe('srv_other_device');
    });

    it('adopts the ticket the server committed under the key this device wrote', async () => {
      fake.seed('repairs', 'srv_committed_ticket', {
        ticketNumber: 'TKT-0042',
        customerName: 'Karim',
        idempotencyKey: 'ticket_landed',
      });
      localStorage.setItem('offline_repairs', JSON.stringify([
        { id: 'offline_tkt_9', ticketNumber: 'TKT-0042', customerName: 'Karim', idempotencyKey: 'ticket_landed' },
      ]));

      expect(await unifiedOfflineSyncService.syncOfflineRepairs()).toBe(1);
      expect(fake.counters.adds).toBe(0);
      expect(fake.docsIn('repairs')).toHaveLength(1);
      expect(localTickets()[0].id).toBe('srv_committed_ticket');
    });
  });

  describe('a create the counter never heard about', () => {
    /** The write reaches the server; the caller is told it timed out and files the record locally. */
    const writeLandedButWasLost = () => {
      fake.flags.loseTheWrite = true;
    };

    it('stamps a customer log so the replay recognises it and posts it once', async () => {
      writeLandedButWasLost();
      const logged = await customerLogService.log({
        customerId: 'cust_1',
        customerName: 'Karim',
        actionType: 'note_added',
        actionTitle: 'Phone unreachable',
        actionDescription: 'Left a message with the neighbour',
        actorName: 'Abdou',
      });
      fake.flags.loseTheWrite = false;

      // The event is filed under an id this device invented, so the only thing the next
      // pass can find the committed document by is the key the log was written with.
      expect(logged.id).toMatch(/^offline_log_/);
      expect(logged.idempotencyKey).toBeTruthy();
      const landed = fake.docsIn('customer_activity_logs');
      expect(landed).toHaveLength(1);
      expect(landed[0].data.idempotencyKey).toBe(logged.idempotencyKey);

      expect(await unifiedOfflineSyncService.syncOfflineLogs()).toBe(1);
      expect(fake.counters.adds).toBe(1);
      expect(fake.docsIn('customer_activity_logs')).toHaveLength(1);
      const stored = JSON.parse(localStorage.getItem('offline_customer_activity_logs') || '[]');
      expect(stored[0].id).toBe(landed[0].id);
    });

    it('stamps a product the same way, so one SKU stays one document', async () => {
      writeLandedButWasLost();
      const created = await inventoryService.addProduct({
        name: 'Xiaomi Redmi 13',
        model: 'Redmi 13',
        brand: 'Xiaomi',
        price: 62000,
        costPrice: 51000,
        stock: 4,
        stockStatus: 'in_stock',
        sku: 'XIAO-R13-256',
        category: 'smartphone',
        lowStockThreshold: 1,
      });
      fake.flags.loseTheWrite = false;

      expect(created.id).toMatch(/^offline_prod_/);
      const landed = fake.docsIn('inventory');
      expect(landed).toHaveLength(1);
      expect(landed[0].data.idempotencyKey).toBe(created.idempotencyKey);

      expect(await unifiedOfflineSyncService.syncOfflineProducts()).toBe(1);
      expect(fake.counters.adds).toBe(1);
      expect(fake.docsIn('inventory')).toHaveLength(1);
      expect(inventoryService.getPendingProducts()).toHaveLength(0);
    });

    it('stamps a repair ticket so the board shows the job, not a copy of it', async () => {
      writeLandedButWasLost();
      const created = await repairService.createTicket({
        customerName: 'Karim',
        customerPhone: '0555123456',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 13',
        issueDescription: 'Screen replacement',
        estimatedCost: 15000,
        status: 'pending',
      });
      fake.flags.loseTheWrite = false;

      expect(created.id).toMatch(/^offline_tkt_/);
      const landed = fake.docsIn('repairs');
      expect(landed).toHaveLength(1);
      expect(landed[0].data.idempotencyKey).toBe(created.idempotencyKey);

      expect(await unifiedOfflineSyncService.syncOfflineRepairs()).toBe(1);
      expect(fake.counters.adds).toBe(1);
      expect(fake.docsIn('repairs')).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem('offline_repairs') || '[]')[0].id).toBe(landed[0].id);
    });
  });

  describe('a bulk import whose commit was not acknowledged', () => {
    const row = (idx: number) => ({
      name: `Part ${idx}`,
      model: `P-${idx}`,
      price: 1000,
      costPrice: 500,
      stock: 10,
      stockStatus: 'in_stock' as const,
      sku: `PRT-${idx}`,
      category: 'repair_part' as const,
      lowStockThreshold: 2,
    });

    it('re-queues only its own rows, and the replay adopts what already landed', async () => {
      fake.flags.failBulkCommitAfter = 0;
      const created = await inventoryService.addProductsBulk([row(1), row(2)]);
      fake.flags.failBulkCommitAfter = null;

      expect(created.every(p => p.id.startsWith('offline_prod_'))).toBe(true);
      expect(inventoryService.getPendingProducts()).toHaveLength(2);

      // The batch was applied; the counter was simply never told.
      const landed = fake.docsIn('inventory');
      expect(landed).toHaveLength(2);

      expect(await unifiedOfflineSyncService.syncOfflineProducts()).toBe(2);
      expect(fake.docsIn('inventory')).toHaveLength(2);
      expect(inventoryService.getPendingProducts()).toHaveLength(0);
    });

    it('keeps the rows a finished batch already committed out of the queue', async () => {
      // 501 rows is two batches: the first one lands and is acknowledged, the second is lost.
      // The old catch filed the entire sheet as pending, so those 500 SKUs were imported twice.
      const sheet = Array.from({ length: 501 }, (_, idx) => row(idx + 1));
      fake.flags.failBulkCommitAfter = 1;
      const created = await inventoryService.addProductsBulk(sheet);
      fake.flags.failBulkCommitAfter = null;

      const pending = inventoryService.getPendingProducts();
      expect(pending).toHaveLength(1);
      expect(created).toHaveLength(501);
      expect(created.filter(p => p.id.startsWith('offline_prod_'))).toHaveLength(1);
      expect(fake.docsIn('inventory')).toHaveLength(501);

      expect(await unifiedOfflineSyncService.syncOfflineProducts()).toBe(1);
      expect(fake.docsIn('inventory')).toHaveLength(501);
    });
  });
});
