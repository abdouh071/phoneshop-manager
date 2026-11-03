/**
 * Unit tests for repairPatchMerge.ts
 *
 * The live repairs stream pushes another device's writes into the list already on
 * screen. Getting this wrong shows up as duplicated tickets at the counter or rows
 * silently vanishing, so the merge rules are pinned here.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import type { RepairTicket } from '../types';
import { mergeRepairPatch } from './repairPatchMerge';

const makeTicket = (overrides: Partial<RepairTicket>): RepairTicket => ({
  id: 'ticket-1',
  ticketNumber: 'TKT-0001',
  customerName: 'Test Customer',
  customerPhone: '0550000000',
  deviceBrand: 'Samsung',
  deviceModel: 'Galaxy A54',
  issueDescription: 'Screen replacement',
  estimatedCost: 5000,
  status: 'pending',
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
  ...overrides,
});

describe('mergeRepairPatch', () => {
  it('returns the same list when the patch changes nothing', () => {
    const tickets = [makeTicket({ id: 'a' })];
    expect(mergeRepairPatch(tickets, { upsert: [], removedIds: [] })).toBe(tickets);
  });

  it('replaces a row in place without touching the others', () => {
    const tickets = [
      makeTicket({ id: 'newer', ticketNumber: 'TKT-0002', createdAt: '2026-01-03T10:00:00.000Z' }),
      makeTicket({ id: 'older', ticketNumber: 'TKT-0001' }),
    ];

    const merged = mergeRepairPatch(tickets, {
      upsert: [makeTicket({ id: 'older', ticketNumber: 'TKT-0001', status: 'in_progress' })],
      removedIds: [],
    });

    expect(merged.map(t => t.id)).toEqual(['newer', 'older']);
    expect(merged.find(t => t.id === 'older')?.status).toBe('in_progress');
  });

  it('lands a ticket added on another device in creation order', () => {
    const tickets = [makeTicket({ id: 'older', ticketNumber: 'TKT-0001' })];

    const merged = mergeRepairPatch(tickets, {
      upsert: [makeTicket({ id: 'fresh', ticketNumber: 'TKT-0009', createdAt: '2026-01-04T08:00:00.000Z' })],
      removedIds: [],
    });

    expect(merged.map(t => t.id)).toEqual(['fresh', 'older']);
  });

  it('collapses a server ticket against the offline copy holding the same number', () => {
    const tickets = [
      makeTicket({ id: 'offline_abc', ticketNumber: 'TKT-0001', status: 'completed' }),
    ];

    const merged = mergeRepairPatch(tickets, {
      upsert: [makeTicket({ id: 'server_123', ticketNumber: 'TKT-0001' })],
      removedIds: [],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('server_123');
  });

  it('drops a ticket that was deleted elsewhere and ignores unknown ids', () => {
    const tickets = [
      makeTicket({ id: 'a', ticketNumber: 'TKT-0001' }),
      makeTicket({ id: 'b', ticketNumber: 'TKT-0002', createdAt: '2026-01-03T10:00:00.000Z' }),
    ];

    const merged = mergeRepairPatch(tickets, { upsert: [], removedIds: ['a', 'never-loaded'] });

    expect(merged.map(t => t.id)).toEqual(['b']);
  });
});
