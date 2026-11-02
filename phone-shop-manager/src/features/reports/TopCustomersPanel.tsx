import React from 'react';
import { Users } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface TopCustomersPanelProps {
  data: ReportData;
}

export const TopCustomersPanel: React.FC<TopCustomersPanelProps> = ({ data }) => {
  const { t } = useTranslation();

  return (
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
                <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} data-col="spent">
                  <strong>{formatPrivateCurrency(c.totalSpent)}</strong>
                </td>
                <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatPrivateCurrency(c.averageOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
