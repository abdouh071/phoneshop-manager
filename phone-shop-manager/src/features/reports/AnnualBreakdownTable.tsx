import React from 'react';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import type { DailyCategoryFilter } from './reportTypes';
import styles from './Reports.module.css';

interface AnnualBreakdownTableProps {
  data: ReportData;
  selectedYear: number;
  dailyCategoryFilter: DailyCategoryFilter;
}

export const AnnualBreakdownTable: React.FC<AnnualBreakdownTableProps> = ({
  data,
  selectedYear,
  dailyCategoryFilter,
}) => {
  return (
    <div style={{ borderBottom: '1px solid var(--color-outline-variant, #e2e8f0)', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
          🗓️ Annual 12-Month Performance ({selectedYear})
        </h4>
        <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          {data.monthlyBreakdown.reduce((s, m) => s + m.daysClosedCount, 0)} days officially sealed
        </span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Month</th>
              <th className={styles.th}>Days Sealed</th>
              {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                <>
                  <th className={[styles.th, styles.textRight].join(' ')}>POS Revenue</th>
                  <th className={[styles.th, styles.textRight].join(' ')}>POS Profit</th>
                </>
              )}
              {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                <>
                  <th className={[styles.th, styles.textRight].join(' ')}>Repair Revenue</th>
                  <th className={[styles.th, styles.textRight].join(' ')}>Repair Profit</th>
                </>
              )}
              {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'parts') && (
                <>
                  <th className={[styles.th, styles.textRight].join(' ')}>Parts Revenue</th>
                  <th className={[styles.th, styles.textRight].join(' ')}>Parts Profit</th>
                </>
              )}
              <th className={[styles.th, styles.textRight].join(' ')}>Cash in Till</th>
              <th className={[styles.th, styles.textRight].join(' ')}>Total Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {data.monthlyBreakdown.map(m => (
              <tr key={m.monthKey} className={styles.tr}>
                <td className={styles.td}><strong>{m.monthLabel}</strong></td>
                <td className={styles.td}>
                  <span style={{ fontSize: '11.5px', fontWeight: 600, color: m.daysClosedCount > 0 ? '#15803d' : '#94a3b8' }}>
                    {m.daysClosedCount} / {m.daysCount} days sealed
                  </span>
                </td>
                {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                  <>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      {formatCurrency(m.salesGrossRevenue)}
                      <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>{m.salesCount} sales</div>
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                      +{formatCurrency(m.salesNetProfit)}
                    </td>
                  </>
                )}
                {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                  <>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      {formatCurrency(m.repairsRevenue)}
                      <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>{m.repairsCount} repairs</div>
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                      +{formatCurrency(m.repairsNetProfit)}
                    </td>
                  </>
                )}
                {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'parts') && (
                  <>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      {formatCurrency(m.partsRevenue)}
                      <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>{m.partsCount || 0} invoices</div>
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: (m.partsNetProfit || 0) >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {(m.partsNetProfit || 0) >= 0 ? '+' : ''}{formatCurrency(m.partsNetProfit || 0)}
                    </td>
                  </>
                )}
                <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>{formatCurrency(m.totalPhysicalCash)}</td>
                <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                  <strong style={{ color: 'var(--color-success)' }}>+{formatCurrency(m.totalNetProfit)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
