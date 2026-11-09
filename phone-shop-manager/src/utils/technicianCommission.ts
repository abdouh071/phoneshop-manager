import type { RepairTicket } from '../types';

export interface TicketCommission {
  revenue: number;
  partsCost: number;
  net: number;
  /** Nothing was billed — a warranty return or a free repair. No commission applies. */
  isWarranty: boolean;
  /** Revenue came from the estimate because no final price was recorded yet. */
  isEstimate: boolean;
  techCut: number;
}

export const ticketRevenue = (t: RepairTicket): number =>
  parseFloat(String(t.actualCost ?? t.estimatedCost ?? 0)) || 0;

export const ticketPartsCost = (t: RepairTicket): number => {
  if (!t.partsUsed || !Array.isArray(t.partsUsed)) return 0;
  return t.partsUsed.reduce((sum, p) => {
    const cost = parseFloat(String(p.cost)) || 0;
    const qty = p.quantity || 1;
    return sum + cost * qty;
  }, 0);
};

/**
 * A warranty return bills the customer nothing yet still consumes parts. Running
 * net = 0 - parts through the commission rate paid the technician a negative cut,
 * charging them for the shop's warranty. Zero revenue means no commission either
 * way; billed work keeps the exact net × rate it always had.
 */
export const computeTicketCommission = (t: RepairTicket, ratePercent: number): TicketCommission => {
  const revenue = ticketRevenue(t);
  const partsCost = ticketPartsCost(t);
  const net = revenue - partsCost;
  const isWarranty = revenue <= 0;
  const isEstimate = t.actualCost === undefined || t.actualCost === null;
  const techCut = isWarranty ? 0 : net * (ratePercent / 100);
  return { revenue, partsCost, net, isWarranty, isEstimate, techCut };
};