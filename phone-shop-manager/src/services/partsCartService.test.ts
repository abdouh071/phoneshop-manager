import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuspendedCart } from '../types';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
  getDoc: vi.fn(),
  getDocsFromServer: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../lib/firebase', () => ({ db: {} }));

const SYNC_KEY = 'parts_suspended_carts_sync_v1';
const MIRROR_KEY = 'parts_suspended_carts';
const disk = new Map<string, string>();
const server = new Map<string, SuspendedCart>();
const storage = {
  getItem: vi.fn((key: string) => disk.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { disk.set(key, value); }),
};
let service: typeof import('./partsCartService')['partsCartService'];

const cart = (id: string, date = '2026-11-01T09:00:00.000Z'): SuspendedCart => ({
  id,
  date,
  items: [],
  customerName: id,
  discount: { type: 'percent', value: 10 },
});
const journal = () => JSON.parse(disk.get(SYNC_KEY)!);
const online = (onLine: boolean) => vi.stubGlobal('navigator', { onLine });
const snapshot = () => ({
  docs: [...server.values()].map(value => ({ id: value.id, data: () => ({ ...value }) })),
});
const reloadService = async () => {
  vi.resetModules();
  service = (await import('./partsCartService')).partsCartService;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
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

describe('parts suspended cart journal and reconciliation', () => {
  it('durably holds offline before returning, then merges another terminal after restart', async () => {
    const held = cart('held-offline');
    const elsewhere = cart('other-terminal', '2026-11-02T09:00:00.000Z');
    online(false);

    const saving = service.saveSuspendedCart(held);
    expect(journal().pending).toEqual([{ type: 'upsert', id: held.id, cart: held }]);
    await saving;
    expect(firestore.setDoc).not.toHaveBeenCalled();
    await expect(service.getAllSuspendedCarts([])).resolves.toEqual([held]);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();

    await reloadService();
    online(true);
    server.set(elsewhere.id, elsewhere);
    await expect(service.getAllSuspendedCarts([held])).resolves.toEqual([elsewhere, held]);
    expect(server.get(held.id)).toEqual(held);
    expect(journal().pending).toEqual([]);
    expect(journal().mirror).toEqual([elsewhere, held]);
  });

  it('retains a rejected remote save and retries it on the next fetch, not continuously', async () => {
    const held = cart('retry');
    firestore.setDoc.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.saveSuspendedCart(held)).resolves.toBeUndefined();
    expect(journal().pending).toHaveLength(1);
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);

    await reloadService();
    await expect(service.getAllSuspendedCarts([])).resolves.toEqual([held]);
    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    expect(journal().pending).toEqual([]);
    await service.getAllSuspendedCarts([held]);
    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
  });

  it('snapshots the held payload rather than replaying later caller edits', async () => {
    online(false);
    const held = cart('snapshot');
    const saving = service.saveSuspendedCart(held);
    held.customerName = 'edited later';
    held.discount!.value = 90;
    await saving;
    online(true);
    const fetched = await service.getAllSuspendedCarts([]);
    expect(fetched[0]).toMatchObject({ customerName: 'snapshot', discount: { value: 10 } });
    expect(server.get(held.id)).toEqual(fetched[0]);
  });

  it('suppresses pending deletes even when remote still returns the cart, then retries', async () => {
    const removed = cart('removed');
    const other = cart('other');
    server.set(removed.id, removed);
    server.set(other.id, other);
    online(false);
    await service.deleteSuspendedCart(removed.id);
    expect(journal().pending).toEqual([{ type: 'delete', id: removed.id }]);

    await reloadService();
    online(true);
    firestore.deleteDoc.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.getAllSuspendedCarts([removed])).resolves.toEqual([other]);
    expect(journal().pending).toHaveLength(1);
    expect(server.has(removed.id)).toBe(true);

    await expect(service.getAllSuspendedCarts([removed, other])).resolves.toEqual([other]);
    expect(journal().pending).toEqual([]);
    expect(server.has(removed.id)).toBe(false);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('preserves legacy unknown carts without uploading them and prefers live remote data', async () => {
    const legacy = cart('legacy');
    const cached = cart('cached');
    const remote = { ...cached, customerName: 'Updated remotely' };
    disk.set(MIRROR_KEY, JSON.stringify([legacy, cached]));
    server.set(remote.id, remote);

    const merged = await service.getAllSuspendedCarts();
    expect(merged).toEqual(expect.arrayContaining([legacy, remote]));
    expect(merged).toHaveLength(2);
    expect(firestore.setDoc).not.toHaveBeenCalled();

    server.delete(remote.id);
    await reloadService();
    await expect(service.getAllSuspendedCarts()).resolves.toEqual([legacy]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('treats an empty server fetch as authoritative for observed ids across restart', async () => {
    const synced = cart('synced');
    server.set(synced.id, synced);
    await expect(service.getAllSuspendedCarts([])).resolves.toEqual([synced]);
    server.clear();
    await reloadService();

    await expect(service.getAllSuspendedCarts([synced])).resolves.toEqual([]);
    expect(journal().observedIds).toContain(synced.id);
    expect(journal().mirror).toEqual([]);
    await reloadService();
    online(false);
    await expect(service.getAllSuspendedCarts([synced])).resolves.toEqual([]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('records acknowledged saves as observed even before the first fetch', async () => {
    const synced = cart('saved');
    const unknown = cart('unknown');
    await service.saveSuspendedCart(synced);
    server.clear();
    await reloadService();
    await expect(service.getAllSuspendedCarts([synced, unknown])).resolves.toEqual([unknown]);
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
  });

  it('does not mistake offline or failed reads for a successful empty remote list', async () => {
    const synced = cart('cached');
    server.set(synced.id, synced);
    await service.getAllSuspendedCarts([]);
    server.clear();
    online(false);
    await expect(service.getAllSuspendedCarts([synced])).resolves.toEqual([synced]);
    expect(firestore.getDocsFromServer).toHaveBeenCalledTimes(1);

    online(true);
    firestore.getDocsFromServer.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.getAllSuspendedCarts([synced])).resolves.toEqual([synced]);
    await expect(service.getAllSuspendedCarts([synced])).resolves.toEqual([]);
  });

  it('keeps pending upserts over older remote data and over a successful empty response', async () => {
    const stale = cart('edited');
    const held = { ...stale, customerName: 'Local edit' };
    const legacy = cart('legacy');
    server.set(stale.id, stale);
    await service.getAllSuspendedCarts([legacy]);
    firestore.setDoc.mockRejectedValue(new Error('unavailable'));
    await service.saveSuspendedCart(held);

    const merged = await service.getAllSuspendedCarts([stale, legacy]);
    expect(merged).toEqual(expect.arrayContaining([held, legacy]));
    expect(merged).toHaveLength(2);
    server.clear();
    await expect(service.getAllSuspendedCarts([stale, legacy])).resolves.toEqual(merged);
    expect(journal().pending).toEqual([{ type: 'upsert', id: held.id, cart: held }]);
  });

  it('serializes an in-flight save and immediate delete without acknowledging away the delete', async () => {
    const held = cart('race');
    const started = deferred();
    const release = deferred();
    const operations: string[] = [];
    firestore.setDoc.mockImplementationOnce(async (ref, value) => {
      operations.push('save-start');
      started.resolve();
      await release.promise;
      server.set(ref.id, value);
      operations.push('save-end');
    });
    firestore.deleteDoc.mockImplementationOnce(async ref => {
      expect(journal().pending).toEqual([{ type: 'delete', id: held.id }]);
      operations.push('delete');
      server.delete(ref.id);
    });

    const saving = service.saveSuspendedCart(held);
    await started.promise;
    const fetching = service.getAllSuspendedCarts([held]);
    const deleting = service.deleteSuspendedCart(held.id);
    expect(journal().pending).toEqual([{ type: 'delete', id: held.id }]);
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    release.resolve();

    await Promise.all([saving, deleting]);
    await expect(fetching).resolves.toEqual([]);
    expect(operations).toEqual(['save-start', 'save-end', 'delete']);
    expect(journal().pending).toEqual([]);
    expect(server.has(held.id)).toBe(false);
    await reloadService();
    online(false);
    await expect(service.getAllSuspendedCarts([held])).resolves.toEqual([]);
  });

  it('coalesces offline hold then discard into only a pending delete', async () => {
    const held = cart('discarded');
    online(false);
    const saving = service.saveSuspendedCart(held);
    const deleting = service.deleteSuspendedCart(held.id);
    await Promise.all([saving, deleting]);
    expect(journal().pending).toEqual([{ type: 'delete', id: held.id }]);
    await reloadService();
    online(true);
    await expect(service.getAllSuspendedCarts([held])).resolves.toEqual([]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).toHaveBeenCalledTimes(1);
  });

  it('overlays holds and deletes staged while a stale remote fetch is in flight', async () => {
    const removed = cart('removed');
    const held = cart('new-hold');
    server.set(removed.id, removed);
    const started = deferred();
    const release = deferred();
    firestore.getDocsFromServer.mockImplementationOnce(async () => {
      const stale = snapshot();
      started.resolve();
      await release.promise;
      return stale;
    });

    const fetching = service.getAllSuspendedCarts([removed]);
    await started.promise;
    const saving = service.saveSuspendedCart(held);
    const deleting = service.deleteSuspendedCart(removed.id);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    release.resolve();
    await expect(fetching).resolves.toEqual([held]);
    await Promise.all([saving, deleting]);
    expect([...server.values()]).toEqual([held]);
    expect(journal().mirror).toEqual([held]);
  });

  it.each(['upsert', 'delete'] as const)(
    'blocks remote %s when localStorage persistence fails, and can recover on fetch',
    async type => {
      const held = cart('disk-failure');
      if (type === 'delete') server.set(held.id, held);
      storage.setItem.mockImplementation(() => { throw new Error('storage full'); });
      const operation = type === 'upsert'
        ? service.saveSuspendedCart(held)
        : service.deleteSuspendedCart(held.id);
      await expect(operation).rejects.toThrow('storage full');
      expect(firestore.setDoc).not.toHaveBeenCalled();
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(disk.has(SYNC_KEY)).toBe(false);

      await expect(service.getAllSuspendedCarts([held])).resolves.toEqual(type === 'upsert' ? [held] : []);
      expect(firestore.setDoc).not.toHaveBeenCalled();
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      storage.setItem.mockImplementation((key, value) => { disk.set(key, value); });
      await expect(service.getAllSuspendedCarts([held])).resolves.toEqual(type === 'upsert' ? [held] : []);
      expect(journal().pending).toEqual([]);
      expect(server.has(held.id)).toBe(type === 'upsert');
    }
  );

  it('retains the durable journal if persisting a remote acknowledgement fails', async () => {
    const held = cart('ack-failure');
    storage.setItem.mockImplementation((key, value) => {
      if (key === SYNC_KEY && JSON.parse(value).pending.length === 0) throw new Error('storage full');
      disk.set(key, value);
    });
    await expect(service.saveSuspendedCart(held)).resolves.toBeUndefined();
    expect(server.get(held.id)).toEqual(held);
    expect(journal().pending).toEqual([{ type: 'upsert', id: held.id, cart: held }]);

    storage.setItem.mockImplementation((key, value) => { disk.set(key, value); });
    await reloadService();
    await expect(service.getAllSuspendedCarts([])).resolves.toEqual([held]);
    expect(journal().pending).toEqual([]);
    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
  });

  it('returns the merged mirror even if its persistence fails', async () => {
    const remote = cart('remote');
    const legacy = cart('legacy');
    server.set(remote.id, remote);
    storage.setItem.mockImplementation(() => { throw new Error('storage full'); });
    const merged = await service.getAllSuspendedCarts([legacy]);
    expect(merged).toEqual(expect.arrayContaining([remote, legacy]));
    expect(merged).toHaveLength(2);
    online(false);
    await expect(service.getAllSuspendedCarts([])).resolves.toEqual(merged);
    expect(console.error).toHaveBeenCalled();
  });

  it('does not overwrite an unreadable journal or issue remote mutations', async () => {
    disk.set(SYNC_KEY, '{broken');
    const held = cart('local');
    await expect(service.saveSuspendedCart(held)).rejects.toThrow();
    await expect(service.getAllSuspendedCarts([held])).resolves.toEqual([held]);
    expect(disk.get(SYNC_KEY)).toBe('{broken');
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });
});
