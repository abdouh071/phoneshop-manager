/**
 * Mirror maintenance service (A2).
 *
 * `firebase/firestore` and `../lib/firebase` are replaced by an in-memory path
 * map. The contract under test: the repair write is the source of truth, mirror
 * maintenance is best-effort (a failure must never reject into the shop flow),
 * a phone change retires the old last-4 mirror id, and the admin rebuild is
 * idempotent and cleans orphans.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackingMirrorId } from '../utils/trackingMirror';
import {
  writeTrackingMirror,
  deleteTrackingMirrorFor,
  refreshTrackingMirrorById,
  backfillTrackingMirrors,
} from './trackingMirrorService';

type FakeDoc = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const store = new Map<string, FakeDoc>();
  const stats = { writes: 0, deletes: 0, commits: 0 };
  const flags = { failWrites: false, failReads: false };

  return {
    store,
    stats,
    flags,
    seed(name: string, id: string, data: FakeDoc): void {
      store.set(`${name}/${id}`, { ...data });
    },
    seedPath(path: string, data: FakeDoc): void {
      store.set(path, { ...data });
    },
    readPath(path: string): FakeDoc | undefined {
      return store.get(path);
    },
    reset(): void {
      store.clear();
      stats.writes = 0;
      stats.deletes = 0;
      stats.commits = 0;
      flags.failWrites = false;
      flags.failReads = false;
    },
    collection: (_db: unknown, name: string) => ({ coll: name }),
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    getDoc: async (ref: { path: string }) => {
      if (flags.failReads) throw new Error('unavailable');
      const data = store.get(ref.path);
      return {
        id: ref.path.split('/').pop(),
        exists: () => data !== undefined,
        data: () => ({ ...(data ?? {}) }),
      };
    },
    getDocs: async (q: { coll: string }) => {
      if (flags.failReads) throw new Error('unavailable');
      const prefix = q.coll + '/';
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          ref: { path },
          data: () => ({ ...data }),
        }));
      return { docs };
    },
    setDoc: async (ref: { path: string }, data: FakeDoc) => {
      if (flags.failWrites) throw new Error('permission-denied: ' + ref.path);
      stats.writes++;
      store.set(ref.path, { ...data });
    },
    deleteDoc: async (ref: { path: string }) => {
      if (flags.failWrites) throw new Error('permission-denied: ' + ref.path);
      stats.deletes++;
      store.delete(ref.path);
    },
    writeBatch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: { path: string }, data: FakeDoc) => {
          ops.push(() => store.set(ref.path, { ...data }));
        },
        delete: (ref: { path: string }) => {
          ops.push(() => store.delete(ref.path));
        },
        commit: async () => {
          if (flags.failWrites) throw new Error('permission-denied: batch');
          stats.commits++;
          for (const op of ops) op();
        },
      };
    },
  };
});

vi.mock('firebase/firestore', () => ({
  collection: fake.collection,
  doc: fake.doc,
  getDoc: fake.getDoc,
  getDocs: fake.getDocs,
  setDoc: fake.setDoc,
  deleteDoc: fake.deleteDoc,
  writeBatch: fake.writeBatch,
}));

vi.mock('../lib/firebase', () => ({ db: {} }));

const TICKET = {
  ticketNumber: 'TKT-0042',
  trackingPin: '0550',
  customerName: 'Yacine Secret',
  customerPhone: '0550120550',
  status: 'ready' as const,
  deviceBrand: 'Samsung',
  deviceModel: 'A54',
  createdAt: '2026-11-01T09:00:00.000Z',
  issueDescription: 'Screen cracked',
};

const mirrorPath = async (number: string, pin: string) =>
  `repair_tracking/${await trackingMirrorId(number, pin)}`;

beforeEach(() => {
  fake.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeTrackingMirror', () => {
  it('writes only the display whitelist under the derived id', async () => {
    await writeTrackingMirror(TICKET);
    const stored = fake.readPath(await mirrorPath('TKT-0042', '0550'));
    expect(stored).toMatchObject({ ticketNumber: 'TKT-0042', status: 'ready', deviceModel: 'A54' });
    expect(stored).not.toHaveProperty('customerName');
    expect(stored).not.toHaveProperty('customerPhone');
    expect(stored).not.toHaveProperty('trackingPin');
    expect(fake.stats.writes).toBe(1);
  });

  it('writes nothing for a provisional or PIN-less ticket', async () => {
    await writeTrackingMirror({ ...TICKET, ticketNumber: 'TKT-PENDING' });
    await writeTrackingMirror({ ...TICKET, ticketNumberProvisional: true });
    await writeTrackingMirror({ ticketNumber: 'TKT-0001' });
    expect(fake.stats.writes).toBe(0);
  });

  it('never rejects into the shop flow when the mirror write is denied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.flags.failWrites = true;
    await expect(writeTrackingMirror(TICKET)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toBeUndefined();
  });
});

describe('deleteTrackingMirrorFor', () => {
  it('removes the mirror a deleted ticket leaves behind', async () => {
    await writeTrackingMirror(TICKET);
    await deleteTrackingMirrorFor(TICKET);
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toBeUndefined();
  });

  it('is a no-op for an untrackable ticket and survives a denied delete', async () => {
    await deleteTrackingMirrorFor({ ticketNumber: 'TKT-PENDING', trackingPin: 'AB12' });
    expect(fake.stats.deletes).toBe(0);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.flags.failWrites = true;
    await expect(deleteTrackingMirrorFor(TICKET)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('refreshTrackingMirrorById', () => {
  it('mirrors the live document, not a stale local copy', async () => {
    fake.seed('repairs', 'r1', { ...TICKET, status: 'completed', actualCost: 4500 });
    await refreshTrackingMirrorById('r1');
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toMatchObject({
      status: 'completed',
      actualCost: 4500,
    });
  });

  it('retires the old last-4 id when the phone behind it changed', async () => {
    const previous = { ...TICKET, trackingPin: '', customerPhone: '0550120550' };
    const live = { ...TICKET, trackingPin: '', customerPhone: '0770997890' };
    fake.seed('repairs', 'r1', live);
    fake.seedPath(await mirrorPath('TKT-0042', '0550'), { ticketNumber: 'TKT-0042' });

    await refreshTrackingMirrorById('r1', previous);

    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toBeUndefined();
    expect(fake.readPath(await mirrorPath('TKT-0042', '7890'))).toMatchObject({ status: 'ready' });
  });

  it('keeps the id when the phone did not change and just rewrites the payload', async () => {
    const previous = { ...TICKET, trackingPin: '', customerPhone: '0550120550', status: 'pending' as const };
    fake.seed('repairs', 'r1', { ...TICKET, trackingPin: '', customerPhone: '0550120550' });
    fake.seedPath(await mirrorPath('TKT-0042', '0550'), { ticketNumber: 'TKT-0042', status: 'pending' });

    await refreshTrackingMirrorById('r1', previous);

    expect(fake.stats.deletes).toBe(0);
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toMatchObject({ status: 'ready' });
  });

  it('deletes the previous mirror when the ticket no longer exists', async () => {
    fake.seedPath(await mirrorPath('TKT-0042', '0550'), { ticketNumber: 'TKT-0042' });
    await refreshTrackingMirrorById('gone', TICKET);
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toBeUndefined();
  });

  it('does nothing for a missing ticket when no previous copy is known', async () => {
    await refreshTrackingMirrorById('gone');
    expect(fake.stats.writes).toBe(0);
    expect(fake.stats.deletes).toBe(0);
  });

  it('survives a denied read without rejecting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.flags.failReads = true;
    await expect(refreshTrackingMirrorById('r1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('backfillTrackingMirrors', () => {
  it('publishes trackable tickets, skips the rest, and removes orphans', async () => {
    fake.seed('repairs', 'r1', TICKET);
    fake.seed('repairs', 'r2', { ...TICKET, ticketNumber: 'TKT-0001', trackingPin: 'AB12' });
    fake.seed('repairs', 'r3', { ...TICKET, ticketNumber: 'TKT-PENDING' });
    fake.seed('repairs', 'r4', { ticketNumber: 'TKT-0002' });
    fake.seedPath('repair_tracking/TKT-9999_orphan', { ticketNumber: 'TKT-9999' });

    const result = await backfillTrackingMirrors();

    expect(result).toEqual({ mirrored: 2, removed: 1, skipped: 2 });
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toMatchObject({ status: 'ready' });
    expect(fake.readPath(await mirrorPath('TKT-0001', 'AB12'))).toBeDefined();
    expect(fake.readPath('repair_tracking/TKT-9999_orphan')).toBeUndefined();
  });

  it('is idempotent: a second run rewrites the same mirrors and removes nothing', async () => {
    fake.seed('repairs', 'r1', TICKET);
    await backfillTrackingMirrors();
    const again = await backfillTrackingMirrors();
    expect(again).toEqual({ mirrored: 1, removed: 0, skipped: 0 });
    expect(fake.readPath(await mirrorPath('TKT-0042', '0550'))).toMatchObject({ status: 'ready' });
  });

  it('splits large rebuilds into batches of at most 400 writes', async () => {
    for (let i = 0; i < 405; i++) {
      fake.seed('repairs', `r${i}`, { ...TICKET, ticketNumber: `TKT-${1000 + i}`, trackingPin: 'AB12' });
    }
    const result = await backfillTrackingMirrors();
    expect(result).toEqual({ mirrored: 405, removed: 0, skipped: 0 });
    expect(fake.stats.commits).toBe(2);
  });

  it('propagates a read failure so the rebuild button can toast it', async () => {
    fake.flags.failReads = true;
    await expect(backfillTrackingMirrors()).rejects.toThrow('unavailable');
  });
});