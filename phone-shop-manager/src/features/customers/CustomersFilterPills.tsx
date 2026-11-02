import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../../hooks/usePermissions';
import type { CustomersMetrics } from './customersPageData';
import type { AdminScope, CustomerFilter } from './customersPageTypes';
import styles from './Customers.module.css';

interface CustomersFilterPillsProps {
  metrics: CustomersMetrics;
  activeFilter: CustomerFilter;
  setActiveFilter: React.Dispatch<React.SetStateAction<CustomerFilter>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  effectiveScope: AdminScope;
}

export const CustomersFilterPills: React.FC<CustomersFilterPillsProps> = ({
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
      {/* Fast Filter Pills */}
      <div className={styles.filterPills}>
        {([
          {
            value: 'all' as CustomerFilter,
            label: effectiveScope === 'shop' ? `🏪 ${t('customers.allShops', 'All Shops')}` : effectiveScope === 'retail' ? `👤 ${t('customers.allRetailClients', 'All Retail Clients')}` : `👥 ${t('customers.allAccounts', 'All Accounts')}`,
            count: metrics.total
          },
          ...(effectiveScope === 'all'
            ? [{ value: 'b2b' as CustomerFilter, label: `🏪 ${t('customers.shopsB2BFilter', 'Shops / B2B')}`, count: metrics.b2b }]
            : []),
          ...(permissions.customers_debt ? [
            { value: 'overdue' as CustomerFilter, label: `🔴 ${t('customers.overdueDebts', 'Overdue Debts')}`, count: metrics.overdueCount, highlight: metrics.overdueCount > 0 },
            { value: 'debt' as CustomerFilter, label: `📒 ${t('customers.filterDebtTabs', 'All Debt Tabs')}`, count: metrics.withDebt }
          ] : []),
          { value: 'repeat' as CustomerFilter, label: `🔄 ${t('customers.repeatVisits', 'Repeat (2+ Visits)')}`, count: metrics.repeat },
          { value: 'new' as CustomerFilter, label: `🌱 ${t('customers.newClients', 'New Clients')}`, count: metrics.new },
          { value: 'recent' as CustomerFilter, label: `🕒 ${t('customers.recentDays', 'Recent (30 Days)')}`, count: metrics.recent },
        ]).map(pill => (
          <button
            key={pill.value}
            type="button"
            className={[
              styles.filterPill,
              activeFilter === pill.value && styles.filterPillActive,
              pill.highlight && activeFilter !== pill.value ? styles.filterPillOverdue : ''
            ].filter(Boolean).join(' ')}
            onClick={() => { setActiveFilter(pill.value); setCurrentPage(1); }}
            style={pill.highlight && activeFilter !== pill.value ? { borderColor: '#fca5a5', color: '#dc2626' } : {}}
          >
            <span>{pill.label}</span>
            <span
              className={styles.pillCount}
              style={pill.highlight && activeFilter !== pill.value ? { background: '#fee2e2', color: '#dc2626' } : {}}
            >
              {pill.count}
            </span>
          </button>
        ))}
      </div>
    </>
  );
};
