import { useEffect, useState, useMemo } from 'react';
import {
  Download, Printer, RefreshCw, Calendar, TrendingUp,
  DollarSign, ShoppingBag, Wrench, CreditCard, Lock, Users,
  CheckCircle2, Clock, Package, Tag, Filter,
  FileText, Moon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { EndOfDayModal } from '../endofday/EndOfDayModal';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import type { EndOfDayRecord } from '../../services/endOfDayService';
import { useAuthStore } from '../../store/authStore';
import { useReportStore } from '../../store/reportStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { exportToCSV, printFormattedReport } from '../../utils/exportUtils';
import { printZReportDirect } from '../../utils/printWindow';
import styles from './Reports.module.css';

type MainTab = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export const ReportsPage = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data, isLoading, fetchData, activeOptions } = useReportStore();
  const { user, isHistoryUnlocked } = useAuthStore();
  const settings = useSettingsStore();
  const storeName = settings?.storeName || 'PhoneShop Pro';
  const currency = settings?.currency || 'DZD';
  const weekStartDay = settings?.weekStartDay ?? 0;
  
  const [mainTab, setMainTab] = useState<MainTab>('weekly');
  const [specificDate, setSpecificDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());

  const [activeSubFilter, setActiveSubFilter] = useState('last_7_days');
  const [ledgerTab, setLedgerTab] = useState<'sales' | 'repairs'>('sales');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [selectedEodRecord, setSelectedEodRecord] = useState<EndOfDayRecord | null>(null);
  const [isEodModalOpen, setIsEodModalOpen] = useState(false);
  const [dailyCategoryFilter, setDailyCategoryFilter] = useState<'all' | 'pos' | 'repairs'>('all');

  // Filtered Ledgers (computed early so CSV exports respect active search)
  const filteredSalesLedger = useMemo(() => {
    if (!data) return [];
    if (!ledgerSearch.trim()) return data.salesLedger;
    const q = ledgerSearch.toLowerCase().trim();
    return data.salesLedger.filter(t => 
      (t.customerName && t.customerName.toLowerCase().includes(q)) ||
      (t.processedByName && t.processedByName.toLowerCase().includes(q)) ||
      (t.id && t.id.toLowerCase().includes(q)) ||
      t.items.some(i => i.product.name.toLowerCase().includes(q) || i.product.model.toLowerCase().includes(q))
    );
  }, [data, ledgerSearch]);

  const filteredRepairsLedger = useMemo(() => {
    if (!data) return [];
    if (!ledgerSearch.trim()) return data.repairsLedger;
    const q = ledgerSearch.toLowerCase().trim();
    return data.repairsLedger.filter(r => 
      (r.customerName && r.customerName.toLowerCase().includes(q)) ||
      (r.customerPhone && r.customerPhone.includes(q)) ||
      (r.ticketNumber && r.ticketNumber.toLowerCase().includes(q)) ||
      (r.deviceBrand && r.deviceBrand.toLowerCase().includes(q)) ||
      (r.deviceModel && r.deviceModel.toLowerCase().includes(q)) ||
      (r.issueDescription && r.issueDescription.toLowerCase().includes(q)) ||
      (r.assignedTechnician && r.assignedTechnician.toLowerCase().includes(q))
    );
  }, [data, ledgerSearch]);

  // Dynamic Year Options (2024 up to next year)
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let yr = 2024; yr <= currentYear + 1; yr++) {
      years.push(yr);
    }
    return years;
  }, [currentYear]);

  // Fetch initial report
  useEffect(() => {
    fetchData({ dateRange: 'last_7_days', weekStartDay });
  }, [fetchData, weekStartDay]);

  // Handle Main Tab Switch
  const handleMainTabChange = (tab: MainTab) => {
    setMainTab(tab);
    if (tab === 'daily') {
      setActiveSubFilter('today');
      fetchData({ dateRange: 'today', weekStartDay });
    } else if (tab === 'weekly') {
      setActiveSubFilter('last_7_days');
      fetchData({ dateRange: 'last_7_days', weekStartDay });
    } else if (tab === 'monthly') {
      setActiveSubFilter('this_month');
      fetchData({ dateRange: 'this_month', weekStartDay });
    } else if (tab === 'yearly') {
      setActiveSubFilter('year_to_date');
      fetchData({ dateRange: 'year_to_date', weekStartDay });
    } else if (tab === 'custom') {
      setActiveSubFilter('custom');
      fetchData({ dateRange: 'custom', weekStartDay, customStartDate: customStart, customEndDate: customEnd });
    }
  };

  const handleSubFilterClick = (filterKey: string, extraOpts: any = {}) => {
    setActiveSubFilter(filterKey);
    fetchData({ dateRange: filterKey, weekStartDay, ...extraOpts });
  };

  // Thermal Z-Report direct print
  const handlePrintThermalZReport = async (day: any) => {
    try {
      const result = await printZReportDirect(
        {
          date: day.date,
          generatedBy: day.eodRecord?.closedByName || user?.name || 'Administrator',
          summary: {
            grossSales: day.salesGrossRevenue,
            salesCount: day.salesCount,
            refundsAmount: day.refundsCash,
            refundsCount: 0,
            netCash: day.totalPhysicalCash,
            unitsSold: 0,
            discountsTotal: 0,
            avgTicket: day.salesCount > 0 ? Math.round(day.salesGrossRevenue / day.salesCount) : 0,
            staffBreakdown: [],
          },
        },
        storeName,
        currency
      );

      if (result.method === 'direct') {
        toast.success(t('reports.printThermalZ', 'Print Thermal Z-Report'), 'Report printed to thermal printer.');
      } else {
        toast.info(t('reports.printThermalZ', 'Print Thermal Z-Report'), 'Thermal server offline; browser print opened.');
      }
    } catch (err: any) {
      toast.error('Print Failed', err?.message || 'Unable to print thermal Z-Report.');
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!data) return;

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
    ];

    exportToCSV(`financial_report_${mainTab}_${new Date().toISOString().split('T')[0]}`, summaryHeaders, summaryRows);
  };

  // Export Sales Ledger CSV (respecting active filter)
  const handleExportSalesCSV = () => {
    if (!data) return;
    const headers = ['Date', 'Transaction ID', 'Customer', 'Items', 'Cashier', 'Payment Method', 'Discount', 'Total (DA)', 'Status'];
    const rows = filteredSalesLedger.map(t => [
      new Date(t.date).toLocaleString(),
      t.id,
      t.customerName || 'Walk-in Customer',
      t.items.map(i => `${i.quantity}x ${i.product.name} ${i.product.model}`).join('; '),
      t.processedByName || 'Store Cashier',
      t.payments.map(p => p.method).join('+'),
      t.discount ? `${t.discount.value}${t.discount.type === 'percent' ? '%' : ' DA'}` : '0 DA',
      t.total,
      t.status || 'completed'
    ]);
    exportToCSV(`sales_ledger_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Export Repairs Ledger CSV (respecting active filter)
  const handleExportRepairsCSV = () => {
    if (!data) return;
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
    exportToCSV(`repairs_ledger_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Export Daily Income CSV (respecting End-of-Day closings)
  const handleExportDailyIncomeCSV = () => {
    if (!data || !data.dailyIncomeDetails) return;
    const headers = [
      'Date', 'Day', 'EOD Status', 'Closed At', 'Closed By',
      'POS Sales Count', 'POS Gross Revenue', 'POS COGS', 'POS Net Profit',
      'POS Cash', 'POS Card', 'POS Mobile', 'POS Debt',
      'Repairs Completed', 'Repairs Revenue', 'Repairs Parts Cost', 'Repairs Net Profit',
      'Repairs Cash Handovers', 'Repairs Cash Deposits', 'Repairs Total Cash', 'Repairs Debt',
      'Old Debt Collected (Cash)', 'Cash Refunds', 'Total Physical Cash', 'Total Daily Net Profit'
    ];
    const rows = data.dailyIncomeDetails.map(d => [
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
      d.debtCollectedCash,
      d.refundsCash,
      d.totalPhysicalCash,
      d.totalNetProfit
    ]);
    exportToCSV(`daily_income_breakdown_${mainTab}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Print Formatted Executive Report
  const handlePrintReport = () => {
    if (!data) return;

    const html = `
      <div class="report-header">
        <div>
          <div class="shop-name">${storeName}</div>
          <div class="report-title">${t('reports.title', 'Executive Financial & Operations Report')}</div>
        </div>
        <div class="meta-info">
          <div><strong>Period:</strong> ${data.timeframeLabel}</div>
          <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
          <div><strong>Authorized by:</strong> ${user?.name || 'Administrator'}</div>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Gross Revenue</div>
          <div class="kpi-value">${formatCurrency(data.financialSummary.grossRevenue)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total COGS (Cost)</div>
          <div class="kpi-value text-danger">-${formatCurrency(data.financialSummary.totalCOGS)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Net Profit</div>
          <div class="kpi-value text-success">${formatCurrency(data.financialSummary.grossProfit)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Profit Margin</div>
          <div class="kpi-value">${data.financialSummary.profitMarginPercent}%</div>
        </div>
      </div>

      <div class="section-title">Detailed Daily Income & End-of-Day Closures (POS & Repairs)</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>EOD Status</th>
            <th class="text-right">POS Revenue</th>
            <th class="text-right">Repair Revenue</th>
            <th class="text-right">Cash in Drawer</th>
            <th class="text-right">Total Net Profit</th>
          </tr>
        </thead>
        <tbody>
          ${(data.dailyIncomeDetails || []).map(d => `
            <tr>
              <td><strong>${d.dayLabel}</strong> (${d.date})</td>
              <td>${d.isClosed ? (d.isAutoClose ? 'Sealed (Auto 00:00)' : `Sealed (${d.closedByName || 'Admin'})`) : 'Open / Live'}</td>
              <td class="text-right font-mono">${formatCurrency(d.salesGrossRevenue)}</td>
              <td class="text-right font-mono">${formatCurrency(d.repairsRevenue)}</td>
              <td class="text-right font-mono">${formatCurrency(d.totalPhysicalCash)}</td>
              <td class="text-right font-mono text-success"><strong>+${formatCurrency(d.totalNetProfit)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="section-title">Cash Drawer & Payment Reconciliation</div>
      <table>
        <thead>
          <tr>
            <th>Payment Method</th>
            <th class="text-right">Amount Collected</th>
            <th class="text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>💵 Cash</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.cash)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round((data.paymentBreakdown.cash / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>💳 Card</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.card)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round((data.paymentBreakdown.card / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>📱 Mobile Pay</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.mobile)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round((data.paymentBreakdown.mobile / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>
          <tr>
            <td><strong>Total Reconciled</strong></td>
            <td class="text-right font-mono"><strong>${formatCurrency(data.paymentBreakdown.totalCollected)}</strong></td>
            <td class="text-right"><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="section-title">Top Selling Products</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="text-right">Units Sold</th>
            <th class="text-right">Revenue</th>
            <th class="text-right">Net Profit</th>
            <th class="text-right">Margin</th>
          </tr>
        </thead>
        <tbody>
          ${data.topProducts.map(p => `
            <tr>
              <td>${p.name}</td>
              <td class="text-right">${p.units}</td>
              <td class="text-right font-mono">${formatCurrency(p.revenue)}</td>
              <td class="text-right font-mono text-success">${formatCurrency(p.profit)}</td>
              <td class="text-right">${p.marginPercent}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="section-title">Staff Performance & Accountability</div>
      <table>
        <thead>
          <tr>
            <th>Staff Member</th>
            <th class="text-right">Sales Count</th>
            <th class="text-right">Sales Revenue</th>
            <th class="text-right">Repairs Handled</th>
            <th class="text-right">Repair Revenue</th>
            <th class="text-right">Total Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${data.staffPerformance.map(s => `
            <tr>
              <td><strong>${s.name}</strong></td>
              <td class="text-right">${s.salesCount}</td>
              <td class="text-right font-mono">${formatCurrency(s.salesRevenue)}</td>
              <td class="text-right">${s.repairsCount}</td>
              <td class="text-right font-mono">${formatCurrency(s.repairsRevenue)}</td>
              <td class="text-right font-mono"><strong>${formatCurrency(s.totalRevenue)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="signature-box">
        <div class="sig-line">Store Manager Signature</div>
        <div class="sig-line">Accountant / Auditor</div>
      </div>
    `;

    printFormattedReport(html, `Executive Report - ${data.timeframeLabel}`, storeName, i18n.language || 'en');
  };

  const isReportsLocked = user?.role !== 'admin' && !isHistoryUnlocked;

  if (isLoading && !data) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>{t('reports.title', 'Reports & Analytics')}</h1>
        </div>
        <div className={styles.kpiGrid}>
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  const maxChartRev = data ? Math.max(...data.chart.points.map(p => p.revenue), 1) : 1;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startDayName = dayNames[weekStartDay] || 'Mon';

  return (
    <div className={styles.page}>
      <AdminUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onSuccess={() => setIsUnlockModalOpen(false)}
        actionName="view historical business reports"
      />

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>{t('reports.title', 'Reports & Analytics')}</h1>
          <p className={styles.subtitle}>{t('reports.subtitle', 'Comprehensive financial analysis, sales ledger, and workshop performance')}</p>
        </div>

        <div className={styles.headerActions}>
          <Button 
            variant="secondary" 
            leftIcon={<RefreshCw size={15} />}
            onClick={() => fetchData()}
          >
            {t('reports.refresh', 'Refresh')}
          </Button>
          <Button 
            variant="secondary" 
            leftIcon={<Download size={15} />}
            onClick={handleExportCSV}
          >
            {t('reports.exportSummary', 'Export Summary')}
          </Button>
          <Button 
            variant="primary" 
            leftIcon={<Printer size={15} />}
            onClick={handlePrintReport}
          >
            {t('reports.printExecutive', 'Print Executive Report')}
          </Button>
          <EndOfDayButton variant="button" />
        </div>
      </div>

      {/* Timeframe Filter Bar */}
      <div className={styles.filterContainer}>
        <div className={styles.mainTabs}>
          <button
            className={[styles.mainTabBtn, mainTab === 'daily' && styles.mainTabActive].filter(Boolean).join(' ')}
            onClick={() => handleMainTabChange('daily')}
          >
            <Calendar size={14} /> {t('reports.daily', 'Daily')}
          </button>
          <button
            className={[styles.mainTabBtn, mainTab === 'weekly' && styles.mainTabActive].filter(Boolean).join(' ')}
            onClick={() => handleMainTabChange('weekly')}
          >
            <Calendar size={14} /> {t('reports.weekly', 'Weekly')}
          </button>
          <button
            className={[styles.mainTabBtn, mainTab === 'monthly' && styles.mainTabActive].filter(Boolean).join(' ')}
            onClick={() => handleMainTabChange('monthly')}
          >
            <Calendar size={14} /> {t('reports.monthly', 'Monthly')}
          </button>
          <button
            className={[styles.mainTabBtn, mainTab === 'yearly' && styles.mainTabActive].filter(Boolean).join(' ')}
            onClick={() => handleMainTabChange('yearly')}
          >
            <TrendingUp size={14} /> {t('reports.yearly', 'Yearly')}
          </button>
          <button
            className={[styles.mainTabBtn, mainTab === 'custom' && styles.mainTabActive].filter(Boolean).join(' ')}
            onClick={() => handleMainTabChange('custom')}
          >
            <Filter size={14} /> {t('reports.custom', 'Custom Range')}
          </button>
        </div>

        {/* Sub-Filters Toolbar */}
        <div className={styles.subFiltersBar}>
          {mainTab === 'daily' && (
            <>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'today' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('today')}
              >
                {t('reports.today', 'Today')}
              </button>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'yesterday' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('yesterday')}
              >
                {t('reports.yesterday', 'Yesterday')}
              </button>
              <div className={styles.customDateInputs}>
                <span>Specific Date:</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={specificDate}
                  onChange={e => {
                    setSpecificDate(e.target.value);
                    handleSubFilterClick('specific_day', { specificDate: e.target.value });
                  }}
                />
              </div>
            </>
          )}

          {mainTab === 'weekly' && (
            <>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'this_week' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('this_week')}
              >
                {t('reports.thisWeek', 'This Week')} ({startDayName} - {t('reports.today', 'Today')})
              </button>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'last_7_days' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('last_7_days')}
              >
                {t('reports.last7Days', 'Last 7 Days')}
              </button>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'last_week' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('last_week')}
              >
                {t('reports.lastWeek', 'Last Full Week')}
              </button>
            </>
          )}

          {mainTab === 'monthly' && (
            <>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'this_month' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('this_month')}
              >
                {t('reports.thisMonth', 'This Month')}
              </button>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'last_month' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('last_month')}
              >
                {t('reports.lastMonth', 'Last Month')}
              </button>
              <div className={styles.customDateInputs}>
                <span>Month:</span>
                <select
                  className={styles.dateInput}
                  value={selectedMonth}
                  onChange={e => {
                    const m = Number(e.target.value);
                    setSelectedMonth(m);
                    handleSubFilterClick('specific_month', { selectedYear, selectedMonth: m });
                  }}
                >
                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((name, idx) => (
                    <option key={idx} value={idx}>{name}</option>
                  ))}
                </select>
                <select
                  className={styles.dateInput}
                  value={selectedYear}
                  onChange={e => {
                    const yr = Number(e.target.value);
                    setSelectedYear(yr);
                    handleSubFilterClick('specific_month', { selectedYear: yr, selectedMonth });
                  }}
                >
                  {yearOptions.map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {mainTab === 'yearly' && (
            <>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'year_to_date' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('year_to_date')}
              >
                {t('reports.yearToDate', 'Year to Date')} ({new Date().getFullYear()})
              </button>
              <button
                className={[styles.subFilterBtn, activeSubFilter === 'full_year' && styles.subFilterActive].filter(Boolean).join(' ')}
                onClick={() => handleSubFilterClick('full_year', { selectedYear })}
              >
                {t('reports.fullYear', 'Full Year')}
              </button>
              <div className={styles.customDateInputs}>
                <span>Select Year:</span>
                <select
                  className={styles.dateInput}
                  value={selectedYear}
                  onChange={e => {
                    const yr = Number(e.target.value);
                    setSelectedYear(yr);
                    handleSubFilterClick('full_year', { selectedYear: yr });
                  }}
                >
                  {yearOptions.map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {mainTab === 'custom' && (
            <div className={styles.customDateInputs}>
              <span>From:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
              />
              <span>To:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
              />
              <Button
                size="sm"
                onClick={() => handleSubFilterClick('custom', { customStartDate: customStart, customEndDate: customEnd })}
              >
                Apply Range
              </Button>
            </div>
          )}
        </div>
      </div>

      {isReportsLocked ? (
        <Card>
          <div style={{ padding: '64px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--color-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Lock size={24} style={{ color: 'var(--color-on-surface-variant)' }} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-on-surface)' }}>{t('reports.reportsLocked', 'Reports Locked')}</h3>
              <p style={{ fontSize: '14px', color: 'var(--color-on-surface-variant)', marginTop: '4px', maxWidth: 400, marginInline: 'auto' }}>
                {t('reports.adminUnlockRequired', 'You need admin permission to view business reports, profits, and top customer analytics.')}
              </p>
            </div>
            <Button onClick={() => setIsUnlockModalOpen(true)} style={{ marginTop: '8px' }}>Unlock Reports</Button>
          </div>
        </Card>
      ) : data ? (
        <>
          {/* 1. EXECUTIVE FINANCIAL SUMMARY CARDS */}
          <div className={styles.kpiGrid}>
            <div className={[styles.kpiCard, styles.kpiRevenue].join(' ')}>
              <div className={styles.kpiTop}>
                <span className={styles.kpiLabel}>{t('reports.grossRevenue', 'Gross Revenue')}</span>
                <div className={styles.kpiIcon}><DollarSign size={16} /></div>
              </div>
              <div className={styles.kpiValue}>{formatCurrency(data.financialSummary.grossRevenue)}</div>
              <div className={styles.kpiSubtext}>
                <span>Sales: {formatCurrency(data.financialSummary.productSalesRevenue)}</span>
                <span>•</span>
                <span>Repairs: {formatCurrency(data.financialSummary.repairRevenue)}</span>
              </div>
            </div>

            <div className={[styles.kpiCard, styles.kpiNetProfit].join(' ')}>
              <div className={styles.kpiTop}>
                <span className={styles.kpiLabel}>{t('reports.netProfit', 'Net Profit')}</span>
                <div className={styles.kpiIcon}><TrendingUp size={16} /></div>
              </div>
              <div className={styles.kpiValue}>{formatCurrency(data.financialSummary.grossProfit)}</div>
              <div className={styles.kpiSubtext}>
                <span className={data.financialSummary.profitMarginPercent >= 0 ? styles.badgeSuccess : styles.badgeDanger}>
                  {data.financialSummary.profitMarginPercent}% {t('reports.profitMargin', 'Margin')}
                </span>
                <span>After COGS & parts</span>
              </div>
            </div>

            <div className={[styles.kpiCard, styles.kpiCost].join(' ')}>
              <div className={styles.kpiTop}>
                <span className={styles.kpiLabel}>{t('reports.totalCOGS', 'Total Cost (COGS)')}</span>
                <div className={styles.kpiIcon}><Package size={16} /></div>
              </div>
              <div className={styles.kpiValue}>{formatCurrency(data.financialSummary.totalCOGS)}</div>
              <div className={styles.kpiSubtext}>
                <span>Items: {formatCurrency(data.financialSummary.salesCOGS)}</span>
                <span>•</span>
                <span>Parts: {formatCurrency(data.financialSummary.repairsCOGS)}</span>
              </div>
            </div>

            <div className={[styles.kpiCard, styles.kpiOrders].join(' ')}>
              <div className={styles.kpiTop}>
                <span className={styles.kpiLabel}>Orders & Activity</span>
                <div className={styles.kpiIcon}><ShoppingBag size={16} /></div>
              </div>
              <div className={styles.kpiValue}>{data.financialSummary.completedSalesCount + data.financialSummary.completedRepairsCount}</div>
              <div className={styles.kpiSubtext}>
                <span>{data.financialSummary.totalUnitsSold} items sold</span>
                <span>•</span>
                <span>{data.financialSummary.completedRepairsCount} repairs</span>
              </div>
            </div>
          </div>

          {/* 1.5. DETAILED DAILY INCOME & END-OF-DAY RECONCILIATION */}
          <Card padding="none" className={styles.spanFull}>
            <div className={styles.cardHeaderWithAction}>
              <div>
                <h3 className={styles.cardTitle}>
                  <Calendar size={18} /> Detailed Daily Income (POS & Repairs)
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  Breakdown by day respecting user End-of-Day closings & real verified cash
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-container, #e2e8f0)', padding: '2px', borderRadius: '8px' }}>
                  <button
                    type="button"
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      background: dailyCategoryFilter === 'all' ? '#ffffff' : 'transparent',
                      color: dailyCategoryFilter === 'all' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
                      boxShadow: dailyCategoryFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    }}
                    onClick={() => setDailyCategoryFilter('all')}
                  >
                    All Streams
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      background: dailyCategoryFilter === 'pos' ? '#ffffff' : 'transparent',
                      color: dailyCategoryFilter === 'pos' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
                      boxShadow: dailyCategoryFilter === 'pos' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    }}
                    onClick={() => setDailyCategoryFilter('pos')}
                  >
                    POS Sales Only
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      background: dailyCategoryFilter === 'repairs' ? '#ffffff' : 'transparent',
                      color: dailyCategoryFilter === 'repairs' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
                      boxShadow: dailyCategoryFilter === 'repairs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    }}
                    onClick={() => setDailyCategoryFilter('repairs')}
                  >
                    Repairs Only
                  </button>
                </div>

                <button
                  type="button"
                  className={styles.subFilterBtn}
                  onClick={handleExportDailyIncomeCSV}
                  title="Export Daily Income CSV"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
            </div>

            {/* If Main Tab is Yearly, show the 12-Month Calendar Performance Table first */}
            {mainTab === 'yearly' && data.monthlyBreakdown && data.monthlyBreakdown.length > 0 && (
              <div style={{ borderBottom: '1px solid var(--color-outline-variant, #e2e8f0)', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                    🗓️ Annual 12-Month Performance ({selectedYear})
                  </h4>
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                    {data.monthlyBreakdown.reduce((s, m) => s + m.daysClosedCount, 0)} days officially sealed
                  </span>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Month</th>
                        <th className={styles.th}>Days Sealed</th>
                        {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                          <>
                            <th className={[styles.th, styles.textRight].join(' ')}>POS Revenue</th>
                            <th className={[styles.th, styles.textRight].join(' ')}>POS Profit</th>
                          </>
                        )}
                        {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                          <>
                            <th className={[styles.th, styles.textRight].join(' ')}>Repair Revenue</th>
                            <th className={[styles.th, styles.textRight].join(' ')}>Repair Profit</th>
                          </>
                        )}
                        <th className={[styles.th, styles.textRight].join(' ')}>Cash in Till</th>
                        <th className={[styles.th, styles.textRight].join(' ')}>Total Net Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.monthlyBreakdown.map(m => (
                        <tr key={m.monthKey} className={styles.tr}>
                          <td className={styles.td}><strong>{m.monthLabel}</strong></td>
                          <td className={styles.td}>
                            <span style={{ fontSize: '11.5px', fontWeight: 600, color: m.daysClosedCount > 0 ? '#15803d' : '#94a3b8' }}>
                              {m.daysClosedCount} / {m.daysCount} days sealed
                            </span>
                          </td>
                          {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                            <>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                                {formatCurrency(m.salesGrossRevenue)}
                                <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>{m.salesCount} sales</div>
                              </td>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                                +{formatCurrency(m.salesNetProfit)}
                              </td>
                            </>
                          )}
                          {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                            <>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                                {formatCurrency(m.repairsRevenue)}
                                <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>{m.repairsCount} repairs</div>
                              </td>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                                +{formatCurrency(m.repairsNetProfit)}
                              </td>
                            </>
                          )}
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(m.totalPhysicalCash)}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                            <strong style={{ color: 'var(--color-success)' }}>+{formatCurrency(m.totalNetProfit)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Daily View: Side-by-Side 3 Cards */}
            {mainTab === 'daily' && data.dailyIncomeDetails.length > 0 ? (
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(() => {
                  const day = data.dailyIncomeDetails[0];
                  if (!day) return null;
                  return (
                    <>
                      {/* Day Status Header */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: day.isClosed ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                        border: `1px solid ${day.isClosed ? '#bbf7d0' : '#fde68a'}`,
                        borderRadius: '10px',
                        flexWrap: 'wrap',
                        gap: '10px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span className={day.isClosed ? (day.isAutoClose ? styles.eodBadgeAuto : styles.eodBadgeClosed) : styles.eodBadgeOpen}>
                            {day.isClosed ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                            {day.isClosed
                              ? `Day Sealed ${day.isAutoClose ? '(Auto at 00:00)' : `at ${new Date(day.closedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${day.closedByName}`}`
                              : 'Day In Progress (Live Calculations)'}
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
                            📅 {day.dayLabel} {day.isToday && '(Today)'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className={styles.viewSlipBtn}
                            onClick={() => handlePrintThermalZReport(day)}
                            title={t('reports.printThermalZ', 'Print Thermal Z-Report')}
                          >
                            <Printer size={13} /> {t('reports.printThermalZ', 'Print Thermal Z-Report')}
                          </button>
                          {day.isClosed && day.eodRecord ? (
                            <button
                              type="button"
                              className={styles.viewSlipBtn}
                              onClick={() => { setSelectedEodRecord(day.eodRecord!); setIsEodModalOpen(true); }}
                            >
                              <FileText size={13} /> {t('reports.viewEodSlip', 'View Official EOD Report & Slip')}
                            </button>
                          ) : day.isToday ? (
                            <button
                              type="button"
                              className={styles.closeDayBtn}
                              onClick={() => { setSelectedEodRecord(null); setIsEodModalOpen(true); }}
                            >
                              <Moon size={13} /> {t('reports.declareEod', 'Declare End of Day Now')}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {day.notes && (
                        <div style={{ padding: '8px 12px', background: 'var(--color-surface-container-low)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                          <strong>📝 Closing Remark:</strong> {day.notes}
                        </div>
                      )}

                      {/* 3 Detail Cards */}
                      <div className={styles.dayCardGrid}>
                        {/* 1. POS Sales Detailed */}
                        <div className={styles.dayCard}>
                          <div className={styles.dayCardHeader}>
                            <span className={styles.dayCardTitle}>
                              <ShoppingBag size={16} color="#4f46e5" /> POS Direct Sales
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#4f46e5', background: '#eef2ff', padding: '2px 7px', borderRadius: '4px' }}>
                              {day.salesCount} sale{day.salesCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Gross Sales Revenue</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.salesGrossRevenue)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Product COGS</span>
                            <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.salesCOGS)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Net Sales Profit</span>
                            <span className={styles.dayCardValue} style={{ color: day.salesNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 700 }}>
                              {day.salesNetProfit >= 0 ? '+' : ''}{formatCurrency(day.salesNetProfit)}
                            </span>
                          </div>
                          <div className={styles.dayCardDivider} />
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>💵 Cash Collected</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.salesCash)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>💳 Card Payments</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.salesCard)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>📱 Mobile / BaridiMob</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.salesMobile)}</span>
                          </div>
                          {day.salesDebt > 0 && (
                            <div className={styles.dayCardRow}>
                              <span className={styles.dayCardLabel} style={{ color: 'var(--color-warning)' }}>⚠️ On Credit (Dette tab)</span>
                              <span className={styles.dayCardValue} style={{ color: 'var(--color-warning)' }}>{formatCurrency(day.salesDebt)}</span>
                            </div>
                          )}
                        </div>

                        {/* 2. Workshop Repairs Detailed */}
                        <div className={styles.dayCard}>
                          <div className={styles.dayCardHeader}>
                            <span className={styles.dayCardTitle}>
                              <Wrench size={16} color="#d97706" /> Workshop Repairs
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '2px 7px', borderRadius: '4px' }}>
                              {day.repairsCompletedCount} completed
                            </span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Repair Services Revenue</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.repairsRevenue)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Spare Parts Used (Cost)</span>
                            <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.repairsPartsCost)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Net Repair Profit</span>
                            <span className={styles.dayCardValue} style={{ color: day.repairsNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 700 }}>
                              {day.repairsNetProfit >= 0 ? '+' : ''}{formatCurrency(day.repairsNetProfit)}
                            </span>
                          </div>
                          <div className={styles.dayCardDivider} />
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>💵 Handover Collections</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.repairsCashHandovers)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>↳ Intake Phone Deposits</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.repairsCashDeposits)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Total Repair Cash</span>
                            <span className={styles.dayCardValue} style={{ fontWeight: 700 }}>{formatCurrency(day.repairsCashTotal)}</span>
                          </div>
                          {day.repairsDebt > 0 && (
                            <div className={styles.dayCardRow}>
                              <span className={styles.dayCardLabel} style={{ color: 'var(--color-error)' }}>⚠️ Unpaid Repair Debt</span>
                              <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>{formatCurrency(day.repairsDebt)}</span>
                            </div>
                          )}
                        </div>

                        {/* 3. Reconciled Drawer Cash & Profit */}
                        <div className={styles.dayCard}>
                          <div className={styles.dayCardHeader}>
                            <span className={styles.dayCardTitle}>
                              <DollarSign size={16} color="#059669" /> Drawer & Total Profit
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#059669', background: '#d1fae5', padding: '2px 7px', borderRadius: '4px' }}>
                              Net Verified
                            </span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Combined Day Revenue</span>
                            <span className={styles.dayCardValue} style={{ fontSize: '14px', fontWeight: 700 }}>{formatCurrency(day.totalRevenue)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Combined Day Profit</span>
                            <span className={styles.dayCardValue} style={{ fontSize: '14px', fontWeight: 700, color: day.totalNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                              {day.totalNetProfit >= 0 ? '+' : ''}{formatCurrency(day.totalNetProfit)}
                            </span>
                          </div>
                          <div className={styles.dayCardDivider} />
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>POS Cash in Till</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.salesCash)}</span>
                          </div>
                          <div className={styles.dayCardRow}>
                            <span className={styles.dayCardLabel}>Repairs Cash in Till</span>
                            <span className={styles.dayCardValue}>{formatCurrency(day.repairsCashTotal)}</span>
                          </div>
                          {day.debtCollectedCash > 0 && (
                            <div className={styles.dayCardRow}>
                              <span className={styles.dayCardLabel}>Old Debt Paid in Cash</span>
                              <span className={styles.dayCardValue} style={{ color: 'var(--color-success)' }}>+{formatCurrency(day.debtCollectedCash)}</span>
                            </div>
                          )}
                          {day.refundsCash > 0 && (
                            <div className={styles.dayCardRow}>
                              <span className={styles.dayCardLabel}>Cash Refunds Paid</span>
                              <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.refundsCash)}</span>
                            </div>
                          )}
                          <div className={styles.dayCardDivider} />
                          <div className={styles.dayCardRow} style={{ background: '#f0fdf4', padding: '6px 8px', borderRadius: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#166534' }}>💰 Total Physical Cash</span>
                            <span style={{ fontWeight: 700, fontSize: '15px', color: '#15803d' }}>{formatCurrency(day.totalPhysicalCash)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              // ─── MULTI-DAY DETAILED TABLE (WEEKLY, MONTHLY, YEARLY, CUSTOM) ───
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Date & Day</th>
                      <th className={styles.th}>End-of-Day Status</th>
                      {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                        <>
                          <th className={[styles.th, styles.textRight].join(' ')}>POS Revenue</th>
                          <th className={[styles.th, styles.textRight].join(' ')}>POS Profit</th>
                        </>
                      )}
                      {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                        <>
                          <th className={[styles.th, styles.textRight].join(' ')}>Repair Revenue</th>
                          <th className={[styles.th, styles.textRight].join(' ')}>Repair Profit</th>
                        </>
                      )}
                      <th className={[styles.th, styles.textRight].join(' ')}>Physical Cash</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Total Net Profit</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyIncomeDetails.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                          No daily records in this period.
                        </td>
                      </tr>
                    ) : (
                      // Render in reverse chronological order (newest first)
                      [...data.dailyIncomeDetails].reverse().map(d => (
                        <tr key={d.date} className={styles.tr}>
                          <td className={styles.td}>
                            <strong>{d.dayLabel}</strong>
                            {d.isToday && (
                              <span style={{ marginLeft: '6px', fontSize: '10px', background: '#e0e7ff', color: '#4338ca', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                                TODAY
                              </span>
                            )}
                            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{d.date}</div>
                          </td>

                          <td className={styles.td}>
                            {d.isClosed ? (
                              <span
                                className={d.isAutoClose ? styles.eodBadgeAuto : styles.eodBadgeClosed}
                                title={d.notes ? `Remark: ${d.notes}` : undefined}
                              >
                                <CheckCircle2 size={12} />
                                {d.isAutoClose
                                  ? '00:00 Auto'
                                  : `Closed ${new Date(d.closedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${d.closedByName || 'User'}`}
                              </span>
                            ) : (
                              <span className={styles.eodBadgeOpen}>
                                <Clock size={12} />
                                {d.isToday ? 'Live / Open' : 'Not Closed'}
                              </span>
                            )}
                          </td>

                          {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                            <>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                                {formatCurrency(d.salesGrossRevenue)}
                                <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{d.salesCount} sale{d.salesCount !== 1 ? 's' : ''}</div>
                              </td>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: d.salesNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                                {d.salesNetProfit >= 0 ? '+' : ''}{formatCurrency(d.salesNetProfit)}
                              </td>
                            </>
                          )}

                          {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                            <>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                                {formatCurrency(d.repairsRevenue)}
                                <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{d.repairsCompletedCount} repair{d.repairsCompletedCount !== 1 ? 's' : ''}</div>
                              </td>
                              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: d.repairsNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                                {d.repairsNetProfit >= 0 ? '+' : ''}{formatCurrency(d.repairsNetProfit)}
                              </td>
                            </>
                          )}

                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ fontWeight: 600 }}>
                            {formatCurrency(d.totalPhysicalCash)}
                          </td>

                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                            <strong style={{ color: d.totalNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                              {d.totalNetProfit >= 0 ? '+' : ''}{formatCurrency(d.totalNetProfit)}
                            </strong>
                          </td>

                          <td className={[styles.td, styles.textRight].join(' ')}>
                            {d.isClosed && d.eodRecord ? (
                              <button
                                type="button"
                                className={styles.viewSlipBtn}
                                onClick={() => { setSelectedEodRecord(d.eodRecord!); setIsEodModalOpen(true); }}
                                title="View official verified End-of-Day slip"
                              >
                                <FileText size={12} /> Slip
                              </button>
                            ) : d.isToday ? (
                              <button
                                type="button"
                                className={styles.closeDayBtn}
                                onClick={() => { setSelectedEodRecord(null); setIsEodModalOpen(true); }}
                                title="Declare End of Day for today"
                              >
                                <Moon size={12} /> Close
                              </button>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {data.dailyIncomeDetails.length > 0 && (
                    <tfoot>
                      <tr style={{ background: 'var(--color-surface-container-low)', fontWeight: 700 }}>
                        <td className={styles.td}>Total ({data.dailyIncomeDetails.length} days)</td>
                        <td className={styles.td} style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
                          {data.dailyIncomeDetails.filter(d => d.isClosed).length} sealed / {data.dailyIncomeDetails.length} total
                        </td>
                        {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                          <>
                            <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                              {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.salesGrossRevenue, 0))}
                            </td>
                            <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                              +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.salesNetProfit, 0))}
                            </td>
                          </>
                        )}
                        {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                          <>
                            <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                              {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.repairsRevenue, 0))}
                            </td>
                            <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                              +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.repairsNetProfit, 0))}
                            </td>
                          </>
                        )}
                        <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                          {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.totalPhysicalCash, 0))}
                        </td>
                        <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                          <strong style={{ color: 'var(--color-success)' }}>
                            +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.totalNetProfit, 0))}
                          </strong>
                        </td>
                        <td className={styles.td}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>

          {/* 2. TREND CHART & CASH DRAWER RECONCILIATION */}
          <div className={styles.sectionGrid}>
            {/* Revenue & Profit Trend Chart */}
            <Card>
              <CardHeader 
                title={data.chart.title} 
                subtitle={`Total: ${formatCurrency(data.financialSummary.grossRevenue)} • Profit: ${formatCurrency(data.financialSummary.grossProfit)}`}
              />
              <div className={styles.chartContainer}>
                <div className={styles.barsWrapper}>
                  {data.chart.points.map((p, idx) => (
                    <div key={idx} className={styles.barCol}>
                      <div className={styles.barTrack}>
                        <div
                          className={styles.barFill}
                          style={{
                            height: `${maxChartRev > 0 ? Math.max(4, (p.revenue / maxChartRev) * 100) : 0}%`,
                          }}
                          title={`${p.label}: Revenue ${formatCurrency(p.revenue)} (Profit: ${formatCurrency(p.profit)})`}
                        />
                      </div>
                      <span className={styles.barVal}>{formatCurrency(p.revenue)}</span>
                      <span className={styles.barLabel}>{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Cash Drawer & Register Reconciliation */}
            <Card padding="none">
              <div className={styles.cardHeaderWithAction}>
                <h3 className={styles.cardTitle}><CreditCard size={18} /> Cash Drawer & Payments</h3>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }}>
                  Total: {formatCurrency(data.paymentBreakdown.totalCollected)}
                </span>
              </div>
              <div className={styles.cashDrawerGrid}>
                <div className={styles.drawerItem}>
                  <div className={styles.drawerLabel}>💵 Cash in Drawer</div>
                  <div className={styles.drawerAmount}>{formatCurrency(data.paymentBreakdown.cash)}</div>
                </div>
                <div className={styles.drawerItem}>
                  <div className={styles.drawerLabel}>💳 Card Payments</div>
                  <div className={styles.drawerAmount}>{formatCurrency(data.paymentBreakdown.card)}</div>
                </div>
                <div className={styles.drawerItem}>
                  <div className={styles.drawerLabel}>📱 Mobile Pay</div>
                  <div className={styles.drawerAmount}>{formatCurrency(data.paymentBreakdown.mobile)}</div>
                </div>
                <div className={styles.drawerItem}>
                  <div className={styles.drawerLabel}>🏷️ Discounts Given</div>
                  <div className={styles.drawerAmount} style={{ color: 'var(--color-warning)' }}>
                    -{formatCurrency(data.financialSummary.discountsTotal)}
                  </div>
                </div>
                <div className={styles.drawerItem}>
                  <div className={styles.drawerLabel}>↩️ Refunds ({data.financialSummary.refundsCount})</div>
                  <div className={styles.drawerAmount} style={{ color: 'var(--color-error)' }}>
                    -{formatCurrency(data.financialSummary.refundsTotal)}
                  </div>
                </div>
                <div className={styles.drawerItem}>
                  <div className={styles.drawerLabel}>🔀 Split Payments</div>
                  <div className={styles.drawerAmount}>{data.paymentBreakdown.splitCount} orders</div>
                </div>
              </div>
            </Card>
          </div>

          {/* 3. PRODUCT SALES & CATEGORY BREAKDOWN */}
          <div className={styles.sectionGrid}>
            {/* Top Selling Products */}
            <Card padding="none">
              <div className={styles.cardHeaderWithAction}>
                <h3 className={styles.cardTitle}><ShoppingBag size={18} /> Top Selling Products</h3>
                <button 
                  className={styles.subFilterBtn} 
                  onClick={handleExportSalesCSV}
                  title="Export Sales Ledger CSV"
                >
                  <Download size={13} /> Export
                </button>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Product</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Units</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Revenue</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Profit</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                          No products sold during this period.
                        </td>
                      </tr>
                    ) : (
                      data.topProducts.map(p => (
                        <tr key={p.id} className={styles.tr}>
                          <td className={styles.td}>
                            <strong>{p.name}</strong>
                            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>SKU: {p.sku}</div>
                          </td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{p.units}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(p.revenue)}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                            +{formatCurrency(p.profit)}
                          </td>
                          <td className={[styles.td, styles.textRight].join(' ')}>
                            <span className={styles.badgeSuccess}>{p.marginPercent}%</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Sales by Category & Inventory Valuation */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Sales by Category */}
              <Card padding="none">
                <div className={styles.cardHeaderWithAction}>
                  <h3 className={styles.cardTitle}><Tag size={18} /> Sales by Category</h3>
                </div>
                <div className={styles.categoryList}>
                  {data.salesByCategory.length === 0 ? (
                    <p style={{ padding: '16px', color: 'var(--color-on-surface-variant)', fontSize: '13px', textAlign: 'center' }}>
                      No category sales in this period.
                    </p>
                  ) : (
                    data.salesByCategory.map(cat => (
                      <div key={cat.category} className={styles.categoryItem}>
                        <div className={styles.categoryHeader}>
                          <span>{cat.label} ({cat.units} units)</span>
                          <span className={styles.fontMono}>{formatCurrency(cat.revenue)} ({cat.percentage}%)</span>
                        </div>
                        <div className={styles.categoryTrack}>
                          <div className={styles.categoryFill} style={{ width: `${cat.percentage}%` }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              {/* Current Inventory Snapshot */}
              <Card padding="none">
                <div className={styles.cardHeaderWithAction}>
                  <h3 className={styles.cardTitle}><Package size={18} /> Current Stock Valuation</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '16px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Total Units in Stock</div>
                    <div style={{ fontSize: '18px', fontWeight: 700 }}>{data.inventoryValuation.totalUnits} units</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Total Stock Cost</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-error)' }}>{formatCurrency(data.inventoryValuation.totalCostValue)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Total Retail Value</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary)' }}>{formatCurrency(data.inventoryValuation.totalRetailValue)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Potential Profit</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-success)' }}>+{formatCurrency(data.inventoryValuation.potentialProfit)}</div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* 4. WORKSHOP REPAIRS & STAFF PERFORMANCE */}
          <div className={styles.sectionGrid}>
            {/* Multi-Lingual Repair Breakdown */}
            <Card padding="none">
              <div className={styles.cardHeaderWithAction}>
                <h3 className={styles.cardTitle}><Wrench size={18} /> Repair Services Breakdown</h3>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }}>
                  Total: {formatCurrency(data.repairAnalytics.totalRevenue)}
                </span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Issue Type</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Count</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Revenue</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Parts Cost</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.repairAnalytics.categories.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                          No repair tickets in this period.
                        </td>
                      </tr>
                    ) : (
                      data.repairAnalytics.categories.map(c => (
                        <tr key={c.key} className={styles.tr}>
                          <td className={styles.td}><strong>{c.label}</strong></td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{c.count}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(c.revenue)}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-error)' }}>
                            -{formatCurrency(c.partsCost)}
                          </td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                            +{formatCurrency(c.profit)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Staff Accountability & Performance */}
            <Card padding="none">
              <div className={styles.cardHeaderWithAction}>
                <h3 className={styles.cardTitle}><Users size={18} /> Staff Performance & Sales</h3>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Staff Member</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Sales</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Repairs</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Total Generated</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Avg Ticket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staffPerformance.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                          No staff activity recorded in this period.
                        </td>
                      </tr>
                    ) : (
                      data.staffPerformance.map(s => (
                        <tr key={s.id} className={styles.tr}>
                          <td className={styles.td}><strong>{s.name}</strong></td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{s.salesCount}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{s.repairsCount}</td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                            <strong>{formatCurrency(s.totalRevenue)}</strong>
                          </td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(s.averageTicket)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Top Customers Section */}
          {data.topCustomers && data.topCustomers.length > 0 && (
            <Card padding="none">
              <div className={styles.cardHeaderWithAction}>
                <h3 className={styles.cardTitle}><Users size={18} /> {t('reports.topCustomersTitle', 'Top Customers (By Spending)')}</h3>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }}>
                  {data.topCustomers.length} {t('reports.topCustomers', 'Customers')}
                </span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>{t('reports.customer', 'Customer')}</th>
                      <th className={styles.th}>{t('reports.phone', 'Phone')}</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>{t('reports.orders', 'Orders')}</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>{t('reports.totalSpent', 'Total Spent')}</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>{t('reports.averageOrder', 'Average Order')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCustomers.map(c => (
                      <tr key={c.id} className={styles.tr}>
                        <td className={styles.td}><strong>{c.name}</strong></td>
                        <td className={[styles.td, styles.fontMono].join(' ')}>{c.phone || 'N/A'}</td>
                        <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{c.ordersCount}</td>
                        <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                          <strong>{formatCurrency(c.totalSpent)}</strong>
                        </td>
                        <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(c.averageOrder)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* 5. VERBATIM AUDIT LEDGERS (ITEMIZED SALES & REPAIRS) */}
          <Card padding="none" className={styles.spanFull}>
            <div className={styles.ledgerHeader}>
              <div className={styles.ledgerTabs}>
                <button
                  className={[styles.ledgerTabBtn, ledgerTab === 'sales' && styles.ledgerTabActive].filter(Boolean).join(' ')}
                  onClick={() => setLedgerTab('sales')}
                >
                  <ShoppingBag size={15} /> {t('reports.salesLedger', 'Sales Ledger')} ({data.salesLedger.length})
                </button>
                <button
                  className={[styles.ledgerTabBtn, ledgerTab === 'repairs' && styles.ledgerTabActive].filter(Boolean).join(' ')}
                  onClick={() => setLedgerTab('repairs')}
                >
                  <Wrench size={15} /> {t('reports.repairsLedger', 'Repairs Ledger')} ({data.repairsLedger.length})
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder={t('reports.searchPlaceholder', 'Search customer, item, cashier...')}
                  value={ledgerSearch}
                  onChange={e => setLedgerSearch(e.target.value)}
                  className={[styles.dateInput, styles.ledgerSearch].join(' ')}
                />
                {ledgerTab === 'sales' ? (
                  <Button size="sm" variant="secondary" leftIcon={<Download size={13} />} onClick={handleExportSalesCSV}>
                    {t('reports.exportSalesCSV', 'Export Sales CSV')}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" leftIcon={<Download size={13} />} onClick={handleExportRepairsCSV}>
                    {t('reports.exportRepairsCSV', 'Export Repairs CSV')}
                  </Button>
                )}
              </div>
            </div>

            <div className={styles.tableWrapper}>
              {ledgerTab === 'sales' ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Date & Time</th>
                      <th className={styles.th}>Receipt #</th>
                      <th className={styles.th}>Customer</th>
                      <th className={styles.th}>Items Purchased</th>
                      <th className={styles.th}>Cashier</th>
                      <th className={styles.th}>Payment</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Total</th>
                      <th className={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSalesLedger.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                          No sales transactions match your filter.
                        </td>
                      </tr>
                    ) : (
                      filteredSalesLedger.map(tx => (
                        <tr key={tx.id} className={styles.tr}>
                          <td className={styles.td} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                            {new Date(tx.date).toLocaleDateString()} {new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className={[styles.td, styles.fontMono].join(' ')} style={{ fontSize: '11px' }}>
                            {tx.id.substring(0, 8)}...
                          </td>
                          <td className={styles.td}>
                            <strong>{tx.customerName || 'Walk-in Customer'}</strong>
                          </td>
                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                              {tx.items.map((i, idx) => (
                                <span key={idx}>
                                  <strong>{i.quantity}x</strong> {i.product.name} {i.product.model}
                                  <span style={{ color: 'var(--color-on-surface-variant)' }}> ({formatCurrency(i.product.price * i.quantity)})</span>
                                </span>
                              ))}
                              {tx.discount && (
                                <span style={{ color: 'var(--color-warning)', fontSize: '11px' }}>
                                  Discount: -{tx.discount.value}{tx.discount.type === 'percent' ? '%' : ' DA'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={styles.td} style={{ fontSize: '12px' }}>
                            {tx.processedByName || 'Store Cashier'}
                          </td>
                          <td className={styles.td} style={{ fontSize: '12px', textTransform: 'capitalize' }}>
                            {tx.payments.map(p => p.method).join(' + ')}
                          </td>
                          <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                            <strong>{formatCurrency(tx.total)}</strong>
                          </td>
                          <td className={styles.td}>
                            <span className={[
                              styles.statusBadge,
                              tx.status === 'refunded' ? styles.statusRefunded : styles.statusCompleted
                            ].join(' ')}>
                              {tx.status || 'completed'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Date & Time</th>
                      <th className={styles.th}>Ticket #</th>
                      <th className={styles.th}>Customer</th>
                      <th className={styles.th}>Device</th>
                      <th className={styles.th}>Issue Description</th>
                      <th className={styles.th}>Technician</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Parts Cost</th>
                      <th className={[styles.th, styles.textRight].join(' ')}>Repair Fee</th>
                      <th className={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRepairsLedger.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                          No repair tickets match your filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRepairsLedger.map(r => {
                        const partsCost = (r.partsUsed || []).reduce((s, p) => s + (p.cost || 0) * (p.quantity || 1), 0);
                        const fee = r.actualCost || r.estimatedCost || 0;
                        return (
                          <tr key={r.id} className={styles.tr}>
                            <td className={styles.td} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                              {new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className={[styles.td, styles.fontMono].join(' ')}>
                              <strong>{r.ticketNumber}</strong>
                            </td>
                            <td className={styles.td}>
                              <strong>{r.customerName}</strong>
                              {r.customerPhone && <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{r.customerPhone}</div>}
                            </td>
                            <td className={styles.td}>
                              {r.deviceBrand} {r.deviceModel}
                            </td>
                            <td className={styles.td} style={{ fontSize: '12px', maxWidth: 200 }}>
                              {r.issueDescription}
                            </td>
                            <td className={styles.td} style={{ fontSize: '12px' }}>
                              {r.assignedTechnician || r.createdByName || 'Tech'}
                            </td>
                            <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-error)' }}>
                              {partsCost > 0 ? `-${formatCurrency(partsCost)}` : '0 DA'}
                            </td>
                            <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                              <strong>{formatCurrency(fee)}</strong>
                              {r.status === 'completed' && r.paymentStatus === 'partial' && (
                                <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                                  Paid: {formatCurrency(r.paidAmount || 0)}
                                </div>
                              )}
                            </td>
                            <td className={styles.td}>
                              <span className={[
                                styles.statusBadge,
                                r.status === 'completed' ? styles.statusCompleted :
                                r.status === 'in_progress' ? styles.statusInProgress :
                                styles.statusPending
                              ].join(' ')}>
                                {r.status === 'completed' && r.paymentStatus === 'partial'
                                  ? 'Claimed (Partly Paid)'
                                  : r.status === 'completed' && r.paymentStatus === 'debt'
                                  ? 'Claimed (Unpaid Debt)'
                                  : r.status === 'completed'
                                  ? 'Completed & Paid'
                                  : r.status}
                              </span>
                              {r.status === 'completed' && (r.paymentStatus === 'partial' || r.paymentStatus === 'debt') && (
                                <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: 700, marginTop: '2px' }}>
                                  Debt: {formatCurrency(Math.max(0, fee - (r.paidAmount || 0)))}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Official End-of-Day Slip Viewer & Live Close Modal */}
          <EndOfDayModal
            isOpen={isEodModalOpen}
            onClose={() => {
              setIsEodModalOpen(false);
              setSelectedEodRecord(null);
              fetchData(activeOptions);
            }}
            viewRecord={selectedEodRecord}
          />
        </>
      ) : null}
    </div>
  );
};
