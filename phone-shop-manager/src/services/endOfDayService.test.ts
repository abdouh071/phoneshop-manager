/**
 * The seal store: reads, provenance and the offline seal that must survive.
 *
 * A day sealed while the till could not reach Firestore exists only in this browser's
 * storage. Reads used to overwrite that mirror with server rows, so the day would vanish on
 * the next online load and reports would fall back to live numbers for it - a closed day
 * silently restated. `firebase/firestore` is replaced with an in-memory fake that applies the
 * date filters these queries rely on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeDoc = Record<string, unknown>;
type Condition = { field: string; op: string; value: unknown };

const fake = vi.hoisted(() => {
  const store = new Map<string, Map<string, FakeDoc>>();
  const state = {
    failReads: false,
    failWrites: false,
    reads: 0,
    writes: [] as Array<{ coll: string; id: string; data: FakeDoc }>,
    addIds: ['seal-server-1', 'seal-server-2'],
  };
  const conditions = new Map<string, Condition[]>();
  let idCursor = 0;

  const collOf = (name: string): Map<string, FakeDoc> => {
    let c = store.get(name);
    if (!c) {
      c = new Map<string, FakeDoc>();
      store.set(name, c);
    }
    return c;
  };

  const matches = (data: FakeDoc, conds: Condition[]): boolean =>
    conds.every(c => {
      const value = (data as Record<string, unknown>)[c.field];
      if (c.op === '==') return value === c.value;
      if (c.op === '>=') return String(value) >= String(c.value);
      if (c.op === '<=') return String(value) <= String(c.value);
      return true;
    });

  return {
    state,
    seed(id: string, data: FakeDoc): void {
      collOf('end_of_day').set(id, { ...data });
    },
    reset(): void {
      store.clear();
      conditions.clear();
      idCursor = 0;
      state.failReads = false;
      state.failWrites = false;
      state.reads = 0;
      state.writes.length = 0;
      state.addIds = ['seal-server-1', 'seal-server-2'];
    },
    collection: (_db: unknown, name: string) => ({ coll: name, key: `q-${conditions.size}` }),
    doc: (_db: unknown, name: string, id: string) => ({ coll: name, id }),
    query: (base: { coll: string }, ...constraints: Array<unknown>) => {
      const key = `q-${conditions.size + 1}`;
      conditions.set(key, (constraints as Condition[]).filter(c => c && c.field));
      return { coll: base.coll, key };
    },
    where: (field: string, op: string, value: unknown): Condition => ({ field, op, value }),
    orderBy: () => ({ type: 'orderBy' }),
    limit: (n: number) => ({ type: 'limit', n }),
    getDocs: async (q: { coll: string; key: string }) => {
      state.reads++;
      if (state.failReads) throw new Error('unavailable: offline');
      const conds = conditions.get(q.key) ?? [];
      const rows = [...(store.get(q.coll) ?? new Map<string, FakeDoc>()).entries()]
        .filter(([, data]) => matches(data, conds))
        .map(([id, data]) => ({ id, data: () => ({ ...data }) }));
      return { docs: rows, empty: rows.length === 0 };
    },
    addDoc: async (ref: { coll: string }, data: FakeDoc) => {
      if (state.failWrites) throw new Error('permission-denied');
      const id = state.addIds[idCursor] ?? `seal-server-${++idCursor}`;
      idCursor++;
      collOf(ref.coll).set(id, { ...data });
      state.writes.push({ coll: ref.coll, id, data: { ...data } });
      return { id };
    },
    updateDoc: async (ref: { coll: string; id: string }, data: FakeDoc) => {
      state.writes.push({ coll: ref.coll, id: ref.id, data: { ...data } });
      const existing = store.get(ref.coll)?.get(ref.id);
      if (existing) store.get(ref.coll)!.set(ref.id, { ...existing, ...data });
    },
  };
});

vi.mock('firebase/firestore', async () => ({
  collection: fake.collection,
  doc: fake.doc,
  query: fake.query,
  where: fake.where,
  orderBy: fake.orderBy,
  limit: fake.limit,
  getDocs: fake.getDocs,
  addDoc: fake.addDoc,
  updateDoc: fake.updateDoc,
}));

vi.mock('../lib/firebase', () => ({ db: {} }));

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

type SealedInput = Omit<import('./endOfDayService').EndOfDayRecord, 'id'>;

const sealFor = (date: string, overrides: Partial<SealedInput> = {}): SealedInput => ({
  date,
  closedAt: `${date}T23:59:00.000Z`,
  isAutoClose: false,
  salesCount: 1,
  salesCash: 100,
  salesCard: 0,
  salesMobile: 0,
  salesTransfer: 0,
  salesDebt: 0,
  salesTotalRevenue: 100,
  salesCogs: 0,
  salesNetProfit: 100,
  repairsCompleted: 0,
  repairsCash: 0,
  repairsCard: 0,
  repairsMobile: 0,
  repairsDebt: 0,
  repairsTotalRevenue: 0,
  repairsPartsCost: 0,
  repairsNetProfit: 0,
  partsSalesCount: 0,
  partsSalesRevenue: 0,
  totalRevenue: 100,
  totalNetProfit: 100,
  totalCash: 100,
  totalCard: 0,
  totalMobile: 0,
  ...overrides,
});

const mirrorOf = (): Array<Record<string, unknown>> =>
  JSON.parse(localStorageMock.getItem('eod_records') || '[]');

const { endOfDayService, OFFLINE_EOD_ID_PREFIX, EOD_SEAL_VERSION } = await import('./endOfDayService');

describe('endOfDayService seals', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.clear();
    fake.reset();
  });

  it('stamps provenance on a seal it writes', async () => {
    const record = await endOfDayService.save(sealFor('2026-02-10'));

    expect(record.id).toBe('seal-server-1');
    expect(record.sealVersion).toBe(EOD_SEAL_VERSION);
    expect(record.sealedAt).toBe('2026-02-10T23:59:00.000Z');
    expect(fake.state.writes[0].data.sealVersion).toBe(EOD_SEAL_VERSION);
  });

  it('keeps an offline seal when the server read succeeds', async () => {
    fake.state.failWrites = true;
    const offline = await endOfDayService.save(sealFor('2026-02-08'));
    expect(offline.id.startsWith(OFFLINE_EOD_ID_PREFIX)).toBe(true);

    fake.state.failWrites = false;
    fake.seed('seal-online', { ...sealFor('2026-02-09'), date: '2026-02-09' });

    const records = await endOfDayService.getAll();
    expect(records.map(r => r.date)).toEqual(['2026-02-09', '2026-02-08']);
    expect(records.some(r => r.id.startsWith(OFFLINE_EOD_ID_PREFIX))).toBe(true);
  });

  it('writes the seal once the till comes back, without duplicating the local one it covers', async () => {
    fake.state.failWrites = true;
    const offline = await endOfDayService.save(sealFor('2026-02-07'));
    fake.state.failWrites = false;
    fake.state.failReads = true;

    const fallback = await endOfDayService.getAll();
    expect(fallback.map(r => r.id)).toEqual([offline.id]);

    fake.state.failReads = false;
    const merged = await endOfDayService.getAll();
    expect(merged.filter(r => r.date === '2026-02-07')).toHaveLength(1);
  });

  it('reads the seals of a date range instead of the newest page', async () => {
    fake.seed('s-1', { ...sealFor('2026-01-31'), date: '2026-01-31' });
    fake.seed('s-2', { ...sealFor('2026-02-10'), date: '2026-02-10' });
    fake.seed('s-3', { ...sealFor('2026-03-01'), date: '2026-03-01' });
    fake.state.failWrites = true;
    const offline = await endOfDayService.save(sealFor('2026-02-05'));

    const inRange = await endOfDayService.getRange('2026-01-01', '2026-02-28');

    expect(inRange.map(r => r.date).sort()).toEqual(
      ['2026-01-31', '2026-02-05', '2026-02-10'].sort()
    );
    expect(inRange.some(r => r.id === offline.id)).toBe(true);
    expect(inRange.some(r => r.date === '2026-03-01')).toBe(false);
  });

  it('finds one day by date and reports an unclosed day as open', async () => {
    fake.seed('s-1', { ...sealFor('2026-02-10'), date: '2026-02-10', closedByName: 'Admin' });

    const found = await endOfDayService.getByDate('2026-02-10');
    expect(found?.id).toBe('s-1');
    expect(found?.closedByName).toBe('Admin');
    expect(await endOfDayService.getByDate('2026-02-11')).toBeNull();
  });

  it('answers from this till when the server cannot be reached', async () => {
    await endOfDayService.save(sealFor('2026-02-12'));
    fake.state.failReads = true;

    const found = await endOfDayService.getByDate('2026-02-12');
    expect(found?.date).toBe('2026-02-12');
    expect(await endOfDayService.getRange('2026-02-01', '2026-02-28')).toHaveLength(1);
  });

  it('does not send a server write for a note on a seal that has no server document', async () => {
    fake.state.failWrites = true;
    const offline = await endOfDayService.save(sealFor('2026-02-14'));
    const writesBefore = fake.state.writes.length;

    await endOfDayService.updateNotes(offline.id, 'Cash box 2 short by 50');

    expect(fake.state.writes.length).toBe(writesBefore);
    expect(mirrorOf().find(r => r.id === offline.id)?.notes).toBe('Cash box 2 short by 50');
  });
});
