import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, DollarSign,
  ShoppingBag, Wrench, AlertTriangle, CreditCard, Lock,
  Plus, ArrowRight, Package, Smartphone, RefreshCw, Eye, CheckCircle2, ExternalLink, User
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
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { usePermissions } from '../../hooks/usePermissions';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import { AdminMobileDashboard } from './AdminMobileDashboard';
import type { RevenueDataPoint, SaleTransaction } from '../../types';
import styles from './Dashboard.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { getOverdueDebts } from '../../utils/debtAlerts';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
  getClaimedRepairHandoverCash,
  getClaimedRepairPartsCost,
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
}

const StatCard: React.FC<StatCardProps> = ({ label, value, change, icon, accent, subtext, onClick, linkLabel }) => (
  <Card
    className={[styles.statCard, accent && styles.accentCard, onClick && styles.statCardClickable].filter(Boolean).join(' ')}
    onClick={onClick}
    style={onClick ? { cursor: 'pointer' } : undefined}
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

const MiniBarChart: React.FC<{ data: RevenueDataPoint[] }> = ({ data }) => {
  const max = Math.max(...data.map(d => d.revenue), 1);
  return (
    <div className={styles.barChart}>
      {data.map((d, i) => (
        <div key={i} className={styles.barGroup}>
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
  const isPrivacyActive = usePrivacyStore((s) => s.isPrivacyActive);
  const { products, fetchProducts } = useInventoryStore();
  const { transactions, fetchTransactions } = useCartStore();
  const { debts, customers, fetchCustomers } = useCustomerStore();
  const { tickets, fetchTickets } = useRepairStore();
  const { isAuthenticated, user, isHistoryUnlocked } = useAuthStore();
  const settings = useSettingsStore();
  const permissions = usePermissions();
  
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<SaleTransaction | null>(null);

  useEffect(() => {
    fetchProducts();
    fetchTransactions();
    fetchTickets();
    fetchCustomers();
  }, [fetchProducts, fetchTransactions, fetchTickets, fetchCustomers]);

  const overdueDebtsList = useMemo(() => getOverdueDebts(debts), [debts]);
  const overdueTotalAmount = useMemo(() => overdueDebtsList.reduce((sum, d) => sum + d.remainingBalance, 0), [overdueDebtsList]);
  const overdueCustomerCount = useMemo(() => new Set(overdueDebtsList.map(d => d.customerId)).size, [overdueDebtsList]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const isSameDay = (dateStr: string, day: Date) => {
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    return d.getTime() === day.getTime();
  };

  const yesterday = useMemo(() => { const d = new Date(today); d.setDate(d.getDate()-1); return d; }, [today]);

  const activeTx = useMemo(() => transactions.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'cancelled' && t.status !== 'pending_approval'), [transactions]);
  // All phones that have been claimed AND marked as paid or partly-paid (recognized revenue)
  const completedRepairs = useMemo(() => tickets.filter(t => isClaimedAndPaidRepair(t)), [tickets]);

  // Today's Sales & Repairs
  const todayTx = useMemo(() => activeTx.filter(t => isSameDay(t.date, today)), [activeTx, today]);
  const yesterdayTx = useMemo(() => activeTx.filter(t => isSameDay(t.date, yesterday)), [activeTx, yesterday]);
  // Use completedAt for the "when revenue was earned" timestamp
  const todayRepairs = useMemo(
    () => completedRepairs.filter(r => isSameDay(r.completedAt || r.updatedAt, today)),
    [completedRepairs, today]
  );
  const yesterdayRepairs = useMemo(
    () => completedRepairs.filter(r => isSameDay(r.completedAt || r.updatedAt, yesterday)),
    [completedRepairs, yesterday]
  );

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

  // Combined Daily Revenue (Retail Sales + Parts B2B + Repairs + Debt Collections on the day paid)
  const todaySalesRev = useMemo(() => todayTx.reduce((s,t) => s+t.total, 0), [todayTx]);
  const todayRetailTx = useMemo(() => todayTx.filter(t => t.saleType !== 'parts_b2b'), [todayTx]);
  const todayPartsTx = useMemo(() => todayTx.filter(t => t.saleType === 'parts_b2b'), [todayTx]);
  const todayRetailSalesRev = useMemo(() => todayRetailTx.reduce((s,t) => s+t.total, 0), [todayRetailTx]);
  const todayPartsRev = useMemo(() => todayPartsTx.reduce((s,t) => s+t.total, 0), [todayPartsTx]);

  const todayRepRev = useMemo(
    () => todayRepairs.reduce((s,r) => s + getClaimedRepairRevenue(r), 0),
    [todayRepairs]
  );
  const todayDebtCollected = useMemo(() => {
    return debts
      .flatMap(d => (d.payments || []).filter(p => isSameDay(p.date, today)))
      .filter(p => String(p.method || '').toLowerCase() === 'cash')
      .reduce((s, p) => s + (p.amount || 0), 0);
  }, [debts, today]);

  const dailyRevenue = todaySalesRev + todayRepRev;

  const yestSalesRev = useMemo(() => yesterdayTx.reduce((s,t) => s+t.total, 0), [yesterdayTx]);
  const yestRepRev = useMemo(
    () => yesterdayRepairs.reduce((s,r) => s + getClaimedRepairRevenue(r), 0),
    [yesterdayRepairs]
  );
  const yestDebtCollected = useMemo(() => {
    return debts
      .flatMap(d => (d.payments || []).filter(p => isSameDay(p.date, yesterday)))
      .filter(p => String(p.method || '').toLowerCase() === 'cash')
      .reduce((s, p) => s + (p.amount || 0), 0);
  }, [debts, yesterday]);

  const yesterdayRev = yestSalesRev + yestRepRev;

  // Today's Estimated Net Profit (parts cost only for claimed+paid repairs; debt collection is cash inflow, not double-counted revenue)
  const todaySalesCOGS = useMemo(
    () => todayTx.reduce((sum, t) => sum + t.items.reduce((s, i) => s + (i.product.costPrice || 0) * i.quantity, 0), 0),
    [todayTx]
  );
  const todayRepairsCOGS = useMemo(
    () => todayRepairs.reduce((sum, r) => sum + getClaimedRepairPartsCost(r), 0),
    [todayRepairs]
  );
  const todayNetProfit = dailyRevenue - (todaySalesCOGS + todayRepairsCOGS);

  // Today's Cash Drawer Balance (reconciled with cash sales + handover cash + intake deposits + debt collections)
  const todayCash = useMemo(() => {
    // Cash in: completed (non-refunded, non-cancelled) POS sales & parts B2B
    let cashIn = 0;
    todayTx.forEach(t => {
      if (t.payments && t.payments.length > 0) {
        t.payments.forEach(p => {
          if (String(p.method || '').toLowerCase() === 'cash') cashIn += (p.amount || 0);
        });
      } else {
        // Fallback for transactions without an explicit payments array
        cashIn += Math.max(0, t.total || 0);
      }
    });

    const repairHandovers = todayRepairs.reduce((s, r) => s + getClaimedRepairHandoverCash(r), 0);
    const repairDeposits = tickets
      .filter(t => isSameDay(t.createdAt, today))
      .reduce((s, t) => s + (t.depositAmount || 0), 0);

    return Math.max(0, cashIn + repairHandovers + repairDeposits + todayDebtCollected);
  }, [todayTx, todayRepairs, tickets, todayDebtCollected, today]);

  const todayCard = useMemo(() => {
    let card = 0;
    todayTx.forEach(t => {
      if (t.payments && t.payments.length > 0) {
        t.payments.forEach(p => {
          if (String(p.method || '').toLowerCase() === 'card') card += (p.amount || 0);
        });
      }
    });
    return card;
  }, [todayTx]);

  const todayMobile = useMemo(() => {
    let mob = 0;
    todayTx.forEach(t => {
      if (t.payments && t.payments.length > 0) {
        t.payments.forEach(p => {
          if (String(p.method || '').toLowerCase() === 'mobile') mob += (p.amount || 0);
        });
      }
    });
    return mob;
  }, [todayTx]);

  // Weekly & Monthly Combined Revenues (Sales + Repairs)
  const weeklyRevenue = useMemo(() => {
    const sRev = activeTx.filter(t => new Date(t.date) >= startOfWeek).reduce((s,t)=>s+t.total, 0);
    const rRev = completedRepairs.filter(r => new Date(r.completedAt || r.updatedAt) >= startOfWeek).reduce((s,r)=>s+getClaimedRepairRevenue(r), 0);
    return sRev + rRev;
  }, [activeTx, completedRepairs, startOfWeek]);

  const monthlyRevenue = useMemo(() => {
    const sRev = activeTx.filter(t => new Date(t.date) >= startOfMonth).reduce((s,t)=>s+t.total, 0);
    const rRev = completedRepairs.filter(r => new Date(r.completedAt || r.updatedAt) >= startOfMonth).reduce((s,r)=>s+getClaimedRepairRevenue(r), 0);
    return sRev + rRev;
  }, [activeTx, completedRepairs, startOfMonth]);

  const unitsSoldToday = useMemo(() => todayTx.reduce((s,t) => s+t.items.reduce((a,i)=>a+i.quantity,0), 0), [todayTx]);
  const unitsYesterday = useMemo(() => yesterdayTx.reduce((s,t) => s+t.items.reduce((a,i)=>a+i.quantity,0), 0), [yesterdayTx]);

  const revenueChange = yesterdayRev === 0 ? (dailyRevenue > 0 ? 100 : 0) : ((dailyRevenue-yesterdayRev)/yesterdayRev)*100;
  const unitsSoldChange = unitsYesterday === 0 ? (unitsSoldToday > 0 ? 100 : 0) : ((unitsSoldToday-unitsYesterday)/unitsYesterday)*100;

  const activeRepairs = useMemo(() => tickets.filter(t => t.status === 'pending' || t.status === 'in_progress').length, [tickets]);
  const lowStockCount = useMemo(() => products.filter(p => p.stockStatus !== 'in_stock').length, [products]);

  // Combined 7-Day Chart Data (Sales + Repairs + Debt Collections)
  const chartData: RevenueDataPoint[] = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - i));
    const dayStart = new Date(day); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999);

    const sRev = activeTx
      .filter(t => { const d = new Date(t.date); return d >= dayStart && d <= dayEnd; })
      .reduce((s,t) => s+t.total, 0);

    const rRev = completedRepairs
      .filter(r => { const d = new Date(r.completedAt || r.updatedAt); return d >= dayStart && d <= dayEnd; })
      .reduce((s,r) => s + getClaimedRepairRevenue(r), 0);

    const dRev = debts
      .flatMap(d => (d.payments || []).filter(p => { const dt = new Date(p.date); return dt >= dayStart && dt <= dayEnd; }))
      .reduce((s,p) => s + p.amount, 0);

    return { label: DAYS[day.getDay()], revenue: sRev + rRev + dRev };
  }), [activeTx, completedRepairs, debts, today]);

  const recentTransactions: SaleTransaction[] = useMemo(() => activeTx.slice(0, 8), [activeTx]);
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
          onClick={() => { fetchProducts(); fetchTransactions(); fetchTickets(); }}
        >
          Refresh Data
        </Button>
        <EndOfDayButton variant="compact" />
      </div>

      {/* Quick Action Shortcuts */}
      <div className={styles.quickActionsGrid}>
        {permissions.pos && (
          <div className={styles.quickActionCard} onClick={() => navigate('/pos')}>
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
          <div className={styles.quickActionCard} onClick={() => navigate('/repairs')}>
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
          <div className={styles.quickActionCard} onClick={() => navigate('/parts')}>
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
          <div className={styles.quickActionCard} onClick={() => navigate('/inventory')}>
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

      {/* Stat Cards */}
      <div className={styles.statsGrid}>
        <StatCard
          accent
          label={permissions.pos ? "Today's Total Revenue" : "Today's Repair Revenue"}
          value={formatPrivateCurrency(permissions.pos ? (permissions.repairs ? dailyRevenue : todaySalesRev) : todayRepRev)}
          change={revenueChange}
          subtext={
            permissions.pos && permissions.repairs
              ? `Sales: ${formatPrivateCurrency(todayRetailSalesRev)} • Repairs: ${formatPrivateCurrency(todayRepRev)}${todayPartsRev > 0 ? ` • Parts: ${formatPrivateCurrency(todayPartsRev)}` : ''}`
              : permissions.repairs
                ? `${todayRepairs.length} repairs finished today`
                : `${todayTx.length} completed sales`
          }
          icon={<DollarSign size={20} />}
          onClick={permissions.pos ? () => navigate('/pos') : () => navigate('/repairs')}
          linkLabel={permissions.pos ? 'Open POS' : 'Open Repairs'}
        />
        {(!isAnalyticsLocked || user?.role === 'admin') ? (
          <StatCard
            label={t('dashboard.netProfit', "Today's Net Profit")}
            value={formatPrivateCurrency(todayNetProfit)}
            change={revenueChange}
            subtext="Gross Revenue minus COGS"
            icon={<TrendingUp size={20} />}
            onClick={() => navigate('/reports')}
            linkLabel="Full Report"
          />
        ) : permissions.pos ? (
          <StatCard
            label={t('dashboard.unitsSold', 'Units Sold Today')}
            value={String(unitsSoldToday)}
            change={unitsSoldChange}
            subtext={`${todayTx.length} completed transactions`}
            icon={<ShoppingBag size={20} />}
            onClick={() => navigate('/pos')}
            linkLabel="Open POS"
          />
        ) : (
          <StatCard
            label={t('dashboard.readyPickup', 'Ready for Pickup')}
            value={String(tickets.filter(t => t.status === 'ready').length)}
            subtext="Repairs awaiting collection"
            icon={<CheckCircle2 size={20} />}
            onClick={() => navigate('/repairs')}
            linkLabel="View Board"
          />
        )}
        {permissions.repairs ? (
          <StatCard
            label={t('dashboard.activeRepairs', 'Active Workshop Repairs')}
            value={String(activeRepairs)}
            subtext={`${todayRepairs.length} finished today`}
            icon={<Wrench size={20} />}
            onClick={() => navigate('/repairs')}
            linkLabel="View Board"
          />
        ) : (
          <StatCard
            label={t('dashboard.totalProducts', 'Total Products in Stock')}
            value={String(products.reduce((sum, p) => sum + (p.stock || 0), 0))}
            subtext={`${products.length} catalog models`}
            icon={<Package size={20} />}
            onClick={() => navigate('/inventory')}
            linkLabel="View Inventory"
          />
        )}
        <StatCard
          label={t('dashboard.lowStockItems', 'Low Stock Items')}
          value={String(lowStockCount)}
          subtext={(!isAnalyticsLocked || user?.role === 'admin') ? `${unitsSoldToday} units sold today` : 'Requires restock soon'}
          icon={<AlertTriangle size={20} />}
          onClick={lowStockCount > 0 ? () => navigate('/inventory') : undefined}
          linkLabel={lowStockCount > 0 ? 'View Inventory' : undefined}
        />
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
                subtitle={`Total: ${formatPrivateCurrency(permissions.repairs ? weeklyRevenue : activeTx.filter(t => new Date(t.date) >= startOfWeek).reduce((s, t) => s + t.total, 0))}`}
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
                            ? customers.find(c => c.name.toLowerCase().trim() === (tx.customerName || '').toLowerCase().trim())
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
