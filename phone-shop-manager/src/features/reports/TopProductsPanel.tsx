import React from 'react';
import { ShoppingBag, Download } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface TopProductsPanelProps {
  data: ReportData;
  handleExportSalesCSV: () => void;
}

export const TopProductsPanel: React.FC<TopProductsPanelProps> = ({ data, handleExportSalesCSV }) => {
  return (
    <Card padding="none">
      <div className={styles.cardHeaderWithAction}>
        <h3 className={styles.cardTitle}><ShoppingBag size={18} /> Top Selling Products</h3>
        <button 
          className={styles.subFilterBtn} 
          onClick={handleExportSalesCSV}
          title="Export Sales Ledger CSV"
        >
          <Download size={13} /> Export
        </button>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Product</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Units</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Revenue</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Profit</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {data.topProducts.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                  No products sold during this period.
                </td>
              </tr>
            ) : (
              data.topProducts.map(p => (
                <tr key={p.id} className={styles.tr}>
                  <td className={styles.td}>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>SKU: {p.sku}</div>
                  </td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{p.units}</td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(p.revenue)}</td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                    +{formatCurrency(p.profit)}
                  </td>
                  <td className={[styles.td, styles.textRight].join(' ')}>
                    <span className={styles.badgeSuccess}>{p.marginPercent}%</span>
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
