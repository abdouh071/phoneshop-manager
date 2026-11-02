import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Users, Wrench, ShoppingCart, AlertTriangle, ShieldAlert, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useCartStore } from '../../store/cartStore';
import { useRepairStore } from '../../store/repairStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuthStore } from '../../store/authStore';
import { useApprovalStore } from '../../store/approvalStore';
import { useCustomerStore } from '../../store/customerStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useHaptic } from '../../hooks/useHaptic';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
} from '../../utils/repairFinancials';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import styles from './AdminMobileDashboard.module.css';

export const AdminMobileDashboard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const { user } = useAuthStore();
  const { transactions } = useCartStore();
  const { tickets } = useRepairStore();
  const { products } = useInventoryStore();
  const { debts } = useCustomerStore();
  const { pendingCount, openModal } = useApprovalStore();
  useSettingsStore();

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const yesterday = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }, [today]);

  const isSameDay = (dateStr: string, day: Date) => {
    const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
    return d.getTime() === day.getTime();
  };

  const activeTx = useMemo(() => transactions.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'cancelled' && t.status !== 'pending_approval'), [transactions]);
  const completedRepairs = useMemo(() => tickets.filter(t => isClaimedAndPaidRepair(t)), [tickets]);

  const todayTx = useMemo(() => activeTx.filter(t => isSameDay(t.date, today)), [activeTx, today]);
  const yesterdayTx = useMemo(() => activeTx.filter(t => isSameDay(t.date, yesterday)), [activeTx, yesterday]);

  const todayRetailSalesRev = useMemo(() => todayTx.filter(t => t.saleType !== 'parts_b2b').reduce((s, t) => s + t.total, 0), [todayTx]);
  const todayPartsRev = useMemo(() => todayTx.filter(t => t.saleType === 'parts_b2b').reduce((s, t) => s + t.total, 0), [todayTx]);
  const todaySalesRev = todayRetailSalesRev + todayPartsRev;
  const yesterdaySalesRev = useMemo(() => yesterdayTx.reduce((s, t) => s + t.total, 0), [yesterdayTx]);

  const todayRepairRev = useMemo(() =>
    completedRepairs
      .filter(r => isSameDay(r.completedAt || r.updatedAt, today))
      .reduce((s, r) => s + getClaimedRepairRevenue(r), 0),
    [completedRepairs, today]
  );
  const yesterdayRepairRev = useMemo(() =>
    completedRepairs
      .filter(r => isSameDay(r.completedAt || r.updatedAt, yesterday))
      .reduce((s, r) => s + getClaimedRepairRevenue(r), 0),
    [completedRepairs, yesterday]
  );

  const todayDebtCollected = useMemo(() => {
    return debts
      .flatMap(d => (d.payments || []).filter(p => isSameDay(p.date, today)))
      .filter(p => String(p.method || '').toLowerCase() === 'cash')
      .reduce((s, p) => s + p.amount, 0);
  }, [debts, today]);

  useMemo(() => {
    return debts
      .flatMap(d => (d.payments || []).filter(p => isSameDay(p.date, yesterday)))
      .filter(p => String(p.method || '').toLowerCase() === 'cash')
      .reduce((s, p) => s + p.amount, 0);
  }, [debts, yesterday]);

  const startOfMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const monthlyRev = useMemo(() => {
    const s = activeTx.filter(t => new Date(t.date) >= startOfMonth).reduce((a, t) => a + t.total, 0);
    const r = completedRepairs.filter(r => new Date(r.completedAt || r.updatedAt) >= startOfMonth).reduce((a, r) => a + getClaimedRepairRevenue(r), 0);
    return s + r;
  }, [activeTx, completedRepairs, startOfMonth]);

  const todayRevenue = todaySalesRev + todayRepairRev;
  const yesterdayRevenue = yesterdaySalesRev + yesterdayRepairRev;
  const revenueChange = yesterdayRevenue === 0
    ? (todayRevenue > 0 ? 100 : 0)
    : ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;

  const activeRepairs = useMemo(() =>
    tickets.filter(t => t.status === 'pending' || t.status === 'in_progress').length,
    [tickets]
  );
  const readyPickup = useMemo(() => tickets.filter(t => t.status === 'ready').length, [tickets]);
  const lowStock = useMemo(() => products.filter(p => p.stockStatus !== 'in_stock').length, [products]);

  // Recent staff activity (last 8 transactions by staff)
  const timeLocale = useMemo(() => {
    const lang = i18n.language || 'en';
    return lang.startsWith('ar') ? 'ar-DZ' : lang.startsWith('fr') ? 'fr-FR' : 'en-US';
  }, []);
  const recentStaffActivity = useMemo(() =>
    [...activeTx]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 6)
      .map(tx => ({
        id: tx.id,
        staff: tx.processedByName || t('mobile.staff'),
        action: t('mobile.saleAction', { count: tx.items.length }),
        amount: tx.total,
        time: new Date(tx.date).toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' }),
      })),
    [activeTx, timeLocale, t]
  );

  const nav = (path: string) => { haptic.tap(); navigate(path); };

  return (
    <div className={styles.wrapper}>
      {/* Greeting */}
      <div className={styles.greeting}>
        <span className={styles.greetingText}>
          {new Date().getHours() < 12 ? t('mobile.goodMorning') : new Date().getHours() < 18 ? t('mobile.goodAfternoon') : t('mobile.goodEvening')},
        </span>
        <span className={styles.greetingName}>{user?.name?.split(' ')[0]}</span>
      </div>

      {/* Approval Alert (if any) */}
      {pendingCount > 0 && (
        <button className={styles.approvalAlert} onClick={() => { haptic.warning(); openModal(); }}>
          <ShieldAlert size={18} />
          <div className={styles.approvalAlertText}>
            <strong>{t('mobile.pendingApproval', { count: pendingCount })}</strong>
            <span>{t('mobile.staffNeedAuth')}</span>
          </div>
          <ChevronRight size={16} />
        </button>
      )}

      {/* Revenue Snapshot */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('mobile.todayVsYesterday')}</h3>
        <div className={styles.revenueCard}>
          <div className={styles.revenueMain}>
            <span className={styles.revenueLabel}>{t('mobile.todaysRevenue')}</span>
            <span className={styles.revenueValue}>{formatPrivateCurrency(todayRevenue)}</span>
            <div className={[styles.revenueBadge, revenueChange >= 0 ? styles.revenueBadgeUp : styles.revenueBadgeDown].join(' ')}>
              {revenueChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>{t('mobile.vsYesterday', { pct: Math.abs(revenueChange).toFixed(1) })}</span>
            </div>
          </div>
          <div className={styles.revenueBreakdown}>
            <div className={styles.breakdownRow}>
              <span>🛒 {t('mobile.retailSales')}</span>
              <span>{formatPrivateCurrency(todayRetailSalesRev)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>🔧 {t('sidebar.repairs')}</span>
              <span>{formatPrivateCurrency(todayRepairRev)}</span>
            </div>
            {todayPartsRev > 0 && (
              <div className={styles.breakdownRow}>
                <span>📦 {t('mobile.partsB2B')}</span>
                <span>{formatPrivateCurrency(todayPartsRev)}</span>
              </div>
            )}
            {todayDebtCollected > 0 && (
              <div className={styles.breakdownRow}>
                <span>💳 {t('mobile.debtCollections')}</span>
                <span>{formatPrivateCurrency(todayDebtCollected)}</span>
              </div>
            )}
            <div className={[styles.breakdownRow, styles.breakdownRowTotal].join(' ')}>
              <span>📅 {t('mobile.thisMonth')}</span>
              <span>{formatPrivateCurrency(monthlyRev)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className={styles.statsGrid}>
        <button className={styles.statCard} onClick={() => nav('/repairs')}>
          <Wrench size={20} className={styles.statIcon} style={{ color: '#d97706' }} />
          <span className={styles.statValue}>{activeRepairs}</span>
          <span className={styles.statLabel}>{t('mobile.activeRepairs')}</span>
        </button>
        <button className={styles.statCard} onClick={() => nav('/repairs')}>
          <Wrench size={20} className={styles.statIcon} style={{ color: '#16a34a' }} />
          <span className={styles.statValue}>{readyPickup}</span>
          <span className={styles.statLabel}>{t('dashboard.readyForPickup')}</span>
        </button>
        <button className={styles.statCard} onClick={() => nav('/pos')}>
          <ShoppingCart size={20} className={styles.statIcon} style={{ color: '#6366f1' }} />
          <span className={styles.statValue}>{todayTx.length}</span>
          <span className={styles.statLabel}>{t('dashboard.todaySales')}</span>
        </button>
        <button className={styles.statCard} onClick={() => nav('/inventory')} style={lowStock > 0 ? { borderColor: '#fbbf24' } : {}}>
          <AlertTriangle size={20} className={styles.statIcon} style={{ color: lowStock > 0 ? '#d97706' : 'var(--color-on-surface-variant)' }} />
          <span className={styles.statValue} style={lowStock > 0 ? { color: '#d97706' } : {}}>{lowStock}</span>
          <span className={styles.statLabel}>{t('mobile.lowStock')}</span>
        </button>
      </div>

      {/* Staff Activity Feed */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>{t('mobile.staffActivityToday')}</h3>
          <button className={styles.sectionLink} onClick={() => nav('/activity')}>{t('common.viewAll')}</button>
        </div>
        <div className={styles.activityList}>
          {recentStaffActivity.length === 0 ? (
            <p className={styles.empty}>{t('mobile.noSalesActivity')}</p>
          ) : (
            recentStaffActivity.map(item => (
              <div key={item.id} className={styles.activityRow}>
                <div className={styles.activityAvatar}>
                  {item.staff.slice(0, 2).toUpperCase()}
                </div>
                <div className={styles.activityInfo}>
                  <span className={styles.activityStaff}>{item.staff}</span>
                  <span className={styles.activityAction}>{item.action}</span>
                </div>
                <div className={styles.activityRight}>
                  <span className={styles.activityAmount}>{formatPrivateCurrency(item.amount)}</span>
                  <span className={styles.activityTime}>{item.time}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick Navigation */}
      <div className={styles.quickNav}>
        {[
          { label: t('sidebar.pos'), icon: ShoppingCart, path: '/pos', color: '#6366f1' },
          { label: t('sidebar.reports'), icon: TrendingUp, path: '/reports', color: '#0ea5e9' },
          { label: t('mobile.staff'), icon: Users, path: '/settings', color: '#10b981' },
          { label: t('sidebar.inventory'), icon: AlertTriangle, path: '/inventory', color: '#f59e0b' },
        ].map(({ label, icon: Icon, path, color }) => (
          <button key={path} className={styles.quickNavBtn} onClick={() => nav(path)}>
            <div className={styles.quickNavIcon} style={{ background: `${color}20`, color }}>
              <Icon size={20} />
            </div>
            <span className={styles.quickNavLabel}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
