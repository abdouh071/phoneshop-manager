/**
 * One old row must not take the rest of the shelf's history down with it.
 *
 * `items` and `payments` are required on `SaleTransaction`, so a cast at the read
 * boundary believed them. A document written before the till recorded its lines —
 * or one left half-written — threw on the first `.map`, which React answers by
 * tearing down the whole tab. These pin the two places that read such a row: the
 * local mirror every screen falls back to, and the pass that re-points offline
 * sales at the real product ids.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { transactionService } from './transactionService';
import { inventoryService } from './inventoryService';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';

const fake = vi.hoisted(() => ({
  added: [] as Array<{ collection: string; data: Record<string, unknown> }>,
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  collection: (_db: unknown, name: string) => ({ name }),
  query: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  limit: (n: number) => n,
  orderBy: (...parts: unknown[]) => parts,
  getDocs: vi.fn<() => Promise<{ empty: boolean; size: number; docs: { id: string; data: () => Record<string, unknown> }[] }>>(),
  addDoc: async (ref: { name: string }, data: Record<string, unknown>) => {
    fake.added.push({ collection: ref.name, data });
    return { id: `real_${fake.added.length}` };
  },
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    collection: fake.collection,
    query: fake.query,
    where: fake.where,
    limit: fake.limit,
    orderBy: fake.orderBy,
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

const MIRROR_KEY = 'offline_transactions';

const seedMirror = (rows: unknown[]): void => {
  localStorage.setItem(MIRROR_KEY, JSON.stringify(rows));
};

const line = (productId: string) => ({
  product: { id: productId, name: 'USB-C Cable', price: 500 },
  quantity: 1,
});

describe('A sale missing its lines', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('navigator', { onLine: false });
    localStorageMock.clear();
    fake.added.length = 0;
    fake.getDocs.mockReset().mockResolvedValue({ empty: true, size: 0, docs: [] });
    inventoryService.savePendingProducts([]);
    inventoryService.saveLocalInventory([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reads as an empty sale from the mirror instead of throwing at the caller', async () => {
    seedMirror([
      { id: 'tx_old', date: '2026-11-08T10:00:00.000Z', saleType: 'retail', total: 1500 },
    ]);

    const all = await transactionService.getAll();

    expect(all).toHaveLength(1);
    expect(all[0].items).toEqual([]);
    expect(all[0].payments).toEqual([]);
    expect(all[0].total).toBe(1500);
  });

  it('keeps the lines and tenders a complete row already carries', async () => {
    const items = [line('prod_1')];
    const payments = [{ method: 'cash', amount: 500 }];
    seedMirror([
      { id: 'tx_1', date: '2026-11-08T10:00:00.000Z', saleType: 'retail', items, payments, total: 500 },
    ]);

    const retail = await transactionService.getRetailTransactions();

    expect(retail[0].items).toEqual(items);
    expect(retail[0].payments).toEqual(payments);
  });

  it('does not let one unreadable row hide the sales beside it', async () => {
    seedMirror([
      null,
      'not a sale',
      { date: '2026-11-08T10:00:00.000Z', total: 900 },
      { id: 'tx_good', date: '2026-11-08T11:00:00.000Z', saleType: 'retail', total: 700 },
    ]);

    const all = await transactionService.getAll();

    expect(all.map(t => t.id)).toEqual(['tx_good']);
  });

  it('reads an unparseable mirror as empty rather than throwing on every screen', async () => {
    localStorage.setItem(MIRROR_KEY, '{"truncated');

    expect(await transactionService.getAll()).toEqual([]);
  });

  it('mirrors fetched parts history without removing retail invoices or duplicating replayed sales', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    seedMirror([
      { id: 'retail', saleType: 'retail' },
      { id: 'offline_parts', saleType: 'parts_b2b', idempotencyKey: 'same-sale' },
      { id: 'offline_pending', saleType: 'parts_b2b', idempotencyKey: 'pending', date: '2026-11-13' },
    ]);
    fake.getDocs.mockResolvedValueOnce({ empty: false, size: 1, docs: [
      { id: 'server', data: () => ({ saleType: 'parts_b2b', idempotencyKey: 'same-sale', date: '2026-11-12' }) },
    ] });
    const parts = await transactionService.getPartsTransactions({ allowLocalFallback: false });
    expect(parts.map(tx => tx.id)).toEqual(['offline_pending', 'server']);
    const mirror = JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]');
    expect(mirror.map((tx: { id: string }) => tx.id)).toEqual(['retail', 'offline_pending', 'server']);
  });

  it('exposes a failed strict parts refresh without erasing the offline mirror', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    seedMirror([{ id: 'parts', saleType: 'parts_b2b' }]);
    fake.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(transactionService.getPartsTransactions({ allowLocalFallback: false })).rejects.toThrow('permission-denied');
    vi.stubGlobal('navigator', { onLine: false });
    expect((await transactionService.getPartsTransactions()).map(tx => tx.id)).toEqual(['parts']);
  });

  it('still re-points the other offline sales when one row lost its lines', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    inventoryService.savePendingProducts([
      { id: 'offline_prod_1', name: 'USB-C Cable', stock: 4, price: 500 } as never,
    ]);
    seedMirror([
      { id: 'offline_tx_broken', date: '2026-11-08T10:00:00.000Z', total: 1500 },
      { id: 'offline_tx_good', date: '2026-11-08T11:00:00.000Z', items: [line('offline_prod_1')], total: 500 },
    ]);

    expect(await unifiedOfflineSyncService.syncOfflineProducts()).toBe(1);

    const mirror = JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]');
    const good = mirror.find((t: { id: string }) => t.id === 'offline_tx_good');
    expect(good.items[0].product.id).toBe('real_1');
  });
});