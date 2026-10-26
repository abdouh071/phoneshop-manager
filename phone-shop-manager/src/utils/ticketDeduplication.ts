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

  // Near-simultaneous duplicate creation (within 180 seconds with identical core attributes)
  if (a.createdAt && b.createdAt) {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && Math.abs(timeA - timeB) < 180_000) {
      const norm = (s?: string) => (s || '').trim().toLowerCase();
      const sameCust = norm(a.customerName) === norm(b.customerName);
      const sameBrand = norm(a.deviceBrand) === norm(b.deviceBrand);
      const sameModel = norm(a.deviceModel) === norm(b.deviceModel);
      const sameIssue = norm(a.issueDescription) === norm(b.issueDescription);

      if (sameCust && sameBrand && sameModel && (sameIssue || norm(a.issueDescription).includes(norm(b.issueDescription)) || norm(b.issueDescription).includes(norm(a.issueDescription)))) {
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
 * Helper to determine which of two duplicate tickets is more authoritative.
 * Completed/active tickets with payments or more data take precedence over cancelled/empty placeholders.
 */
const pickPreferredTicket = (existing: RepairTicket, incoming: RepairTicket): { preferred: RepairTicket; absorbed: RepairTicket } => {
  const isServer = (t: RepairTicket) => !t.id.startsWith('offline_') && !t.id.startsWith('local_');
  const existingIsServer = isServer(existing);
  const incomingIsServer = isServer(incoming);

  if (incomingIsServer && !existingIsServer) {
    return { preferred: incoming, absorbed: existing };
  }
  if (existingIsServer && !incomingIsServer) {
    return { preferred: existing, absorbed: incoming };
  }

  // Active status takes precedence over cancelled
  const isCancelled = (t: RepairTicket) => t.status === 'cancelled';
  if (isCancelled(existing) && !isCancelled(incoming)) {
    return { preferred: incoming, absorbed: existing };
  }
  if (!isCancelled(existing) && isCancelled(incoming)) {
    return { preferred: existing, absorbed: incoming };
  }

  // Paid or priced status takes precedence
  const hasPayment = (t: RepairTicket) => (t.paidAmount || 0) > 0 || (t.actualCost || 0) > 0 || t.paymentStatus === 'paid';
  if (hasPayment(incoming) && !hasPayment(existing)) {
    return { preferred: incoming, absorbed: existing };
  }
  if (hasPayment(existing) && !hasPayment(incoming)) {
    return { preferred: existing, absorbed: incoming };
  }

  // Default to newest update/creation
  const incomingTS = new Date(incoming.updatedAt || incoming.createdAt).getTime() || 0;
  const existingTS = new Date(existing.updatedAt || existing.createdAt).getTime() || 0;
  if (incomingTS > existingTS) {
    return { preferred: incoming, absorbed: existing };
  }

  return { preferred: existing, absorbed: incoming };
};

/**
 * Merges properties of an absorbed ticket into the preferred ticket to ensure no data is lost.
 */
const fuseTicketData = (preferred: RepairTicket, absorbed: RepairTicket): RepairTicket => {
  const mergedParts = [...(preferred.partsUsed || [])];
  if (absorbed.partsUsed && absorbed.partsUsed.length > 0) {
    absorbed.partsUsed.forEach(part => {
      if (!mergedParts.some(p => p.productId === part.productId)) {
        mergedParts.push(part);
      }
    });
  }

  const remarks = [preferred.remark, absorbed.remark].filter(Boolean);
  const fusedRemark = remarks.length > 0 ? Array.from(new Set(remarks)).join(' | ') : undefined;

  return {
    ...preferred,
    partsUsed: mergedParts.length > 0 ? mergedParts : undefined,
    remark: fusedRemark,
    depositAmount: Math.max(preferred.depositAmount || 0, absorbed.depositAmount || 0) || undefined,
    paidAmount: Math.max(preferred.paidAmount || 0, absorbed.paidAmount || 0) || undefined,
    handoverAmountPaid: Math.max(preferred.handoverAmountPaid || 0, absorbed.handoverAmountPaid || 0) || undefined,
    debtEntryId: preferred.debtEntryId || absorbed.debtEntryId,
    trackingPin: preferred.trackingPin || absorbed.trackingPin,
  };
};

/**
 * Deduplicates an array of tickets, ensuring:
 * 1. Filter out tickets that were archived/merged into another ticket.
 * 2. No duplicate `id` can exist.
 * 3. No duplicate `ticketNumber` can exist.
 * 4. No accidental duplicate tickets created at the same time can exist.
 * When a collision occurs, server-persisted, active, and paid tickets take precedence,
 * and extra details (parts, notes) are fused without losing data.
 */
export const deduplicateTickets = (tickets: RepairTicket[]): RepairTicket[] => {
  if (!Array.isArray(tickets) || tickets.length <= 1) {
    return Array.isArray(tickets) ? tickets.filter(t => !t.mergedIntoTicketId) : [];
  }

  const result: RepairTicket[] = [];
  const seenIds = new Set<string>();
  const seenTicketNumbers = new Set<string>();

  for (const ticket of tickets) {
    if (!ticket || !ticket.id) continue;
    // Exclude merged/archived tickets
    if (ticket.mergedIntoTicketId) continue;

    const tktNum = (ticket.ticketNumber || '').trim().toUpperCase();

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
        const { preferred, absorbed } = pickPreferredTicket(existing, ticket);
        seenIds.delete(existing.id);
        seenIds.add(preferred.id);
        result[existingIdx] = fuseTicketData(preferred, absorbed);
      }
      continue;
    }

    // 3. Check for near-simultaneous duplicate content
    const duplicateContentIdx = result.findIndex(t => isSameTicketContent(t, ticket));
    if (duplicateContentIdx !== -1) {
      const existing = result[duplicateContentIdx];
      const { preferred, absorbed } = pickPreferredTicket(existing, ticket);
      seenIds.delete(existing.id);
      if (existing.ticketNumber) {
        seenTicketNumbers.delete(existing.ticketNumber.trim().toUpperCase());
      }
      seenIds.add(preferred.id);
      if (preferred.ticketNumber) {
        seenTicketNumbers.add(preferred.ticketNumber.trim().toUpperCase());
      }
      result[duplicateContentIdx] = fuseTicketData(preferred, absorbed);
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

export interface DuplicateTicketPair {
  ticketA: RepairTicket;
  ticketB: RepairTicket;
  reason: string;
}

/**
 * Finds potential duplicate tickets in the database for UI review and manual fusion.
 */
export const findDuplicateTickets = (tickets: RepairTicket[]): DuplicateTicketPair[] => {
  const activeTickets = tickets.filter(t => !t.mergedIntoTicketId);
  const duplicates: DuplicateTicketPair[] = [];
  const seenPairs = new Set<string>();

  const norm = (s?: string) => (s || '').trim().toLowerCase();

  for (let i = 0; i < activeTickets.length; i++) {
    for (let j = i + 1; j < activeTickets.length; j++) {
      const a = activeTickets[i];
      const b = activeTickets[j];
      const pairKey = [a.id, b.id].sort().join(':::');
      if (seenPairs.has(pairKey)) continue;

      const numA = (a.ticketNumber || '').trim().toUpperCase();
      const numB = (b.ticketNumber || '').trim().toUpperCase();

      // 1. Same ticket number
      if (numA && numB && numA === numB) {
        duplicates.push({ ticketA: a, ticketB: b, reason: `Identical Ticket #${numA}` });
        seenPairs.add(pairKey);
        continue;
      }

      // 2. Same customer, same device, and identical or near-simultaneous creation
      const sameCust = norm(a.customerName) && norm(a.customerName) === norm(b.customerName);
      const sameBrand = norm(a.deviceBrand) && norm(a.deviceBrand) === norm(b.deviceBrand);
      const sameModel = norm(a.deviceModel) && norm(a.deviceModel) === norm(b.deviceModel);
      const sameIssue = norm(a.issueDescription) && norm(a.issueDescription) === norm(b.issueDescription);

      const phoneA = (a.customerPhone || '').replace(/\D/g, '');
      const phoneB = (b.customerPhone || '').replace(/\D/g, '');
      const phoneMatch = !phoneA || !phoneB || phoneA === phoneB;

      if (sameCust && sameBrand && sameModel && phoneMatch) {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        const diffSec = (!isNaN(timeA) && !isNaN(timeB)) ? Math.round(Math.abs(timeA - timeB) / 1000) : 999999;

        if (sameIssue && diffSec < 3600) { // Same issue within 1 hour
          duplicates.push({
            ticketA: a,
            ticketB: b,
            reason: diffSec < 180 ? `Duplicate Submission (${diffSec}s apart)` : `Identical Issue within 1 hour`
          });
          seenPairs.add(pairKey);
        } else if (diffSec < 180) { // Any issue on same device submitted within 3 minutes
          duplicates.push({
            ticketA: a,
            ticketB: b,
            reason: `Near-simultaneous submission (${diffSec}s apart)`
          });
          seenPairs.add(pairKey);
        }
      }
    }
  }

  return duplicates;
};

