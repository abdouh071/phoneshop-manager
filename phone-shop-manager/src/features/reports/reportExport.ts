import { formatCurrency } from '../../utils/formatCurrency';
import { discountsGivenOf } from '../../utils/discountPolicy';
import type { DailyIncomeDetail, ReportData } from '../../services/reportsService';
import type { RepairTicket, SaleTransaction } from '../../types';

export type CsvRow = (string | number)[];

export interface CsvPayload {
  headers: string[];
  rows: CsvRow[];
}

export const buildFinancialSummaryCsv = (data: ReportData): CsvPayload => {
  // 1. Financial Summary CSV
  const summaryHeaders = ['Metric', 'Value'];
  const summaryRows = [
    ['Timeframe', data.timeframeLabel],
    ['Gross Revenue', formatCurrency(data.financialSummary.grossRevenue)],
    ['Product Sales Revenue', formatCurrency(data.financialSummary.productSalesRevenue)],
    ['Repair Revenue', formatCurrency(data.financialSummary.repairRevenue)],
    ['Discounts Given', formatCurrency(data.financialSummary.discountsTotal)],
    ['Refunds Given', formatCurrency(data.financialSummary.refundsTotal)],
    ['Net Revenue', formatCurrency(data.financialSummary.netRevenue)],
    ['Total Cost of Goods (COGS)', formatCurrency(data.financialSummary.totalCOGS)],
    ['Net Profit', formatCurrency(data.financialSummary.grossProfit)],
    ['Profit Margin', `${data.financialSummary.profitMarginPercent}%`],
    ['Total Completed Sales', data.financialSummary.completedSalesCount],
    ['Total Completed Repairs', data.financialSummary.completedRepairsCount],
    ['Total Units Sold', data.financialSummary.totalUnitsSold],
    ['Average Order Value', formatCurrency(data.financialSummary.averageOrderValue)],
    ['Cash Collected', formatCurrency(data.paymentBreakdown.cash)],
    ['Card Payments', formatCurrency(data.paymentBreakdown.card)],
    ['Mobile Payments', formatCurrency(data.paymentBreakdown.mobile)],
    ['Bank Transfers', formatCurrency(data.paymentBreakdown.transfer || 0)],
    ['Store Credit Used', formatCurrency(data.paymentBreakdown.storeCredit || 0)],
  ];

  return { headers: summaryHeaders, rows: summaryRows };
};

export const buildSalesLedgerCsv = (filteredSalesLedger: SaleTransaction[]): CsvPayload => {
  const headers = ['Date', 'Transaction ID', 'Customer', 'Items', 'Cashier', 'Payment Method', 'Discount (DA)', 'Total (DA)', 'Status'];
  const rows = filteredSalesLedger.map(t => [
    new Date(t.date).toLocaleString(),
    t.id,
    t.customerName || 'Walk-in Customer',
    t.items.map(i => `${i.quantity}x ${i.product.name} ${i.product.model}`).join('; '),
    t.processedByName || 'Store Cashier',
    t.payments.map(p => p.method).join('+'),
    discountsGivenOf(t),
    t.total,
    t.status || 'completed'
  ]);

  return { headers, rows };
};

export const buildRepairsLedgerCsv = (filteredRepairsLedger: RepairTicket[]): CsvPayload => {
  const headers = ['Created At', 'Ticket #', 'Customer', 'Phone', 'Device', 'Issue', 'Technician', 'Parts Cost', 'Total Fee (DA)', 'Status'];
  const rows = filteredRepairsLedger.map(r => [
    new Date(r.createdAt).toLocaleString(),
    r.ticketNumber,
    r.customerName,
    r.customerPhone || 'N/A',
    `${r.deviceBrand} ${r.deviceModel}`,
    r.issueDescription,
    r.assignedTechnician || r.createdByName || 'Tech',
    (r.partsUsed || []).reduce((s, p) => s + (p.cost || 0) * (p.quantity || 1), 0),
    r.actualCost || r.estimatedCost || 0,
    r.status
  ]);

  return { headers, rows };
};

export const buildDailyIncomeCsv = (dailyIncomeDetails: DailyIncomeDetail[]): CsvPayload => {
  const headers = [
    'Date', 'Day', 'EOD Status', 'Closed At', 'Closed By',
    'POS Sales Count', 'POS Gross Revenue', 'POS COGS', 'POS Net Profit',
    'POS Cash', 'POS Card', 'POS Mobile', 'POS Debt',
    'Repairs Completed', 'Repairs Revenue', 'Repairs Parts Cost', 'Repairs Net Profit',
    'Repairs Cash Handovers', 'Repairs Cash Deposits', 'Repairs Total Cash', 'Repairs Debt',
    'Parts Invoices', 'Parts Revenue', 'Parts COGS', 'Parts Net Profit', 'Parts Cash',
    'Old Debt Collected (Cash)', 'Cash Refunds', 'Total Physical Cash', 'Total Daily Net Profit'
  ];
  const rows = dailyIncomeDetails.map(d => [
    d.date,
    d.dayLabel,
    d.isClosed ? (d.isAutoClose ? 'Auto-Closed (00:00)' : 'Sealed by User') : 'Open/Live',
    d.closedAt ? new Date(d.closedAt).toLocaleString() : 'N/A',
    d.closedByName || 'N/A',
    d.salesCount,
    d.salesGrossRevenue,
    d.salesCOGS,
    d.salesNetProfit,
    d.salesCash,
    d.salesCard,
    d.salesMobile,
    d.salesDebt,
    d.repairsCompletedCount,
    d.repairsRevenue,
    d.repairsPartsCost,
    d.repairsNetProfit,
    d.repairsCashHandovers,
    d.repairsCashDeposits,
    d.repairsCashTotal,
    d.repairsDebt,
    d.partsCount || 0,
    d.partsRevenue,
    d.partsCOGS || 0,
    d.partsNetProfit || 0,
    d.partsCash || 0,
    d.debtCollectedCash,
    d.refundsCash,
    d.totalPhysicalCash,
    d.totalNetProfit
  ]);

  return { headers, rows };
};
