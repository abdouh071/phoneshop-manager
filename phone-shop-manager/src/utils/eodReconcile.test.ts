/**
 * Sealed day vs the same day recomputed later.
 *
 * A seal is a document the shop already counted money against, so it must not change. What
 * has to change is visibility: when a payment arrives, a refund lands on an older sale, or a
 * line gets edited after the close, reconcileEodDay is what says so - and it must stay quiet
 * about fields an older seal never stored, and about float noise.
 */
import { describe, it, expect } from 'vitest';
import { reconcileEodDay } from './eodReconcile';
import { computeDayFigures } from './dayFigures';
import type { EndOfDayRecord } from '../services/endOfDayService';
import type { DayFigures } from './dayFigures';

const sealed = (overrides: Partial<EndOfDayRecord> = {}): EndOfDayRecord => ({
  id: 'seal-1',
  date: '2026-02-10',
  closedAt: '2026-02-10T23:59:00.000Z',
  isAutoClose: false,
  salesCount: 4,
  salesCash: 1000,
  salesCard: 500,
  salesMobile: 0,
  salesTransfer: 0,
  salesDebt: 200,
  salesTotalRevenue: 1700,
  salesCogs: 900,
  salesNetProfit: 800,
  repairsCompleted: 2,
  repairsCash: 600,
  repairsCard: 0,
  repairsMobile: 0,
  repairsDebt: 400,
  repairsTotalRevenue: 700,
  repairsPartsCost: 200,
  repairsNetProfit: 500,
  partsSalesCount: 1,
  partsSalesRevenue: 800,
  totalRevenue: 3200,
  totalNetProfit: 1600,
  totalCash: 2500,
  totalCard: 500,
  totalMobile: 0,
  sealVersion: 2,
  ...overrides,
});

/** Figures that line up with `sealed()` above, so the baseline test starts from agreement. */
const matchingFigures = (): DayFigures => ({
  salesCount: 4,
  salesCash: 1000,
  salesCard: 500,
  salesMobile: 0,
  salesTransfer: 0,
  salesStoreCredit: 0,
  salesDebt: 200,
  salesGrossRevenue: 1700,
  salesCOGS: 900,
  salesNetProfit: 800,
  refundsCash: 0,
  repairsCompletedCount: 2,
  repairsRecognizedCount: 1,
  repairsRevenue: 700,
  repairsPartsCost: 200,
  repairsNetProfit: 500,
  repairsHandoverCash: 600,
  repairsHandoverCard: 0,
  repairsHandoverMobile: 0,
  repairsHandoverTransfer: 0,
  repairsDepositCash: 0,
  repairsCash: 600,
  repairsDebt: 400,
  partsCount: 1,
  partsRevenue: 800,
  partsCash: 0,
  partsCard: 0,
  partsMobile: 0,
  partsTransfer: 0,
  partsDebt: 0,
  partsStoreCredit: 0,
  partsCOGS: 0,
  partsNetProfit: 800,
  debtCollectedCash: 0,
  debtCollectedCard: 0,
  debtCollectedMobile: 0,
  totalRevenue: 3200,
  totalCOGS: 1100,
  totalNetProfit: 1600,
  totalCash: 2500,
  totalCard: 500,
  totalMobile: 0,
});

describe('reconcileEodDay', () => {
  it('reports no drift when the day still adds up the way the seal said', () => {
    const result = reconcileEodDay(sealed(), matchingFigures());
    expect(result.hasDrift).toBe(false);
    expect(result.drifts).toEqual([]);
    expect(result.revenueDelta).toBe(0);
    expect(result.date).toBe('2026-02-10');
  });

  it('keeps the seal authoritative and shows a later payment as drift', () => {
    const figures = { ...matchingFigures(), salesCash: 1400, totalCash: 2900, salesCount: 5 };
    const result = reconcileEodDay(sealed(), figures);

    expect(result.hasDrift).toBe(true);
    expect(result.cashDelta).toBe(400);
    expect(result.drifts.map(d => d.field).sort()).toEqual(['salesCash', 'salesCount', 'totalCash'].sort());

    const cashDrift = result.drifts.find(d => d.field === 'salesCash');
    expect(cashDrift?.sealed).toBe(1000);
    expect(cashDrift?.live).toBe(1400);
    expect(cashDrift?.delta).toBe(400);
  });

  it('shows money leaving a closed day as a negative delta', () => {
    const result = reconcileEodDay(sealed(), { ...matchingFigures(), totalRevenue: 2700 });
    const drift = result.drifts.find(d => d.field === 'totalRevenue');
    expect(drift?.delta).toBe(-500);
    expect(result.revenueDelta).toBe(-500);
  });

  it('ignores fields an older seal never wrote instead of reading them as zero', () => {
    const legacy = sealed({ sealVersion: undefined, refundsCash: undefined, debtCollectedCash: undefined });
    const result = reconcileEodDay(legacy, { ...matchingFigures(), refundsCash: 300, debtCollectedCash: 250 });

    expect(result.isLegacySeal).toBe(true);
    expect(result.drifts.map(d => d.field)).not.toContain('refundsCash');
    expect(result.drifts.map(d => d.field)).not.toContain('debtCollectedCash');
    expect(result.hasDrift).toBe(false);
  });

  it('does not call half a cent a difference', () => {
    expect(reconcileEodDay(sealed(), { ...matchingFigures(), totalCash: 2500.001 }).hasDrift).toBe(false);
    expect(reconcileEodDay(sealed(), { ...matchingFigures(), totalCash: 2501 }).hasDrift).toBe(true);
  });

  it('marks a seal that only this till has', () => {
    const result = reconcileEodDay(sealed({ id: 'offline_eod_1739231940000' }), matchingFigures());
    expect(result.isLocalOnly).toBe(true);
    expect(result.sealedAt).toBe('2026-02-10T23:59:00.000Z');
  });

  it('compares through the same formula the seal used', () => {
    // Empty sources recompute to zero revenue, which is a difference from a day that had sales.
    const figures = computeDayFigures({ transactions: [], repairs: [], debts: [] }, '2026-02-10');
    const result = reconcileEodDay(sealed(), figures);
    expect(result.hasDrift).toBe(true);
    expect(result.revenueDelta).toBe(-3200);
  });

  it('shows a card handover arriving after the close as repair-card drift, not drawer cash', () => {
    const figures = {
      ...matchingFigures(),
      repairsHandoverCard: 700,
      totalCard: 1200,
    };
    const result = reconcileEodDay(sealed(), figures);

    const fields = result.drifts.map(d => d.field);
    expect(fields).toContain('repairsCard');
    expect(fields).toContain('totalCard');
    expect(fields).not.toContain('totalCash');
    expect(fields).not.toContain('repairsCash');
    expect(result.drifts.find(d => d.field === 'repairsCard')?.delta).toBe(700);
  });

  it('stays quiet about transfer handovers a seal written before the split never stored', () => {
    const legacy = sealed({ repairsTransfer: undefined });
    const result = reconcileEodDay(legacy, { ...matchingFigures(), repairsHandoverTransfer: 900 });
    expect(result.drifts.map(d => d.field)).not.toContain('repairsTransfer');
  });
});
