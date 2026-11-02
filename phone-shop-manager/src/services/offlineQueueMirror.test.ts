/**
 * Tests for the durable IndexedDB mirror of the offline queues (#37).
 *
 * Two layers: the pure decide-which-copy-wins rule, and the restore driven through a small
 * fake IndexedDB that implements only the surface the mirror uses. The fake resolves its
 * requests on a microtask so the tests stay deterministic without timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checksumOf, decideWhichCopyWins, type QueueCopy } from './offlineQueueMirror';

interface MirrorRow {
  key: string;
  raw: string;
  checksum: string;
  savedAt: number;
}

interface FakeRequest {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface FakeTransaction {
  error: Error | null;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  objectStore: (name: string) => {
    get: (key: string) => FakeRequest;
    put: (row: MirrorRow) => FakeRequest;
    delete: (key: string) => FakeRequest;
  };
}

interface FakeIdb {
  open: () => FakeRequest & { onupgradeneeded: (() => void) | null; onblocked: (() => void) | null };
  seed: (key: string, raw: string, savedAt: number, checksum?: string) => void;
  peek: (key: string) => MirrorRow | null;
  setHookBeforeRead: (fn: (() => void) | null) => void;
}

const makeFakeIndexedDb = (opts: { failOpen?: boolean; failPut?: boolean } = {}): FakeIdb => {
  const rows = new Map<string, MirrorRow>();
  let hookBeforeRead: (() => void) | null = null;

  const later = (fn: () => void) => queueMicrotask(fn);
  const newRequest = (): FakeRequest => ({ result: null, error: null, onsuccess: null, onerror: null });

  const fakeDb = {
    objectStoreNames: { contains: (name: string) => name === 'queues' },
    createObjectStore: () => undefined,
    // Handlers are assigned to this object by the caller after the request is issued, so it
    // must stay the same identity the callbacks fire on — a spread here would break that.
    transaction: (): FakeTransaction => {
      const tx: FakeTransaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          get: (key: string) => {
            const req = newRequest();
            later(() => {
              hookBeforeRead?.();
              req.result = rows.get(key) ?? null;
              req.onsuccess?.();
            });
            return req;
          },
          put: (row: MirrorRow) => {
            const req = newRequest();
            later(() => {
              if (opts.failPut) {
                req.error = new Error('mirror quota exceeded');
                tx.error = req.error;
                tx.onerror?.();
                tx.onabort?.();
                return;
              }
              rows.set(row.key, { ...row });
              req.onsuccess?.();
              tx.oncomplete?.();
            });
            return req;
          },
          delete: (key: string) => {
            const req = newRequest();
            later(() => {
              rows.delete(key);
              req.onsuccess?.();
              tx.oncomplete?.();
            });
            return req;
          },
        }),
      };
      return tx;
    },
  };

  return {
    open: () => {
      const req = Object.assign(newRequest(), {
        onupgradeneeded: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      });
      later(() => {
        if (opts.failOpen) {
          req.error = new Error('database is locked');
          req.onerror?.();
          return;
        }
        req.result = fakeDb;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    seed: (key, raw, savedAt, checksum) => {
      rows.set(key, { key, raw, checksum: checksum ?? checksumOf(raw), savedAt });
    },
    peek: key => rows.get(key) ?? null,
    setHookBeforeRead: fn => {
      hookBeforeRead = fn;
    },
  };
};

const storage = new Map<string, string>();
let storageThrows = false;

const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    // The realistic eviction: reads keep working, writes start failing.
    if (storageThrows) throw new Error('QuotaExceededError');
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => storage.clear(),
};

const QUEUE = 'offline_action_queue';
const T1000 = 1_000;
const T2000 = 2_000;

const stampLocal = (key: string, checksum: string, savedAt: number) => {
  storage.set(`${key}__sum`, `${checksum}|${savedAt}`);
};

/** Builds a copy the way the mirror reads one, deriving `verified` from the same rules. */
const makeCopy = (raw: string, savedAt: number | null, checksum = checksumOf(raw)): QueueCopy => {
  let parses = true;
  try {
    JSON.parse(raw);
  } catch {
    parses = false;
  }
  return { raw, checksum, savedAt, verified: checksum === checksumOf(raw) && parses };
};

describe('offlineQueueMirror (#37) — which copy wins', () => {
  const local = makeCopy('[{"id":"a"}]', T2000);

  it('keeps localStorage when there is nothing to adopt', () => {
    expect(decideWhichCopyWins(local, null)).toEqual({ action: 'keep_local' });
  });

  it('refuses a mirror whose checksum does not match its bytes', () => {
    // Stamped newer than local, so it is verification — not recency — that rejects it.
    const torn = makeCopy('[{"id":"m"}]', T2000 + 1, 'deadbeef');
    expect(torn.verified).toBe(false);
    expect(decideWhichCopyWins(local, torn)).toEqual({ action: 'keep_local' });
  });

  it('refuses a mirror whose bytes do not parse', () => {
    expect(decideWhichCopyWins(local, makeCopy('[{"id":"m"', T2000 + 1))).toEqual({ action: 'keep_local' });
  });

  it('adopts the mirror when localStorage holds no copy at all', () => {
    expect(decideWhichCopyWins(null, makeCopy('[{"id":"m"}]', T1000))).toEqual({
      action: 'adopt_mirror',
      reason: 'local_missing',
    });
  });

  it('adopts the mirror when the local copy is corrupt, even an older one', () => {
    // Same stamp as the mirror would prove this is corruption, not recency, that drives it.
    expect(
      decideWhichCopyWins(makeCopy('{oops', T2000, 'ffffffff'), makeCopy('[{"id":"m"}]', T2000)),
    ).toEqual({ action: 'adopt_mirror', reason: 'local_corrupt' });
  });

  it('does nothing when both copies hold identical content', () => {
    expect(decideWhichCopyWins(local, makeCopy(local.raw, T2000))).toEqual({ action: 'keep_local' });
  });

  it('adopts a strictly newer mirror over an intact local copy', () => {
    expect(decideWhichCopyWins(local, makeCopy('[{"id":"newer"}]', T2000 + 1))).toEqual({
      action: 'adopt_mirror',
      reason: 'mirror_newer',
    });
  });

  it('keeps local when the mirror is older — this is what stops re-queuing synced sales', () => {
    expect(decideWhichCopyWins(local, makeCopy('[{"id":"old"}]', T1000))).toEqual({ action: 'keep_local' });
  });

  it('keeps local when the local copy carries no stamp to compare against', () => {
    expect(decideWhichCopyWins(makeCopy(local.raw, null), makeCopy('[{"id":"m"}]', T2000))).toEqual({
      action: 'keep_local',
    });
  });

  it('keeps local when the mirror carries no stamp but local does', () => {
    expect(decideWhichCopyWins(makeCopy(local.raw, T1000), makeCopy('[{"id":"m"}]', null))).toEqual({
      action: 'keep_local',
    });
  });

  it('checksums are stable and content-sensitive', () => {
    expect(checksumOf('[]')).toBe(checksumOf('[]'));
    expect(checksumOf('[]')).not.toBe(checksumOf('[{"id":"a"}]'));
  });
});

describe('offlineQueueMirror (#37) — write-through and boot restore', () => {
  let idb: FakeIdb = makeFakeIndexedDb();

  beforeEach(() => {
    storage.clear();
    storageThrows = false;
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('navigator', { onLine: true });
    idb = makeFakeIndexedDb();
    vi.stubGlobal('indexedDB', idb);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Fresh module instance, so the cached db handle and counters start clean. */
  const load = async () => {
    vi.resetModules();
    return import('./offlineQueueMirror');
  };

  it('stamps a checksum beside the queue and mirrors the same bytes', async () => {
    const { offlineQueueMirror } = await load();
    const raw = JSON.stringify([{ id: 'act_1', type: 'ADJUST_STOCK' }]);

    offlineQueueMirror.write(QUEUE, raw);
    await vi.waitFor(() => expect(idb.peek(QUEUE)).not.toBeNull());

    const row = idb.peek(QUEUE);
    expect(row?.raw).toBe(raw);
    expect(row?.checksum).toBe(checksumOf(raw));
    expect(storage.get(`${QUEUE}__sum`)).toBe(`${row?.checksum}|${row?.savedAt}`);
  });

  it('mirrors even when the localStorage save fails, and never throws to the caller', async () => {
    const { offlineQueueMirror } = await load();
    storageThrows = true;

    expect(() => offlineQueueMirror.write(QUEUE, '[{"id":"rescue"}]')).not.toThrow();
    await vi.waitFor(() => expect(idb.peek(QUEUE)).not.toBeNull());

    expect(idb.peek(QUEUE)?.raw).toBe('[{"id":"rescue"}]');
    expect(storage.get(QUEUE)).toBeUndefined();
    expect(offlineQueueMirror.stats().failures).toBeGreaterThan(0);
  });

  it('restores a queue that localStorage lost to eviction', async () => {
    idb.seed(QUEUE, '[{"id":"sale_9","type":"CREATE_SALE_TRANSACTION"}]', T2000);
    storage.set(QUEUE, '[]');
    stampLocal(QUEUE, checksumOf('[]'), T1000);

    const { offlineQueueMirror } = await load();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([{ key: QUEUE, reason: 'mirror_newer' }]);
    expect(JSON.parse(storage.get(QUEUE) ?? '[]')).toEqual([
      { id: 'sale_9', type: 'CREATE_SALE_TRANSACTION' },
    ]);
    expect(storage.get(`${QUEUE}__sum`)).toBe(`${checksumOf(idb.peek(QUEUE)?.raw ?? '')}|${T2000}`);
  });

  it('repairs a truncated local queue from the mirror', async () => {
    idb.seed(QUEUE, '[{"id":"intact"}]', T2000);
    storage.set(QUEUE, '[{"id":"trun');
    // The stamp matches the broken bytes, so only the JSON itself gives the corruption away —
    // and it is stamped newer than the mirror, to prove corruption outranks recency.
    stampLocal(QUEUE, checksumOf('[{"id":"trun'), T2000 + 5000);

    const { offlineQueueMirror } = await load();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([{ key: QUEUE, reason: 'local_corrupt' }]);
    expect(storage.get(QUEUE)).toBe('[{"id":"intact"}]');
  });

  it('leaves a queue alone when the mirror is only an older copy of it', async () => {
    idb.seed(QUEUE, '[{"id":"already_synced"}]', T1000);
    storage.set(QUEUE, '[]');
    stampLocal(QUEUE, checksumOf('[]'), T2000);

    const { offlineQueueMirror } = await load();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([]);
    expect(storage.get(QUEUE)).toBe('[]');
  });

  it('refuses a mirror row that does not match its own checksum, even a newer one', async () => {
    // The signature of a torn write: newer than local, but the bytes and the stamp disagree.
    idb.seed(QUEUE, '[{"id":"torn"}]', T2000, 'deadbeef');
    storage.set(QUEUE, '[]');
    stampLocal(QUEUE, checksumOf('[]'), T1000);

    const { offlineQueueMirror } = await load();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([]);
    expect(storage.get(QUEUE)).toBe('[]');
  });

  it('does not clobber a queue written while the restore was in flight', async () => {
    idb.seed(QUEUE, '[{"id":"from_mirror"}]', T2000);
    idb.setHookBeforeRead(() => {
      // The app enqueues a live sale after the local copy was read but before it is replaced.
      storage.set(QUEUE, '[{"id":"fresh_sale"}]');
      stampLocal(QUEUE, checksumOf('[{"id":"fresh_sale"}]'), T2000 + 10);
    });

    const { offlineQueueMirror } = await load();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([]);
    expect(storage.get(QUEUE)).toBe('[{"id":"fresh_sale"}]');
  });

  it('notifies queue owners only when a restore actually changed what they read', async () => {
    idb.seed(QUEUE, '[{"id":"recovered"}]', T2000);
    storage.set(QUEUE, '[]');
    stampLocal(QUEUE, checksumOf('[]'), T1000);

    const { offlineQueueMirror } = await load();
    const listener = vi.fn();
    offlineQueueMirror.onRestored(listener);

    await offlineQueueMirror.restoreAll();
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    await offlineQueueMirror.restoreAll();
    expect(listener).not.toHaveBeenCalled();
  });

  it('degrades quietly with no IndexedDB and keeps the local queue untouched', async () => {
    const { offlineQueueMirror } = await load();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', localStorageMock);
    storage.clear();
    // The owner writes localStorage first, then mirrors — so with no IndexedDB the local
    // queue must still read back exactly what was saved.
    const raw = '[{"id":"local_only"},{"id":"b"}]';
    storage.set(QUEUE, raw);

    expect(() => offlineQueueMirror.write(QUEUE, raw)).not.toThrow();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([]);
    expect(report.timedOut).toBe(false);
    expect(storage.get(QUEUE)).toBe(raw);
    expect(offlineQueueMirror.stats().available).toBe(false);
  });

  it('clearing a queue also clears its mirror so it cannot come back', async () => {
    const { offlineQueueMirror } = await load();
    offlineQueueMirror.write(QUEUE, '[{"id":"ghost"}]');
    await vi.waitFor(() => expect(idb.peek(QUEUE)).not.toBeNull());

    offlineQueueMirror.clear(QUEUE);
    await vi.waitFor(() => expect(idb.peek(QUEUE)).toBeNull());
    expect(storage.get(`${QUEUE}__sum`)).toBeUndefined();
  });

  it('survives a database that will not open', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('indexedDB', makeFakeIndexedDb({ failOpen: true }));
    storage.clear();
    storage.set(QUEUE, '[{"id":"kept"}]');
    stampLocal(QUEUE, checksumOf('[{"id":"kept"}]'), T1000);

    const { offlineQueueMirror } = await load();
    const report = await offlineQueueMirror.restoreAll();

    expect(report.restored).toEqual([]);
    expect(storage.get(QUEUE)).toBe('[{"id":"kept"}]');
    expect(offlineQueueMirror.stats().available).toBe(false);
    expect(offlineQueueMirror.stats().lastError).toContain('Failed to open the queue mirror database');
  });

  it('reports a mirror write the database rejected, without losing the local copy', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('indexedDB', makeFakeIndexedDb({ failPut: true }));
    storage.clear();

    const { offlineQueueMirror } = await load();
    offlineQueueMirror.write(QUEUE, '[{"id":"stock_delta"}]');
    await vi.waitFor(() => expect(offlineQueueMirror.stats().failures).toBeGreaterThan(0));

    expect(storage.get(`${QUEUE}__sum`)).toContain('|');
    expect(offlineQueueMirror.stats().available).toBe(true);
    expect(offlineQueueMirror.stats().lastError).toContain(`Failed to mirror ${QUEUE}`);
  });

  it('recovers a real enqueued stock adjustment after localStorage drops it', async () => {
    // End to end, through the queue the POS money path writes to.
    vi.stubGlobal('navigator', { onLine: false });
    const { offlineQueue } = await import('./offlineQueue');

    const queuedLater = await offlineQueue.enqueue({
      type: 'ADJUST_STOCK',
      payload: { id: 'p_1', delta: -1 },
    });
    expect(queuedLater).toBe(false);
    await vi.waitFor(() => expect(idb.peek(QUEUE)).not.toBeNull());
    expect(JSON.parse(idb.peek(QUEUE)?.raw ?? '[]')[0]).toMatchObject({ type: 'ADJUST_STOCK' });

    // The bucket fills: the key stops existing even though the queue was never flushed.
    storage.delete(QUEUE);
    storage.delete(`${QUEUE}__sum`);
    expect(offlineQueue.getPendingCount()).toBe(0);

    const fresh = await load();
    await fresh.offlineQueueMirror.restoreAll();

    const { offlineQueue: reloaded } = await import('./offlineQueue');
    expect(reloaded.getPendingCount()).toBe(1);
  });
});
