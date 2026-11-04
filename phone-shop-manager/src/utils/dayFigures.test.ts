/**
 * The single day-figures formula.
 *
 * The End-of-Day seal and the reports recompute both run through computeDayFigures, so this
 * fixture locks the arithmetic: what counts as a sale, what a repair contributes when it is
 * claimed, partly paid or still on debt, and how the drawer total is assembled. If these
 * numbers move, every sealed day suddenly disagrees with the same day recomputed.
 */
import { describe, it, expect } from 'vitest';
import { computeDayFigures, mergeDayInvoices } from './dayFigures';
import type { CustomerDebtEntry, PhoneModel, RepairTicket, SaleTransaction } from '../types';

const DAY = '2026-02-10';
const at = (hour: number, day = DAY): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).toISOString();
};

const item = (costPrice: number, quantity = 1): SaleTransaction['items'][number] => ({
  product: { id: `p-${costPrice}`, name: 'Item', price: costPrice * 2, costPrice } as PhoneModel,
  quantity,
});

const tx = (
  id: string,
  total: number,
  payments: Array<[string, number]>,
  options: Partial<SaleTransaction> = {}
): SaleTransaction => ({
  id,
  date: at(10),
  items: [item(Math.abs(total) / 2, 1)],
  subtotal: total,
  total,
  payments: payments.map(([method, amount]) => ({ method, amount })) as SaleTransaction['payments'],
  status: 'completed',
  ...options,
});

const ticket = (
  id: string,
  options: Partial<RepairTicket> & Pick<RepairTicket, 'status'>
): RepairTicket => ({
  id,
  ticketNumber: `TKT-${id}`,
  customerName: 'Customer',
  customerPhone: '0500000000',
  deviceBrand: 'Apple',
  deviceModel: 'iPhone 12',
  issueDescription: 'Screen',
  estimatedCost: 0,
  createdAt: at(9),
  updatedAt: at(18),
  ...options,
});

const debt = (
  id: string,
  payments: Array<{ date: string; amount: number; method: string }>
): CustomerDebtEntry => ({
  id,
  customerId: 'c-1',
  customerName: 'Customer',
  customerPhone: '0500000000',
  productOrService: 'Phone',
  date: at(9),
  totalAmount: payments.reduce((s, p) => s + p.amount, 0),
  amountPaid: 0,
  remainingBalance: 0,
  status: 'partially_paid',
  payments: payments.map((p, i) => ({ id: `${id}-pay-${i}`, ...p })) as CustomerDebtEntry['payments'],
  createdAt: at(9),
});

describe('computeDayFigures', () => {
  const sources = (): {
    transactions: SaleTransaction[];
    repairs: RepairTicket[];
    debts: CustomerDebtEntry[];
  } => ({
    transactions: [
      tx('tx-cash-card', 1000, [['cash', 600], ['card', 400]], {
        items: [item(300, 1), item(100, 2)],
      }),
      tx('tx-credit', 500, [['debt', 500]], { items: [item(200, 1)] }),
      tx('tx-refunded', 300, [['cash', 300]], { status: 'refunded' }),
      tx('tx-voided', 999, [['cash', 999]], { status: 'voided' }),
      tx('tx-parts', 800, [['cash', 800]], { saleType: 'parts_b2b', items: [item(500, 1)] }),
      tx('tx-other-day', 777, [['cash', 777]], { date: at(10, '2026-02-11') }),
    ],
    repairs: [
      ticket('r-paid', {
        status: 'completed',
        completedAt: at(17),
        createdAt: at(9),
        actualCost: 700,
        paymentStatus: 'paid',
        depositAmount: 100,
        handoverAmountPaid: 600,
        partsUsed: [{ cost: 200, quantity: 1 }] as RepairTicket['partsUsed'],
      }),
      ticket('r-debt', {
        status: 'completed',
        completedAt: at(16),
        createdAt: at(9, '2026-02-09'),
        actualCost: 400,
        paymentStatus: 'debt',
      }),
      ticket('r-in-progress', {
        status: 'in_progress',
        createdAt: at(11),
        actualCost: 900,
        depositAmount: 150,
      }),
    ],
    debts: [
      debt('d-1', [
        { date: at(12), amount: 250, method: 'cash' },
        { date: at(13), amount: 100, method: 'card' },
        { date: at(12, '2026-02-11'), amount: 500, method: 'cash' },
      ]),
    ],
  });

  it('counts only settled retail sales, split by tender', () => {
    const figures = computeDayFigures(sources(), DAY);

    expect(figures.salesCount).toBe(2);
    expect(figures.salesGrossRevenue).toBe(1500);
    expect(figures.salesCOGS).toBe(700);
    expect(figures.salesNetProfit).toBe(800);
    expect(figures.salesCash).toBe(600);
    expect(figures.salesCard).toBe(400);
    expect(figures.salesDebt).toBe(500);
    expect(figures.salesStoreCredit).toBe(0);
  });

  it('reports cash paid out for refunds without letting them touch the drawer total', () => {
    const figures = computeDayFigures(sources(), DAY);
    expect(figures.refundsCash).toBe(300);
    expect(figures.salesCash).toBe(600);
  });

  it('recognises claimed repairs by what was actually paid, and keeps deposits separate', () => {
    const figures = computeDayFigures(sources(), DAY);

    // Two phones left the bench, one of them brought money in.
    expect(figures.repairsCompletedCount).toBe(2);
    expect(figures.repairsRecognizedCount).toBe(1);

    expect(figures.repairsRevenue).toBe(700);
    expect(figures.repairsPartsCost).toBe(200);
    expect(figures.repairsNetProfit).toBe(500);
    expect(figures.repairsHandoverCash).toBe(600);
    // Intake deposits are counted on the day the phone arrived, whatever its status.
    expect(figures.repairsDepositCash).toBe(250);
    expect(figures.repairsCash).toBe(850);
    expect(figures.repairsDebt).toBe(400);
  });

  it('keeps parts B2B out of retail sales and counts its cash in the drawer', () => {
    const figures = computeDayFigures(sources(), DAY);

    expect(figures.partsCount).toBe(1);
    expect(figures.partsRevenue).toBe(800);
    expect(figures.partsCash).toBe(800);
    expect(figures.partsCOGS).toBe(500);
    expect(figures.partsNetProfit).toBe(300);
  });

  it('adds only same-day debt repayments, cash only', () => {
    expect(computeDayFigures(sources(), DAY).debtCollectedCash).toBe(250);
  });

  it('sums the grand totals the way the seal stores them', () => {
    const figures = computeDayFigures(sources(), DAY);

    expect(figures.totalRevenue).toBe(3000);
    expect(figures.totalCOGS).toBe(1400);
    expect(figures.totalNetProfit).toBe(1600);
    expect(figures.totalCash).toBe(2500);
    expect(figures.totalCard).toBe(400);
    expect(figures.totalMobile).toBe(0);
  });

  it('matches payment methods whatever case the stored row uses', () => {
    const figures = computeDayFigures(
      {
        transactions: [tx('tx-shouty', 500, [['CASH', 500]])],
        repairs: [],
        debts: [],
      },
      DAY
    );
    expect(figures.salesCash).toBe(500);
    expect(figures.totalCash).toBe(500);
  });

  it('treats a transaction with no status as a completed sale', () => {
    const figures = computeDayFigures(
      { transactions: [tx('tx-legacy', 250, [['cash', 250]], { status: undefined })], repairs: [], debts: [] },
      DAY
    );
    expect(figures.salesCount).toBe(1);
    expect(figures.salesCash).toBe(250);
  });

  it('never reports a negative drawer', () => {
    const figures = computeDayFigures(
      { transactions: [tx('tx-return', -5000, [['cash', -5000]])], repairs: [], debts: [] },
      DAY
    );
    expect(figures.salesCash).toBe(-5000);
    expect(figures.totalCash).toBe(0);
  });

  it('returns zeros for a day with nothing in it', () => {
    const figures = computeDayFigures({ transactions: [], repairs: [], debts: [] }, DAY);
    expect(figures.totalRevenue).toBe(0);
    expect(figures.totalCash).toBe(0);
    expect(figures.repairsCompletedCount).toBe(0);
  });

  it('an invoice charged entirely to the account puts no cash in the drawer', () => {
    // checkoutB2B stores `payments: []` when nothing was tendered. The drawer cards
    // used to read that as "all cash", which put the whole invoice in the till on
    // paper while the sealed day said otherwise.
    const figures = computeDayFigures(
      {
        transactions: [
          tx('tx-account', 50000, [], { saleType: 'parts_b2b' }),
          tx('tx-partial', 9000, [['debt', 9000]], { saleType: 'parts_b2b' }),
        ],
        repairs: [],
        debts: [],
      },
      DAY
    );
    expect(figures.partsCash).toBe(0);
    expect(figures.partsDebt).toBe(9000);
    expect(figures.totalCash).toBe(0);
  });

  it('a document written before the till recorded tenders still counts as cash', () => {
    const legacy = tx('tx-pre-tender', 600, []);
    delete (legacy as { payments?: unknown }).payments;
    const figures = computeDayFigures({ transactions: [legacy], repairs: [], debts: [] }, DAY);
    expect(figures.salesCash).toBe(600);
    expect(figures.salesCard).toBe(0);
    expect(figures.totalCash).toBe(600);
  });

  it('parts tenders split the same way retail tenders do', () => {
    const figures = computeDayFigures(
      {
        transactions: [
          tx('p-card', 100, [['card', 100]], { saleType: 'parts_b2b' }),
          tx('p-store', 200, [['store_credit', 200]], { saleType: 'parts_b2b' }),
          tx('p-transfer', 300, [['transfer', 300]], { saleType: 'parts_b2b' }),
        ],
        repairs: [],
        debts: [],
      },
      DAY
    );
    expect(figures.partsCard).toBe(100);
    expect(figures.partsStoreCredit).toBe(200);
    expect(figures.partsTransfer).toBe(300);
    expect(figures.totalCard).toBe(100);
    expect(figures.totalCash).toBe(0);
  });

  it('merging the two invoice lists keeps one copy of a shared invoice', () => {
    const shared = tx('tx-shared', 500, [['cash', 500]]);
    const merged = mergeDayInvoices([shared], [shared, tx('tx-b', 200, [['cash', 200]])]);
    expect(merged.map(t => t.id)).toEqual(['tx-shared', 'tx-b']);
    const figures = computeDayFigures({ transactions: merged, repairs: [], debts: [] }, DAY);
    expect(figures.salesCash, 'a double-counted invoice is invented money').toBe(700);
  });

  it('ignores rows whose date cannot be read', () => {
    const figures = computeDayFigures(
      { transactions: [tx('tx-broken', 400, [['cash', 400]], { date: 'not-a-date' })], repairs: [], debts: [] },
      DAY
    );
    expect(figures.salesCount).toBe(0);
  });
});
