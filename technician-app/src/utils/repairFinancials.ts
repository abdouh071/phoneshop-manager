import type { RepairTicket } from '../types';

/**
 * Determines whether a repair ticket represents a phone that has been
 * claimed/picked up AND marked as paid or partly paid.
 *
 * Requirements:
 * 1. Must be claimed / picked up: `ticket.status === 'completed'`.
 *    Phones in 'pending', 'in_progress', 'ready', 'cancelled', 'returned'
 *    are NOT claimed/picked up yet.
 * 2. Must be marked as paid or partly paid:
 *    - `paymentStatus === 'paid'` (fully paid)
 *    - `paymentStatus === 'partial'` (partly paid with deposit or partial handover payment)
 *    - Or `paidAmount > 0` / `handoverAmountPaid > 0`
 *    Phones with `paymentStatus === 'debt'` and 0 paid are pure unpaid debt
 *    and are NOT marked as paid or partly paid.
 */
export const isClaimedAndPaidRepair = (ticket: RepairTicket | null | undefined): boolean => {
  if (!ticket) return false;
  if (ticket.status !== 'completed') return false;

  // Fully paid or partly paid with remaining debt
  if (ticket.paymentStatus === 'paid' || ticket.paymentStatus === 'partial') {
    return true;
  }

  // Check explicit paid amounts (deposit + handover)
  const totalPaid = (ticket.paidAmount !== undefined && ticket.paidAmount > 0)
    ? ticket.paidAmount
    : ((ticket.depositAmount || 0) + (ticket.handoverAmountPaid || 0));

  if (totalPaid > 0) {
    return true;
  }

  // Pure debt (0 paid) or unhandled completed ticket without payment
  return false;
};

/**
 * Returns the total contract / sticker price of the repair.
 */
export const getClaimedRepairFullPrice = (ticket: RepairTicket | null | undefined): number => {
  if (!ticket) return 0;
  return ticket.actualCost ?? ticket.estimatedCost ?? 0;
};

/**
 * Calculates the recognized revenue (income) for a claimed repair.
 *
 * CRITICAL RULE:
 * - If the phone was partly paid (`paymentStatus === 'partial'`), ONLY the amount
 *   actually paid (`paidAmount` or deposit + handover) is recognized as income.
 *   The remaining unpaid price is customer debt and is NOT counted as revenue now!
 * - If the phone was fully paid (`paymentStatus === 'paid'`), the full price
 *   (`actualCost ?? estimatedCost`) is recognized.
 * - If the phone was pure debt (`paymentStatus === 'debt'` with 0 paid) or not completed,
 *   0 is recognized.
 */
export const getClaimedRepairRevenue = (ticket: RepairTicket | null | undefined): number => {
  if (!isClaimedAndPaidRepair(ticket)) return 0;

  const fullPrice = getClaimedRepairFullPrice(ticket);

  // 1. Explicitly marked as partly paid: STRICTLY return paid amount only, never full price!
  if (ticket?.paymentStatus === 'partial') {
    const paid = ticket.paidAmount !== undefined
      ? ticket.paidAmount
      : ((ticket.depositAmount || 0) + (ticket.handoverAmountPaid || 0));
    // Paid amount cannot exceed full price (sanity cap)
    return fullPrice > 0 ? Math.min(Math.max(0, paid), fullPrice) : Math.max(0, paid);
  }

  // 2. Pure debt: 0 revenue
  if (ticket?.paymentStatus === 'debt') {
    const paid = ticket.paidAmount ?? ((ticket.depositAmount || 0) + (ticket.handoverAmountPaid || 0));
    return paid > 0 ? (fullPrice > 0 ? Math.min(paid, fullPrice) : paid) : 0;
  }

  // 3. Fully paid:
  if (ticket?.paymentStatus === 'paid') {
    if (ticket.paidAmount !== undefined && ticket.paidAmount > 0) {
      return ticket.paidAmount;
    }
    return fullPrice;
  }

  // 4. Fallback for tickets without paymentStatus:
  // If paidAmount or deposit+handover is recorded and less than fullPrice, treat as partial!
  const explicitPaid = ticket?.paidAmount !== undefined
    ? ticket.paidAmount
    : ((ticket?.depositAmount || 0) + (ticket?.handoverAmountPaid || 0));

  if (explicitPaid > 0) {
    return fullPrice > 0 ? Math.min(explicitPaid, fullPrice) : explicitPaid;
  }

  return fullPrice;
};

/**
 * Legacy alias for backwards compatibility: returns recognized repair revenue.
 */
export const getClaimedRepairPrice = getClaimedRepairRevenue;

/**
 * The handover money collected at claim/completion, whatever tender it came in.
 * Excludes intake deposit (which was received when the ticket was created).
 */
const handoverTotalOf = (ticket: RepairTicket | null | undefined): number => {
  if (!isClaimedAndPaidRepair(ticket)) return 0;
  if (ticket?.paymentStatus === 'debt') return 0;

  if (ticket?.handoverAmountPaid !== undefined) {
    return Math.max(0, ticket.handoverAmountPaid);
  }

  const fullPrice = getClaimedRepairFullPrice(ticket);
  const deposit = ticket?.depositAmount || 0;

  if (ticket?.paymentStatus === 'partial') {
    const totalPaid = ticket.paidAmount ?? deposit;
    return Math.max(0, totalPaid - deposit);
  }

  // Fully paid: full price minus whatever was already paid as deposit
  return Math.max(0, fullPrice - deposit);
};

/**
 * The handover money taken in one tender. A card or transfer settlement is not
 * drawer cash: each stamped row counts under the tender the counter chose, and
 * only money collected before the stamp existed (no rows, or handover above the
 * rows' sum) keeps the old cash reading — the till that took it counted it cash.
 */
export const getClaimedRepairHandoverByTender = (
  ticket: RepairTicket | null | undefined,
  method: string
): number => {
  const handover = handoverTotalOf(ticket);
  if (handover <= 0) return 0;

  const target = method.toLowerCase();
  const rows = ticket?.handoverPayments;
  if (!Array.isArray(rows) || rows.length === 0) {
    return target === 'cash' ? handover : 0;
  }

  let stamped = 0;
  let stampedTotal = 0;
  for (const row of rows) {
    const amount = Math.max(0, Number(row.amount) || 0);
    stampedTotal += amount;
    if (String(row.method ?? '').toLowerCase() === target) stamped += amount;
  }
  const unstamped = Math.max(0, handover - stampedTotal);
  return stamped + (target === 'cash' ? unstamped : 0);
};

/**
 * The handover money that landed in the physical drawer.
 */
export const getClaimedRepairHandoverCash = (ticket: RepairTicket | null | undefined): number =>
  getClaimedRepairHandoverByTender(ticket, 'cash');

/**
 * Returns the remaining debt (unpaid balance) for a claimed repair.
 */
export const getClaimedRepairDebt = (ticket: RepairTicket | null | undefined): number => {
  if (!ticket || ticket.status !== 'completed') return 0;
  const fullPrice = getClaimedRepairFullPrice(ticket);
  if (ticket.paymentStatus === 'paid') return 0;
  const recognizedRevenue = getClaimedRepairRevenue(ticket);
  return Math.max(0, fullPrice - recognizedRevenue);
};

/**
 * Calculates spare parts cost for a claimed repair.
 * Returns 0 if not claimed and paid.
 */
export const getClaimedRepairPartsCost = (ticket: RepairTicket | null | undefined): number => {
  if (!isClaimedAndPaidRepair(ticket)) return 0;
  return (ticket?.partsUsed || []).reduce(
    (sum, p) => sum + (p.cost || 0) * (p.quantity || 1),
    0
  );
};

/**
 * Calculates repair net profit for a claimed repair.
 * Net Profit = Recognized Revenue (paid amount) - Spare Parts Cost.
 * Returns 0 if not claimed and paid.
 */
export const getClaimedRepairProfit = (ticket: RepairTicket | null | undefined): number => {
  if (!isClaimedAndPaidRepair(ticket)) return 0;
  return getClaimedRepairRevenue(ticket) - getClaimedRepairPartsCost(ticket);
};
