import React from 'react';
import { Wrench } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface RepairBreakdownPanelProps {
  data: ReportData;
}

export const RepairBreakdownPanel: React.FC<RepairBreakdownPanelProps> = ({ data }) => {
  return (
    <Card padding="none">
      <div className={styles.cardHeaderWithAction}>
        <h3 className={styles.cardTitle}><Wrench size={18} /> Repair Services Breakdown</h3>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }}>
          Total: {formatCurrency(data.repairAnalytics.totalRevenue)}
        </span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Issue Type</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Count</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Revenue</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Parts Cost</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {data.repairAnalytics.categories.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                  No repair tickets in this period.
                </td>
              </tr>
            ) : (
              data.repairAnalytics.categories.map(c => (
                <tr key={c.key} className={styles.tr}>
                  <td className={styles.td}><strong>{c.label}</strong></td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{c.count}</td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(c.revenue)}</td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-error)' }}>
                    -{formatCurrency(c.partsCost)}
                  </td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                    +{formatCurrency(c.profit)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
