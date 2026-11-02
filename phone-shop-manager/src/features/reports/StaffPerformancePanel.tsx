import React from 'react';
import { Users } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface StaffPerformancePanelProps {
  data: ReportData;
}

export const StaffPerformancePanel: React.FC<StaffPerformancePanelProps> = ({ data }) => {
  return (
    <Card padding="none">
      <div className={styles.cardHeaderWithAction}>
        <h3 className={styles.cardTitle}><Users size={18} /> Staff Performance & Sales</h3>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Staff Member</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Sales</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Repairs</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Total Generated</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Avg Ticket</th>
            </tr>
          </thead>
          <tbody>
            {data.staffPerformance.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                  No staff activity recorded in this period.
                </td>
              </tr>
            ) : (
              data.staffPerformance.map(s => (
                <tr key={s.id} className={styles.tr}>
                  <td className={styles.td}><strong>{s.name}</strong></td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{s.salesCount}</td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{s.repairsCount}</td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                    <strong>{formatCurrency(s.totalRevenue)}</strong>
                  </td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(s.averageTicket)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
