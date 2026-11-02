import React from 'react';
import { Users, AlertTriangle, BookOpen, RefreshCw, DollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../../hooks/usePermissions';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import type { CustomersMetrics } from './customersPageData';
import type { AdminScope, CustomerFilter } from './customersPageTypes';
import styles from './Customers.module.css';

interface CustomersKpiGridProps {
  metrics: CustomersMetrics;
  activeFilter: CustomerFilter;
  setActiveFilter: React.Dispatch<React.SetStateAction<CustomerFilter>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  effectiveScope: AdminScope;
}

export const CustomersKpiGrid: React.FC<CustomersKpiGridProps> = ({
  metrics,
  activeFilter,
  setActiveFilter,
  setCurrentPage,
  effectiveScope,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();

  return (
    <>
      {/* Interactive KPI Summary Grid */}
      <div className={styles.summaryGrid}>
        <div
          className={[styles.summaryCard, activeFilter === 'all' && styles.summaryCardActive].filter(Boolean).join(' ')}
          onClick={() => { setActiveFilter('all'); setCurrentPage(1); }}
          title={t('customers.viewAllCustomers', 'Click to view all customers')}
        >
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>
              {effectiveScope === 'retail' ? t('customers.retailCustomers', 'Retail Customers') : effectiveScope === 'shop' ? t('customers.b2bShops', 'B2B Shops') : t('customers.totalAccounts', 'Total Accounts')}
            </span>
            <div className={[styles.summaryIconWrap, styles.iconTotal].join(' ')}><Users size={16} /></div>
          </div>
          <p className={styles.summaryValue}>{metrics.total}</p>
          <p className={styles.summarySub}>
            {effectiveScope === 'retail'
              ? `${metrics.repeat} ${t('customers.repeat', 'repeat')} · ${metrics.totalRepairsCount} ${t('customers.repairs', 'repairs')} · ${metrics.totalPhonesTracked} ${t('customers.devices', 'devices')}`
              : effectiveScope === 'shop'
              ? `${metrics.repeat} ${t('customers.activeWorkshops', 'active workshops')} · ${metrics.totalRepairsCount} ${t('customers.repairs', 'repairs')}`
              : t('customers.b2bStats', 'B2B · {{repairs}} repairs · {{devices}} devices', { repairs: metrics.totalRepairsCount, devices: metrics.totalPhonesTracked })}
          </p>
        </div>

        {/* Overdue Debts KPI Card */}
        {permissions.customers_debt && (
          <div
            className={[
              styles.summaryCard,
              activeFilter === 'overdue' && styles.summaryCardActive
            ].filter(Boolean).join(' ')}
            onClick={() => { setActiveFilter(activeFilter === 'overdue' ? 'all' : 'overdue'); setCurrentPage(1); }}
            title={t('customers.filterOverdueTooltip', 'Click to filter customers with OVERDUE debts')}
            style={metrics.overdueCount > 0 ? { borderColor: '#fca5a5', background: '#fff5f5' } : undefined}
          >
            <div className={styles.summaryCardTop}>
              <span className={styles.summaryLabel} style={{ color: metrics.overdueCount > 0 ? '#b91c1c' : undefined, fontWeight: 700 }}>
                🔴 {t('customers.overdueDebts', 'Overdue Debts')}
              </span>
              <div className={[styles.summaryIconWrap, styles.iconOverdue].join(' ')}><AlertTriangle size={16} /></div>
            </div>
            <p className={styles.summaryValue} style={{ color: metrics.overdueCount > 0 ? '#dc2626' : '#64748b' }}>
              {formatPrivateCurrency(metrics.overdueTotalAmount)}
            </p>
            <p className={styles.summarySub} style={{ color: metrics.overdueCount > 0 ? '#b91c1c' : '#64748b', fontWeight: 600 }}>
              {t('customers.overdueRecordsCount', '{{customers}} customer(s) ({{records}} record(s))', { customers: metrics.overdueCount, records: metrics.totalOverdueDebtsCount })}
            </p>
          </div>
        )}

        {permissions.customers_debt && (
          <div
            className={[styles.summaryCard, activeFilter === 'debt' && styles.summaryCardActive].filter(Boolean).join(' ')}
            onClick={() => { setActiveFilter(activeFilter === 'debt' ? 'all' : 'debt'); setCurrentPage(1); }}
            title={t('customers.filterDebtTooltip', 'Click to filter customers with unpaid debt tabs')}
            style={metrics.totalDebt > 0 ? { borderColor: '#fed7aa' } : undefined}
          >
            <div className={styles.summaryCardTop}>
              <span className={styles.summaryLabel} style={{ color: metrics.totalDebt > 0 ? '#d97706' : undefined }}>
                {t('customers.totalOutstanding', 'Total Outstanding')}
              </span>
              <div className={[styles.summaryIconWrap, styles.iconDebt].join(' ')}><BookOpen size={16} /></div>
            </div>
            <p className={styles.summaryValue} style={{ color: metrics.totalDebt > 0 ? '#d97706' : '#64748b' }}>
              {formatPrivateCurrency(metrics.totalDebt)}
            </p>
            <p className={styles.summarySub}>
              {t('customers.customersWithActiveTab', '{{count}} customer(s) with active tab', { count: metrics.withDebt })}
            </p>
          </div>
        )}

        <div
          className={[styles.summaryCard, activeFilter === 'repeat' && styles.summaryCardActive].filter(Boolean).join(' ')}
          onClick={() => { setActiveFilter(activeFilter === 'repeat' ? 'all' : 'repeat'); setCurrentPage(1); }}
          title={t('customers.filterRepeatTooltip', 'Click to filter repeat customers')}
        >
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>{t('customers.repeatBuyers', 'Repeat Buyers')}</span>
            <div className={[styles.summaryIconWrap, styles.iconRepeat].join(' ')}><RefreshCw size={16} /></div>
          </div>
          <p className={styles.summaryValue} style={{ color: '#16a34a' }}>{metrics.repeat}</p>
          <p className={styles.summarySub}>{t('customers.retentionRate', '{{rate}}% retention rate', { rate: metrics.total > 0 ? ((metrics.repeat / metrics.total) * 100).toFixed(0) : 0 })}</p>
        </div>

        <div className={styles.summaryCard} style={{ cursor: 'default' }}>
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>{t('customers.lifetimeValue', 'Lifetime Value')}</span>
            <div className={[styles.summaryIconWrap, styles.iconLtv].join(' ')}><DollarSign size={16} /></div>
          </div>
          <p className={styles.summaryValue}>{formatPrivateCurrency(metrics.totalLtv)}</p>
          <p className={styles.summarySub}>{t('customers.avgRevenuePerClient', 'Avg {{amount}} / client', { amount: formatPrivateCurrency(metrics.avgRevenue) })}</p>
        </div>
      </div>
    </>
  );
};
