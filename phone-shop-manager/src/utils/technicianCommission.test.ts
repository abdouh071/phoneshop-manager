import { describe, it, expect } from 'vitest';
import { computeTicketCommission, ticketPartsCost, ticketRevenue } from './technicianCommission';
import type { RepairTicket } from '../types';

const ticket = (overrides: Partial<RepairTicket> = {}): RepairTicket => ({
  id: 't1',
  ticketNumber: 'TKT-0001',
  customerName: 'Walk-in',
  customerPhone: '0550000000',
  deviceBrand: 'Samsung',
  deviceModel: 'A10',
  issueDescription: 'Screen',
  estimatedCost: 0,
  status: 'completed',
  createdAt: '2026-11-09T08:00:00.000Z',
  updatedAt: '2026-11-09T09:00:00.000Z',
  ...overrides,
});

describe('computeTicketCommission', () => {
  it('pays the rate on net labor for a billed repair', () => {
    const c = computeTicketCommission(ticket({ actualCost: 5000, partsUsed: [{ productId: 'p', name: 'Screen', cost: 1500, quantity: 1 }] }), 50);
    expect(c.revenue).toBe(5000);
    expect(c.partsCost).toBe(1500);
    expect(c.net).toBe(3500);
    expect(c.isWarranty).toBe(false);
    expect(c.techCut).toBe(1750);
  });

  it('a warranty return with parts charges the technician nothing', () => {
    const c = computeTicketCommission(ticket({ actualCost: 0, isReturn: true, partsUsed: [{ productId: 'p', name: 'Screen', cost: 1500, quantity: 1 }] }), 50);
    expect(c.isWarranty).toBe(true);
    expect(c.partsCost).toBe(1500);
    expect(c.net).toBe(-1500);
    expect(c.techCut).toBe(0);
  });

  it('a zero-price ticket with no parts is still warranty, not a negative cut', () => {
    const c = computeTicketCommission(ticket({ actualCost: 0 }), 60);
    expect(c.isWarranty).toBe(true);
    expect(c.techCut).toBe(0);
  });

  it('falls back to the estimate when no final price was recorded', () => {
    const c = computeTicketCommission(ticket({ estimatedCost: 4000 }), 50);
    expect(c.revenue).toBe(4000);
    expect(c.isWarranty).toBe(false);
    expect(c.techCut).toBe(2000);
  });

  it('multiplies part cost by quantity', () => {
    const t = ticket({ partsUsed: [{ productId: 'p', name: 'Screw', cost: 200, quantity: 3 }] });
    expect(ticketPartsCost(t)).toBe(600);
  });

  it('leaves a billed but parts-heavy repair exactly as before (no warranty flooring)', () => {
    const c = computeTicketCommission(ticket({ actualCost: 1000, partsUsed: [{ productId: 'p', name: 'Board', cost: 1500, quantity: 1 }] }), 50);
    expect(c.isWarranty).toBe(false);
    expect(c.net).toBe(-500);
    expect(c.techCut).toBe(-250);
  });

  it('reads a missing price as zero revenue', () => {
    expect(ticketRevenue(ticket({ estimatedCost: 0 }))).toBe(0);
  });

  it('flags revenue drawn from the estimate when no final price exists', () => {
    const c = computeTicketCommission(ticket({ estimatedCost: 4000 }), 50);
    expect(c.isEstimate).toBe(true);
    expect(c.techCut).toBe(2000);
  });

  it('a recorded final price is billed, not an estimate', () => {
    const c = computeTicketCommission(ticket({ estimatedCost: 4000, actualCost: 4500 }), 50);
    expect(c.isEstimate).toBe(false);
    expect(c.revenue).toBe(4500);
  });

  it('a zero final price is a billed warranty, not an estimate', () => {
    const c = computeTicketCommission(ticket({ estimatedCost: 4000, actualCost: 0 }), 50);
    expect(c.isEstimate).toBe(false);
    expect(c.isWarranty).toBe(true);
  });
});