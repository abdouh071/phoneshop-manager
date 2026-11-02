import type { SaleTransaction, RepairTicket, CustomerDebtEntry } from '../../types';
import { isSameLocalDate, toDateStr } from '../../store/endOfDayStore';
import { isClaimedAndPaidRepair, getClaimedRepairHandoverCash } from '../../utils/repairFinancials';

// Pure Today Net Cash in Drawer aggregation (strictly cash tender: POS cash + parts cash + repairs cash + debt collections, excluding refunded/cancelled sales).
// Copied verbatim from POSPage's todayNetCash useMemo; takes all inputs as arguments.
export const computeTodayNetCash = (
  transactions: SaleTransaction[],
  partsInvoices: SaleTransaction[],
  tickets: RepairTicket[],
  debts: CustomerDebtEntry[],
): number => {
  const todayStr = toDateStr(new Date());

  const allTx = [...(transactions || []), ...(partsInvoices || [])];
  const uniqueTxMap = new Map<string, typeof allTx[0]>();
  allTx.forEach(t => uniqueTxMap.set(t.id, t));

  // 1. Completed sales (strictly excluding refunded, voided, cancelled, and pending approval)
  const completed = Array.from(uniqueTxMap.values()).filter(t =>
    t.status !== 'refunded' &&
    t.status !== 'voided' &&
    t.status !== 'cancelled' &&
    t.status !== 'pending_approval' &&
    isSameLocalDate(t.date, todayStr)
  );

  const posCash = completed.reduce((sum, t) => {
    if (t.payments && t.payments.length > 0) {
      const cashPart = t.payments
        .filter(p => String(p.method || '').toLowerCase() === 'cash')
        .reduce((s, p) => s + (p.amount || 0), 0);
      return sum + cashPart;
    }
    return sum + Math.max(0, t.total || 0);
  }, 0);

  // 2. Repairs Cash (intake deposits + handover cash)
  const completedRepairs = tickets.filter(t =>
    t.status === 'completed' &&
    isSameLocalDate(t.completedAt || t.updatedAt, todayStr)
  );
  const claimedPaidRepairs = completedRepairs.filter(r => isClaimedAndPaidRepair(r));
  const repairHandoversCash = claimedPaidRepairs.reduce((s, r) => s + getClaimedRepairHandoverCash(r), 0);

  const createdRepairs = tickets.filter(t => isSameLocalDate(t.createdAt, todayStr));
  const repairDepositsCash = createdRepairs.reduce((s, t) => s + (t.depositAmount || 0), 0);
  const repairsCash = repairHandoversCash + repairDepositsCash;

  // 3. Customer Debt Cash Collections
  const todayDebtPayments = debts.flatMap(d => (d.payments || []).filter(p => isSameLocalDate(p.date, todayStr)));
  const debtCollectedCash = todayDebtPayments
    .filter(p => String(p.method || '').toLowerCase() === 'cash')
    .reduce((s, p) => s + (p.amount || 0), 0);

  return Math.max(0, posCash + repairsCash + debtCollectedCash);
};
