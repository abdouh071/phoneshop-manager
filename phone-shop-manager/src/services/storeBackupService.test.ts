/**
 * Store backup / restore.
 *
 * `firebase/firestore` is replaced by an in-memory fake that keeps the real `Timestamp` class, so
 * the encode → JSON → decode → write path is exercised exactly as it runs in the browser: paging,
 * batching, and the two failure modes that used to produce a backup that looked fine (an unreadable
 * collection and a date field that no longer round-trips).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  decodeValue,
  encodeValue,
  exportStoreBackup,
  parseStoreBackup,
  restoreStoreBackup,
  valueToCsvCell,
  type BackupData,
  type StoreBackupArtifact,
} from './storeBackupService';

type FakeDoc = Record<string, unknown>;
interface FakeRef { id: string; key: string; coll: string }

const PAGE_SIZE = 400;

const fake = vi.hoisted(() => {
  const store = new Map<string, Map<string, FakeDoc>>();
  const stats = { commits: 0, reads: 0 };
  const flags = { failWritesFor: null as string | null, failReadsFor: null as string | null };

  const collOf = (name: string): Map<string, FakeDoc> => {
    let c = store.get(name);
    if (!c) {
      c = new Map<string, FakeDoc>();
      store.set(name, c);
    }
    return c;
  };

  const sortedIds = (name: string): string[] => [...collOf(name).keys()].sort();

  return {
    store,
    stats,
    flags,
    seed(name: string, id: string, data: FakeDoc): void {
      collOf(name).set(id, { ...data });
    },
    seedMany(name: string, count: number): void {
      for (let i = 0; i < count; i++) {
        collOf(name).set(`id_${String(i).padStart(4, '0')}`, { n: i });
      }
    },
    read(name: string, id: string): FakeDoc | undefined {
      return store.get(name)?.get(id);
    },
    ids(name: string): string[] {
      return sortedIds(name);
    },
    reset(): void {
      store.clear();
      stats.commits = 0;
      stats.reads = 0;
      flags.failWritesFor = null;
      flags.failReadsFor = null;
    },
    collection: (_db: unknown, name: string) => ({ coll: name, constraints: [] as unknown[] }),
    doc: (_db: unknown, name: string, id: string): FakeRef => ({ id, coll: name, key: `${name}/${id}` }),
    query: (base: { coll: string; constraints: unknown[] }, ...constraints: unknown[]) => ({
      coll: base.coll,
      constraints: [...base.constraints, ...constraints],
    }),
    orderBy: () => ({ type: 'orderBy' }),
    limit: (n: number) => ({ type: 'limit', n }),
    startAfter: (snapshot: { id: string }) => ({ type: 'startAfter', id: snapshot.id }),
    documentId: () => '__name__',
    getDocs: async (q: { coll: string; constraints: unknown[] }) => {
      stats.reads++;
      if (flags.failReadsFor === q.coll) throw new Error(`permission-denied: ${q.coll}`);
      const startAfterC = q.constraints.find((c) => (c as { type?: string }).type === 'startAfter') as
        | { id: string }
        | undefined;
      const limitC = q.constraints.find((c) => (c as { type?: string }).type === 'limit') as
        | { n: number }
        | undefined;
      let ids = sortedIds(q.coll);
      if (startAfterC) ids = ids.filter((id) => id > startAfterC.id);
      const size = limitC ? ids.slice(0, limitC.n).length : ids.length;
      const taken = ids.slice(0, limitC ? limitC.n : ids.length);
      return {
        size,
        empty: size === 0,
        docs: taken.map((id) => ({
          id,
          data: () => ({ ...(store.get(q.coll)?.get(id) ?? {}) }),
        })),
      };
    },
    writeBatch: (_db: unknown) => {
      const ops: Array<{ ref: FakeRef; data: FakeDoc }> = [];
      return {
        ops,
        set: (ref: FakeRef, data: FakeDoc) => {
          ops.push({ ref, data });
        },
        commit: async () => {
          if (flags.failWritesFor === ops[0]?.ref.coll) throw new Error('permission-denied: users');
          for (const op of ops) {
            collOf(op.ref.coll).set(op.ref.id, { ...op.data });
          }
          stats.commits++;
        },
      };
    },
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    collection: fake.collection,
    doc: fake.doc,
    query: fake.query,
    orderBy: fake.orderBy,
    limit: fake.limit,
    startAfter: fake.startAfter,
    documentId: fake.documentId,
    getDocs: fake.getDocs,
    writeBatch: fake.writeBatch,
  };
});

beforeEach(() => {
  fake.reset();
});

const seedArtifact = (collections: Record<string, Array<{ id: string; data: BackupData }>>): StoreBackupArtifact => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  metadata: {
    app: 'Phone Shop Manager Pro',
    storeName: 'Test',
    currency: 'EGP',
    exportedAt: new Date().toISOString(),
    version: BACKUP_VERSION,
    generatedBy: 'client',
  },
  reports: [],
  collections,
});

describe('backup value encoding', () => {
  it('round-trips a Firestore Timestamp through JSON', () => {
    const encoded = encodeValue(new Timestamp(1_700_000_000, 123_456_789));
    const throughJson = JSON.parse(JSON.stringify({ v: encoded })).v as BackupData;

    expect(throughJson).toEqual({ __type: 'timestamp', seconds: 1_700_000_000, nanoseconds: 123_456_789 });
    const decoded = decodeValue(throughJson) as Timestamp;
    expect(decoded).toBeInstanceOf(Timestamp);
    expect(decoded.seconds).toBe(1_700_000_000);
    expect(decoded.nanoseconds).toBe(123_456_789);
  });

  it('encodes nested arrays and objects, and drops non-finite numbers', () => {
    const encoded = encodeValue({
      items: [{ price: 12, tags: ['a', 'b'] }],
      broken: Number.POSITIVE_INFINITY,
      missing: undefined,
      when: new Date('2026-01-02T03:04:05.000Z'),
    }) as BackupData;

    expect(encoded.items).toEqual([{ price: 12, tags: ['a', 'b'] }]);
    expect(encoded.broken).toBeNull();
    expect(encoded.missing).toBeNull();
    expect(decodeValue(encoded.when)).toBeInstanceOf(Timestamp);
  });

  it('renders encoded timestamps as ISO in CSV instead of [object Object]', () => {
    const encoded = encodeValue(new Timestamp(1_700_000_000, 0));
    expect(valueToCsvCell(encoded)).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(valueToCsvCell(null)).toBe('');
    expect(valueToCsvCell('Ahmed')).toBe('Ahmed');
  });
});

describe('full store export', () => {
  it('exports the collections the app actually writes to', async () => {
    const { artifact } = await exportStoreBackup({ storeName: 'Test', currency: 'EGP' });

    expect(artifact.collections.inventory).toBeDefined();
    expect(artifact.reports.find((r) => r.name === 'inventory')?.status).toBe('ok');
    // The old export read `products` and `parts`, which no service writes to.
    expect(artifact.collections.products).toBeUndefined();
    expect(artifact.collections.parts).toBeUndefined();
    expect(artifact.format).toBe(BACKUP_FORMAT);
    expect(artifact.version).toBe(BACKUP_VERSION);
  });

  it('paginates a collection larger than one page', async () => {
    fake.seedMany('customers', PAGE_SIZE + 57);
    const { artifact } = await exportStoreBackup({ storeName: 'Test', currency: 'EGP' });

    expect(artifact.collections.customers).toHaveLength(PAGE_SIZE + 57);
    expect(artifact.reports.find((r) => r.name === 'customers')?.count).toBe(PAGE_SIZE + 57);
  });

  it('reports a collection it could not read instead of exporting it empty and claiming success', async () => {
    fake.flags.failReadsFor = 'end_of_day';
    fake.seed('customers', 'c1', { name: 'Ahmed' });

    const { artifact, failed } = await exportStoreBackup({ storeName: 'Test', currency: 'EGP' });

    const report = artifact.reports.find((r) => r.name === 'end_of_day');
    expect(report?.status).toBe('failed');
    expect(report?.error).toContain('permission-denied');
    expect(failed.map((f) => f.name)).toEqual(['end_of_day']);
    expect(artifact.collections.customers).toHaveLength(1);
  });
});

describe('artifact parsing', () => {
  it('rejects anything that is not a backup from this tool', () => {
    expect(() => parseStoreBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseStoreBackup(JSON.stringify({ hello: 'world' }))).toThrow(/not produced by/);
    expect(() =>
      parseStoreBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2, collections: {} }))
    ).toThrow(/old backup format/);
    expect(() =>
      parseStoreBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, collections: {} }))
    ).toThrow(/newer than/);
    expect(() =>
      parseStoreBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, collections: { customers: 'nope' } }))
    ).toThrow(/malformed/);
  });

  it('accepts a well-formed artifact', () => {
    const json = JSON.stringify(seedArtifact({ customers: [{ id: 'c1', data: { name: 'Ahmed' } }] }));
    expect(parseStoreBackup(json).collections.customers).toHaveLength(1);
  });
});

describe('restore', () => {
  const artifact = seedArtifact({
    customers: [
      { id: 'c1', data: { name: 'Ahmed' } },
      { id: 'c2', data: { name: 'Mohamed' } },
    ],
  });

  it('skips documents that already exist by default', async () => {
    fake.seed('customers', 'c1', { name: 'Ahmed (edited live)' });

    const reports = await restoreStoreBackup({ artifact, collections: ['customers'], mode: 'skip-existing' });

    expect(reports[0]).toMatchObject({ name: 'customers', written: 1, skipped: 1, failed: 0 });
    expect(fake.read('customers', 'c1')).toEqual({ name: 'Ahmed (edited live)' });
    expect(fake.read('customers', 'c2')).toEqual({ name: 'Mohamed' });
  });

  it('overwrites live documents only when told to', async () => {
    fake.seed('customers', 'c1', { name: 'Ahmed (edited live)' });

    const reports = await restoreStoreBackup({ artifact, collections: ['customers'], mode: 'overwrite' });

    expect(reports[0]).toMatchObject({ written: 2, skipped: 0 });
    expect(fake.read('customers', 'c1')).toEqual({ name: 'Ahmed' });
  });

  it('restores archived timestamps as Timestamp objects, not plain JSON', async () => {
    const withDate = seedArtifact({
      transactions: [{ id: 't1', data: { date: encodeValue(new Timestamp(1_700_000_000, 0)) } }],
    });

    await restoreStoreBackup({ artifact: withDate, collections: ['transactions'], mode: 'overwrite' });

    expect(fake.read('transactions', 't1')?.date).toBeInstanceOf(Timestamp);
  });

  it('commits in chunks under the Firestore batch ceiling', async () => {
    const many = seedArtifact({
      repairs: Array.from({ length: PAGE_SIZE + 3 }, (_, i) => ({
        id: `r${i}`,
        data: { n: i } as BackupData,
      })),
    });

    const reports = await restoreStoreBackup({ artifact: many, collections: ['repairs'], mode: 'overwrite' });

    expect(reports[0].written).toBe(PAGE_SIZE + 3);
    expect(fake.stats.commits).toBe(2);
    expect(fake.ids('repairs')).toHaveLength(PAGE_SIZE + 3);
  });

  it('keeps restoring the other collections when one is rejected', async () => {
    const both = seedArtifact({
      users: [{ id: 'u1', data: { role: 'admin' } }],
      customers: [{ id: 'c1', data: { name: 'Ahmed' } }],
    });
    fake.flags.failWritesFor = 'users';

    const reports = await restoreStoreBackup({ artifact: both, collections: ['users', 'customers'], mode: 'overwrite' });

    expect(reports.find((r) => r.name === 'users')).toMatchObject({ failed: 1, written: 0 });
    expect(reports.find((r) => r.name === 'users')?.error).toContain('permission-denied');
    expect(reports.find((r) => r.name === 'customers')).toMatchObject({ written: 1, failed: 0 });
  });
});
