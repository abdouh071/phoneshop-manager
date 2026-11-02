import React from 'react';
import type { Customer, RepairTicket } from '../../types';
import type { CustomerFinancialStats } from '../../utils/customerFinancials';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import styles from './CustomerProfile.module.css';

interface CustomerProfileKpiSummaryProps {
  customer: Customer;
  customerFinancials: CustomerFinancialStats;
  customerTickets: RepairTicket[];
}

export const CustomerProfileKpiSummary: React.FC<CustomerProfileKpiSummaryProps> = ({
  customer,
  customerFinancials,
  customerTickets,
}) => {
  const { t } = useTranslation();

  return (
          <div className={styles.stats}>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>{t('common.totalSpent', 'Total Spent')}</span>
              <span className={styles.statValue}>{formatPrivateCurrency(customerFinancials.totalSpent)}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>{t('common.orders', 'Orders')}</span>
              <span className={styles.statValue}>{customerFinancials.totalPurchases}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>{t('common.repairs', 'Repairs')}</span>
              <span className={styles.statValue}>{customerTickets.length}</span>
            </div>
            <div className={styles.statBox} style={{ background: customerFinancials.totalDebt > 0 ? '#fef2f2' : undefined, borderColor: customerFinancials.totalDebt > 0 ? '#fecaca' : undefined }}>
              <span className={styles.statLabel} style={{ color: customerFinancials.totalDebt > 0 ? '#991b1b' : undefined }}>{t('common.debtBalance', 'Debt Balance')}</span>
              <span className={styles.statValue} style={{ color: customerFinancials.totalDebt > 0 ? '#dc2626' : undefined }}>
                {formatPrivateCurrency(customerFinancials.totalDebt)}
              </span>
            </div>
            {(customer.storeCredit || 0) > 0 && (
              <div className={styles.statBox} style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                <span className={styles.statLabel} style={{ color: '#065f46' }}>🎟️ {t('common.storeCredit', 'Store Credit (Avoir)')}</span>
                <span className={styles.statValue} style={{ color: '#059669' }}>
                  {formatPrivateCurrency(customer.storeCredit || 0)}
                </span>
              </div>
            )}
          </div>
  );
};
