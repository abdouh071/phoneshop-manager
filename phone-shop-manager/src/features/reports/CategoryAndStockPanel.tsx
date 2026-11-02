import React from 'react';
import { Tag, Package } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface CategoryAndStockPanelProps {
  data: ReportData;
}

export const CategoryAndStockPanel: React.FC<CategoryAndStockPanelProps> = ({ data }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Sales by Category */}
      <Card padding="none">
        <div className={styles.cardHeaderWithAction}>
          <h3 className={styles.cardTitle}><Tag size={18} /> Sales by Category</h3>
        </div>
        <div className={styles.categoryList}>
          {data.salesByCategory.length === 0 ? (
            <p style={{ padding: '16px', color: 'var(--color-on-surface-variant)', fontSize: '13px', textAlign: 'center' }}>
              No category sales in this period.
            </p>
          ) : (
            data.salesByCategory.map(cat => (
              <div key={cat.category} className={styles.categoryItem}>
                <div className={styles.categoryHeader}>
                  <span>{cat.label} ({cat.units} units)</span>
                  <span className={styles.fontMono}>{formatCurrency(cat.revenue)} ({cat.percentage}%)</span>
                </div>
                <div className={styles.categoryTrack}>
                  <div className={styles.categoryFill} style={{ width: `${cat.percentage}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Current Inventory Snapshot */}
      <Card padding="none">
        <div className={styles.cardHeaderWithAction}>
          <h3 className={styles.cardTitle}><Package size={18} /> Current Stock Valuation</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Total Units in Stock</div>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>{data.inventoryValuation.totalUnits} units</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Total Stock Cost</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-error)' }}>{formatCurrency(data.inventoryValuation.totalCostValue)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Total Retail Value</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary)' }}>{formatCurrency(data.inventoryValuation.totalRetailValue)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Potential Profit</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-success)' }}>+{formatCurrency(data.inventoryValuation.potentialProfit)}</div>
          </div>
        </div>
      </Card>
    </div>
  );
};
