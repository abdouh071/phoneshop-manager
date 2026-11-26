/**
 * Phase 5 TDD Tests — Report Cache / Incomplete Indicators,
 * Concurrent Filter Race Protection, Noncash Debt Surplus, and Refund Timestamps.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const failCollections = new Set<string>();
  const makeRef = (name: string, id: string) => ({ name, id, key: `${name}/${id}` });

  return {
    docs,
    failCollections,
    seed: (col: string, id: string, data: object) => {
      docs.set(`${col}/${id}`, structuredClone(data as Record<string, unknown>));
    },
    doc: (_db: unknown, name: string, id: string) => makeRef(name, id),
    collection: (_db: unknown, name: string) => ({ name }),
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    orderBy: (field: string, dir?: string) => ({ kind: 'orderBy', field, dir }),
    limit: (n: number) => ({ kind: 'limit', n }),
    query: (target: { name: string }, ...constraints: Array<{ kind: string; field?: string; value?: unknown }>) => ({
      name: target.name,
      constraints,
    }),
    getDocs: async (q: { name: string; constraints?: Array<{ kind: string; field?: string; op?: string; value?: unknown }> }) => {
      if (failCollections.has(q.name)) {
        throw new Error(`Firestore unavailable for ${q.name}`);
      }
      const rows = [...docs.entries()]
        .filter(([key]) => key.startsWith(`${q.name}/`))
        .map(([key, data]) => {
          const [, id] = key.split('/');
          return { id, ref: makeRef(q.name, id), data: () => structuredClone(data) };
        });
      return { empty: rows.length === 0, docs: rows };
    },
    reset: () => {
      docs.clear();
      failCollections.clear();
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
import { useReportStore } from '../store/reportStore';
import { closedAtOf, computeDayFigures } from '../utils/dayFigures';
import type { SaleTransaction } from '../types';

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

beforeEach(() => {
  fake.reset();
  mockStorage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('navigator', { onLine: true });
  reportsService.invalidateCache();
});

describe('Phase 5 — Report Cache & Incomplete Data Indicators', () => {
  it('marks online server reports as fresh (isCached=false, isIncomplete=false)', async () => {
    const today = new Date().toISOString();
    fake.seed('transactions', 'tx1', {
      date: today,
      saleType: 'retail',
      status: 'completed',
      items: [],
      subtotal: 1000,
      total: 1000,
      payments: [{ method: 'cash', amount: 1000 }],
    });

    const report = await reportsService.getDashboardData('today');
    expect(report.isCached).toBe(false);
    expect(report.isIncomplete).toBe(false);
    expect(report.cachedSources).toEqual([]);
  });

  it('flags isCached and identifies fallback collections when server queries fail or device is offline', async () => {
    const today = new Date().toISOString();
    mockStorage.set('offline_transactions', JSON.stringify([{
      id: 'tx_cached_1',
      date: today,
      saleType: 'retail',
      status: 'completed',
      items: [],
      subtotal: 2500,
      total: 2500,
      payments: [{ method: 'cash', amount: 2500 }],
    }]));

    fake.failCollections.add('transactions');
    fake.failCollections.add('customer_debts');

    const report = await reportsService.getDashboardData('today');
    expect(report.isCached).toBe(true);
    expect(report.cachedSources).toEqual(expect.arrayContaining(['sales', 'debts']));
    expect(report.financialSummary.grossRevenue).toBe(2500);
  });

  it('flags isCached when running completely offline from device cache', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const report = await reportsService.getDashboardData('today');
    expect(report.isCached).toBe(true);
    expect(report.cachedSources?.length).toBeGreaterThan(0);
  });

  it('prevents stale slow filter responses from overwriting newer filter selections', async () => {
    let resolveSlow!: (v: Awaited<ReturnType<typeof reportsService.getDashboardData>>) => void;
    let resolveFast!: (v: Awaited<ReturnType<typeof reportsService.getDashboardData>>) => void;
    const spy = vi.spyOn(reportsService, 'getDashboardData')
      .mockImplementationOnce(() => new Promise(res => { resolveSlow = res; }))
      .mockImplementationOnce(() => new Promise(res => { resolveFast = res; }));

    const base = await (vi.importActual<typeof import('./reportsService')>('./reportsService')).then(async () => {
      // build minimal shape via real compute offline
      vi.stubGlobal('navigator', { onLine: false });
      spy.mockRestore();
      return await reportsService.getDashboardData('today');
    });

    const slowReport = { ...base, timeframeLabel: 'Last Month (Slow)' };
    const fastReport = { ...base, timeframeLabel: 'Today (Fast)' };

    vi.spyOn(reportsService, 'getDashboardData')
      .mockImplementationOnce(() => new Promise(res => { resolveSlow = res; }))
      .mockImplementationOnce(() => new Promise(res => { resolveFast = res; }));

    const pSlow = useReportStore.getState().fetchData('last_month');
    const pFast = useReportStore.getState().fetchData('today');

    resolveFast(fastReport);
    await pFast;
    resolveSlow(slowReport);
    await pSlow;

    expect(useReportStore.getState().data?.timeframeLabel).toBe('Today (Fast)');
    vi.restoreAllMocks();
  });

  it('keeps noncash exchange debt deduction out of physical drawer cash and uses refund timestamps with fallback', () => {
    const day = '2026-11-15';
    const surplusAppliedToDebt: SaleTransaction = {
      id: 'tx_ex_debt',
      date: `${day}T11:00:00.000Z`,
      saleType: 'retail',
      status: 'completed',
      items: [],
      subtotal: -1500,
      total: -1500,
      payments: [{ method: 'debt', amount: 1500 }],
      exchangeSummary: {
        hasReturn: true,
        returnedTotal: 3000,
        purchasedTotal: 1500,
        netDifference: -1500,
        refundType: 'debt_deduction',
      },
    };
    const figures = computeDayFigures({ transactions: [surplusAppliedToDebt], repairs: [], debts: [] }, day);
    expect(figures.totalCash).toBe(0);
    expect(figures.refundsCash).toBe(0);

    const refundedWithTimestamp: SaleTransaction = {
      ...surplusAppliedToDebt,
      status: 'refunded',
      date: '2026-11-10T10:00:00.000Z',
      refundedAt: '2026-11-15T14:30:00.000Z',
    };
    expect(closedAtOf(refundedWithTimestamp)).toBe('2026-11-15T14:30:00.000Z');
    const voidedWithTimestamp: SaleTransaction = {
      ...surplusAppliedToDebt,
      status: 'voided',
      date: '2026-11-10T10:00:00.000Z',
      voidedAt: '2026-11-16T09:00:00.000Z',
    };
    expect(closedAtOf(voidedWithTimestamp)).toBe('2026-11-16T09:00:00.000Z');
    const legacyNoTimestamp: SaleTransaction = {
      ...surplusAppliedToDebt,
      status: 'refunded',
      date: '2026-11-08T08:00:00.000Z',
    };
    expect(closedAtOf(legacyNoTimestamp)).toBe('2026-11-08T08:00:00.000Z');
  });
});
