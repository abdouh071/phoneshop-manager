import { transactionService } from './transactionService';
import { repairService } from './repairService';
import { inventoryService } from './inventoryService';
import { endOfDayService, type EndOfDayRecord } from './endOfDayService';
import { debtService } from './debtService';
import { toDateStr, isSameLocalDate } from '../store/endOfDayStore';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
  getClaimedRepairHandoverCash,
  getClaimedRepairPartsCost,
  getClaimedRepairDebt,
} from '../utils/repairFinancials';
import type { SaleTransaction, RepairTicket } from '../types';

export interface ReportFilterOptions {
  dateRange: string; // 'today' | 'yesterday' | 'specific_day' | 'this_week' | 'last_7_days' | 'last_week' | 'this_month' | 'last_month' | 'specific_month' | 'year_to_date' | 'full_year' | 'custom'
  specificDate?: string;     // YYYY-MM-DD
  selectedYear?: number;     // e.g. 2026
  selectedMonth?: number;    // 0-11
  customStartDate?: string;  // YYYY-MM-DD
  customEndDate?: string;    // YYYY-MM-DD
  weekStartDay?: number;     // 0 = Sunday, 1 = Monday, etc.
}

export interface DailyIncomeDetail {
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "Mon, Oct 2"
  isToday: boolean;

  // End of Day Status
  eodRecord?: EndOfDayRecord | null;
  isClosed: boolean;
  closedAt?: string;
  closedByName?: string;
  isAutoClose?: boolean;
  notes?: string;

  // POS Sales Details
  salesCount: number;
  salesGrossRevenue: number;
  salesCOGS: number;
  salesNetProfit: number;
  salesCash: number;
  salesCard: number;
  salesMobile: number;
  salesTransfer: number;
  salesDebt: number;

  // Workshop Repair Details
  repairsCompletedCount: number;
  repairsRevenue: number;
  repairsPartsCost: number;
  repairsNetProfit: number;
  repairsCashHandovers: number;
  repairsCashDeposits: number;
  repairsCashTotal: number;
  repairsDebt: number;

  // B2B & Debt Recoveries
  partsRevenue: number;
  debtCollectedCash: number;
  refundsCash: number;

  // Day Totals
  totalRevenue: number;
  totalCOGS: number;
  totalNetProfit: number;
  totalPhysicalCash: number;
}

export interface MonthlyIncomeDetail {
  monthKey: string; // YYYY-MM
  monthIndex: number; // 0-11
  monthLabel: string; // e.g. "January 2026"
  daysCount: number;
  daysClosedCount: number;

  // POS Sales
  salesCount: number;
  salesGrossRevenue: number;
  salesCOGS: number;
  salesNetProfit: number;
  salesCash: number;

  // Repairs
  repairsCount: number;
  repairsRevenue: number;
  repairsPartsCost: number;
  repairsNetProfit: number;
  repairsCash: number;

  // Overall
  partsRevenue: number;
  totalRevenue: number;
  totalCOGS: number;
  totalNetProfit: number;
  totalPhysicalCash: number;
}

export interface ReportData {
  timeframeLabel: string;
  startDate: string;
  endDate: string;
  
  // 1. Financial Summary
  financialSummary: {
    grossRevenue: number;
    productSalesRevenue: number;
    repairRevenue: number;
    discountsTotal: number;
    refundsTotal: number;
    refundsCount: number;
    netRevenue: number;
    salesCOGS: number;
    repairsCOGS: number;
    totalCOGS: number;
    grossProfit: number;
    profitMarginPercent: number;
    completedSalesCount: number;
    completedRepairsCount: number;
    totalUnitsSold: number;
    averageOrderValue: number;
  };

  // 2. Cash Drawer & Payments
  paymentBreakdown: {
    cash: number;
    card: number;
    mobile: number;
    splitCount: number;
    totalCollected: number;
  };

  // 3. Trend Chart
  chart: {
    title: string;
    points: { label: string; revenue: number; profit: number; salesCount: number }[];
  };

  // 4. Products & Categories
  topProducts: {
    id: string;
    name: string;
    sku: string;
    category: string;
    units: number;
    revenue: number;
    cost: number;
    profit: number;
    marginPercent: number;
  }[];

  salesByCategory: {
    category: string;
    label: string;
    units: number;
    revenue: number;
    percentage: number;
  }[];

  // 5. Inventory Valuation Snapshot
  inventoryValuation: {
    totalUnits: number;
    totalCostValue: number;
    totalRetailValue: number;
    potentialProfit: number;
    lowStockCount: number;
    outOfStockCount: number;
  };

  // 6. Repair Analytics
  repairAnalytics: {
    totalTickets: number;
    completedCount: number;
    inProgressCount: number;
    pendingCount: number;
    cancelledCount: number;
    totalRevenue: number;
    totalPartsCost: number;
    netProfit: number;
    categories: {
      key: string;
      label: string;
      count: number;
      revenue: number;
      partsCost: number;
      profit: number;
    }[];
  };

  // 7. Staff Performance
  staffPerformance: {
    id: string;
    name: string;
    salesCount: number;
    salesRevenue: number;
    repairsCount: number;
    repairsRevenue: number;
    totalRevenue: number;
    averageTicket: number;
  }[];

  // 8. Top Customers
  topCustomers: {
    id: string;
    name: string;
    phone?: string;
    ordersCount: number;
    totalSpent: number;
    averageOrder: number;
  }[];

  // 9. Verbatim Itemized Ledgers
  salesLedger: SaleTransaction[];
  repairsLedger: RepairTicket[];

  // 10. NEW: Detailed Daily Income & End-of-Day Reconciliation
  dailyIncomeDetails: DailyIncomeDetail[];
  monthlyBreakdown: MonthlyIncomeDetail[];
}

export const reportsService = {
  getDashboardData: async (options: ReportFilterOptions | string = 'last_7_days'): Promise<ReportData> => {
    const opts: ReportFilterOptions = typeof options === 'string' ? { dateRange: options } : options;
    const { dateRange = 'last_7_days', specificDate, selectedYear, selectedMonth, customStartDate, customEndDate } = opts;

    const now = new Date();

    // 1. Determine Date Bounds [startRange, endRange]
    let startRange = new Date();
    let endRange = new Date();
    let timeframeLabel = 'Last 7 Days';
    let chartTitle = 'Revenue Trend';

    switch (dateRange) {
      case 'today': {
        startRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        timeframeLabel = `Today (${startRange.toLocaleDateString()})`;
        chartTitle = 'Today\'s Hourly Revenue';
        break;
      }
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        startRange = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
        endRange = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
        timeframeLabel = `Yesterday (${startRange.toLocaleDateString()})`;
        chartTitle = 'Yesterday\'s Hourly Revenue';
        break;
      }
      case 'specific_day': {
        if (specificDate) {
          const parts = specificDate.split('-').map(Number);
          startRange = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
          endRange = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
        } else {
          startRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        }
        timeframeLabel = `Date: ${startRange.toLocaleDateString()}`;
        chartTitle = `Hourly Revenue (${startRange.toLocaleDateString()})`;
        break;
      }
      case 'this_week': {
        const d = new Date(now);
        const day = d.getDay();
        const startDay = options.weekStartDay ?? 0;
        const diff = (day - startDay + 7) % 7;
        startRange = new Date(d.setDate(d.getDate() - diff));
        startRange.setHours(0, 0, 0, 0);
        endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        timeframeLabel = `This Week (${dayNames[startDay]} - Today)`;
        chartTitle = 'Daily Revenue This Week';
        break;
      }
      case 'last_week': {
        const d = new Date(now);
        const day = d.getDay();
        const startDay = options.weekStartDay ?? 0;
        const diff = (day - startDay + 7) % 7;
        startRange = new Date(d.setDate(d.getDate() - diff - 7));
        startRange.setHours(0, 0, 0, 0);
        endRange = new Date(startRange);
        endRange.setDate(startRange.getDate() + 6);
        endRange.setHours(23, 59, 59, 999);
        timeframeLabel = `Last Week (${startRange.toLocaleDateString()} - ${endRange.toLocaleDateString()})`;
        chartTitle = 'Daily Revenue (Last Week)';
        break;
      }
      case 'this_month': {
        startRange = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        timeframeLabel = `${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
        chartTitle = 'Daily Revenue (This Month)';
        break;
      }
      case 'last_month': {
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        startRange = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1, 0, 0, 0, 0);
        endRange = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        timeframeLabel = `${prevMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
        chartTitle = 'Daily Revenue (Last Month)';
        break;
      }
      case 'specific_month': {
        const yr = selectedYear ?? now.getFullYear();
        const mo = selectedMonth ?? now.getMonth();
        startRange = new Date(yr, mo, 1, 0, 0, 0, 0);
        endRange = new Date(yr, mo + 1, 0, 23, 59, 59, 999);
        timeframeLabel = `${startRange.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
        chartTitle = `Daily Revenue (${timeframeLabel})`;
        break;
      }
      case 'year_to_date': {
        startRange = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        timeframeLabel = `Year to Date (${now.getFullYear()})`;
        chartTitle = `Monthly Revenue (${now.getFullYear()} YTD)`;
        break;
      }
      case 'full_year': {
        const yr = selectedYear ?? now.getFullYear();
        startRange = new Date(yr, 0, 1, 0, 0, 0, 0);
        endRange = new Date(yr, 11, 31, 23, 59, 59, 999);
        timeframeLabel = `Full Year ${yr}`;
        chartTitle = `Monthly Revenue (${yr})`;
        break;
      }
      case 'custom': {
        if (customStartDate && customEndDate) {
          const sParts = customStartDate.split('-').map(Number);
          const eParts = customEndDate.split('-').map(Number);
          startRange = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0);
          endRange = new Date(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999);
        } else {
          startRange = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
          endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        }
        timeframeLabel = `Custom: ${startRange.toLocaleDateString()} - ${endRange.toLocaleDateString()}`;
        chartTitle = 'Custom Period Revenue';
        break;
      }
      case 'last_7_days':
      default: {
        const s = new Date(now);
        s.setDate(now.getDate() - 6);
        startRange = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
        endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        timeframeLabel = 'Last 7 Days';
        chartTitle = 'Daily Revenue (Last 7 Days)';
        break;
      }
    }

    const startMs = startRange.getTime();
    const endMs = endRange.getTime();

    // 2. Fetch live data (date-scoped transactions) & official End-of-Day records
    const [transactions, repairs, products, eodRecords, debts] = await Promise.all([
      transactionService.getByDateRange(startRange, endRange),
      repairService.getAll(),
      inventoryService.getAll(),
      endOfDayService.getAll(),
      debtService.getAll(),
    ]);

    // 3. Build Detailed Day-by-Day Income List (respecting official End-of-Day records)
    const daysList: string[] = [];
    const currD = new Date(startRange);
    currD.setHours(0, 0, 0, 0);
    const endD = new Date(endRange);
    endD.setHours(0, 0, 0, 0);

    while (currD.getTime() <= endD.getTime()) {
      daysList.push(toDateStr(currD));
      currD.setDate(currD.getDate() + 1);
    }

    const todayStr = toDateStr(now);
    const dailyIncomeDetails: DailyIncomeDetail[] = [];

    daysList.forEach(dayStr => {
      const eod = eodRecords.find(r => r.date === dayStr);
      const isToday = dayStr === todayStr;
      const dayDate = new Date(dayStr + 'T00:00:00');
      const dayLabel = dayDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });

      if (eod) {
        // Officially closed day: Respect and prioritize sealed EOD numbers!
        dailyIncomeDetails.push({
          date: dayStr,
          dayLabel,
          isToday,
          eodRecord: eod,
          isClosed: true,
          closedAt: eod.closedAt,
          closedByName: eod.closedByName,
          isAutoClose: eod.isAutoClose,
          notes: eod.notes,

          salesCount: eod.salesCount,
          salesGrossRevenue: eod.salesTotalRevenue,
          salesCOGS: eod.salesCogs,
          salesNetProfit: eod.salesNetProfit,
          salesCash: eod.salesCash,
          salesCard: eod.salesCard,
          salesMobile: eod.salesMobile,
          salesTransfer: eod.salesTransfer || 0,
          salesDebt: eod.salesDebt,

          repairsCompletedCount: eod.repairsCompleted,
          repairsRevenue: eod.repairsTotalRevenue,
          repairsPartsCost: eod.repairsPartsCost,
          repairsNetProfit: eod.repairsNetProfit,
          repairsCashTotal: eod.repairsCash,
          repairsCashHandovers: eod.repairHandoversCash ?? Math.max(0, eod.repairsCash - (eod.repairDepositsCash || 0)),
          repairsCashDeposits: eod.repairDepositsCash || 0,
          repairsDebt: eod.repairsDebt,

          partsRevenue: eod.partsSalesRevenue || 0,
          debtCollectedCash: eod.debtCollectedCash || 0,
          refundsCash: eod.refundsCash || 0,

          totalRevenue: eod.totalRevenue,
          totalCOGS: eod.salesCogs + eod.repairsPartsCost,
          totalNetProfit: eod.totalNetProfit,
          totalPhysicalCash: eod.totalCash,
        });
      } else {
        // Unclosed day / Live Today: Compute live numbers
        const dayTx = transactions.filter(t => isSameLocalDate(t.date, dayStr));
        const completedTx = dayTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval' && t.saleType !== 'parts_b2b');
        const refundedTx = dayTx.filter(t => t.status === 'refunded');
        const partsTx = dayTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval' && t.saleType === 'parts_b2b');

        const sumPayment = (txList: typeof transactions, method: string) =>
          txList.reduce((s, tx) => s + (tx.payments || []).filter(p => p.method === method).reduce((a, p) => a + p.amount, 0), 0);

        const salesCash     = sumPayment(completedTx, 'cash');
        const salesCard     = sumPayment(completedTx, 'card');
        const salesMobile   = sumPayment(completedTx, 'mobile');
        const salesTransfer = sumPayment(completedTx, 'transfer');
        const salesDebt     = sumPayment(completedTx, 'debt');
        const salesGrossRevenue = completedTx.reduce((s, t) => s + t.total, 0);
        const salesCOGS = completedTx.reduce(
          (s, t) => s + t.items.reduce((a, i) => a + (i.product.costPrice || 0) * i.quantity, 0), 0
        );

        // All repairs completed on this day
        const completedRepairs = repairs.filter(r =>
          r.status === 'completed' && isSameLocalDate(r.completedAt || r.updatedAt, dayStr)
        );

        // RECOGNIZED revenue: only phones that were picked up AND marked as paid or partly-paid.
        // Phones completed but still in full 'debt' (paymentStatus==='debt', 0 paid) are NOT
        // counted in income until money changes hands.
        // For partly paid phones, ONLY the paid amount is counted in revenue/profit, NOT the full price!
        const claimedPaidRepairs = completedRepairs.filter(r => isClaimedAndPaidRepair(r));

        const repairsRevenue = claimedPaidRepairs.reduce(
          (s, r) => s + getClaimedRepairRevenue(r), 0
        );
        const repairsPartsCost = claimedPaidRepairs.reduce(
          (s, r) => s + getClaimedRepairPartsCost(r), 0
        );
        const repairsCashHandovers = claimedPaidRepairs.reduce(
          (s, r) => s + getClaimedRepairHandoverCash(r), 0
        );

        const createdRepairs = repairs.filter(r => isSameLocalDate(r.createdAt, dayStr));
        const repairsCashDeposits = createdRepairs.reduce((s, t) => s + (t.depositAmount || 0), 0);
        const repairsCashTotal = repairsCashHandovers + repairsCashDeposits;

        const repairsDebt = completedRepairs.reduce(
          (s, r) => s + getClaimedRepairDebt(r), 0
        );

        const partsRevenue = partsTx.reduce((s, t) => s + t.total, 0);

        const todayDebtPayments = debts.flatMap(d =>
          (d.payments || []).filter(p => isSameLocalDate(p.date, dayStr))
        );
        const debtCollectedCash = todayDebtPayments
          .filter(p => p.method === 'cash')
          .reduce((s, p) => s + p.amount, 0);

        const refundsCash = sumPayment(refundedTx, 'cash');

        const totalRevenue = salesGrossRevenue + repairsRevenue + partsRevenue + debtCollectedCash;
        const totalCOGS = salesCOGS + repairsPartsCost;
        const totalNetProfit = totalRevenue - totalCOGS;
        const totalPhysicalCash = Math.max(0, (salesCash + repairsCashTotal + debtCollectedCash) - refundsCash);

        dailyIncomeDetails.push({
          date: dayStr,
          dayLabel,
          isToday,
          isClosed: false,

          salesCount: completedTx.length,
          salesGrossRevenue,
          salesCOGS,
          salesNetProfit: salesGrossRevenue - salesCOGS,
          salesCash,
          salesCard,
          salesMobile,
          salesTransfer,
          salesDebt,

          // repairsCompletedCount = phones claimed AND paid/partly-paid (revenue-recognized)
          repairsCompletedCount: claimedPaidRepairs.length,
          repairsRevenue,
          repairsPartsCost,
          repairsNetProfit: repairsRevenue - repairsPartsCost,
          repairsCashTotal,
          repairsCashHandovers,
          repairsCashDeposits,
          repairsDebt,

          partsRevenue,
          debtCollectedCash,
          refundsCash,

          totalRevenue,
          totalCOGS,
          totalNetProfit,
          totalPhysicalCash,
        });
      }
    });

    // 4. Monthly Breakdown (Group by YYYY-MM for Yearly / Long Range analysis)
    const monthMap: Record<string, MonthlyIncomeDetail> = {};
    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    dailyIncomeDetails.forEach(d => {
      const mKey = d.date.slice(0, 7); // YYYY-MM
      const [yStr, mStr] = mKey.split('-');
      const mIdx = parseInt(mStr, 10) - 1;

      if (!monthMap[mKey]) {
        monthMap[mKey] = {
          monthKey: mKey,
          monthIndex: mIdx,
          monthLabel: `${MONTH_NAMES[mIdx]} ${yStr}`,
          daysCount: 0,
          daysClosedCount: 0,
          salesCount: 0,
          salesGrossRevenue: 0,
          salesCOGS: 0,
          salesNetProfit: 0,
          salesCash: 0,
          repairsCount: 0,
          repairsRevenue: 0,
          repairsPartsCost: 0,
          repairsNetProfit: 0,
          repairsCash: 0,
          partsRevenue: 0,
          totalRevenue: 0,
          totalCOGS: 0,
          totalNetProfit: 0,
          totalPhysicalCash: 0,
        };
      }

      const m = monthMap[mKey];
      m.daysCount += 1;
      if (d.isClosed) m.daysClosedCount += 1;
      m.salesCount += d.salesCount;
      m.salesGrossRevenue += d.salesGrossRevenue;
      m.salesCOGS += d.salesCOGS;
      m.salesNetProfit += d.salesNetProfit;
      m.salesCash += d.salesCash;
      m.repairsCount += d.repairsCompletedCount;
      m.repairsRevenue += d.repairsRevenue;
      m.repairsPartsCost += d.repairsPartsCost;
      m.repairsNetProfit += d.repairsNetProfit;
      m.repairsCash += d.repairsCashTotal;
      m.partsRevenue += d.partsRevenue;
      m.totalRevenue += d.totalRevenue;
      m.totalCOGS += d.totalCOGS;
      m.totalNetProfit += d.totalNetProfit;
      m.totalPhysicalCash += d.totalPhysicalCash;
    });

    const monthlyBreakdown = Object.values(monthMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    // 5. Raw in-range transactions and repairs for secondary ledgers & category analytics
    const inRangeTx = transactions.filter(t => {
      const tMs = new Date(t.date).getTime();
      return tMs >= startMs && tMs <= endMs;
    });

    const inRangeRepairs = repairs.filter(r => {
      const rMs = new Date(r.createdAt || r.updatedAt).getTime();
      return rMs >= startMs && rMs <= endMs;
    });

    // 6. Aggregate Overall Financial Summary (Reconciled with End-of-Day)
    const productSalesRevenue = dailyIncomeDetails.reduce((s, d) => s + d.salesGrossRevenue, 0);
    const salesCOGS = dailyIncomeDetails.reduce((s, d) => s + d.salesCOGS, 0);
    const repairRevenue = dailyIncomeDetails.reduce((s, d) => s + d.repairsRevenue, 0);
    const repairsCOGS = dailyIncomeDetails.reduce((s, d) => s + d.repairsPartsCost, 0);
    const partsSalesRevenue = dailyIncomeDetails.reduce((s, d) => s + d.partsRevenue, 0);

    const debtCollectionsTotal = dailyIncomeDetails.reduce((s, d) => s + d.debtCollectedCash, 0);
    const grossRevenue = productSalesRevenue + repairRevenue + partsSalesRevenue + debtCollectionsTotal;
    const refundsTotal = dailyIncomeDetails.reduce((s, d) => s + d.refundsCash, 0);
    const refundsCount = inRangeTx.filter(t => t.status === 'refunded').length;
    const netRevenue = grossRevenue - refundsTotal;
    const totalCOGS = salesCOGS + repairsCOGS;
    const grossProfit = netRevenue - totalCOGS;
    const profitMarginPercent = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 1000) / 10 : 0;

    const completedSalesCount = dailyIncomeDetails.reduce((s, d) => s + d.salesCount, 0);
    const completedRepairsCount = dailyIncomeDetails.reduce((s, d) => s + d.repairsCompletedCount, 0);

    let totalUnitsSold = 0;
    let discountsTotal = 0;
    inRangeTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval').forEach(t => {
      t.items.forEach(i => { if (!i.isReturn) totalUnitsSold += i.quantity; });
      if (t.discount) {
        if (t.discount.type === 'flat') discountsTotal += t.discount.value;
        else discountsTotal += (t.subtotal * (t.discount.value / 100));
      }
    });

    const averageOrderValue = completedSalesCount > 0 ? Math.round((productSalesRevenue / completedSalesCount) * 100) / 100 : 0;

    const paymentCash = dailyIncomeDetails.reduce((s, d) => s + d.totalPhysicalCash, 0);
    const paymentCard = dailyIncomeDetails.reduce((s, d) => s + d.salesCard, 0);
    const paymentMobile = dailyIncomeDetails.reduce((s, d) => s + d.salesMobile, 0);

    const paymentBreakdown = {
      cash: paymentCash,
      card: paymentCard,
      mobile: paymentMobile,
      splitCount: inRangeTx.filter(t => (t.payments || []).length > 1).length,
      totalCollected: paymentCash + paymentCard + paymentMobile,
    };

    // 7. Dynamic Trend Chart Points
    const chartPoints: { label: string; revenue: number; profit: number; salesCount: number }[] = [];

    if (dateRange === 'today' || dateRange === 'yesterday' || dateRange === 'specific_day') {
      // 2-hour intervals from 08:00 to 22:00 for the single day
      const hours = [8, 10, 12, 14, 16, 18, 20, 22];
      hours.forEach(hr => {
        const startH = new Date(startRange);
        startH.setHours(hr, 0, 0, 0);
        const endH = new Date(startRange);
        endH.setHours(hr + 1, 59, 59, 999);

        const sMs = startH.getTime();
        const eMs = endH.getTime();

        const txs = inRangeTx.filter(t => {
          const ms = new Date(t.date).getTime();
          return t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval' && ms >= sMs && ms <= eMs;
        });

        const rev = txs.reduce((sum, t) => sum + t.total, 0);
        const cost = txs.reduce((sum, t) => sum + t.items.reduce((s, i) => s + (i.product.costPrice || 0) * i.quantity, 0), 0);

        chartPoints.push({
          label: `${String(hr).padStart(2, '0')}:00`,
          revenue: rev,
          profit: rev - cost,
          salesCount: txs.length
        });
      });
    } else if (dateRange === 'year_to_date' || dateRange === 'full_year') {
      // Month-by-month bars for yearly
      monthlyBreakdown.forEach(m => {
        chartPoints.push({
          label: m.monthLabel.slice(0, 3),
          revenue: m.totalRevenue,
          profit: m.totalNetProfit,
          salesCount: m.salesCount + m.repairsCount
        });
      });
    } else {
      // Day-by-day bars for weekly / monthly / custom
      dailyIncomeDetails.forEach(d => {
        chartPoints.push({
          label: d.dayLabel,
          revenue: d.totalRevenue,
          profit: d.totalNetProfit,
          salesCount: d.salesCount + d.repairsCompletedCount
        });
      });
    }

    // 8. Top Selling Products
    const productSalesMap: Record<string, {
      id: string;
      name: string;
      sku: string;
      category: string;
      units: number;
      revenue: number;
      cost: number;
      profit: number;
      marginPercent: number;
    }> = {};

    inRangeTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval').forEach(t => {
      t.items.forEach(item => {
        const pId = item.product.id;
        if (!productSalesMap[pId]) {
          productSalesMap[pId] = {
            id: pId,
            name: `${item.product.name} ${item.product.model}${item.product.storage ? ` (${item.product.storage})` : ''}`,
            sku: item.product.sku || 'N/A',
            category: item.product.category || 'other',
            units: 0,
            revenue: 0,
            cost: 0,
            profit: 0,
            marginPercent: 0
          };
        }
        const itemRevenue = item.product.price * item.quantity;
        const itemCost = (item.product.costPrice || 0) * item.quantity;
        productSalesMap[pId].units += item.quantity;
        productSalesMap[pId].revenue += itemRevenue;
        productSalesMap[pId].cost += itemCost;
        productSalesMap[pId].profit += (itemRevenue - itemCost);
      });
    });

    const topProducts = Object.values(productSalesMap)
      .map(p => ({
        ...p,
        marginPercent: p.revenue > 0 ? Math.round((p.profit / p.revenue) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // 9. Sales by Category
    const categoryLabels: Record<string, string> = {
      smartphone: 'Smartphones',
      repair_part: 'Repair Parts',
      accessory: 'Accessories',
      tablet: 'Tablets',
      wearable: 'Wearables',
      other: 'Other'
    };

    const categoryMap: Record<string, { units: number; revenue: number }> = {};
    inRangeTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval').forEach(t => {
      t.items.forEach(item => {
        const cat = item.product.category || 'other';
        if (!categoryMap[cat]) {
          categoryMap[cat] = { units: 0, revenue: 0 };
        }
        categoryMap[cat].units += item.quantity;
        categoryMap[cat].revenue += item.product.price * item.quantity;
      });
    });

    const salesByCategory = Object.entries(categoryMap).map(([category, val]) => {
      const percentage = productSalesRevenue > 0 ? Math.round((val.revenue / productSalesRevenue) * 100) : 0;
      return {
        category,
        label: categoryLabels[category] || category,
        units: val.units,
        revenue: val.revenue,
        percentage
      };
    }).sort((a, b) => b.revenue - a.revenue);

    // 10. Inventory Valuation Snapshot
    let totalStockUnits = 0;
    let totalCostValue = 0;
    let totalRetailValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    products.forEach(p => {
      totalStockUnits += p.stock;
      totalCostValue += (p.costPrice || 0) * p.stock;
      totalRetailValue += (p.price || 0) * p.stock;
      if (p.stock === 0) outOfStockCount += 1;
      else if (p.stock <= (p.lowStockThreshold || 1)) lowStockCount += 1;
    });

    const inventoryValuation = {
      totalUnits: totalStockUnits,
      totalCostValue,
      totalRetailValue,
      potentialProfit: Math.max(0, totalRetailValue - totalCostValue),
      lowStockCount,
      outOfStockCount
    };

    // 11. Multi-Lingual Repair Analytics
    const repairCategoryKeywords: { key: string; label: string; keywords: string[] }[] = [
      { key: 'screen', label: 'Screen / Display', keywords: ['screen', 'display', 'lcd', 'glass', 'touch', 'écran', 'afficheur', 'vitre', 'شاشة', 'زجاج', 'تاش'] },
      { key: 'battery', label: 'Battery & Power', keywords: ['battery', 'charge', 'charging', 'power', 'batterie', 'connecteur', 'بطارية', 'شحن', 'كونكتور', 'باور'] },
      { key: 'waterDamage', label: 'Water / Liquid Damage', keywords: ['water', 'liquid', 'wet', 'drop', 'eau', 'liquide', 'humidité', 'ماء', 'سائل', 'رطوبة', 'غرق'] },
      { key: 'camera', label: 'Camera & Optics', keywords: ['camera', 'lens', 'focus', 'caméra', 'lentille', 'كاميرا', 'عدسة', 'فلاش'] },
      { key: 'housing', label: 'Housing & Frame', keywords: ['housing', 'back', 'frame', 'châssis', 'vitre arrière', 'coque', 'شاسي', 'كفر', 'ظهر', 'هيكل'] },
      { key: 'board', label: 'Board & Micro-soldering', keywords: ['board', 'ic', 'motherboard', 'chip', 'carte mère', 'circuit', 'سيركوي', 'كارت مير', 'اي سي', 'لحام'] },
      { key: 'software', label: 'Software & Unlocking', keywords: ['software', 'flash', 'unlock', 'frp', 'icloud', 'déblocage', 'système', 'فلاش', 'سوفتوير', 'فك شفرة', 'تخطي'] },
    ];

    const repairCategoryStats: Record<string, { count: number; revenue: number; partsCost: number; profit: number }> = {};
    repairCategoryKeywords.forEach(k => {
      repairCategoryStats[k.key] = { count: 0, revenue: 0, partsCost: 0, profit: 0 };
    });
    repairCategoryStats['other'] = { count: 0, revenue: 0, partsCost: 0, profit: 0 };

    inRangeRepairs.forEach(r => {
      const desc = (r.issueDescription || '').toLowerCase();
      let matchedKey = 'other';

      for (const cat of repairCategoryKeywords) {
        if (cat.keywords.some(kw => desc.includes(kw))) {
          matchedKey = cat.key;
          break;
        }
      }

      // Only recognize revenue for claimed + paid/partly-paid repairs (paid amount only for partial)
      const rev = getClaimedRepairRevenue(r);
      const partsCost = getClaimedRepairPartsCost(r);

      repairCategoryStats[matchedKey].count += 1;
      repairCategoryStats[matchedKey].revenue += rev;
      repairCategoryStats[matchedKey].partsCost += partsCost;
      repairCategoryStats[matchedKey].profit += (rev - partsCost);
    });

    const repairCategories = [
      ...repairCategoryKeywords.map(k => ({
        key: k.key,
        label: k.label,
        ...repairCategoryStats[k.key]
      })),
      {
        key: 'other',
        label: 'Other Repairs',
        ...repairCategoryStats['other']
      }
    ].filter(c => c.count > 0 || c.revenue > 0);

    const repairAnalytics = {
      totalTickets: inRangeRepairs.length,
      completedCount: completedRepairsCount,
      inProgressCount: inRangeRepairs.filter(r => r.status === 'in_progress' || r.status === 'ready').length,
      pendingCount: inRangeRepairs.filter(r => r.status === 'pending').length,
      cancelledCount: inRangeRepairs.filter(r => r.status === 'cancelled').length,
      totalRevenue: repairRevenue,
      totalPartsCost: repairsCOGS,
      netProfit: repairRevenue - repairsCOGS,
      categories: repairCategories
    };

    // 12. Staff Performance & Accountability
    const staffMap: Record<string, {
      id: string;
      name: string;
      salesCount: number;
      salesRevenue: number;
      repairsCount: number;
      repairsRevenue: number;
      totalRevenue: number;
      averageTicket: number;
    }> = {};

    inRangeTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval').forEach(t => {
      const workerName = t.processedByName || 'Store Cashier';
      const workerId = t.processedById || workerName;

      if (!staffMap[workerId]) {
        staffMap[workerId] = {
          id: workerId,
          name: workerName,
          salesCount: 0,
          salesRevenue: 0,
          repairsCount: 0,
          repairsRevenue: 0,
          totalRevenue: 0,
          averageTicket: 0
        };
      }
      staffMap[workerId].salesCount += 1;
      staffMap[workerId].salesRevenue += t.total;
      staffMap[workerId].totalRevenue += t.total;
    });

    // Staff performance: only count revenue for claimed+paid repairs
    inRangeRepairs.filter(r => r.status === 'completed').forEach(r => {
      const techName = r.assignedTechnician || r.createdByName || 'Workshop Tech';
      const techId = (r as any).assignedTechnicianId || (r as any).createdById || techName;

      if (!staffMap[techId]) {
        staffMap[techId] = {
          id: techId,
          name: techName,
          salesCount: 0,
          salesRevenue: 0,
          repairsCount: 0,
          repairsRevenue: 0,
          totalRevenue: 0,
          averageTicket: 0
        };
      }
      staffMap[techId].repairsCount += 1;
      // Revenue only recognized when phone is claimed and payment received (paid amount only for partial)
      const rev = getClaimedRepairRevenue(r);
      staffMap[techId].repairsRevenue += rev;
      staffMap[techId].totalRevenue += rev;
    });

    const staffPerformance = Object.values(staffMap).map(s => ({
      ...s,
      averageTicket: (s.salesCount + s.repairsCount) > 0
        ? Math.round(s.totalRevenue / (s.salesCount + s.repairsCount))
        : 0
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // 13. Top Customers
    const customerMap: Record<string, {
      id: string;
      name: string;
      phone?: string;
      ordersCount: number;
      totalSpent: number;
      averageOrder: number;
    }> = {};

    inRangeTx.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval').forEach(t => {
      const name = t.customerName || 'Walk-in Customer';
      if (!customerMap[name]) {
        customerMap[name] = {
          id: t.customerId || name,
          name,
          phone: t.customerPhone,
          ordersCount: 0,
          totalSpent: 0,
          averageOrder: 0
        };
      }
      customerMap[name].ordersCount += 1;
      customerMap[name].totalSpent += t.total;
    });

    // Top customers: only count spending for claimed+paid repairs
    inRangeRepairs.filter(r => isClaimedAndPaidRepair(r)).forEach(r => {
      const name = r.customerName || 'Walk-in Customer';
      if (!customerMap[name]) {
        customerMap[name] = {
          id: r.customerId || name,
          name,
          phone: r.customerPhone,
          ordersCount: 0,
          totalSpent: 0,
          averageOrder: 0
        };
      }
      if (r.customerPhone) customerMap[name].phone = r.customerPhone;
      customerMap[name].ordersCount += 1;
      customerMap[name].totalSpent += getClaimedRepairRevenue(r);
    });

    const topCustomers = Object.values(customerMap)
      .map(c => ({
        ...c,
        averageOrder: c.ordersCount > 0 ? Math.round((c.totalSpent / c.ordersCount) * 100) / 100 : 0
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);

    // 14. Sorted Ledgers
    const salesLedger = [...inRangeTx].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const repairsLedger = [...inRangeRepairs].sort((a, b) => new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime());

    return {
      timeframeLabel,
      startDate: startRange.toISOString(),
      endDate: endRange.toISOString(),
      financialSummary: {
        grossRevenue,
        productSalesRevenue,
        repairRevenue,
        discountsTotal,
        refundsTotal,
        refundsCount,
        netRevenue,
        salesCOGS,
        repairsCOGS,
        totalCOGS,
        grossProfit,
        profitMarginPercent,
        completedSalesCount,
        completedRepairsCount,
        totalUnitsSold,
        averageOrderValue
      },
      paymentBreakdown,
      chart: {
        title: chartTitle,
        points: chartPoints
      },
      topProducts,
      salesByCategory,
      inventoryValuation,
      repairAnalytics,
      staffPerformance,
      topCustomers,
      salesLedger,
      repairsLedger,
      dailyIncomeDetails,
      monthlyBreakdown,
    };
  }
};
