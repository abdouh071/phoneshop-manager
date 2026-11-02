import React from 'react';
import { Download, Plus, RefreshCw, GitMerge, Store } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../../hooks/usePermissions';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import type { Customer } from '../../types';
import type { CustomersMetrics } from './customersPageData';
import type { AdminScope, PageTab } from './customersPageTypes';
import styles from './Customers.module.css';

interface CustomersPageHeaderProps {
  effectiveScope: AdminScope;
  scopedCustomers: Customer[];
  metrics: CustomersMetrics;
  pageTab: PageTab;
  pendingSyncCount: number;
  handleExportCSV: () => void;
  onMergeAccounts: () => void;
  onSyncQueue: () => void;
  onNewWalkInTicket: () => void;
  onAddCustomer: () => void;
}

export const CustomersPageHeader: React.FC<CustomersPageHeaderProps> = ({
  effectiveScope,
  scopedCustomers,
  metrics,
  pageTab,
  pendingSyncCount,
  handleExportCSV,
  onMergeAccounts,
  onSyncQueue,
  onNewWalkInTicket,
  onAddCustomer,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();

  return (
    <>
      {/* Modern Page Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>
            {effectiveScope === 'retail'
              ? t('customers.retailCustomerDirectory', 'Retail Customer Directory')
              : effectiveScope === 'shop'
              ? t('customers.shopAccounts', 'B2B Shops & Parts Accounts')
              : t('customers.customerDirectory', 'Customer Directory')}
            <span className={styles.titleBadge}>{scopedCustomers.length} {t('common.total', 'total')}</span>
          </h1>
          <p className={styles.subtitle}>
            {formatPrivateCurrency(metrics.totalLtv)} {t('customers.totalLifetimeValue', 'total lifetime value')} · {metrics.repeat} {t('customers.repeatBuyers', 'repeat buyers')}
            {permissions.customers_debt && metrics.totalDebt > 0 && ` · ${formatPrivateCurrency(metrics.totalDebt)} ${t('customers.activeCreditBalance', 'active credit balance')}`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            leftIcon={<GitMerge size={16} />}
            onClick={onMergeAccounts}
          >
            {t('customers.mergeCustomers', 'Merge Accounts')}
          </Button>
          {pendingSyncCount > 0 && (
            <Button
              variant="secondary"
              leftIcon={<RefreshCw size={15} />}
              style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a', fontWeight: 600 }}
              onClick={onSyncQueue}
              title={t('customers.offlineSyncTooltip', 'Offline customers are waiting in queue. Click to trigger cloud sync immediately.')}
            >
              {t('customers.syncQueue', 'Sync Queue ({{count}})', { count: pendingSyncCount })}
            </Button>
          )}
          <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExportCSV}>
            {t('common.export', 'Export CSV')}
          </Button>
          {pageTab === 'walkin' ? (
            <Button
              leftIcon={<Plus size={16} />}
              onClick={onNewWalkInTicket}
            >
              {t('ticket.newTicket', 'New Repair Ticket')}
            </Button>
          ) : (
            <Button
              leftIcon={effectiveScope === 'shop' ? <Store size={16} /> : <Plus size={16} />}
              onClick={onAddCustomer}
            >
              {effectiveScope === 'shop'
                ? t('customers.addCustomer', 'Add Shop / Client')
                : effectiveScope === 'retail'
                ? t('customers.addCustomer', 'Add Retail Customer')
                : t('customers.addCustomer', 'Add Customer')}
            </Button>
          )}
        </div>
      </div>
    </>
  );
};
