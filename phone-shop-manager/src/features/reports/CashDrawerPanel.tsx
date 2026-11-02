import React from 'react';
import { CreditCard } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface CashDrawerPanelProps {
  data: ReportData;
}

export const CashDrawerPanel: React.FC<CashDrawerPanelProps> = ({ data }) => {
  return (
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
        {(data.paymentBreakdown.transfer || 0) > 0 && (
          <div className={styles.drawerItem}>
            <div className={styles.drawerLabel}>🏦 Bank Transfer</div>
            <div className={styles.drawerAmount}>{formatCurrency(data.paymentBreakdown.transfer || 0)}</div>
          </div>
        )}
        {(data.paymentBreakdown.storeCredit || 0) > 0 && (
          <div className={styles.drawerItem}>
            <div className={styles.drawerLabel}>🎫 Store Credit</div>
            <div className={styles.drawerAmount}>{formatCurrency(data.paymentBreakdown.storeCredit || 0)}</div>
          </div>
        )}
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
  );
};
