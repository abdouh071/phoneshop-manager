import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuspendedCart } from '../types';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../lib/firebase', () => ({ db: {} }));

const SYNC_KEY = 'pos_suspended_carts_sync_v1';
const disk = new Map<string, string>();
const server = new Map<string, SuspendedCart>();
const storage = {
  getItem: vi.fn((key: string) => disk.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { disk.set(key, value); }),
};
let service: typeof import('./cartService')['cartService'];

const cart = (id: string, date = '2026-11-01T09:00:00.000Z'): SuspendedCart => ({
  id,
  date,
  items: [],
  customerName: id,
  customerId: `cust_${id}`,
  customerPhone: '0555000001',
  discount: null,
});

const online = (onLine: boolean) => vi.stubGlobal('navigator', { onLine });
const snapshot = () => ({
  docs: [...server.values()].map(value => ({ id: value.id, data: () => ({ ...value }) })),
});

const reloadService = async () => {
  vi.resetModules();
  service = (await import('./cartService')).cartService;
};

beforeEach(async () => {
  vi.clearAllMocks();
  disk.clear();
  server.clear();
  storage.getItem.mockImplementation(key => disk.get(key) ?? null);
  storage.setItem.mockImplementation((key, value) => { disk.set(key, value); });
  vi.stubGlobal('localStorage', storage);
  online(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  firestore.getDocsFromServer.mockReset().mockImplementation(async () => snapshot());
  firestore.getDocs.mockReset().mockImplementation(async () => snapshot());
  firestore.setDoc.mockReset().mockImplementation(async (ref, value) => {
    server.set(ref.id, value);
  });
  firestore.deleteDoc.mockReset().mockImplementation(async ref => {
    server.delete(ref.id);
  });
  await reloadService();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('retail suspended cart journal and reconciliation', () => {
  it('reads authoritative server carts with getDocsFromServer and removes carts deleted on another till', async () => {
    const first = cart('held-1');
    server.set(first.id, first);
    await expect(service.getAllSuspendedCarts([first])).resolves.toEqual([first]);
    expect(firestore.getDocsFromServer).toHaveBeenCalledTimes(1);

    server.delete(first.id);
    await expect(service.getAllSuspendedCarts([first])).resolves.toEqual([]);
    const journal = JSON.parse(disk.get(SYNC_KEY)!);
    expect(journal.mirror).toEqual([]);
  });

  it('retains a delete staged offline and prevents a deleted cart from resurrecting', async () => {
    const first = cart('held-del');
    server.set(first.id, first);
    await service.getAllSuspendedCarts([]);

    online(false);
    await service.deleteSuspendedCart(first.id);
    await expect(service.getAllSuspendedCarts([first])).resolves.toEqual([]);

    await reloadService();
    online(true);
    await expect(service.getAllSuspendedCarts([first])).resolves.toEqual([]);
    expect(server.has(first.id)).toBe(false);
  });
});
