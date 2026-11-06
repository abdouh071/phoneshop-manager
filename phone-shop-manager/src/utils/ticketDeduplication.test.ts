/**
 * The double-submit guard must only catch double-submits.
 *
 * The old rule treated a missing phone number as a wildcard and any window under three
 * minutes as "the same moment", so two walk-ins with the same name and device silently
 * became one ticket. These tests pin the tightened rule: both phones must be present and
 * equal, the window is seconds, and the board never hides a ticket for looking like
 * another one.
 */
import { describe, it, expect } from 'vitest';
import type { RepairTicket } from '../types';
import { deduplicateTickets, isSameTicketContent } from './ticketDeduplication';

const ticket = (over: Partial<RepairTicket> = {}): RepairTicket =>
  ({
    id: over.id ?? `tkt_${Math.random().toString(36).slice(2, 8)}`,
    ticketNumber: over.ticketNumber ?? `TKT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    customerName: 'Karim',
    customerPhone: '0555123456',
    deviceBrand: 'Samsung',
    deviceModel: 'A55',
    issueDescription: 'Broken screen',
    status: 'pending',
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    ...over,
  }) as RepairTicket;

const secondsLater = (base: string, seconds: number): string =>
  new Date(new Date(base).getTime() + seconds * 1000).toISOString();

describe('isSameTicketContent', () => {
  it('catches a double-submit: same phone, same device, seconds apart', () => {
    const first = ticket({ createdAt: '2026-11-06T10:00:00.000Z' });
    const retry = ticket({ createdAt: secondsLater(first.createdAt, 4) });

    expect(isSameTicketContent(first, retry)).toBe(true);
  });

  it('never matches two walk-ins without a phone number', () => {
    const first = ticket({ customerPhone: '', createdAt: '2026-11-06T10:00:00.000Z' });
    const second = ticket({ customerPhone: '', createdAt: secondsLater(first.createdAt, 2) });

    expect(isSameTicketContent(first, second)).toBe(false);
  });

  it('never matches one walk-in and one registered customer of the same name', () => {
    const first = ticket({ customerPhone: '', createdAt: '2026-11-06T10:00:00.000Z' });
    const second = ticket({ customerPhone: '0555123456', createdAt: secondsLater(first.createdAt, 2) });

    expect(isSameTicketContent(first, second)).toBe(false);
  });

  it('does not match different phones even when everything else is identical', () => {
    const first = ticket({ customerPhone: '0555123456', createdAt: '2026-11-06T10:00:00.000Z' });
    const second = ticket({ customerPhone: '0770123456', createdAt: secondsLater(first.createdAt, 2) });

    expect(isSameTicketContent(first, second)).toBe(false);
  });

  it('does not match a submission minutes later — the same customer can bring two devices', () => {
    const first = ticket({ createdAt: '2026-11-06T10:00:00.000Z' });
    const second = ticket({ createdAt: secondsLater(first.createdAt, 180) });

    expect(isSameTicketContent(first, second)).toBe(false);
  });

  it('does not match a different issue even in the same breath', () => {
    const first = ticket({ issueDescription: 'Broken screen', createdAt: '2026-11-06T10:00:00.000Z' });
    const second = ticket({ issueDescription: 'Battery replacement', createdAt: secondsLater(first.createdAt, 3) });

    expect(isSameTicketContent(first, second)).toBe(false);
  });
});

describe('deduplicateTickets', () => {
  it('keeps every ticket on the board, even two that look alike', () => {
    const first = ticket({ id: 'a', ticketNumber: 'TKT-1001', customerPhone: '' });
    const second = ticket({ id: 'b', ticketNumber: 'TKT-1002', customerPhone: '', createdAt: secondsLater(first.createdAt, 2) });

    expect(deduplicateTickets([first, second])).toHaveLength(2);
  });

  it('still merges a shared ticket number and prefers the paid one', () => {
    const paid = ticket({ id: 'a', ticketNumber: 'TKT-1001', paidAmount: 5000, paymentStatus: 'paid' });
    const shadow = ticket({ id: 'b', ticketNumber: 'TKT-1001', customerName: 'Karim B' });

    const result = deduplicateTickets([shadow, paid]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('drops a ticket archived into another', () => {
    const absorbed = ticket({ id: 'a', mergedIntoTicketId: 'b' });
    const keeper = ticket({ id: 'b' });

    expect(deduplicateTickets([absorbed, keeper])).toHaveLength(1);
  });
});
