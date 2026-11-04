import type { SaleTransaction, RepairTicket, CustomerDebtEntry } from '../../types';
import { toDateStr } from '../../store/endOfDayStore';
import { computeDayFigures, mergeDayInvoices } from '../../utils/dayFigures';

/**
 * The till's live "net cash in drawer" number.
 *
 * This is the same formula the End-of-Day seal and the reports use — the drawer card
 * and the sealed day must be the same money, so the only thing this function does is
 * merge the two invoice lists the till keeps apart and hand them to the one formula.
 * A previous version re-derived the arithmetic here with a fallback that counted an
 * invoice with an empty `payments` array as all cash, which made the card claim money
 * the till never received on every parts invoice charged to a customer's account.
 */
export const computeTodayNetCash = (
  transactions: SaleTransaction[],
  partsInvoices: SaleTransaction[],
  tickets: RepairTicket[],
  debts: CustomerDebtEntry[],
): number => {
  const todayStr = toDateStr(new Date());
  return computeDayFigures(
    { transactions: mergeDayInvoices(transactions, partsInvoices), repairs: tickets, debts },
    todayStr
  ).totalCash;
};
