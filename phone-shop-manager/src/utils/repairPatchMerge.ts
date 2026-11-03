import type { RepairTicket } from '../types';
import type { RepairPatch } from '../services/repairService';
import { deduplicateTickets } from './ticketDeduplication';

/**
 * Merge one live change from another device into the list already on screen.
 *
 * Three rules keep a pushed ticket from disturbing the terminal:
 * - rows the stream says nothing about stay exactly as they are, in place;
 * - the newest-first order that the one-shot load leaves behind is restored, so a
 *   ticket arriving from a phone sits where a reload would have put it;
 * - the pairwise dedup only runs when another device actually added a ticket,
 *   because a same-id replacement cannot create a duplicate.
 *
 * Returns the input array untouched when the patch changes nothing, so an idle
 * stream cannot re-render the list.
 */
export const mergeRepairPatch = (tickets: RepairTicket[], patch: RepairPatch): RepairTicket[] => {
  const { upsert, removedIds } = patch;
  if (upsert.length === 0 && removedIds.length === 0) return tickets;

  const byId = new Map(tickets.map((t) => [t.id, t] as const));
  removedIds.forEach((id) => {
    byId.delete(id);
  });

  let sawNewTicket = false;
  upsert.forEach((ticket) => {
    if (!byId.has(ticket.id)) sawNewTicket = true;
    byId.set(ticket.id, ticket);
  });

  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return sawNewTicket ? deduplicateTickets(merged) : merged;
};
