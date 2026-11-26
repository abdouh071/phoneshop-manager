/**
 * Phase 8 TDD Tests — Report Session Data Reuse, Superset Filtering,
 * Explicit Refresh / Invalidation, and Calculation Parity.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const failCollections = new Set<string>();
  const getDocsCalls: string[] = [];
  const makeRef = (name: string, id: string) => ({ name, id, key: `${name}/${id}` });

  return {
    docs,
    failCollections,
    getDocsCalls,
    seed: (col: string, id: string, data: object) => {
      docs.set(`${col}/${id}`, structuredClone(data as Record<string, unknown>));
    },
    doc: (_db: unknown, name: string, id: string) => makeRef(name, id),
    collection: (_db: unknown, name: string) => ({ name }),
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    orderBy: (field: string, dir?: string) => ({ kind: 'orderBy', field, dir }),
    limit: (n: number) => ({ kind: 'limit', n }),
    query: (target: { name: string }, ...constraints: Array<{ kind: string; field?: string; op?: string; value?: unknown }>) => ({
      name: target.name,
      constraints,
    }),
    getDocs: async (q: { name: string; constraints?: Array<{ kind: string; field?: string; op?: string; value?: unknown }> }) => {
      getDocsCalls.push(q.name);
      if (failCollections.has(q.name)) {
        throw new Error(`Firestore unavailable for ${q.name}`);
      }
      const wheres = (q.constraints || []).filter(c => c.kind === 'where' && c.field && c.op);
      const rows = [...docs.entries()]
        .filter(([key]) => key.startsWith(`${q.name}/`))
        .map(([key, data]) => {
          const [, id] = key.split('/');
          return { id, ref: makeRef(q.name, id), data: structuredClone(data) };
        })
        .filter(row => {
          for (const w of wheres) {
            const val = row.data[w.field!];
            if (typeof val !== 'string' && typeof val !== 'number') return false;
            if (w.op === '>=' && !(val >= (w.value as string | number))) return false;
            if (w.op === '<=' && !(val <= (w.value as string | number))) return false;
          }
          return true;
        })
        .map(row => ({ id: row.id, ref: row.ref, data: () => row.data }));
      return { empty: rows.length === 0, docs: rows };
    },
    reset: () => {
      docs.clear();
      failCollections.clear();
      getDocsCalls.length = 0;
    },
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    collection: fake.collection,
    where: fake.where,
    orderBy: fake.orderBy,
    limit: fake.limit,
    query: fake.query,
    getDocs: fake.getDocs,
  };
});

import { reportsService } from './reportsService';
import { invalidateReportsCache } from './reportCacheInvalidation';
import { useReportStore } from '../store/reportStore';

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

function seedSampleShopData() {
  // Sales across Nov 10, Nov 24, Nov 25, and Oct 12 (local noon UTC-safe timestamps)
  fake.seed('transactions', 'tx_nov10', {
    date: '2026-11-10T12:00:00.000Z',
    saleType: 'retail',
    status: 'completed',
    items: [{
      product: { id: 'p1', name: 'Phone', model: 'X1', category: 'smartphone', price: 30000, costPrice: 20000, stock: 5, sku: 'S1' },
      quantity: 1,
      finalPrice: 30000,
    }],
    subtotal: 30000,
    total: 30000,
    payments: [{ method: 'cash', amount: 30000 }],
  });

  fake.seed('transactions', 'tx_nov24', {
    date: '2026-11-24T12:00:00.000Z',
    saleType: 'retail',
    status: 'completed',
    items: [{
      product: { id: 'p2', name: 'Case', model: 'C1', category: 'accessory', price: 2000, costPrice: 800, stock: 10, sku: 'C1' },
      quantity: 2,
      finalPrice: 2000,
    }],
    subtotal: 4000,
    total: 4000,
    payments: [{ method: 'cash', amount: 4000 }],
  });

  fake.seed('transactions', 'tx_nov25', {
    date: '2026-11-25T12:00:00.000Z',
    saleType: 'parts_b2b',
    status: 'completed',
    items: [{
      product: { id: 'p3', name: 'OLED Screen', model: 'iPhone 13', category: 'repair_part', price: 15000, costPrice: 9000, stock: 3, sku: 'PT1' },
      quantity: 1,
      finalPrice: 15000,
    }],
    subtotal: 15000,
    total: 15000,
    payments: [{ method: 'cash', amount: 15000 }],
  });

  fake.seed('transactions', 'tx_oct12', {
    date: '2026-10-12T12:00:00.000Z',
    saleType: 'retail',
    status: 'completed',
    items: [],
    subtotal: 8000,
    total: 8000,
    payments: [{ method: 'card', amount: 8000 }],
  });

  // Old repair created in Oct, claimed & paid on Nov 24 — must NOT be lost by query optimization!
  fake.seed('repairs', 'rep_old_claimed_nov24', {
    ticketNumber: 'REP-101',
    customerName: 'Samir',
    customerPhone: '0555000001',
    deviceBrand: 'Samsung',
    deviceModel: 'A54',
    issueDescription: 'Screen replacement',
    status: 'completed',
    paymentStatus: 'paid',
    finalCost: 12000,
    paidAmount: 12000,
    partsCost: 5000,
    createdAt: '2026-10-05T10:00:00.000Z',
    completedAt: '2026-11-24T14:00:00.000Z',
    claimedAt: '2026-11-24T14:00:00.000Z',
    updatedAt: '2026-11-24T14:00:00.000Z',
  });

  fake.seed('products', 'p1', {
    name: 'Phone',
    model: 'X1',
    category: 'smartphone',
    price: 30000,
    costPrice: 20000,
    stock: 5,
    lowStockThreshold: 2,
    sku: 'S1',
  });

  // Old debt from Sep with payment collected on Nov 24 — must remain accurate!
  fake.seed('customer_debts', 'debt_sep_paid_nov24', {
    customerId: 'cust_1',
    customerName: 'Nabil',
    totalAmount: 10000,
    amountPaid: 4000,
    remainingBalance: 6000,
    status: 'partial',
    createdAt: '2026-09-10T10:00:00.000Z',
    payments: [
      { id: 'pay_nov24', amount: 4000, method: 'cash', date: '2026-11-24T16:00:00.000Z' },
    ],
  });
}

beforeEach(() => {
  fake.reset();
  mockStorage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('navigator', { onLine: true });
  invalidateReportsCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Phase 8 — Report Data Reuse, Explicit Refresh, Invalidation & Calculation Parity', () => {
  it('reuses wide live session data across narrower filter changes with zero extra Firestore reads and bit-identical calculations', async () => {
    seedSampleShopData();

    // 1. Load wide Nov 1..Nov 25 custom period (warms live cache with all 5 collections)
    await reportsService.getDashboardData({
      dateRange: 'custom',
      customStartDate: '2026-11-01',
      customEndDate: '2026-11-25',
    });
    expect(fake.getDocsCalls).toHaveLength(5);

    fake.getDocsCalls.length = 0;

    // 2. Switch into narrower Nov 24 and Nov 25 filters — must incur 0 additional Firestore reads
    const cachedNov24 = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-24',
    });
    const cachedNov25 = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-25',
    });
    expect(fake.getDocsCalls).toHaveLength(0);

    // Confirm old October repair & old September debt payment on Nov 24 stayed intact
    expect(cachedNov24.financialSummary.repairRevenue).toBe(12000);
    expect(cachedNov24.financialSummary.debtCollectionsTotal).toBe(4000);
    expect(cachedNov24.financialSummary.productSalesRevenue).toBe(4000);
    expect(cachedNov25.financialSummary.partsSalesRevenue).toBe(15000);

    // 3. Compare cached calculations against completely fresh uncached reads
    invalidateReportsCache();
    fake.getDocsCalls.length = 0;
    const freshNov24 = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-24',
    });
    invalidateReportsCache();
    const freshNov25 = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-25',
    });

    expect(cachedNov24.financialSummary).toEqual(freshNov24.financialSummary);
    expect(cachedNov24.paymentBreakdown).toEqual(freshNov24.paymentBreakdown);
    expect(cachedNov24.dailyIncomeDetails).toEqual(freshNov24.dailyIncomeDetails);
    expect(cachedNov25.financialSummary).toEqual(freshNov25.financialSummary);
    expect(cachedNov25.paymentBreakdown).toEqual(freshNov25.paymentBreakdown);
  });

  it('reuses invariant snapshot collections (repairs, inventory, debts) when switching to an outside date range', async () => {
    seedSampleShopData();

    await reportsService.getDashboardData({
      dateRange: 'custom',
      customStartDate: '2026-11-01',
      customEndDate: '2026-11-25',
    });
    expect(fake.getDocsCalls).toHaveLength(5);

    fake.getDocsCalls.length = 0;
    const octReport = await reportsService.getDashboardData({
      dateRange: 'specific_month',
      selectedYear: 2026,
      selectedMonth: 9, // October (0-indexed)
    });

    // Only sales (transactions) and eod (end_of_day) should query Firestore!
    expect(fake.getDocsCalls).toHaveLength(2);
    expect(fake.getDocsCalls).toEqual(expect.arrayContaining(['transactions', 'end_of_day']));
    expect(octReport.financialSummary.productSalesRevenue).toBe(8000);
  });

  it('bypasses cache on forceRefresh=true and after invalidateReportsCache() mutation invalidation', async () => {
    seedSampleShopData();

    await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-25',
    });
    fake.getDocsCalls.length = 0;

    // Seed a brand new sale on Nov 25
    fake.seed('transactions', 'tx_nov25_new', {
      date: '2026-11-25T16:00:00.000Z',
      saleType: 'retail',
      status: 'completed',
      items: [],
      subtotal: 5000,
      total: 5000,
      payments: [{ method: 'cash', amount: 5000 }],
    });

    // Without refresh/invalidation -> cached within TTL
    const stillCached = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-25',
    });
    expect(fake.getDocsCalls).toHaveLength(0);
    expect(stillCached.financialSummary.productSalesRevenue).toBe(0);

    // Explicit forceRefresh bypasses cache
    const refreshed = await reportsService.getDashboardData(
      { dateRange: 'specific_day', specificDate: '2026-11-25' },
      { forceRefresh: true }
    );
    expect(fake.getDocsCalls).toHaveLength(5);
    expect(refreshed.financialSummary.productSalesRevenue).toBe(5000);

    // Mutation invalidation clears cache immediately
    fake.seed('transactions', 'tx_nov25_second', {
      date: '2026-11-25T17:00:00.000Z',
      saleType: 'retail',
      status: 'completed',
      items: [],
      subtotal: 2500,
      total: 2500,
      payments: [{ method: 'cash', amount: 2500 }],
    });
    invalidateReportsCache();
    fake.getDocsCalls.length = 0;

    const afterInvalidation = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-25',
    });
    expect(fake.getDocsCalls).toHaveLength(5);
    expect(afterInvalidation.financialSummary.productSalesRevenue).toBe(7500);
  });

  it('does not mask offline fallback state with an earlier online live cache', async () => {
    seedSampleShopData();

    const online = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-24',
    });
    expect(online.isCached).toBe(false);

    vi.stubGlobal('navigator', { onLine: false });
    const offline = await reportsService.getDashboardData({
      dateRange: 'specific_day',
      specificDate: '2026-11-24',
    });
    expect(offline.isCached).toBe(true);
    expect(offline.cachedSources?.length).toBeGreaterThan(0);
  });

  it('forwards forceRefresh options from useReportStore.fetchData', async () => {
    const spy = vi.spyOn(reportsService, 'getDashboardData');
    await useReportStore.getState().fetchData({ dateRange: 'today' }, { forceRefresh: true });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange: 'today' }),
      { forceRefresh: true }
    );
    spy.mockRestore();
  });
});
