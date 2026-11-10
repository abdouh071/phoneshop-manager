/**
 * The single day-figures formula.
 *
 * The End-of-Day seal and the reports recompute both run through computeDayFigures, so this
 * fixture locks the arithmetic: what counts as a sale, what a repair contributes when it is
 * claimed, partly paid or still on debt, and how the drawer total is assembled. If these
 * numbers move, every sealed day suddenly disagrees with the same day recomputed.
 */
import { describe, it, expect } from 'vitest';
import { closedAtOf, computeDayFigures, hasFinalStatus, mergeDayInvoices } from './dayFigures';
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
    // The phone closes a sale as `voided` and hands the money back exactly as the
    // counter's `refunded` does, so both are payouts. Counting only one of them left
    // every phone-voided sale out of the drawer's refunds line altogether.
    expect(figures.refundsCash).toBe(1299);
    expect(figures.salesCash).toBe(600);
    // Both were rung up and handed back on the same day, so excluding them from the
    // sales sums has already netted the payout: taking it off again would double it.
    expect(figures.totalCash).toBe(2500);
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

  it('hands the cost of a restocked unit back to the day and keeps a written-off one', () => {
    // Two units at 1 000 sold, one handed back: the document nets the 1 000 it charged.
    // What the day owes for cost turns on where the goods went — back on the shelf the
    // cost comes with them, written off the shop ate it and the day must show the loss.
    const day = (writtenOff: boolean) => ({
      transactions: [
        tx('tx-credit-note', 1000, [['cash', 1000]], {
          items: [
            item(500, 2),
            { ...item(500, 1), isReturn: true, customReturnPrice: 1000, ...(writtenOff ? { restock: false } : {}) },
          ],
        }),
      ],
      repairs: [],
      debts: [],
    });

    const restocked = computeDayFigures(day(false), DAY);
    expect(restocked.salesCOGS).toBe(500);
    expect(restocked.salesNetProfit).toBe(500);

    const notRestocked = computeDayFigures(day(true), DAY);
    expect(notRestocked.salesCOGS).toBe(1000);
    expect(notRestocked.salesNetProfit).toBe(0);
  });
});

describe('the day the dashboard shows', () => {
  it('shares one exclusion rule with the day formula', () => {
    expect(hasFinalStatus(tx('a', 100, [['cash', 100]]))).toBe(true);
    expect(hasFinalStatus(tx('b', 100, [['cash', 100]], { status: undefined }))).toBe(true);
    for (const status of ['refunded', 'voided', 'cancelled', 'pending_approval'] as const) {
      expect(hasFinalStatus(tx(status, 100, [['cash', 100]], { status }))).toBe(false);
    }
  });

  it('counts a parts invoice the retail store never fetched', () => {
    // The two stores hold different documents: the retail query filters saleType, so a
    // B2B invoice exists only in the parts list. Reading one list showed no parts money
    // on the revenue card while the drawer card, which merged them, counted it.
    const retail = [tx('tx-retail', 1000, [['cash', 1000]])];
    const parts = [tx('tx-parts', 800, [['cash', 800]], { saleType: 'parts_b2b' })];

    const retailOnly = computeDayFigures({ transactions: retail, repairs: [], debts: [] }, DAY);
    expect(retailOnly.totalRevenue).toBe(1000);

    const merged = computeDayFigures(
      { transactions: mergeDayInvoices(retail, parts), repairs: [], debts: [] },
      DAY
    );
    expect(merged.partsRevenue).toBe(800);
    expect(merged.totalRevenue).toBe(1800);
    expect(merged.totalCash).toBe(1800);
  });

  it('splits into exactly the three cards the dashboard prints, and no more', () => {
    const figures = computeDayFigures(
      {
        transactions: mergeDayInvoices(
          [tx('tx-retail', 1000, [['cash', 1000]])],
          [tx('tx-parts', 800, [['cash', 800]], { saleType: 'parts_b2b' })]
        ),
        repairs: [
          ticket('r-paid', {
            status: 'completed',
            completedAt: at(17),
            actualCost: 700,
            paymentStatus: 'paid',
            handoverAmountPaid: 700,
          }),
        ],
        debts: [debt('d-1', [{ date: at(12), amount: 250, method: 'cash' }])],
      },
      DAY
    );

    expect(figures.salesGrossRevenue + figures.partsRevenue + figures.repairsRevenue).toBe(figures.totalRevenue);
    // A repayment is money the shop already recognised on the day of the sale: it moves
    // the drawer, never the revenue line. The 7-day chart used to add it a second time.
    expect(figures.debtCollectedCash).toBe(250);
    expect(figures.totalRevenue).toBe(2500);
    expect(figures.totalCash).toBe(2750);
  });
});

describe('the day the money was handed back', () => {
  const MONDAY = '2026-02-09';
  const empty = { repairs: [], debts: [] };

  it('puts the payout on the day it was given, not the day of the sale', () => {
    // The counter took 1000 on Monday and handed it back on Tuesday. Reading the refund
    // against the sale date showed the payout on Monday, whose drawer had already been
    // sealed, and left Tuesday claiming a thousand dinars it no longer held.
    const transactions = [
      tx('tx-monday', 1000, [['cash', 1000]], {
        date: at(10, MONDAY),
        status: 'refunded',
        refundedAt: at(15, DAY),
      }),
    ];

    const monday = computeDayFigures({ transactions, ...empty }, MONDAY);
    expect(monday.refundsCash).toBe(0);

    const tuesday = computeDayFigures({ transactions, ...empty }, DAY);
    expect(tuesday.refundsCash).toBe(1000);
    expect(tuesday.salesCash).toBe(0);
    expect(tuesday.totalCash).toBe(0);
  });

  it('takes the payout off the drawer of the day that actually paid it', () => {
    const transactions = [
      tx('tx-monday', 1000, [['cash', 1000]], {
        date: at(10, MONDAY),
        status: 'refunded',
        refundedAt: at(15, DAY),
      }),
      tx('tx-tuesday', 5000, [['cash', 5000]]),
    ];

    const tuesday = computeDayFigures({ transactions, ...empty }, DAY);
    expect(tuesday.salesCash).toBe(5000);
    expect(tuesday.refundsCash).toBe(1000);
    expect(tuesday.totalCash).toBe(4000);
  });

  it('reads the phone\'s void the same as the counter\'s refund', () => {
    // One shop, two terminals: the phone writes `voided` + `voidedAt` for the act the
    // counter writes as `refunded` + `refundedAt`. Both hand the cash back.
    const transactions = [
      tx('tx-phoned', 1000, [['cash', 1000]], {
        date: at(10, MONDAY),
        status: 'voided',
        voidedAt: at(15, DAY),
      }),
    ];

    expect(closedAtOf(transactions[0])).toBe(at(15, DAY));
    const tuesday = computeDayFigures({ transactions, ...empty }, DAY);
    expect(tuesday.refundsCash).toBe(1000);
    expect(computeDayFigures({ transactions, ...empty }, MONDAY).refundsCash).toBe(0);
  });

  it('nets a same-day refund once, not twice', () => {
    const transactions = [
      tx('tx-today', 1000, [['cash', 1000]], { status: 'refunded', refundedAt: at(15) }),
      tx('tx-kept', 5000, [['cash', 5000]]),
    ];

    const figures = computeDayFigures({ transactions, ...empty }, DAY);
    // Excluding the refunded sale already removed its 1000 from the intake.
    expect(figures.salesCash).toBe(5000);
    expect(figures.refundsCash).toBe(1000);
    expect(figures.totalCash).toBe(5000);
  });

  it('leaves a closed sale with no recorded moment on its own day', () => {
    // Documents closed before either stamp existed have no refund day to read. Guessing
    // one would move money on days the shop has already sealed and counted.
    const transactions = [
      tx('tx-legacy', 1000, [['cash', 1000]], { date: at(10, MONDAY), status: 'refunded' }),
    ];

    expect(closedAtOf(transactions[0])).toBe(at(10, MONDAY));
    expect(computeDayFigures({ transactions, ...empty }, MONDAY).refundsCash).toBe(1000);
    expect(computeDayFigures({ transactions, ...empty }, DAY).refundsCash).toBe(0);
  });

  it('never calls a sale that took no money a payout', () => {
    for (const status of ['cancelled', 'pending_approval'] as const) {
      const transactions = [
        tx(`tx-${status}`, 1000, [['cash', 1000]], { date: at(10, MONDAY), status }),
      ];
      expect(computeDayFigures({ transactions, ...empty }, DAY).refundsCash).toBe(0);
      expect(computeDayFigures({ transactions, ...empty }, MONDAY).refundsCash).toBe(0);
    }
  });
});

describe('a partial sale counts its money once (B1)', () => {
  // A debt whose payment rows carry the exact shapes the writers used: the legacy
  // fabricated `pay_down_` cash row, the new flagged real-tender row, the settlement
  // modal's `pay_dep_`/`pay_handover_` pair, or a genuine later collection.
  const debtWith = (
    id: string,
    rows: Array<Partial<CustomerDebtEntry['payments'][number]> & { amount: number; method: string }>,
    links: Partial<CustomerDebtEntry> = {}
  ): CustomerDebtEntry => {
    const d = debt(id, rows.map(r => ({ date: at(10), amount: r.amount, method: r.method })));
    return {
      ...d,
      ...links,
      payments: d.payments.map((p, i) => ({ ...p, date: at(10), ...rows[i] })) as CustomerDebtEntry['payments'],
    };
  };

  it('a card-paid B2B down payment never enters the drawer as cash', () => {
    // The ledger used to fabricate a cash row for the 3 000 paid by card, so the day
    // claimed 3 000 in the till on top of the invoice's own card line.
    const figures = computeDayFigures(
      {
        transactions: [tx('tx-b2b', 5000, [['card', 3000], ['debt', 2000]], { saleType: 'parts_b2b' })],
        repairs: [],
        debts: [debtWith(
          'd-b2b',
          [{ id: 'pay_down_1700_ab12', amount: 3000, method: 'cash', note: 'Initial down payment' }],
          { invoiceNumber: 'INV-PARTS-0001', type: 'parts_b2b' }
        )],
      },
      DAY
    );
    expect(figures.partsCard).toBe(3000);
    expect(figures.partsCash).toBe(0);
    expect(figures.debtCollectedCash).toBe(0);
    expect(figures.totalCash).toBe(0);
  });

  it('a cash-paid B2B down payment lands in the drawer once, not twice', () => {
    const figures = computeDayFigures(
      {
        transactions: [tx('tx-b2b', 5000, [['cash', 3000], ['debt', 2000]], { saleType: 'parts_b2b' })],
        repairs: [],
        debts: [debtWith(
          'd-b2b',
          [{ id: 'pay_down_1700_ab12', amount: 3000, method: 'cash', note: 'Initial down payment' }],
          { invoiceNumber: 'INV-PARTS-0001', type: 'parts_b2b' }
        )],
      },
      DAY
    );
    expect(figures.partsCash).toBe(3000);
    expect(figures.debtCollectedCash).toBe(0);
    expect(figures.totalCash).toBe(3000);
  });

  it('the new flagged opening row is skipped whatever tender it names', () => {
    const figures = computeDayFigures(
      {
        transactions: [tx('tx-b2b', 5000, [['card', 3000], ['debt', 2000]], { saleType: 'parts_b2b' })],
        repairs: [],
        debts: [debtWith(
          'd-b2b',
          [{ id: 'pay_down_1700_0_zzzz', amount: 3000, method: 'card', countedOn: 'sale' }],
          { invoiceNumber: 'INV-PARTS-0001', type: 'parts_b2b' }
        )],
      },
      DAY
    );
    expect(figures.partsCard).toBe(3000);
    expect(figures.debtCollectedCard).toBe(0);
    expect(figures.debtCollectedCash).toBe(0);
    expect(figures.totalCash).toBe(0);
  });

  it('a retail partial sale counts its down payment once', () => {
    const figures = computeDayFigures(
      {
        transactions: [tx('tx-retail', 5000, [['cash', 3000], ['debt', 2000]])],
        repairs: [],
        debts: [debtWith(
          'd-retail',
          [{ id: 'pay_down_1700_ab12', amount: 3000, method: 'cash', note: 'Initial down payment' }],
          { transactionId: 'tx-retail' }
        )],
      },
      DAY
    );
    expect(figures.salesCash).toBe(3000);
    expect(figures.debtCollectedCash).toBe(0);
    expect(figures.totalCash).toBe(3000);
  });

  it('a manual debt keeps counting its opening row — no other document holds that money', () => {
    const figures = computeDayFigures(
      {
        transactions: [],
        repairs: [],
        debts: [debtWith('d-manual', [
          { id: 'pay_down_1700_ab12', amount: 3000, method: 'cash', note: 'Initial down payment' },
        ])],
      },
      DAY
    );
    expect(figures.debtCollectedCash).toBe(3000);
    expect(figures.totalCash).toBe(3000);
  });

  it('a genuine later collection on a linked debt still enters the drawer', () => {
    const figures = computeDayFigures(
      {
        transactions: [tx('tx-retail', 5000, [['cash', 3000], ['debt', 2000]])],
        repairs: [],
        debts: [debtWith(
          'd-retail',
          [{ id: 'pay_1700_efgh', amount: 1000, method: 'cash', note: 'Partial settlement' }],
          { transactionId: 'tx-retail' }
        )],
      },
      DAY
    );
    expect(figures.salesCash).toBe(3000);
    expect(figures.debtCollectedCash).toBe(1000);
    expect(figures.totalCash).toBe(4000);
  });

  it('a repair with a debt counts its deposit and handover once, not again on the ledger', () => {
    const figures = computeDayFigures(
      {
        transactions: [],
        repairs: [ticket('r-1', {
          status: 'completed',
          completedAt: at(17),
          createdAt: at(9),
          actualCost: 5000,
          paymentStatus: 'partial',
          depositAmount: 1000,
          handoverAmountPaid: 2000,
        })],
        debts: [debtWith(
          'd-rep',
          [
            { id: 'pay_dep_1700', amount: 1000, method: 'cash', date: at(9), note: 'Deposit paid at intake for Repair #TKT-r-1' },
            { id: 'pay_handover_1700', amount: 2000, method: 'cash', note: 'Payment at handover for Repair #TKT-r-1' },
          ],
          { type: 'repair', linkedTicketId: 'r-1' }
        )],
      },
      DAY
    );
    expect(figures.repairsDepositCash).toBe(1000);
    expect(figures.repairsHandoverCash).toBe(2000);
    expect(figures.debtCollectedCash).toBe(0);
    expect(figures.totalCash).toBe(3000);
  });

  it('the phone-written handover row and the price-edit row are skipped on repair debts', () => {
    const figures = computeDayFigures(
      {
        transactions: [],
        repairs: [],
        debts: [
          debtWith(
            'd-mobile',
            [{ id: 'pay_1700000000', amount: 2000, method: 'cash', note: 'Handover payment for Repair #TKT-0042' }],
            { type: 'repair', linkedTicketId: 't-42' }
          ),
          debtWith(
            'd-price-edit',
            [{ id: 'pay_1700000001', amount: 1000, method: 'cash', note: 'Prior payment before price edit' }],
            { type: 'repair', linkedTicketId: 't-43' }
          ),
        ],
      },
      DAY
    );
    expect(figures.debtCollectedCash).toBe(0);
    expect(figures.totalCash).toBe(0);
  });
});
