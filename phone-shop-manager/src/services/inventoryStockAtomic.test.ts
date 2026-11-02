/**
 * Atomicity of the stock write paths.
 *
 * The rest of the suite mocks only localStorage with `navigator.onLine = false`, so the
 * online Firestore branch is never exercised. Here the firestore module is replaced by a
 * fake whose runTransaction enforces the same precondition Firestore does — a document
 * read by the transaction may not move before commit — which turns a lost update
 * (two tills selling the same model) into an observable abort instead of silent data loss.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inventoryService, commitStockDelta } from './inventoryService';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';

type FakeDoc = Record<string, unknown>;
interface FakeRef { id: string; key: string }

const fake = vi.hoisted(() => {
  const docs = new Map<string, FakeDoc>();
  const versions = new Map<string, number>();
  const stats = { commits: 0, aborts: 0 };
  const flags = { failWrites: false };

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
    flags,
    seed(id: string, data: FakeDoc): void {
      docs.set(`inventory/${id}`, { ...data });
      versions.set(`inventory/${id}`, 0);
    },
    stockOf(id: string): number | undefined {
      return docs.get(`inventory/${id}`)?.stock as number | undefined;
    },
    exists(id: string): boolean {
      return docs.has(`inventory/${id}`);
    },
    reset(): void {
      docs.clear();
      versions.clear();
      stats.commits = 0;
      stats.aborts = 0;
      flags.failWrites = false;
    },
    doc: (_db: unknown, collectionName: string, id: string): FakeRef => ({ id, key: `${collectionName}/${id}` }),
    getDoc: async (ref: FakeRef) => snapshotOf(ref.key),
    updateDoc: async (ref: FakeRef, data: FakeDoc): Promise<void> => {
      if (flags.failWrites) throw new Error('Fake: Firestore write rejected');
      writeOf(ref.key, data);
    },
    deleteDoc: async (ref: FakeRef): Promise<void> => { docs.delete(ref.key); },
    addDoc: async (_coll: unknown, data: FakeDoc) => {
      const id = `gen_${docs.size + 1}`;
      writeOf(`inventory/${id}`, data);
      return { id, key: `inventory/${id}` };
    },
    getDocs: async () => ({
      empty: true,
      size: 0,
      docs: [] as Array<{ id: string; data: () => FakeDoc }>,
    }),
    runTransaction: async (_db: unknown, fn: (tx: FakeTx) => Promise<unknown>) => {
      const reads = new Map<string, number>();
      const writes: Array<{ key: string; data: FakeDoc }> = [];

      const tx: FakeTx = {
        get: async (ref: FakeRef) => {
          reads.set(ref.key, versionOf(ref.key));
          return snapshotOf(ref.key);
        },
        update: (ref: FakeRef, data: FakeDoc) => {
          // Firestore rejects an update to a document this transaction never read.
          if (!reads.has(ref.key)) throw new Error(`Fake transaction: update without read (${ref.key})`);
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
}

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    getDoc: fake.getDoc,
    updateDoc: fake.updateDoc,
    deleteDoc: fake.deleteDoc,
    addDoc: fake.addDoc,
    getDocs: fake.getDocs,
    runTransaction: fake.runTransaction,
  };
});

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

/** Server document + this device's localStorage mirror, deliberately out of sync. */
const seedProduct = (serverStock: number, mirrorStock: number): void => {
  fake.seed('prod_1', { stock: serverStock, lowStockThreshold: 1, name: 'USB-C Cable' });
  inventoryService.saveLocalInventory([
    {
      id: 'prod_1',
      name: 'USB-C Cable',
      model: 'Universal',
      category: 'accessory',
      stock: mirrorStock,
      price: 500,
      cost: 200,
      costPrice: 200,
      sku: 'ACC-USB-C',
      lowStockThreshold: 1,
      stockStatus: 'in_stock',
    },
  ]);
};

describe('Atomic stock writes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.clear();
    fake.reset();
    inventoryService.savePendingStockAdjustments([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('commitStockDelta', () => {
    it('reads the server document and writes current + delta', async () => {
      seedProduct(10, 10);

      const result = await commitStockDelta('prod_1', -3);

      expect(result).toEqual({ previousStock: 10, stock: 7, stockStatus: 'in_stock' });
      expect(fake.stockOf('prod_1')).toBe(7);
    });

    it('never drives the server stock below zero', async () => {
      seedProduct(2, 2);

      const result = await commitStockDelta('prod_1', -50);

      expect(result.stock).toBe(0);
      expect(result.stockStatus).toBe('out_of_stock');
      expect(fake.stockOf('prod_1')).toBe(0);
    });
  });

  describe('inventoryService.applyStockDelta', () => {
    it('applies the delta to server stock, ignoring this device\'s stale mirror', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      // Another till already sold 7 units from this device's cached view of 10.
      seedProduct(10, 3);

      const result = await inventoryService.applyStockDelta('prod_1', -2);

      expect(result.atomic).toBe(true);
      expect(result.previousStock).toBe(10);
      expect(result.updated.stock).toBe(8);
      expect(fake.stockOf('prod_1')).toBe(8);
      // The mirror is reconciled to the authoritative value, and nothing was queued.
      expect(inventoryService.getLocalInventory()[0].stock).toBe(8);
      expect(inventoryService.getPendingStockAdjustments()).toHaveLength(0);
    });

    it('serializes two concurrent sales of the same model instead of losing one', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedProduct(5, 5);

      const [first, second] = await Promise.all([
        inventoryService.applyStockDelta('prod_1', -1),
        inventoryService.applyStockDelta('prod_1', -1),
      ]);

      const committed = [first, second].filter(r => r.atomic);
      const queued = [first, second].filter(r => !r.atomic);
      expect(committed).toHaveLength(1);
      expect(queued).toHaveLength(1);
      expect(fake.stats.commits).toBe(1);
      expect(fake.stats.aborts).toBe(1);
      expect(fake.stockOf('prod_1')).toBe(4);

      const pending = inventoryService.getPendingStockAdjustments();
      expect(pending).toHaveLength(1);
      expect(pending[0].delta).toBe(-1);
      expect(pending[0].mode).toBe('relative');

      // The loser replays as a delta, so both sales are counted.
      expect(await unifiedOfflineSyncService.syncOfflineStockAdjustments()).toBe(1);
      expect(fake.stockOf('prod_1')).toBe(3);
      expect(inventoryService.getPendingStockAdjustments()).toHaveLength(0);
    });

    it('queues a relative delta when the device is offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      seedProduct(10, 10);

      const result = await inventoryService.applyStockDelta('prod_1', -2);

      expect(result.atomic).toBe(false);
      expect(fake.stats.commits).toBe(0);
      const pending = inventoryService.getPendingStockAdjustments();
      expect(pending).toHaveLength(1);
      expect(pending[0].mode).toBe('relative');
      expect(pending[0].delta).toBe(-2);
    });
  });

  describe('unifiedOfflineSyncService.syncOfflineStockAdjustments', () => {
    const queue = (entry: { id: string; delta: number; newStock?: number; mode?: 'relative' | 'absolute' }) => {
      inventoryService.savePendingStockAdjustments([
        { ...entry, productId: 'prod_1', timestamp: new Date().toISOString() },
      ]);
    };

    it('adds a relative delta to the server stock instead of replaying the stale absolute value', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      // Sold 2 while offline from a view of 10; meanwhile another till sold 5.
      seedProduct(5, 10);
      queue({ id: 'adj_1', delta: -2, newStock: 8, mode: 'relative' });

      expect(await unifiedOfflineSyncService.syncOfflineStockAdjustments()).toBe(1);

      // Absolute replay (the old behaviour) would have written 8 and resurrected 5 sold units.
      expect(fake.stockOf('prod_1')).toBe(3);
    });

    it('sets the value verbatim for an absolute entry from a manual stock edit', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedProduct(5, 5);
      queue({ id: 'adj_2', delta: 0, newStock: 8, mode: 'absolute' });

      expect(await unifiedOfflineSyncService.syncOfflineStockAdjustments()).toBe(1);
      expect(fake.stockOf('prod_1')).toBe(8);
    });

    it('treats a queue entry written before mode existed as absolute', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedProduct(5, 5);
      queue({ id: 'adj_3', delta: 0, newStock: 8 });

      expect(await unifiedOfflineSyncService.syncOfflineStockAdjustments()).toBe(1);
      expect(fake.stockOf('prod_1')).toBe(8);
    });

    it('drops an entry whose document no longer exists on the server', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedProduct(5, 5);
      inventoryService.savePendingStockAdjustments([
        { id: 'adj_4', productId: 'prod_gone', delta: 0, newStock: 4, mode: 'absolute', timestamp: new Date().toISOString() },
      ]);

      expect(await unifiedOfflineSyncService.syncOfflineStockAdjustments()).toBe(1);
      expect(fake.exists('prod_gone')).toBe(false);
      expect(inventoryService.getPendingStockAdjustments()).toHaveLength(0);
    });

    it('recomputes stockStatus from the threshold stored on the server document', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      fake.seed('prod_1', { stock: 10, lowStockThreshold: 4 });
      inventoryService.saveLocalInventory([]);
      queue({ id: 'adj_5', delta: -7, newStock: 3, mode: 'relative' });

      await unifiedOfflineSyncService.syncOfflineStockAdjustments();

      expect(fake.stockOf('prod_1')).toBe(3);
      expect(fake.docs.get('inventory/prod_1')?.stockStatus).toBe('low_stock');
    });
  });

  describe('inventoryService.updateProduct outcome', () => {
    const queuedActions = (): Array<{ type: string }> =>
      JSON.parse(localStorage.getItem('offline_action_queue') || '[]');

    it('reports committed when the field really lands on the server document', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedProduct(10, 10);

      const result = await inventoryService.updateProduct('prod_1', { name: 'USB-C Cable Pro', stock: 4 });

      expect(result.outcome).toBe('committed');
      expect(fake.stockOf('prod_1')).toBe(4);
      expect(fake.docs.get('inventory/prod_1')?.name).toBe('USB-C Cable Pro');
      expect(queuedActions()).toHaveLength(0);
    });

    it('reports failed when the server rejects the write, keeping the edit local and queued', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedProduct(10, 10);
      fake.flags.failWrites = true;

      const result = await inventoryService.updateProduct('prod_1', { stock: 4 });

      expect(result.outcome).toBe('failed');
      expect(result.product.stock).toBe(4);
      expect(fake.stockOf('prod_1')).toBe(10);
      expect(queuedActions().some(a => a.type === 'UPDATE_PRODUCT')).toBe(true);
    });

    it('reports queued when the device is offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      seedProduct(10, 10);

      const result = await inventoryService.updateProduct('prod_1', { stock: 4 });

      expect(result.outcome).toBe('queued');
      expect(fake.stats.commits).toBe(0);
      expect(queuedActions().some(a => a.type === 'UPDATE_PRODUCT')).toBe(true);
    });
  });
});
