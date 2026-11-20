import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, DollarSign,
  ShoppingBag, Wrench, AlertTriangle, CreditCard, Lock,
  Plus, ArrowRight, Package, Smartphone, RefreshCw, Eye, ExternalLink, User
} from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { ReceiptModal } from '../pos/ReceiptModal';
import { useAuthStore } from '../../store/authStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useCartStore } from '../../store/cartStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { usePermissions } from '../../hooks/usePermissions';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import { toDateStr } from '../../store/endOfDayStore';
import { computeDayFigures, hasFinalStatus, mergeDayInvoices } from '../../utils/dayFigures';
import { netUnitsSold } from '../../utils/saleEditLines';
import { AdminMobileDashboard } from './AdminMobileDashboard';
import type { RevenueDataPoint, SaleTransaction } from '../../types';
import styles from './Dashboard.module.css';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { getOverdueDebts } from '../../utils/debtAlerts';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
} from '../../utils/repairFinancials';

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

interface StatCardProps {
  label: string;
  value: string;
  change?: number;
  icon: React.ReactNode;
  accent?: boolean;
  subtext?: string;
  onClick?: () => void;
  linkLabel?: string;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, change, icon, accent, subtext, onClick, linkLabel, className }) => (
  <Card
    className={[styles.statCard, accent && styles.accentCard, onClick && styles.statCardClickable, className].filter(Boolean).join(' ')}
    onClick={onClick}
  >
    <div className={styles.statTop}>
      <div className={[styles.statIcon, accent && styles.accentIcon].filter(Boolean).join(' ')}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        {change !== undefined && (
          <span className={[styles.change, change >= 0 ? styles.changeUp : styles.changeDown].join(' ')}>
            {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
        {onClick && linkLabel && (
          <span style={{ fontSize: '10px', color: 'var(--color-primary, #4f46e5)', display: 'inline-flex', alignItems: 'center', gap: '2px', opacity: 0.8 }}>
            {linkLabel} <ExternalLink size={9} />
          </span>
        )}
      </div>
    </div>
    <p className={styles.statValue}>{value}</p>
    <p className={styles.statLabel}>{label}</p>
    {subtext && <p style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>{subtext}</p>}
  </Card>
);

/** Formats a number to a short abbreviated label (e.g. 12400 → "12.4k") */
const shortNum = (n: number): string => {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};

const MiniBarChart: React.FC<{ data: RevenueDataPoint[] }> = ({ data }) => {
  const max = Math.max(...data.map(d => d.revenue), 1);
  return (
    <div className={styles.barChart}>
      {data.map((d, i) => (
        <div key={i} className={styles.barGroup}>
          <span className={[styles.barValueLabel, 'privacy-blur'].join(' ')}>
            {d.revenue > 0 ? shortNum(d.revenue) : ''}
          </span>
          <div className={styles.barWrapper}>
            <div
              className={[styles.bar, 'privacy-blur'].join(' ')}
              style={{ height: `${max > 0 ? Math.max(4, (d.revenue / max) * 100) : 0}%` }}
              title={`${d.label}: ${formatPrivateCurrency(d.revenue)}`}
            />
          </div>
          <span className={styles.barLabel}>{d.label}</span>
        </div>
      ))}
    </div>
  );
};

const paymentMethodLabel: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile: 'Mobile Pay',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DashboardPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePrivacyStore((s) => s.isPrivacyActive);
  const { products, fetchProducts, isLoading: productsLoading, error: productsError } = useInventoryStore();
  const { transactions, fetchTransactions, isLoadingTransactions, error: transactionsError } = useCartStore();
  const { invoices: partsInvoices, fetchInvoices: fetchPartsInvoices } = usePartsCartStore();
  const { debts, customers, fetchCustomers, isLoading: customersLoading, error: customersError } = useCustomerStore();
  const { tickets, fetchTickets, isLoading: ticketsLoading, error: ticketsError } = useRepairStore();
  const { user, isHistoryUnlocked } = useAuthStore();
  const settings = useSettingsStore();
  const permissions = usePermissions();
  
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<SaleTransaction | null>(null);

  useEffect(() => {
    fetchProducts();
    fetchTransactions();
    fetchPartsInvoices();
    fetchTickets();
    fetchCustomers();
  }, [fetchProducts, fetchTransactions, fetchPartsInvoices, fetchTickets, fetchCustomers]);

  const isLoading = productsLoading || ticketsLoading || customersLoading || isLoadingTransactions;
  const loadError = productsError || ticketsError || customersError || transactionsError;
  const hasData = transactions.length > 0 || partsInvoices.length > 0 || tickets.length > 0 || products.length > 0;

  const refreshAll = () => {
    fetchProducts();
    fetchTransactions();
    fetchPartsInvoices();
    fetchTickets();
    fetchCustomers({ force: true });
  };

  const overdueDebtsList = useMemo(() => getOverdueDebts(debts), [debts]);
  const overdueTotalAmount = useMemo(() => overdueDebtsList.reduce((sum, d) => sum + d.remainingBalance, 0), [overdueDebtsList]);
  const overdueCustomerCount = useMemo(() => new Set(overdueDebtsList.map(d => d.customerId)).size, [overdueDebtsList]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const isSameDay = (dateStr: string, day: Date) => {
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    return d.getTime() === day.getTime();
  };

  const yesterday = useMemo(() => { const d = new Date(today); d.setDate(d.getDate()-1); return d; }, [today]);

  // The receipt list stays retail-only: its rows open ReceiptModal, which prints a
  // till receipt, and a parts B2B invoice is a different document with its own page.
  const retailTx = useMemo(() => transactions.filter(hasFinalStatus), [transactions]);
  // Money reads both stores merged and deduped by id. The retail store never fetches
  // parts invoices, so summing it alone hid every B2B sale from the revenue card while
  // the drawer card below — which already merged them — counted it.
  const activeInvoices = useMemo(
    () => mergeDayInvoices(transactions, partsInvoices).filter(hasFinalStatus),
    [transactions, partsInvoices]
  );
  // All phones that have been claimed AND marked as paid or partly-paid (recognized revenue)
  const completedRepairs = useMemo(() => tickets.filter(t => isClaimedAndPaidRepair(t)), [tickets]);

  const todayTx = useMemo(() => activeInvoices.filter(t => isSameDay(t.date, today)), [activeInvoices, today]);

  const startOfWeek = useMemo(() => { 
    const d = new Date(today); 
    const day = d.getDay();
    const startDay = settings.weekStartDay ?? 0;
    const diff = (day - startDay + 7) % 7;
    const s = new Date(d.setDate(d.getDate() - diff));
    s.setHours(0,0,0,0);
    return s; 
  }, [today, settings.weekStartDay]);

  const startOfMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);

  // One formula for the day — the same one the End-of-Day seal freezes. Revenue,
  // profit and the drawer all come out of it, so the cards cannot disagree with each
  // other or with the sealed day. Debt collections stay out of revenue: that money
  // was recognised when the sale was made, and only the drawer sees it again.
  const daySources = useMemo(
    () => ({
      transactions: mergeDayInvoices(transactions, partsInvoices),
      repairs: tickets,
      debts,
    }),
    [transactions, partsInvoices, tickets, debts]
  );
  const todayFigures = useMemo(() => computeDayFigures(daySources, toDateStr(today)), [daySources, today]);
  const yesterdayFigures = useMemo(() => computeDayFigures(daySources, toDateStr(yesterday)), [daySources, yesterday]);

  const todayRetailSalesRev = todayFigures.salesGrossRevenue;
  const todayPartsRev = todayFigures.partsRevenue;
  const todayRepRev = todayFigures.repairsRevenue;
  const dailyRevenue = todayFigures.totalRevenue;
  const yesterdayRev = yesterdayFigures.totalRevenue;
  const todayNetProfit = todayFigures.totalNetProfit;
  const todayCash = todayFigures.totalCash;
  const todayCard = todayFigures.totalCard;
  const todayMobile = todayFigures.totalMobile;

  // Weekly & Monthly Combined Revenues (Sales + Parts B2B + Repairs)
  const weeklyRevenue = useMemo(() => {
    const sRev = activeInvoices.filter(t => new Date(t.date) >= startOfWeek).reduce((s,t)=>s+t.total, 0);
    const rRev = completedRepairs.filter(r => new Date(r.completedAt || r.updatedAt) >= startOfWeek).reduce((s,r)=>s+getClaimedRepairRevenue(r), 0);
    return sRev + rRev;
  }, [activeInvoices, completedRepairs, startOfWeek]);

  const monthlyRevenue = useMemo(() => {
    const sRev = activeInvoices.filter(t => new Date(t.date) >= startOfMonth).reduce((s,t)=>s+t.total, 0);
    const rRev = completedRepairs.filter(r => new Date(r.completedAt || r.updatedAt) >= startOfMonth).reduce((s,r)=>s+getClaimedRepairRevenue(r), 0);
    return sRev + rRev;
  }, [activeInvoices, completedRepairs, startOfMonth]);

  const unitsSoldToday = useMemo(() => Math.max(0, todayTx.reduce((s,t) => s + netUnitsSold(t.items), 0)), [todayTx]);

  const revenueChange = yesterdayRev === 0 ? (dailyRevenue > 0 ? 100 : 0) : ((dailyRevenue-yesterdayRev)/yesterdayRev)*100;

  const activeRepairs = useMemo(() => tickets.filter(t => t.status === 'pending' || t.status === 'in_progress').length, [tickets]);
  const lowStockCount = useMemo(() => products.filter(p => p.stockStatus !== 'in_stock').length, [products]);

  // Each bar is the same day formula the cards read, so today's bar and today's
  // revenue card are one number. A debt repayment is not revenue: it was recognised
  // on the day the sale was made, and counting it here sold the same phone twice.
  const chartData: RevenueDataPoint[] = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - i));
    return { label: DAYS[day.getDay()], revenue: computeDayFigures(daySources, toDateStr(day)).totalRevenue };
  }), [daySources, today]);

  const recentTransactions: SaleTransaction[] = useMemo(() => retailTx.slice(0, 8), [retailTx]);
  const isAnalyticsLocked = user?.role !== 'admin' && !isHistoryUnlocked;

  // Show mobile admin dashboard on small screens
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  if (isMobile && user?.role === 'admin') {
    return <AdminMobileDashboard />;
  }

  return (
    <div className={styles.page}>
      <AdminUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onSuccess={() => setIsUnlockModalOpen(false)}
        actionName="view historical analytics"
      />

      {selectedTx && (
        <ReceiptModal
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
        />
      )}

      {/* Loading / Error status */}
      {isLoading && !hasData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '8px', marginBottom: '8px', background: 'var(--color-surface-variant)', color: 'var(--color-on-surface-variant)', fontSize: '14px' }}>
          <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Loading dashboard data…</span>
        </div>
      )}

      {loadError && !isLoading && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '8px', marginBottom: '8px', background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.2)', color: '#b91c1c', fontSize: '14px' }}>
          <AlertTriangle size={18} />
          <span style={{ flex: 1 }}>Some dashboard data could not be loaded. Figures below may be incomplete.</span>
          <button
            type="button"
            onClick={refreshAll}
            style={{
              background: 'rgba(220, 38, 38, 0.1)', border: '1px solid rgba(220, 38, 38, 0.3)',
              borderRadius: '6px', padding: '6px 12px', cursor: 'pointer',
              color: '#b91c1c', fontSize: '13px', fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Critical Stock Alert */}
      {lowStockCount > 0 && (
        <div style={{ background: 'var(--color-warning-container)', color: 'var(--color-warning-text)', padding: '16px', borderRadius: '8px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AlertTriangle size={24} />
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{t('dashboard.lowStockAlert', 'Low Stock Alert')}</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', opacity: 0.9 }}>
              You have {lowStockCount} item{lowStockCount === 1 ? '' : 's'} running low on stock. 
              {products.filter(p => p.stockStatus !== 'in_stock').slice(0, 3).map(p => ` ${p.name} ${p.model} (${p.stock} left)`).join(', ')}
              {lowStockCount > 3 ? ' and more.' : '.'}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('sidebar.dashboard', 'Dashboard')}</h1>
          <p className={styles.subtitle}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <Button 
          variant="secondary" 
          leftIcon={<RefreshCw size={15} />}
          onClick={refreshAll}
        >
          Refresh Data
        </Button>
        <EndOfDayButton variant="compact" />
      </div>

      {/* Quick Action Shortcuts */}
      <div className={styles.quickActionsGrid}>
        {permissions.pos && (
          <div className={styles.quickActionCard} role="button" tabIndex={0} onClick={() => navigate('/pos')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/pos'); } }}>
            <div className={[styles.quickActionIcon, styles.actionSale].join(' ')}>
              <ShoppingBag size={18} />
            </div>
            <div className={styles.quickActionText}>
              <span className={styles.quickActionTitle}>{t('dashboard.newSale', 'New POS Sale')}</span>
              <span className={styles.quickActionDesc}>{t('dashboard.newSaleDesc', 'Sell phones & accessories')}</span>
            </div>
          </div>
        )}

        {permissions.repairs && (
          <div className={styles.quickActionCard} role="button" tabIndex={0} onClick={() => navigate('/repairs')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/repairs'); } }}>
            <div className={[styles.quickActionIcon, styles.actionRepair].join(' ')}>
              <Wrench size={18} />
            </div>
            <div className={styles.quickActionText}>
              <span className={styles.quickActionTitle}>{t('ticket.newTicket', 'New Repair Ticket')}</span>
              <span className={styles.quickActionDesc}>{t('dashboard.newTicketDesc', 'Check in device & issue')}</span>
            </div>
          </div>
        )}

        {permissions.inventory_parts && (
          <div className={styles.quickActionCard} role="button" tabIndex={0} onClick={() => navigate('/parts')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/parts'); } }}>
            <div className={[styles.quickActionIcon, styles.actionParts].join(' ')}>
              <Smartphone size={18} />
            </div>
            <div className={styles.quickActionText}>
              <span className={styles.quickActionTitle}>{t('sidebar.parts', 'Parts')}</span>
              <span className={styles.quickActionDesc}>{t('dashboard.partsDesc', 'Sell screens, batteries & ICs')}</span>
            </div>
          </div>
        )}

        {permissions.inventory_products && (
          <div className={styles.quickActionCard} role="button" tabIndex={0} onClick={() => navigate('/inventory')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/inventory'); } }}>
            <div className={[styles.quickActionIcon, styles.actionInventory].join(' ')}>
              <Plus size={18} />
            </div>
            <div className={styles.quickActionText}>
              <span className={styles.quickActionTitle}>{t('inventory.addProduct', 'Add Product')}</span>
              <span className={styles.quickActionDesc}>{t('dashboard.addProductDesc', 'Stock inventory & models')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Overdue Debt Alert Banner */}
      {permissions.customers_debt && overdueDebtsList.length > 0 && (
        <div className={styles.overdueAlertBanner}>
          <div className={styles.overdueAlertLeft}>
            <div className={styles.overdueAlertIcon}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className={styles.overdueAlertTitle}>
                🚨 {overdueCustomerCount} Customer{overdueCustomerCount !== 1 ? 's' : ''} with Overdue Debts ({formatPrivateCurrency(overdueTotalAmount)} Total Past Due)
              </p>
              <p className={styles.overdueAlertSubtitle}>
                {overdueDebtsList.length} credit record{overdueDebtsList.length !== 1 ? 's' : ''} have exceeded their scheduled repayment due date.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.overdueAlertBtn}
            onClick={() => navigate('/customers?filter=overdue')}
          >
            <span>View Overdue Debts</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* ── TODAY'S INCOME SECTION ─────────────────────────── */}
      <div>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>📈 Today's Income (Revenue)</span>
          {revenueChange !== 0 && (
            <span className={[styles.change, revenueChange >= 0 ? styles.changeUp : styles.changeDown].join(' ')}>
              {revenueChange >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {Math.abs(revenueChange).toFixed(1)}% vs yesterday
            </span>
          )}
        </div>

        <div className={styles.heroBreakdownGrid}>
          {/* Hero income card */}
          <StatCard
            accent
            label="Total Income Today"
            value={formatPrivateCurrency(dailyRevenue)}
            change={revenueChange}
            icon={<DollarSign size={20} />}
            onClick={() => navigate('/reports')}
            linkLabel="Full Report"
            subtext={`${todayTx.length} sales · ${todayFigures.repairsRecognizedCount} repairs`}
          />

          {/* 3 breakdown income cards */}
          <div className={styles.breakdownGrid}>
            {/* POS Sales */}
            <Card
              className={[styles.breakdownCard, styles.statCardClickable].join(' ')}
              onClick={() => navigate('/pos')}
            >
              <div className={styles.breakdownCardTop}>
                <div className={[styles.breakdownIcon, styles.breakdownIconSales].join(' ')}>
                  <ShoppingBag size={16} />
                </div>
                <span style={{ fontSize: '10px', color: 'var(--color-primary)', opacity: 0.8, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  Open POS <ExternalLink size={9} />
                </span>
              </div>
              <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>{formatPrivateCurrency(todayRetailSalesRev)}</p>
              <p className={styles.breakdownLabel}>POS Sales</p>
              <p className={styles.breakdownSub}>{todayTx.length} transaction{todayTx.length !== 1 ? 's' : ''} · {unitsSoldToday} units</p>
            </Card>

            {/* Repairs */}
            {permissions.repairs ? (
              <Card
                className={[styles.breakdownCard, styles.statCardClickable].join(' ')}
                onClick={() => navigate('/repairs')}
              >
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconRepairs].join(' ')}>
                    <Wrench size={16} />
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--color-primary)', opacity: 0.8, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    View Board <ExternalLink size={9} />
                  </span>
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>{formatPrivateCurrency(todayRepRev)}</p>
                <p className={styles.breakdownLabel}>Repairs Income</p>
                <p className={styles.breakdownSub}>{todayFigures.repairsRecognizedCount} repair{todayFigures.repairsRecognizedCount !== 1 ? 's' : ''} completed today</p>
              </Card>
            ) : (
              <Card className={styles.breakdownCard}>
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconRepairs].join(' ')}><Wrench size={16} /></div>
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>—</p>
                <p className={styles.breakdownLabel}>Repairs Income</p>
                <p className={styles.breakdownSub}>No repair access</p>
              </Card>
            )}

            {/* Parts B2B */}
            {permissions.inventory_parts ? (
              <Card
                className={[styles.breakdownCard, styles.statCardClickable].join(' ')}
                onClick={() => navigate('/parts')}
              >
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconParts].join(' ')}>
                    <Package size={16} />
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--color-primary)', opacity: 0.8, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    View Parts <ExternalLink size={9} />
                  </span>
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>{formatPrivateCurrency(todayPartsRev)}</p>
                <p className={styles.breakdownLabel}>Parts B2B</p>
                <p className={styles.breakdownSub}>{todayFigures.partsCount ?? 0} invoice{(todayFigures.partsCount ?? 0) !== 1 ? 's' : ''} today</p>
              </Card>
            ) : (
              <Card className={styles.breakdownCard}>
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconParts].join(' ')}><Package size={16} /></div>
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>—</p>
                <p className={styles.breakdownLabel}>Parts B2B</p>
                <p className={styles.breakdownSub}>No parts access</p>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ── TODAY'S BENEFIT (NET PROFIT) SECTION ──────────────── */}
      {(!isAnalyticsLocked || user?.role === 'admin') && (
        <div>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>💰 Today's Benefit (Net Profit)</span>
            {dailyRevenue > 0 && (
              <span className={[styles.marginBadge, todayNetProfit >= 0 ? styles.marginPositive : styles.marginNegative].join(' ')}>
                Margin: {((todayNetProfit / (dailyRevenue || 1)) * 100).toFixed(1)}%
              </span>
            )}
          </div>

          <div className={styles.heroBreakdownGrid}>
            {/* Hero benefit card */}
            <StatCard
              label="Total Benefit"
              value={formatPrivateCurrency(todayNetProfit)}
              icon={<TrendingUp size={20} />}
              accent={false}
              subtext={`Margin: ${dailyRevenue > 0 ? ((todayNetProfit / dailyRevenue) * 100).toFixed(1) : '0.0'}%`}
              onClick={() => navigate('/reports')}
              linkLabel="Full Report"
              className={styles.benefitHeroCard}
            />

            {/* 3 breakdown benefit cards */}
            <div className={styles.breakdownGrid}>
              {/* POS Benefit */}
              <Card className={[styles.breakdownCard, styles.statCardClickable].join(' ')} onClick={() => navigate('/pos')}>
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconSales].join(' ')}><ShoppingBag size={16} /></div>
                  {todayRetailSalesRev > 0 && (
                    <span className={[styles.marginBadge, todayFigures.salesNetProfit >= 0 ? styles.marginPositive : styles.marginNegative].join(' ')}>
                      {((todayFigures.salesNetProfit / (todayRetailSalesRev || 1)) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>{formatPrivateCurrency(todayFigures.salesNetProfit)}</p>
                <p className={styles.breakdownLabel}>POS Benefit</p>
                <p className={styles.breakdownSub}>COGS: {formatPrivateCurrency(todayFigures.salesCOGS)}</p>
              </Card>

              {/* Repairs Benefit */}
              <Card className={[styles.breakdownCard, styles.statCardClickable].join(' ')} onClick={() => navigate('/repairs')}>
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconRepairs].join(' ')}><Wrench size={16} /></div>
                  {todayRepRev > 0 && (
                    <span className={[styles.marginBadge, todayFigures.repairsNetProfit >= 0 ? styles.marginPositive : styles.marginNegative].join(' ')}>
                      {((todayFigures.repairsNetProfit / (todayRepRev || 1)) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>{formatPrivateCurrency(todayFigures.repairsNetProfit)}</p>
                <p className={styles.breakdownLabel}>Repairs Benefit</p>
                <p className={styles.breakdownSub}>Parts cost: {formatPrivateCurrency(todayFigures.repairsPartsCost)}</p>
              </Card>

              {/* Parts Benefit */}
              <Card className={[styles.breakdownCard, styles.statCardClickable].join(' ')} onClick={() => navigate('/parts')}>
                <div className={styles.breakdownCardTop}>
                  <div className={[styles.breakdownIcon, styles.breakdownIconParts].join(' ')}><Package size={16} /></div>
                  {todayPartsRev > 0 && (
                    <span className={[styles.marginBadge, todayFigures.partsNetProfit >= 0 ? styles.marginPositive : styles.marginNegative].join(' ')}>
                      {((todayFigures.partsNetProfit / (todayPartsRev || 1)) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className={[styles.breakdownValue, 'privacy-blur'].join(' ')}>{formatPrivateCurrency(todayFigures.partsNetProfit)}</p>
                <p className={styles.breakdownLabel}>Parts Benefit</p>
                <p className={styles.breakdownSub}>COGS: {formatPrivateCurrency(todayFigures.partsCOGS)}</p>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ── OPERATIONAL STATUS STRIP ───────────────────────────── */}
      <div className={styles.opsStrip}>
        {/* Low Stock */}
        <button
          type="button"
          className={styles.opsCard}
          onClick={() => navigate('/inventory')}
        >
          <div className={[styles.opsIcon, styles.opsIconWarning].join(' ')}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className={styles.opsCount}>{lowStockCount}</div>
            <div className={styles.opsLabel}>Low Stock Articles</div>
            <div className={styles.opsSub}>
              {lowStockCount === 0 ? 'All items well stocked' : `${lowStockCount} item${lowStockCount !== 1 ? 's' : ''} need restocking`}
            </div>
          </div>
        </button>

        {/* Unrepaired phones */}
        {permissions.repairs && (
          <button
            type="button"
            className={styles.opsCard}
            onClick={() => navigate('/repairs')}
          >
            <div className={[styles.opsIcon, styles.opsIconInfo].join(' ')}>
              <Wrench size={20} />
            </div>
            <div>
              <div className={styles.opsCount}>{activeRepairs}</div>
              <div className={styles.opsLabel}>Phones in Workshop</div>
              <div className={styles.opsSub}>
                {activeRepairs === 0 ? 'No phones awaiting repair' : `${activeRepairs} pending or in-progress`}
              </div>
            </div>
          </button>
        )}
      </div>

      {/* End of Day Widget + Cash Drawer */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'stretch' }}>
        {/* EOD Widget */}
        <EndOfDayButton variant="widget" />

        {/* Cash Drawer */}
        <div className={styles.cashDrawerWidget} style={{ margin: 0 }}>
          <div className={styles.drawerWidgetTitle}>
            <CreditCard size={16} />
            <span>{t('dashboard.todaysCashDrawer', "Today's Cash Drawer:")}</span>
          </div>
          <div className={styles.drawerItemsRow}>
            <div className={styles.drawerWidgetItem}>
              <span>💵 Cash:</span>
              <span className={styles.drawerItemValue}>{formatPrivateCurrency(todayCash)}</span>
            </div>
            <div className={styles.drawerWidgetItem}>
              <span>💳 Card:</span>
              <span className={styles.drawerItemValue}>{formatPrivateCurrency(todayCard)}</span>
            </div>
            <div className={styles.drawerWidgetItem}>
              <span>📱 Mobile:</span>
              <span className={styles.drawerItemValue}>{formatPrivateCurrency(todayMobile)}</span>
            </div>
          </div>
        </div>
      </div>

      {isAnalyticsLocked ? (
        <Card>
          <div style={{ padding: '64px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--color-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Lock size={24} style={{ color: 'var(--color-on-surface-variant)' }} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-on-surface)' }}>Analytics Locked</h3>
              <p style={{ fontSize: '14px', color: 'var(--color-on-surface-variant)', marginTop: '4px', maxWidth: 400, marginInline: 'auto' }}>
                You need admin permission to view past revenue charts, monthly summaries, and recent transactions.
              </p>
            </div>
            <Button onClick={() => setIsUnlockModalOpen(true)} style={{ marginTop: '8px' }}>Unlock Analytics</Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Charts + Transactions Row */}
          <div className={styles.contentGrid}>
            {/* Revenue Chart */}
            <Card>
              <CardHeader
                title={permissions.repairs ? "Weekly Revenue (Sales + Repairs)" : "Weekly Revenue (Sales)"}
                subtitle={`Total: ${formatPrivateCurrency(permissions.repairs ? weeklyRevenue : activeInvoices.filter(t => new Date(t.date) >= startOfWeek).reduce((s, t) => s + t.total, 0))}`}
              />
              <MiniBarChart data={chartData} />
            </Card>

            {/* Recent Transactions */}
            <Card padding="none">
              <div className={styles.txHeader}>
                <CardHeader title={t('dashboard.recentTransactions', 'Recent Transactions')} subtitle={t('dashboard.clickToView', 'Click row to view receipt · Click name to open customer')} />
              </div>
              <div className={styles.txList}>
                {recentTransactions.length === 0 ? (
                  <p style={{ padding: '16px', color: 'var(--color-on-surface-variant)', fontSize: '14px', textAlign: 'center' }}>
                    No transactions yet. Complete a sale in the POS.
                  </p>
                ) : recentTransactions.map(tx => (
                  <div 
                    key={tx.id} 
                    className={styles.txRow} 
                    onClick={() => setSelectedTx(tx)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view receipt"
                  >
                    <div className={styles.txIcon}>
                      <CreditCard size={16} />
                    </div>
                    <div className={styles.txInfo}>
                      {(() => {
                        const matchedCust = tx.customerId
                          ? customers.find(c => c.id === tx.customerId)
                          : tx.customerName
                            ? customers.find(c => (c.name ?? '').toLowerCase().trim() === (tx.customerName || '').toLowerCase().trim())
                            : undefined;
                        return matchedCust ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/customers?focusId=${encodeURIComponent(matchedCust.id)}`);
                            }}
                            title={`Open ${matchedCust.name}'s customer profile`}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              color: 'var(--color-primary, #4f46e5)',
                              fontSize: 'inherit',
                              fontWeight: 600,
                              textDecoration: 'underline',
                              textDecorationColor: 'rgba(79,70,229,0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <User size={11} />{matchedCust.name}
                          </button>
                        ) : (
                          <span className={styles.txCustomer}>{tx.customerName || 'Walk-in Customer'}</span>
                        );
                      })()}
                      <span className={styles.txTime}>
                        {formatTime(tx.date)} · {tx.payments.map(p => paymentMethodLabel[p.method] ?? p.method).join('+')}
                        {tx.processedByName ? ` · by ${tx.processedByName}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={styles.txAmount}>{formatPrivateCurrency(tx.total)}</span>
                      <Eye size={14} style={{ color: 'var(--color-on-surface-variant)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Recent Repairs Row */}
          {permissions.repairs && (
            <Card padding="none">
              <div className={styles.txHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <CardHeader title="Workshop: Active & Ready" subtitle="Click a ticket to open it on the Repairs board" />
                <button
                  type="button"
                  onClick={() => navigate('/repairs')}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-primary, #4f46e5)', fontSize: '12px', fontWeight: 600,
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '6px 12px',
                  }}
                >
                  View All <ArrowRight size={13} />
                </button>
              </div>
              <div className={styles.txList}>
                {tickets.filter(t => t.status === 'pending' || t.status === 'in_progress' || t.status === 'ready').length === 0 ? (
                  <p style={{ padding: '16px', color: 'var(--color-on-surface-variant)', fontSize: '14px', textAlign: 'center' }}>
                    No active repairs right now.
                  </p>
                ) : (
                  tickets
                    .filter(t => t.status === 'pending' || t.status === 'in_progress' || t.status === 'ready')
                    .slice(0, 6)
                    .map(ticket => (
                      <div
                        key={ticket.id}
                        className={styles.txRow}
                        onClick={() => navigate(`/repairs?focusId=${encodeURIComponent(ticket.ticketNumber)}`)}
                        style={{ cursor: 'pointer' }}
                        title={`Open ticket #${ticket.ticketNumber} on repair board`}
                      >
                        <div className={styles.txIcon} style={{
                          background:
                            ticket.status === 'ready' ? 'rgba(22, 163, 74, 0.1)' :
                            ticket.status === 'in_progress' ? 'rgba(234, 179, 8, 0.1)' :
                            'rgba(100, 116, 139, 0.1)',
                          color:
                            ticket.status === 'ready' ? '#16a34a' :
                            ticket.status === 'in_progress' ? '#d97706' :
                            '#64748b',
                        }}>
                          <Wrench size={14} />
                        </div>
                        <div className={styles.txInfo}>
                          <span className={styles.txCustomer}>
                            #{ticket.ticketNumber} · {ticket.deviceBrand} {ticket.deviceModel}
                          </span>
                          <span className={styles.txTime}>
                            {ticket.customerName}
                            {ticket.customerPhone ? ` · ${ticket.customerPhone}` : ''}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '10.5px', fontWeight: 700, padding: '2px 7px', borderRadius: '5px',
                            background:
                              ticket.status === 'ready' ? '#dcfce7' :
                              ticket.status === 'in_progress' ? '#fef9c3' :
                              '#f1f5f9',
                            color:
                              ticket.status === 'ready' ? '#15803d' :
                              ticket.status === 'in_progress' ? '#a16207' :
                              '#475569',
                          }}>
                            {ticket.status === 'ready' ? '✓ Ready' :
                             ticket.status === 'in_progress' ? 'In Progress' :
                             'Pending'}
                          </span>
                          <ExternalLink size={12} style={{ color: 'var(--color-on-surface-variant)', opacity: 0.5 }} />
                        </div>
                      </div>
                    ))
                )}
              </div>
            </Card>
          )}

          {/* Monthly Summary */}
          <Card>
            <CardHeader title="Monthly Summary" subtitle={new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} />
            <div className={styles.monthlySummary}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Monthly Revenue</span>
                <span className={styles.summaryValue}>{formatPrivateCurrency(monthlyRevenue)}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Today vs Yesterday</span>
                <Badge variant={revenueChange >= 0 ? 'success' : 'danger'}>
                  {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}%
                </Badge>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Weekly Revenue</span>
                <span className={styles.summaryValue}>{formatPrivateCurrency(weeklyRevenue)}</span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
