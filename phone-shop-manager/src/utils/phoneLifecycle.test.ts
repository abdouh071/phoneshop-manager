/**
 * A returned ticket stays pending until its LATEST return is settled.
 *
 * The auto-heal used to treat a returned parent as resolved the moment ANY return
 * child completed — even while a newer return was still in the shop — and then
 * persisted `completed` over the live return. These tests pin the rule the heal
 * must follow, and pin the overdue predicate both the pill and the filter share.
 */
import { describe, it, expect } from 'vitest';
import type { RepairTicket } from '../types';
import { isTicketActiveReturnPending, isTicketOverdue } from './phoneLifecycle';

const ticket = (over: Partial<RepairTicket> = {}): RepairTicket =>
  ({
    id: over.id ?? `t_${Math.random().toString(36).slice(2, 8)}`,
    ticketNumber: over.ticketNumber ?? 'TKT-0001',
    customerName: 'Karim',
    deviceBrand: 'Samsung',
    deviceModel: 'A55',
    issueDescription: 'Broken screen',
    status: 'returned',
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    ...over,
  }) as RepairTicket;

const child = (parentId: string, status: RepairTicket['status']): RepairTicket =>
  ticket({ id: `c_${parentId}_${status}`, parentTicketId: parentId, isReturn: true, status });

describe('isTicketActiveReturnPending', () => {
  it('stays pending while a return child is open, even beside a completed one', () => {
    const parent = ticket({ id: 'p1' });
    const older = child('p1', 'completed');
    const newer = child('p1', 'pending');

    // The older return was settled and the newer one is still in the shop: the
    // parent is a live return, not history.
    expect(isTicketActiveReturnPending(parent, [parent, older, newer])).toBe(true);
  });

  it('is resolved when every return child completed', () => {
    const parent = ticket({ id: 'p1' });
    const only = child('p1', 'completed');

    expect(isTicketActiveReturnPending(parent, [parent, only])).toBe(false);
  });

  it('is resolved when the explicitly linked child completed and no other child is open', () => {
    const linked = child('p1', 'completed');
    const parent = ticket({ id: 'p1', activeReturnTicketId: linked.id });

    expect(isTicketActiveReturnPending(parent, [parent, linked])).toBe(false);
  });

  it('is still pending when the linked child completed but a newer child is open', () => {
    const linked = child('p1', 'completed');
    const newer = child('p1', 'ready');
    const parent = ticket({ id: 'p1', activeReturnTicketId: linked.id });

    expect(isTicketActiveReturnPending(parent, [parent, linked, newer])).toBe(true);
  });

  it('reads a returned ticket with no children as pending', () => {
    const parent = ticket({ id: 'p1' });

    expect(isTicketActiveReturnPending(parent, [parent])).toBe(true);
  });
});

describe('isTicketOverdue', () => {
  const now = new Date('2026-11-06T12:00:00.000Z');

  it('counts a pending ticket past its promised date', () => {
    expect(isTicketOverdue(ticket({ status: 'pending', estimatedCompletionDate: '2026-11-05T10:00:00.000Z' }), now)).toBe(true);
  });

  it('does not count a future date, a closed ticket, or a ticket with no promise', () => {
    expect(isTicketOverdue(ticket({ status: 'pending', estimatedCompletionDate: '2026-11-07T10:00:00.000Z' }), now)).toBe(false);
    expect(isTicketOverdue(ticket({ status: 'completed', estimatedCompletionDate: '2026-11-05T10:00:00.000Z' }), now)).toBe(false);
    expect(isTicketOverdue(ticket({ status: 'returned', estimatedCompletionDate: '2026-11-05T10:00:00.000Z' }), now)).toBe(false);
    expect(isTicketOverdue(ticket({ status: 'pending' }), now)).toBe(false);
  });
});
