import type { CustomerDebtEntry, RepairTicket, SaleTransaction } from '../types';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairDebt,
  getClaimedRepairHandoverCash,
  getClaimedRepairPartsCost,
  getClaimedRepairRevenue,
} from './repairFinancials';
import { isSameLocalDate } from './localDate';
import { netCogsOf } from './saleEditLines';

/**
 * The one formula the shop uses to turn raw documents into a day's figures.
 *
 * Both sides of the End-of-Day problem read it: the seal that freezes a day
 * (`endOfDayStore.buildPreview`) and the live recompute that reports run against
 * date-scoped server data. Keeping them on the same function is what makes a
 * sealed day comparable to the same day recomputed later - two hand-written
 * copies of this arithmetic drift apart and every drift looks like lost money.
 */

const EXCLUDED_SALE_STATUSES = ['refunded', 'voided', 'cancelled', 'pending_approval'] as const;

export interface DayFigureSources {
  /** POS sales and parts B2B invoices together; `saleType` tells them apart. */
  transactions: SaleTransaction[];
  repairs: RepairTicket[];
  debts: CustomerDebtEntry[];
}

export interface DayFigures {
  salesCount: number;
  salesCash: number;
  salesCard: number;
  salesMobile: number;
  salesTransfer: number;
  salesStoreCredit: number;
  salesDebt: number;
  salesGrossRevenue: number;
  salesCOGS: number;
  salesNetProfit: number;

  /** Cash paid out for transactions refunded on this date. */
  refundsCash: number;

  /** Every repair finished this day, paid or not - what the seal stored as `repairsCompleted`. */
  repairsCompletedCount: number;
  /** Of those, the ones that brought money in (claimed and paid/partly-paid). */
  repairsRecognizedCount: number;
  repairsRevenue: number;
  repairsPartsCost: number;
  repairsNetProfit: number;
  repairsHandoverCash: number;
  repairsDepositCash: number;
  repairsCash: number;
  repairsDebt: number;

  partsCount: number;
  partsRevenue: number;
  partsCash: number;
  partsCard: number;
  partsMobile: number;
  partsTransfer: number;
  partsDebt: number;
  partsStoreCredit: number;
  partsCOGS: number;
  partsNetProfit: number;

  debtCollectedCash: number;
  debtCollectedCard: number;
  debtCollectedMobile: number;

  totalRevenue: number;
  totalCOGS: number;
  totalNetProfit: number;
  totalCash: number;
  totalCard: number;
  totalMobile: number;
}

const hasFinalStatus = (tx: SaleTransaction): boolean =>
  !EXCLUDED_SALE_STATUSES.includes((tx.status ?? 'completed') as (typeof EXCLUDED_SALE_STATUSES)[number]);

/**
 * The one rule for what a document put in the till, for any tender.
 *
 * The recorded `payments` array is the truth — including an empty one: an invoice
 * charged entirely to a customer's account is stored with `payments: []`, and that
 * says "no cash came in", not "assume the whole total was cash". The drawer cards
 * used to fall back to `total` for an empty array, which put the full value of every
 * account-charged parts invoice in the till on paper and made the card disagree with
 * the sealed day. Only a document written before the till recorded a tender at all
 * (no array field) falls back, and only to cash — that till was cash-only.
 */
export const tenderOf = (tx: SaleTransaction, method: string): number => {
  const payments = tx.payments;
  if (!Array.isArray(payments)) {
    return method.toLowerCase() === 'cash' ? Math.max(0, tx.total || 0) : 0;
  }
  return payments
    .filter(p => String(p.method ?? '').toLowerCase() === method.toLowerCase())
    .reduce((a, p) => a + (p.amount || 0), 0);
};

/**
 * Two stores, one day's invoices: the till keeps retail and parts B2B apart, and the
 * drawer, the seal and the reports all read them merged. Deduping by id matters — the
 * same invoice can be present in both lists, and counting it twice is invented money.
 */
export const mergeDayInvoices = (...lists: SaleTransaction[][]): SaleTransaction[] => {
  const seen = new Map<string, SaleTransaction>();
  for (const list of lists) {
    for (const t of list) {
      if (t && t.id && !seen.has(t.id)) seen.set(t.id, t);
    }
  }
  return Array.from(seen.values());
};

const sumPayment = (txList: SaleTransaction[], method: string): number =>
  txList.reduce((sum, tx) => sum + tenderOf(tx, method), 0);

const sumCogs = (txList: SaleTransaction[]): number =>
  txList.reduce((sum, tx) => sum + netCogsOf(tx.items || []), 0);

export function computeDayFigures(sources: DayFigureSources, dateStr: string): DayFigures {
  const dayTx = sources.transactions.filter(t => isSameLocalDate(t.date, dateStr));
  const salesTx = dayTx.filter(t => hasFinalStatus(t) && t.saleType !== 'parts_b2b');
  const refundedTx = dayTx.filter(t => t.status === 'refunded');
  const partsTx = dayTx.filter(t => hasFinalStatus(t) && t.saleType === 'parts_b2b');

  const salesCash = sumPayment(salesTx, 'cash');
  const salesCard = sumPayment(salesTx, 'card');
  const salesMobile = sumPayment(salesTx, 'mobile');
  const salesTransfer = sumPayment(salesTx, 'transfer');
  const salesStoreCredit = sumPayment(salesTx, 'store_credit');
  const salesDebt = sumPayment(salesTx, 'debt');
  const salesGrossRevenue = salesTx.reduce((s, t) => s + (t.total || 0), 0);
  const salesCOGS = sumCogs(salesTx);

  const allTickets = sources.repairs || [];
  const completedRepairs = allTickets.filter(
    r => r.status === 'completed' && isSameLocalDate(r.completedAt || r.updatedAt, dateStr)
  );
  // Only phones the customer took back AND that put money in the drawer count as revenue.
  // A completed phone still on full debt is recognised when the payment arrives, not before;
  // a partly-paid phone recognises the paid part only.
  const recognizedRepairs = completedRepairs.filter(r => isClaimedAndPaidRepair(r));
  const repairsRevenue = recognizedRepairs.reduce((s, r) => s + getClaimedRepairRevenue(r), 0);
  const repairsPartsCost = recognizedRepairs.reduce((s, r) => s + getClaimedRepairPartsCost(r), 0);
  const repairsHandoverCash = recognizedRepairs.reduce((s, r) => s + getClaimedRepairHandoverCash(r), 0);
  const repairsDebt = completedRepairs.reduce((s, r) => s + getClaimedRepairDebt(r), 0);

  // Intake deposits are cash the shop took today, on phones received today whether or not they were fixed.
  const repairsDepositCash = allTickets
    .filter(t => isSameLocalDate(t.createdAt, dateStr))
    .reduce((s, t) => s + (t.depositAmount || 0), 0);
  const repairsCash = repairsHandoverCash + repairsDepositCash;

  const partsRevenue = partsTx.reduce((s, t) => s + (t.total || 0), 0);
  const partsCOGS = sumCogs(partsTx);
  const dayDebtPayments = (sources.debts || [])
    .flatMap(d => (d.payments || []).filter(p => isSameLocalDate(p.date, dateStr)));
  const debtTender = (method: string): number =>
    dayDebtPayments
      .filter(p => String(p.method ?? '').toLowerCase() === method.toLowerCase())
      .reduce((s, p) => s + (p.amount || 0), 0);
  const debtCollectedCash = debtTender('cash');
  const debtCollectedCard = debtTender('card');
  const debtCollectedMobile = debtTender('mobile');

  const totalRevenue = salesGrossRevenue + repairsRevenue + partsRevenue;
  const totalCOGS = salesCOGS + repairsPartsCost + partsCOGS;

  return {
    salesCount: salesTx.length,
    salesCash,
    salesCard,
    salesMobile,
    salesTransfer,
    salesStoreCredit,
    salesDebt,
    salesGrossRevenue,
    salesCOGS,
    salesNetProfit: salesGrossRevenue - salesCOGS,

    refundsCash: sumPayment(refundedTx, 'cash'),

    repairsCompletedCount: completedRepairs.length,
    repairsRecognizedCount: recognizedRepairs.length,
    repairsRevenue,
    repairsPartsCost,
    repairsNetProfit: repairsRevenue - repairsPartsCost,
    repairsHandoverCash,
    repairsDepositCash,
    repairsCash,
    repairsDebt,

    partsCount: partsTx.length,
    partsRevenue,
    partsCash: sumPayment(partsTx, 'cash'),
    partsCard: sumPayment(partsTx, 'card'),
    partsMobile: sumPayment(partsTx, 'mobile'),
    partsTransfer: sumPayment(partsTx, 'transfer'),
    partsDebt: sumPayment(partsTx, 'debt'),
    partsStoreCredit: sumPayment(partsTx, 'store_credit'),
    partsCOGS,
    partsNetProfit: partsRevenue - partsCOGS,

    debtCollectedCash,
    debtCollectedCard,
    debtCollectedMobile,

    totalRevenue,
    totalCOGS,
    totalNetProfit: totalRevenue - totalCOGS,
    // Physical drawer money: refunded sales contribute nothing here because their status
    // already excluded them from the payment sums above.
    totalCash: Math.max(0, salesCash + sumPayment(partsTx, 'cash') + repairsCash + debtCollectedCash),
    totalCard: salesCard + sumPayment(partsTx, 'card'),
    totalMobile: salesMobile + sumPayment(partsTx, 'mobile'),
  };
}
