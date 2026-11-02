/**
 * What a stock write tells the cashier back.
 *
 * `queued` and `committed` used to be indistinguishable to the UI: both looked like a saved
 * restock, so a till that had been offline all morning reported server stock it had never written.
 * These tests pin the outcome each branch reports.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useInventoryStore } from './inventoryStore';
import { inventoryService } from '../services/inventoryService';
import type { PhoneModel } from '../types';

type FakeDoc = Record<string, unknown>;
interface FakeRef { id: string; key: string }

const fake = vi.hoisted(() => {
  const docs = new Map<string, FakeDoc>();
  const flags = { failWrites: false, failReads: false };
  const stats = { commits: 0 };

  const snapshotOf = (key: string) => ({
    exists: () => docs.has(key),
    data: () => {
      const d = docs.get(key);
      return d ? { ...d } : undefined;
    },
  });

  return {
    docs,
    flags,
    stats,
    seed(id: string, data: FakeDoc): void {
      docs.set(`inventory/${id}`, { ...data });
    },
    reset(): void {
      docs.clear();
      flags.failWrites = false;
      stats.commits = 0;
    },
    stockOf(id: string): number | undefined {
      return docs.get(`inventory/${id}`)?.stock as number | undefined;
    },
    doc: (_db: unknown, collectionName: string, id: string): FakeRef => ({ id, key: `${collectionName}/${id}` }),
    getDoc: async (ref: FakeRef) => snapshotOf(ref.key),
    deleteDoc: async (ref: FakeRef): Promise<void> => {
      if (flags.failWrites) throw new Error('Fake: permission-denied');
      docs.delete(ref.key);
    },
    runTransaction: async (_db: unknown, fn: (tx: FakeTx) => Promise<unknown>) => {
      const writes: Array<{ key: string; data: FakeDoc }> = [];
      const tx: FakeTx = {
        get: async (ref: FakeRef) => {
          if (fake.flags.failReads) throw new Error('Fake: unavailable');
          return snapshotOf(ref.key);
        },
        update: (ref: FakeRef, data: FakeDoc) => {
          writes.push({ key: ref.key, data });
        },
      };
      if (flags.failWrites) throw new Error('Fake: transaction write rejected');
      const result = await fn(tx);
      for (const w of writes) docs.set(w.key, { ...(docs.get(w.key) || {}), ...w.data });
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
    deleteDoc: fake.deleteDoc,
    runTransaction: fake.runTransaction,
  };
});

const logs = vi.hoisted(() => ({ restock: vi.fn(async () => undefined), writeOff: vi.fn(async () => undefined) }));

vi.mock('../services/restockService', () => ({ restockService: { log: logs.restock } }));
vi.mock('../services/writeOffService', () => ({ writeOffService: { log: logs.writeOff } }));
vi.mock('./activityStore', () => ({ useActivityStore: { getState: () => ({ logActivity: vi.fn(async () => undefined) }) } }));
vi.mock('./authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'u_1', name: 'Amina' } }) } }));

const mockStorage = new Map<string, string>();

const cable = (stock: number): PhoneModel => ({
  id: 'prod_1',
  name: 'USB-C Cable',
  model: 'Universal',
  category: 'accessory',
  stock,
  price: 500,
  cost: 200,
  costPrice: 200,
  sku: 'ACC-USB-C',
  lowStockThreshold: 1,
  stockStatus: 'in_stock',
});

const seedTill = (product: PhoneModel, serverStock: number): void => {
  useInventoryStore.setState({ products: [product], parts: [], error: null });
  fake.seed(product.id, { stock: serverStock, lowStockThreshold: product.lowStockThreshold });
  inventoryService.saveLocalInventory([product]);
};

describe('stock write outcomes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage.get(key) || null,
      setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
    });
    mockStorage.clear();
    fake.reset();
    logs.restock.mockClear();
    logs.writeOff.mockClear();
    inventoryService.savePendingStockAdjustments([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('restockProduct', () => {
    it('reports committed when the server document moved', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedTill(cable(10), 10);

      const result = await useInventoryStore.getState().restockProduct('prod_1', 5);

      expect(result).toEqual({ outcome: 'committed', applied: 5 });
      expect(fake.stockOf('prod_1')).toBe(15);
      expect(logs.restock).toHaveBeenCalledTimes(1);
    });

    it('reports queued, not committed, when the device is offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      seedTill(cable(10), 10);

      const result = await useInventoryStore.getState().restockProduct('prod_1', 5);

      expect(result.outcome).toBe('queued');
      expect(result.applied).toBe(5);
      expect(fake.stats.commits).toBe(0);
      expect(fake.stockOf('prod_1')).toBe(10);
      expect(inventoryService.getPendingStockAdjustments()).toHaveLength(1);
    });

    it('reports queued when the server rejects the transaction', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedTill(cable(10), 10);
      fake.flags.failWrites = true;

      const result = await useInventoryStore.getState().restockProduct('prod_1', 5);

      expect(result.outcome).toBe('queued');
      expect(fake.stockOf('prod_1')).toBe(10);
    });

    it('reports failed instead of staying silent when the product is not loaded', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      useInventoryStore.setState({ products: [], parts: [], error: null });

      const result = await useInventoryStore.getState().restockProduct('prod_missing', 5);

      expect(result).toEqual({ outcome: 'failed', applied: 0 });
      expect(useInventoryStore.getState().error).toBeTruthy();
      expect(logs.restock).not.toHaveBeenCalled();
    });
  });

  describe('writeOffStock', () => {
    it('reports the units actually removed', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedTill(cable(4), 4);

      const result = await useInventoryStore.getState().writeOffStock('prod_1', 3, 'damaged', 'cracked');

      expect(result).toEqual({ outcome: 'committed', applied: 3 });
      expect(fake.stockOf('prod_1')).toBe(1);
      expect(logs.writeOff).toHaveBeenCalledTimes(1);
    });

    it('clamps to what the server really has and reports the smaller number', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      // This till still thinks 9 are on the shelf; 2 were sold from another till.
      seedTill(cable(9), 2);

      const result = await useInventoryStore.getState().writeOffStock('prod_1', 9, 'lost');

      expect(result.outcome).toBe('committed');
      expect(result.applied).toBe(2);
      expect(fake.stockOf('prod_1')).toBe(0);
    });

    it('reports unchanged when there is nothing to write off', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedTill(cable(0), 0);

      const result = await useInventoryStore.getState().writeOffStock('prod_1', 1, 'damaged');

      expect(result).toEqual({ outcome: 'unchanged', applied: 0 });
      expect(logs.writeOff).not.toHaveBeenCalled();
    });

    it('reports queued when the write-off only waits on this device', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      seedTill(cable(4), 4);

      const result = await useInventoryStore.getState().writeOffStock('prod_1', 2, 'stolen');

      expect(result.outcome).toBe('queued');
      expect(result.applied).toBe(2);
      expect(fake.stockOf('prod_1')).toBe(4);
    });
  });

  describe('deleteProduct', () => {
    it('reports committed when the server document is gone', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedTill(cable(3), 3);

      expect(await useInventoryStore.getState().deleteProduct('prod_1')).toBe('committed');
      expect(fake.docs.has('inventory/prod_1')).toBe(false);
    });

    it('reports queued when the server refuses the delete', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      seedTill(cable(3), 3);
      fake.flags.failWrites = true;

      expect(await useInventoryStore.getState().deleteProduct('prod_1')).toBe('queued');
      // The document survives: this till only hid it.
      expect(fake.stockOf('prod_1')).toBe(3);
      expect(JSON.parse(mockStorage.get('offline_action_queue') || '[]'))
        .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'DELETE_PRODUCT' })]));
    });

    it('reports queued when the device is offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      seedTill(cable(3), 3);

      expect(await useInventoryStore.getState().deleteProduct('prod_1')).toBe('queued');
      expect(fake.docs.has('inventory/prod_1')).toBe(true);
    });
  });
});
