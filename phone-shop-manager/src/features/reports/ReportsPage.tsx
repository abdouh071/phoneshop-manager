import { useEffect, useState, useMemo } from 'react';
import {
  Download, Printer, RefreshCw, Lock
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { EndOfDayModal } from '../endofday/EndOfDayModal';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import type { EndOfDayRecord } from '../../services/endOfDayService';
import type { DailyIncomeDetail, ReportFilterOptions } from '../../services/reportsService';
import { useAuthStore } from '../../store/authStore';
import { useReportStore } from '../../store/reportStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { useToast } from '../../components/ui/Toast';
import { exportToCSV, printFormattedReport } from '../../utils/exportUtils';
import { printZReportDirect } from '../../utils/printWindow';
import styles from './Reports.module.css';
import { errorMessage } from '../../utils/errorUtils';
import { normalizeArabic } from '../../utils/normalizeText';
import type { DailyCategoryFilter, LedgerTab, MainTab } from './reportTypes';
import { DAY_NAMES, buildYearOptions } from './reportUtils';
import { buildExecutiveReportHtml } from './execReportHtml';
import { buildDailyIncomeCsv, buildFinancialSummaryCsv, buildRepairsLedgerCsv, buildSalesLedgerCsv } from './reportExport';
import { TimeframeFilterBar } from './TimeframeFilterBar';
import { ReportCacheBanner } from './ReportCacheBanner';
import { ReportSummaryCards } from './ReportSummaryCards';
import { DailyIncomeCard } from './DailyIncomeCard';
import { ReportTrendChart } from './ReportTrendChart';
import { CashDrawerPanel } from './CashDrawerPanel';
import { TopProductsPanel } from './TopProductsPanel';
import { CategoryAndStockPanel } from './CategoryAndStockPanel';
import { RepairBreakdownPanel } from './RepairBreakdownPanel';
import { StaffPerformancePanel } from './StaffPerformancePanel';
import { TopCustomersPanel } from './TopCustomersPanel';
import { LedgerTable } from './LedgerTable';

export const ReportsPage = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  usePrivacyStore((s) => s.isPrivacyActive);
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
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('sales');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [selectedEodRecord, setSelectedEodRecord] = useState<EndOfDayRecord | null>(null);
  const [isEodModalOpen, setIsEodModalOpen] = useState(false);
  const [dailyCategoryFilter, setDailyCategoryFilter] = useState<DailyCategoryFilter>('all');

  // Filtered Ledgers (computed early so CSV exports respect active search)
  const filteredSalesLedger = useMemo(() => {
    if (!data) return [];
    if (!ledgerSearch.trim()) return data.salesLedger;
    const q = normalizeArabic(ledgerSearch);
    return data.salesLedger.filter(t =>
      normalizeArabic(t.customerName).includes(q) ||
      normalizeArabic(t.processedByName).includes(q) ||
      normalizeArabic(t.id).includes(q) ||
      t.items.some(i => normalizeArabic(i?.product?.name).includes(q) || normalizeArabic(i?.product?.model).includes(q))
    );
  }, [data, ledgerSearch]);

  const filteredRepairsLedger = useMemo(() => {
    if (!data) return [];
    if (!ledgerSearch.trim()) return data.repairsLedger;
    const q = normalizeArabic(ledgerSearch);
    return data.repairsLedger.filter(r =>
      normalizeArabic(r.customerName).includes(q) ||
      normalizeArabic(r.customerPhone).includes(q) ||
      normalizeArabic(r.ticketNumber).includes(q) ||
      normalizeArabic(r.deviceBrand).includes(q) ||
      normalizeArabic(r.deviceModel).includes(q) ||
      normalizeArabic(r.issueDescription).includes(q) ||
      normalizeArabic(r.assignedTechnician).includes(q)
    );
  }, [data, ledgerSearch]);

  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => buildYearOptions(currentYear), [currentYear]);

  // Fetch initial report
  useEffect(() => {
    fetchData({ dateRange: 'last_7_days', weekStartDay }, { forceRefresh: true });
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

  const handleSubFilterClick = (
    filterKey: string,
    extraOpts: Partial<Omit<ReportFilterOptions, 'dateRange' | 'weekStartDay'>> = {}
  ) => {
    setActiveSubFilter(filterKey);
    fetchData({ dateRange: filterKey, weekStartDay, ...extraOpts });
  };

  // Thermal Z-Report direct print
  const handlePrintThermalZReport = async (day: DailyIncomeDetail) => {
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
        // A direct path carrying an error was refused by the server (for example,
        // the printer is offline). The report never printed — say so instead of
        // filing it as done.
        if (result.error) {
          toast.error(t('error.printFailed', 'Print Failed'), result.error);
          return;
        }
        toast.success(t('reports.printThermalZ', 'Print Thermal Z-Report'), t('reports.thermalPrintOk', 'Report printed to thermal printer.'));
      } else {
        toast.info(t('reports.printThermalZ', 'Print Thermal Z-Report'), t('reports.thermalPrintFallback', 'Thermal server offline; browser print opened.'));
      }
    } catch (err: unknown) {
      toast.error(t('error.printFailed', 'Print Failed'), errorMessage(err) || t('reports.thermalPrintFailed', 'Unable to print thermal Z-Report.'));
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!data) return;

    const { headers, rows } = buildFinancialSummaryCsv(data);

    exportToCSV(`financial_report_${mainTab}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Export Sales Ledger CSV (respecting active filter)
  const handleExportSalesCSV = () => {
    if (!data) return;
    const { headers, rows } = buildSalesLedgerCsv(filteredSalesLedger);
    exportToCSV(`sales_ledger_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Export Repairs Ledger CSV (respecting active filter)
  const handleExportRepairsCSV = () => {
    if (!data) return;
    const { headers, rows } = buildRepairsLedgerCsv(filteredRepairsLedger);
    exportToCSV(`repairs_ledger_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Export Daily Income CSV (respecting End-of-Day closings)
  const handleExportDailyIncomeCSV = () => {
    if (!data || !data.dailyIncomeDetails) return;
    const { headers, rows } = buildDailyIncomeCsv(data.dailyIncomeDetails);
    exportToCSV(`daily_income_breakdown_${mainTab}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  // Print Formatted Executive Report
  const handlePrintReport = () => {
    if (!data) return;

    const html = buildExecutiveReportHtml({
      data,
      storeName,
      authorizedByName: user?.name || 'Administrator',
      t,
    });

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
  const startDayName = DAY_NAMES[weekStartDay] || 'Mon';

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
            onClick={() => fetchData(undefined, { forceRefresh: true })}
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
      <TimeframeFilterBar
        mainTab={mainTab}
        activeSubFilter={activeSubFilter}
        specificDate={specificDate}
        customStart={customStart}
        customEnd={customEnd}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        yearOptions={yearOptions}
        startDayName={startDayName}
        handleMainTabChange={handleMainTabChange}
        handleSubFilterClick={handleSubFilterClick}
        setSpecificDate={setSpecificDate}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
        setSelectedYear={setSelectedYear}
        setSelectedMonth={setSelectedMonth}
      />

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
          <ReportCacheBanner data={data} onRetry={() => fetchData()} />

          {/* 1. EXECUTIVE FINANCIAL SUMMARY CARDS */}
          <ReportSummaryCards data={data} />

          {/* 1.5. DETAILED DAILY INCOME & END-OF-DAY RECONCILIATION */}
          <DailyIncomeCard
            data={data}
            mainTab={mainTab}
            selectedYear={selectedYear}
            dailyCategoryFilter={dailyCategoryFilter}
            setDailyCategoryFilter={setDailyCategoryFilter}
            handleExportDailyIncomeCSV={handleExportDailyIncomeCSV}
            handlePrintThermalZReport={handlePrintThermalZReport}
            setSelectedEodRecord={setSelectedEodRecord}
            setIsEodModalOpen={setIsEodModalOpen}
          />

          {/* 2. TREND CHART & CASH DRAWER RECONCILIATION */}
          <div className={styles.sectionGrid}>
            {/* Revenue & Profit Trend Chart */}
            <ReportTrendChart
              data={data}
              maxChartRev={maxChartRev}
            />

            {/* Cash Drawer & Register Reconciliation */}
            <CashDrawerPanel
              data={data}
            />
          </div>

          {/* 3. PRODUCT SALES & CATEGORY BREAKDOWN */}
          <div className={styles.sectionGrid}>
            {/* Top Selling Products */}
            <TopProductsPanel
              data={data}
              handleExportSalesCSV={handleExportSalesCSV}
            />

            {/* Sales by Category & Inventory Valuation */}
            <CategoryAndStockPanel
              data={data}
            />
          </div>

          {/* 4. WORKSHOP REPAIRS & STAFF PERFORMANCE */}
          <div className={styles.sectionGrid}>
            {/* Multi-Lingual Repair Breakdown */}
            <RepairBreakdownPanel
              data={data}
            />

            {/* Staff Accountability & Performance */}
            <StaffPerformancePanel
              data={data}
            />
          </div>

          {/* Top Customers Section */}
          {data.topCustomers && data.topCustomers.length > 0 && (
            <TopCustomersPanel
              data={data}
            />
          )}

          {/* 5. VERBATIM AUDIT LEDGERS (ITEMIZED SALES & REPAIRS) */}
          <LedgerTable
            data={data}
            filteredSalesLedger={filteredSalesLedger}
            filteredRepairsLedger={filteredRepairsLedger}
            ledgerTab={ledgerTab}
            setLedgerTab={setLedgerTab}
            ledgerSearch={ledgerSearch}
            setLedgerSearch={setLedgerSearch}
            handleExportSalesCSV={handleExportSalesCSV}
            handleExportRepairsCSV={handleExportRepairsCSV}
          />

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
