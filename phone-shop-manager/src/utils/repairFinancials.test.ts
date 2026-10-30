/**
 * Unit tests for repairFinancials.ts
 *
 * These tests protect the core financial invariants that determine revenue recognition
 * for repair tickets. Incorrect logic here directly affects daily cash reports.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import type { RepairTicket } from '../types';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
  getClaimedRepairHandoverCash,
  getClaimedRepairDebt,
  getClaimedRepairPartsCost,
  getClaimedRepairProfit,
  getClaimedRepairFullPrice,
} from './repairFinancials';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal completed ticket with a given payment state */
const makeTicket = (overrides: Partial<RepairTicket>): RepairTicket => ({
  id: 'ticket-1',
  ticketNumber: 'TKT-0001',
  customerName: 'Test Customer',
  customerPhone: '0550000000',
  deviceBrand: 'Samsung',
  deviceModel: 'Galaxy A54',
  issueDescription: 'Screen replacement',
  estimatedCost: 5000,
  status: 'completed',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ─── isClaimedAndPaidRepair ───────────────────────────────────────────────────

describe('isClaimedAndPaidRepair', () => {
  it('returns false for null/undefined', () => {
    expect(isClaimedAndPaidRepair(null)).toBe(false);
    expect(isClaimedAndPaidRepair(undefined)).toBe(false);
  });

  it('returns false when ticket is not completed', () => {
    expect(isClaimedAndPaidRepair(makeTicket({ status: 'pending' }))).toBe(false);
    expect(isClaimedAndPaidRepair(makeTicket({ status: 'in_progress' }))).toBe(false);
    expect(isClaimedAndPaidRepair(makeTicket({ status: 'ready' }))).toBe(false);
    expect(isClaimedAndPaidRepair(makeTicket({ status: 'cancelled' }))).toBe(false);
    expect(isClaimedAndPaidRepair(makeTicket({ status: 'returned' }))).toBe(false);
  });

  it('returns true for fully paid completed ticket', () => {
    const t = makeTicket({ status: 'completed', paymentStatus: 'paid' });
    expect(isClaimedAndPaidRepair(t)).toBe(true);
  });

  it('returns true for partially paid completed ticket', () => {
    const t = makeTicket({ status: 'completed', paymentStatus: 'partial', paidAmount: 2000 });
    expect(isClaimedAndPaidRepair(t)).toBe(true);
  });

  it('returns false for pure debt completed ticket (0 paid)', () => {
    const t = makeTicket({ status: 'completed', paymentStatus: 'debt', paidAmount: 0 });
    expect(isClaimedAndPaidRepair(t)).toBe(false);
  });

  it('returns true when paidAmount > 0 even without explicit paymentStatus', () => {
    const t = makeTicket({ status: 'completed', paidAmount: 3000 });
    expect(isClaimedAndPaidRepair(t)).toBe(true);
  });

  it('returns true when depositAmount + handoverAmountPaid > 0', () => {
    const t = makeTicket({ status: 'completed', depositAmount: 1000, handoverAmountPaid: 2000 });
    expect(isClaimedAndPaidRepair(t)).toBe(true);
  });
});

// ─── getClaimedRepairFullPrice ────────────────────────────────────────────────

describe('getClaimedRepairFullPrice', () => {
  it('prefers actualCost over estimatedCost', () => {
    const t = makeTicket({ actualCost: 6000, estimatedCost: 5000 });
    expect(getClaimedRepairFullPrice(t)).toBe(6000);
  });

  it('falls back to estimatedCost when no actualCost', () => {
    const t = makeTicket({ estimatedCost: 4500 });
    expect(getClaimedRepairFullPrice(t)).toBe(4500);
  });

  it('returns 0 for null ticket', () => {
    expect(getClaimedRepairFullPrice(null)).toBe(0);
  });
});

// ─── getClaimedRepairRevenue ──────────────────────────────────────────────────

describe('getClaimedRepairRevenue', () => {
  it('returns 0 for non-completed tickets', () => {
    const t = makeTicket({ status: 'in_progress', paymentStatus: 'paid' });
    expect(getClaimedRepairRevenue(t)).toBe(0);
  });

  it('returns 0 for pure debt (0 paid)', () => {
    const t = makeTicket({ paymentStatus: 'debt', paidAmount: 0 });
    expect(getClaimedRepairRevenue(t)).toBe(0);
  });

  it('returns full price for fully paid ticket', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 5000 });
    expect(getClaimedRepairRevenue(t)).toBe(5000);
  });

  it('returns only paid amount for partial payment — NEVER full price', () => {
    const t = makeTicket({
      paymentStatus: 'partial',
      actualCost: 5000,
      paidAmount: 2000,
    });
    expect(getClaimedRepairRevenue(t)).toBe(2000);
  });

  it('caps partial payment at full price (cannot exceed)', () => {
    const t = makeTicket({
      paymentStatus: 'partial',
      actualCost: 3000,
      paidAmount: 5000, // more than actual cost — should be capped
    });
    expect(getClaimedRepairRevenue(t)).toBe(3000);
  });

  it('recognises deposit + handover sum for partial payment', () => {
    const t = makeTicket({
      paymentStatus: 'partial',
      actualCost: 5000,
      depositAmount: 1000,
      handoverAmountPaid: 2000,
      // paidAmount not set — should fall back to deposit + handover
    });
    expect(getClaimedRepairRevenue(t)).toBe(3000);
  });

  it('returns paidAmount when paymentStatus=paid and paidAmount is set', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 5000, paidAmount: 4800 });
    expect(getClaimedRepairRevenue(t)).toBe(4800);
  });

  it('returns 0 for null', () => {
    expect(getClaimedRepairRevenue(null)).toBe(0);
  });
});

// ─── getClaimedRepairHandoverCash ─────────────────────────────────────────────

describe('getClaimedRepairHandoverCash', () => {
  it('returns 0 for non-completed ticket', () => {
    const t = makeTicket({ status: 'ready', paymentStatus: 'paid', handoverAmountPaid: 4000 });
    expect(getClaimedRepairHandoverCash(t)).toBe(0);
  });

  it('returns 0 for pure-debt ticket', () => {
    const t = makeTicket({ paymentStatus: 'debt', handoverAmountPaid: 0 });
    expect(getClaimedRepairHandoverCash(t)).toBe(0);
  });

  it('returns explicit handoverAmountPaid when set', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 5000, depositAmount: 1000, handoverAmountPaid: 4000 });
    expect(getClaimedRepairHandoverCash(t)).toBe(4000);
  });

  it('derives handover from full price - deposit when handoverAmountPaid not set', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 5000, depositAmount: 1000 });
    expect(getClaimedRepairHandoverCash(t)).toBe(4000);
  });

  it('returns partial paid amount minus deposit for partial payment', () => {
    const t = makeTicket({ paymentStatus: 'partial', actualCost: 5000, depositAmount: 1000, paidAmount: 3000 });
    expect(getClaimedRepairHandoverCash(t)).toBe(2000); // 3000 - 1000
  });
});

// ─── getClaimedRepairDebt ─────────────────────────────────────────────────────

describe('getClaimedRepairDebt', () => {
  it('returns 0 for non-completed', () => {
    const t = makeTicket({ status: 'in_progress', paymentStatus: 'debt', paidAmount: 0 });
    expect(getClaimedRepairDebt(t)).toBe(0);
  });

  it('returns 0 for fully paid', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 5000 });
    expect(getClaimedRepairDebt(t)).toBe(0);
  });

  it('returns remaining balance for partial payment', () => {
    const t = makeTicket({ paymentStatus: 'partial', actualCost: 5000, paidAmount: 2000 });
    expect(getClaimedRepairDebt(t)).toBe(3000);
  });

  it('returns full price for pure debt (0 paid)', () => {
    // Pure debt: paymentStatus='debt' with 0 paid
    // BUT isClaimedAndPaidRepair returns false for 0-paid debt, so revenue=0
    // debt = fullPrice - revenue = 5000 - 0 = 5000
    const t = makeTicket({ paymentStatus: 'debt', actualCost: 5000, paidAmount: 0 });
    expect(getClaimedRepairDebt(t)).toBe(5000);
  });

  it('never returns negative debt', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 5000, paidAmount: 6000 });
    expect(getClaimedRepairDebt(t)).toBeGreaterThanOrEqual(0);
  });
});

// ─── getClaimedRepairPartsCost ────────────────────────────────────────────────

describe('getClaimedRepairPartsCost', () => {
  it('returns 0 for non-completed ticket', () => {
    const t = makeTicket({
      status: 'in_progress',
      partsUsed: [{ productId: 'p1', name: 'Screen', cost: 2000, quantity: 1 }],
    });
    expect(getClaimedRepairPartsCost(t)).toBe(0);
  });

  it('sums parts cost × quantity', () => {
    const t = makeTicket({
      paymentStatus: 'paid',
      actualCost: 8000,
      partsUsed: [
        { productId: 'p1', name: 'Screen', cost: 2000, quantity: 1 },
        { productId: 'p2', name: 'Battery', cost: 800, quantity: 2 },
      ],
    });
    expect(getClaimedRepairPartsCost(t)).toBe(3600); // 2000 + (800 * 2)
  });

  it('returns 0 when no parts used', () => {
    const t = makeTicket({ paymentStatus: 'paid', actualCost: 3000 });
    expect(getClaimedRepairPartsCost(t)).toBe(0);
  });
});

// ─── getClaimedRepairProfit ───────────────────────────────────────────────────

describe('getClaimedRepairProfit', () => {
  it('computes profit as revenue minus parts cost', () => {
    const t = makeTicket({
      paymentStatus: 'paid',
      actualCost: 8000,
      partsUsed: [{ productId: 'p1', name: 'Screen', cost: 3000, quantity: 1 }],
    });
    expect(getClaimedRepairProfit(t)).toBe(5000);
  });

  it('returns 0 for non-claimed ticket', () => {
    const t = makeTicket({
      status: 'ready',
      paymentStatus: 'paid',
      actualCost: 5000,
    });
    expect(getClaimedRepairProfit(t)).toBe(0);
  });

  it('handles partial payment profit correctly', () => {
    // Partial: 3000 paid on a 5000 repair with 1000 DA parts cost
    const t = makeTicket({
      paymentStatus: 'partial',
      actualCost: 5000,
      paidAmount: 3000,
      partsUsed: [{ productId: 'p1', name: 'Screen', cost: 1000, quantity: 1 }],
    });
    // Revenue = 3000 (paid only), parts = 1000, profit = 2000
    expect(getClaimedRepairProfit(t)).toBe(2000);
  });
});
