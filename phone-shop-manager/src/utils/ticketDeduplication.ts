import type { RepairTicket } from '../types';

/**
 * Checks if two tickets represent the same repair incident.
 */
export const isSameTicketContent = (a: RepairTicket, b: RepairTicket): boolean => {
  if (!a || !b) return false;

  // Exact ID match
  if (a.id && b.id && a.id === b.id) return true;

  // Exact ticket number match
  if (a.ticketNumber && b.ticketNumber && a.ticketNumber.trim().toLowerCase() === b.ticketNumber.trim().toLowerCase()) {
    return true;
  }

  // Near-simultaneous duplicate creation (within 45 seconds with identical core attributes)
  if (a.createdAt && b.createdAt) {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && Math.abs(timeA - timeB) < 45_000) {
      const norm = (s?: string) => (s || '').trim().toLowerCase();
      const sameCust = norm(a.customerName) === norm(b.customerName);
      const sameBrand = norm(a.deviceBrand) === norm(b.deviceBrand);
      const sameModel = norm(a.deviceModel) === norm(b.deviceModel);
      const sameIssue = norm(a.issueDescription) === norm(b.issueDescription);

      if (sameCust && sameBrand && sameModel && sameIssue) {
        const phoneA = (a.customerPhone || '').replace(/\D/g, '');
        const phoneB = (b.customerPhone || '').replace(/\D/g, '');
        if (!phoneA || !phoneB || phoneA === phoneB) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Deduplicates an array of tickets, ensuring:
 * 1. No duplicate `id` can exist.
 * 2. No duplicate `ticketNumber` can exist.
 * 3. No accidental duplicate tickets created at the same time can exist.
 * When a collision occurs, server-persisted tickets and newer updates take precedence.
 */
export const deduplicateTickets = (tickets: RepairTicket[]): RepairTicket[] => {
  if (!Array.isArray(tickets) || tickets.length <= 1) {
    return Array.isArray(tickets) ? tickets : [];
  }

  const result: RepairTicket[] = [];
  const seenIds = new Set<string>();
  const seenTicketNumbers = new Set<string>();

  for (const ticket of tickets) {
    if (!ticket || !ticket.id) continue;

    const tktNum = (ticket.ticketNumber || '').trim().toUpperCase();

    // Helper: is this a real Firestore server doc or a local temporary placeholder?
    const isServerDoc = !ticket.id.startsWith('offline_') && !ticket.id.startsWith('local_');

    // 1. Check if we already have this exact ID
    if (seenIds.has(ticket.id)) {
      continue;
    }

    // 2. Check if we already have this ticketNumber
    if (tktNum && seenTicketNumbers.has(tktNum)) {
      const existingIdx = result.findIndex(
        t => (t.ticketNumber || '').trim().toUpperCase() === tktNum
      );
      if (existingIdx !== -1) {
        const existing = result[existingIdx];
        const existingIsServer = !existing.id.startsWith('offline_') && !existing.id.startsWith('local_');

        if (isServerDoc && !existingIsServer) {
          // Upgrade local placeholder to authoritative server document
          seenIds.delete(existing.id);
          seenIds.add(ticket.id);
          result[existingIdx] = ticket;
        } else if (isServerDoc === existingIsServer) {
          // Compare updatedAt or createdAt timestamp; keep newest
          const currentTS = new Date(ticket.updatedAt || ticket.createdAt).getTime() || 0;
          const existingTS = new Date(existing.updatedAt || existing.createdAt).getTime() || 0;
          if (currentTS > existingTS) {
            seenIds.delete(existing.id);
            seenIds.add(ticket.id);
            result[existingIdx] = ticket;
          }
        }
      }
      continue;
    }

    // 3. Check for near-simultaneous duplicate content
    const duplicateContentIdx = result.findIndex(t => isSameTicketContent(t, ticket));
    if (duplicateContentIdx !== -1) {
      const existing = result[duplicateContentIdx];
      const existingIsServer = !existing.id.startsWith('offline_') && !existing.id.startsWith('local_');

      if (isServerDoc && !existingIsServer) {
        seenIds.delete(existing.id);
        if (existing.ticketNumber) {
          seenTicketNumbers.delete(existing.ticketNumber.trim().toUpperCase());
        }
        seenIds.add(ticket.id);
        if (tktNum) seenTicketNumbers.add(tktNum);
        result[duplicateContentIdx] = ticket;
      }
      // If existing is already server or equal, discard the second duplicate
      continue;
    }

    // Ticket is unique — register it
    seenIds.add(ticket.id);
    if (tktNum) {
      seenTicketNumbers.add(tktNum);
    }
    result.push(ticket);
  }

  return result;
};
