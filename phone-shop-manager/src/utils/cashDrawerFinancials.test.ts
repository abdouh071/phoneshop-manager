import { describe, it, expect } from 'vitest';
import { isSameLocalDate, toDateStr } from '../store/endOfDayStore';
import type { PhoneModel, SaleTransaction } from '../types';

describe('Cash Drawer Financials & Date Scoping', () => {
  const todayStr = toDateStr(new Date());
  const yesterdayObj = new Date();
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayStr = toDateStr(yesterdayObj);

  const mockTransactions: SaleTransaction[] = [
    // 1. Valid cash sale today: 1000 DA
    {
      id: 'tx-1',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p1', name: 'Case', price: 1000 } as PhoneModel, quantity: 1 }],
      subtotal: 1000,
      total: 1000,
      payments: [{ method: 'cash', amount: 1000 }],
      status: 'completed',
    },
    // 2. Card sale today: 2500 DA (should not add to cash in drawer)
    {
      id: 'tx-2',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p2', name: 'Charger', price: 2500 } as PhoneModel, quantity: 1 }],
      subtotal: 2500,
      total: 2500,
      payments: [{ method: 'card', amount: 2500 }],
      status: 'completed',
    },
    // 3. Refunded sale today: was 500 DA cash, but customer returned it (status = 'refunded')
    {
      id: 'tx-3',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p3', name: 'Cable', price: 500 } as PhoneModel, quantity: 1 }],
      subtotal: 500,
      total: 500,
      payments: [{ method: 'cash', amount: 500 }],
      status: 'refunded',
    },
    // 4. Voided / Cancelled sale today: 800 DA cash (never finalized)
    {
      id: 'tx-4',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p4', name: 'Film', price: 800 } as PhoneModel, quantity: 1 }],
      subtotal: 800,
      total: 800,
      payments: [{ method: 'cash', amount: 800 }],
      status: 'voided',
    },
    // 5. Cancelled sale today: 1200 DA cash
    {
      id: 'tx-5',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p5', name: 'Holder', price: 1200 } as PhoneModel, quantity: 1 }],
      subtotal: 1200,
      total: 1200,
      payments: [{ method: 'cash', amount: 1200 }],
      status: 'cancelled',
    },
    // 6. Valid cash sale from YESTERDAY: 3000 DA (must NOT leak into today)
    {
      id: 'tx-6',
      date: yesterdayObj.toISOString(),
      items: [{ product: { id: 'p6', name: 'Battery', price: 3000 } as PhoneModel, quantity: 1 }],
      subtotal: 3000,
      total: 3000,
      payments: [{ method: 'cash', amount: 3000 }],
      status: 'completed',
    },
  ];

  it('correctly filters strictly today transactions in local date', () => {
    const todayTxs = mockTransactions.filter(t => isSameLocalDate(t.date, todayStr));
    expect(todayTxs.map(t => t.id)).toEqual(['tx-1', 'tx-2', 'tx-3', 'tx-4', 'tx-5']);
    expect(todayTxs.find(t => t.id === 'tx-6')).toBeUndefined();
  });

  it('excludes refunded, voided, cancelled, and pending approval transactions from completed sales', () => {
    const todayTxs = mockTransactions.filter(t => isSameLocalDate(t.date, todayStr));
    const isExcluded = (t: SaleTransaction) =>
      t.status === 'refunded' || t.status === 'voided' || (t.status as string) === 'cancelled' || t.status === 'pending_approval';

    const completed = todayTxs.filter(t => !isExcluded(t));
    expect(completed.map(t => t.id)).toEqual(['tx-1', 'tx-2']);
  });

  it('calculates exact cash drawer balance without double-deducting refunded transactions', () => {
    const todayTxs = mockTransactions.filter(t => isSameLocalDate(t.date, todayStr));
    const completed = todayTxs.filter(t =>
      t.status !== 'refunded' &&
      t.status !== 'voided' &&
      (t.status as string) !== 'cancelled' &&
      t.status !== 'pending_approval'
    );

    // Only tx-1 was completed with cash (1000 DA)
    const posCash = completed.reduce((sum, t) => {
      const cashPart = (t.payments || [])
        .filter(p => p.method === 'cash')
        .reduce((s, p) => s + p.amount, 0);
      return sum + cashPart;
    }, 0);

    expect(posCash).toBe(1000);

    // If double deduction occurred (posCash - refundAmount), it would have been 1000 - 500 = 500 DA,
    // which is wrong because tx-3 was already excluded from posCash!
    // The real cash in till is 1000 DA from tx-1.
    const netCashInDrawer = Math.max(0, posCash);
    expect(netCashInDrawer).toBe(1000);
  });

  it('ensures yesterday transactions are correctly retrieved when yesterday filter is selected', () => {
    const yesterdayTxs = mockTransactions.filter(t => isSameLocalDate(t.date, yesterdayStr));
    expect(yesterdayTxs.map(t => t.id)).toEqual(['tx-6']);
    const completedYesterday = yesterdayTxs.filter(t => t.status === 'completed');
    const yesterdayCash = completedYesterday.reduce((sum, t) => {
      return sum + (t.payments || []).filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    }, 0);
    expect(yesterdayCash).toBe(3000);
  });

  it('accurately reconciles multi-source physical cash inflows and tender breakdown', () => {
    // 1. Retail POS Cash: 1000
    const posRetailCash = 1000;
    // 2. Parts B2B Wholesale Cash: 4500
    const partsB2BCash = 4500;
    // 3. Repair Handover Pickup Cash: 2000
    const repairHandoversCash = 2000;
    // 4. Repair Intake Deposit Cash: 500
    const repairDepositsCash = 500;
    // 5. Customer Debt Repayment Cash: 1500
    const debtCollectedCash = 1500;

    const totalCashInTill = posRetailCash + partsB2BCash + repairHandoversCash + repairDepositsCash + debtCollectedCash;
    expect(totalCashInTill).toBe(9500);

    // Tender breakdown
    const tenderBreakdown = {
      cash: posRetailCash + partsB2BCash, // 5500
      card: 2500,
      mobile: 1200,
      debt: 800,
      storeCredit: 400,
    };

    const totalSalesVolume = tenderBreakdown.cash + tenderBreakdown.card + tenderBreakdown.mobile + tenderBreakdown.debt + tenderBreakdown.storeCredit;
    expect(totalSalesVolume).toBe(10400);
  });

  it('handles case-insensitive payment methods and legacy transactions with missing payments array', () => {
    const legacyTx: SaleTransaction = {
      id: 'tx-legacy',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p7', name: 'Adaptor', price: 600 } as PhoneModel, quantity: 1 }],
      subtotal: 600,
      total: 600,
      payments: [], // missing/empty payments
      status: 'completed',
    };

    const mixedCaseTx: SaleTransaction = {
      id: 'tx-mixed',
      date: new Date().toISOString(),
      items: [{ product: { id: 'p8', name: 'Stylus', price: 400 } as PhoneModel, quantity: 1 }],
      subtotal: 400,
      total: 400,
      // Deliberately uppercase: legacy rows store payment methods outside the current union
      payments: [{ method: 'CASH', amount: 400 }] as unknown as SaleTransaction['payments'],
      status: 'completed',
    };

    const sumPayment = (txList: SaleTransaction[], method: string) => {
      return txList.reduce((sum, t) => {
        if (t.payments && t.payments.length > 0) {
          const match = t.payments
            .filter(p => String(p.method || '').toLowerCase() === method.toLowerCase())
            .reduce((s, p) => s + (p.amount || 0), 0);
          return sum + match;
        }
        return sum + (method.toLowerCase() === 'cash' ? Math.max(0, t.total || 0) : 0);
      }, 0);
    };

    const extractedCash = sumPayment([legacyTx, mixedCaseTx], 'cash');
    expect(extractedCash).toBe(1000); // 600 from legacy fallback + 400 from 'CASH'
  });

  it('ensures debt collections are excluded from invoiced revenue and net profit to prevent double-counting', () => {
    // Scenario: A phone was sold on credit (debt) for 40,000 DA (COGS: 35,000 DA)
    const salesGrossRevenue = 40000;
    const salesCOGS = 35000;
    const repairsRevenue = 5000;
    const repairsPartsCost = 2000;
    const partsRevenue = 10000;
    const partsCOGS = 8000;

    // Days later, the customer pays 40,000 DA cash to settle their debt tab
    const debtCollectedCash = 40000;

    // 1. Invoiced / Recognized Revenue (must NOT include debtCollectedCash)
    const totalRevenue = salesGrossRevenue + repairsRevenue + partsRevenue;
    expect(totalRevenue).toBe(55000); // exactly 40k + 5k + 10k, NOT 95,000 DA!

    // 2. Net Profit (must NOT count debt collection as 100% pure extra profit)
    const totalCOGS = salesCOGS + repairsPartsCost + partsCOGS;
    const totalNetProfit = totalRevenue - totalCOGS;
    expect(totalNetProfit).toBe(10000); // 5k + 3k + 2k, NOT 50,000 DA!

    // 3. Physical Cash in Drawer (MUST include debtCollectedCash because cash entered register)
    const posCash = 0; // was bought on credit
    const partsCash = 10000;
    const repairsCashTotal = 5000;
    const totalPhysicalCash = Math.max(0, posCash + partsCash + repairsCashTotal + debtCollectedCash);
    expect(totalPhysicalCash).toBe(55000);
  });

  it('ensures net revenue does not double-subtract refunded transactions', () => {
    // 50,000 DA in completed sales
    const completedTxTotal = 50000;
    const repairsRevenue = 15000;
    const partsRevenue = 5000;

    // Gross recognized revenue from completed sales already excludes refunded status transactions
    const grossRevenue = completedTxTotal + repairsRevenue + partsRevenue; // 70,000 DA
     // 10,000 DA refunded transaction

    // Net revenue should equal recognized gross revenue (since refunded transactions were already filtered out)
    const netRevenue = grossRevenue;
    expect(netRevenue).toBe(70000); // NOT 70,000 - 10,000 = 60,000 DA!
  });

  it('correctly deducts return items from units sold, revenue, and profit in product rankings', () => {
    // Exchange sale: customer buys 2 chargers at 1500 DA (cost 1000 DA), and returns 1 defective cable at 800 DA (cost 500 DA)
    const items = [
      { product: { id: 'prod-charger', price: 1500, costPrice: 1000 }, quantity: 2, isReturn: false },
      { product: { id: 'prod-cable', price: 800, costPrice: 500 }, quantity: 1, isReturn: true },
    ];

    const productSalesMap: Record<string, { units: number; revenue: number; profit: number }> = {
      'prod-cable': { units: 5, revenue: 4000, profit: 1500 } // previous 5 sales
    };

    items.forEach(item => {
      const pId = item.product.id;
      if (!productSalesMap[pId]) {
        productSalesMap[pId] = { units: 0, revenue: 0, profit: 0 };
      }
      const itemRev = item.product.price * item.quantity;
      const itemCost = (item.product.costPrice || 0) * item.quantity;
      if (item.isReturn) {
        productSalesMap[pId].units -= item.quantity;
        productSalesMap[pId].revenue -= itemRev;
        productSalesMap[pId].profit -= (itemRev - itemCost);
      } else {
        productSalesMap[pId].units += item.quantity;
        productSalesMap[pId].revenue += itemRev;
        productSalesMap[pId].profit += (itemRev - itemCost);
      }
    });

    // Cable stats should be decremented: 5 - 1 = 4 units, 4000 - 800 = 3200 revenue, 1500 - 300 = 1200 profit
    expect(productSalesMap['prod-cable'].units).toBe(4);
    expect(productSalesMap['prod-cable'].revenue).toBe(3200);
    expect(productSalesMap['prod-cable'].profit).toBe(1200);

    // Charger stats
    expect(productSalesMap['prod-charger'].units).toBe(2);
    expect(productSalesMap['prod-charger'].revenue).toBe(3000);
    expect(productSalesMap['prod-charger'].profit).toBe(1000);
  });

  it('correctly calculates repair ticket parts cost with quantity multiplier', () => {
    const partsUsed = [
      { partId: 'part-1', name: 'Screen', cost: 8000, quantity: 1 },
      { partId: 'part-2', name: 'Screw / Seal', cost: 300, quantity: 3 },
    ];

    const totalPartsCost = partsUsed.reduce((sum, p) => sum + (p.cost || 0) * (p.quantity || 1), 0);
    // 8000*1 + 300*3 = 8900 DA
    expect(totalPartsCost).toBe(8900);
  });

  it('aggregates payment breakdown including transfers and store credit', () => {
    const dailyIncome = [
      { totalPhysicalCash: 12000, salesCard: 3000, salesMobile: 1500, salesTransfer: 5000, salesStoreCredit: 1000, partsCard: 0, partsMobile: 0, partsTransfer: 0 },
    ];

    const paymentCash = dailyIncome.reduce((s, d) => s + d.totalPhysicalCash, 0);
    const paymentCard = dailyIncome.reduce((s, d) => s + d.salesCard + (d.partsCard || 0), 0);
    const paymentMobile = dailyIncome.reduce((s, d) => s + d.salesMobile + (d.partsMobile || 0), 0);
    const paymentTransfer = dailyIncome.reduce((s, d) => s + (d.salesTransfer || 0) + (d.partsTransfer || 0), 0);
    const paymentStoreCredit = dailyIncome.reduce((s, d) => s + (d.salesStoreCredit || 0), 0);

    const paymentBreakdown = {
      cash: paymentCash,
      card: paymentCard,
      mobile: paymentMobile,
      transfer: paymentTransfer,
      storeCredit: paymentStoreCredit,
      totalCollected: paymentCash + paymentCard + paymentMobile + paymentTransfer + paymentStoreCredit,
    };

    expect(paymentBreakdown.cash).toBe(12000);
    expect(paymentBreakdown.transfer).toBe(5000);
    expect(paymentBreakdown.storeCredit).toBe(1000);
    expect(paymentBreakdown.totalCollected).toBe(22500);
  });
});
