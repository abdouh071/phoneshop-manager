import React from 'react';
import { CheckCircle2, Clock, FileText, Moon } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import type { EndOfDayRecord } from '../../services/endOfDayService';
import type { DailyCategoryFilter } from './reportTypes';
import styles from './Reports.module.css';

interface MultiDayIncomeTableProps {
  data: ReportData;
  dailyCategoryFilter: DailyCategoryFilter;
  setSelectedEodRecord: (record: EndOfDayRecord | null) => void;
  setIsEodModalOpen: (open: boolean) => void;
}

export const MultiDayIncomeTable: React.FC<MultiDayIncomeTableProps> = ({
  data,
  dailyCategoryFilter,
  setSelectedEodRecord,
  setIsEodModalOpen,
}) => {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Date & Day</th>
            <th className={styles.th}>End-of-Day Status</th>
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
            <th className={[styles.th, styles.textRight].join(' ')}>Physical Cash</th>
            <th className={[styles.th, styles.textRight].join(' ')}>Total Net Profit</th>
            <th className={[styles.th, styles.textRight].join(' ')}>Action</th>
          </tr>
        </thead>
        <tbody>
          {data.dailyIncomeDetails.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                No daily records in this period.
              </td>
            </tr>
          ) : (
            // Render in reverse chronological order (newest first)
            [...data.dailyIncomeDetails].reverse().map(d => (
              <tr key={d.date} className={styles.tr}>
                <td className={styles.td}>
                  <strong>{d.dayLabel}</strong>
                  {d.isToday && (
                    <span style={{ marginLeft: '6px', fontSize: '10px', background: '#e0e7ff', color: '#4338ca', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                      TODAY
                    </span>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{d.date}</div>
                </td>

                <td className={styles.td}>
                  {d.isClosed ? (
                    <span
                      className={d.isAutoClose ? styles.eodBadgeAuto : styles.eodBadgeClosed}
                      title={d.notes ? `Remark: ${d.notes}` : undefined}
                    >
                      <CheckCircle2 size={12} />
                      {d.isAutoClose
                        ? '00:00 Auto'
                        : `Closed ${new Date(d.closedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${d.closedByName || 'User'}`}
                    </span>
                  ) : (
                    <span className={styles.eodBadgeOpen}>
                      <Clock size={12} />
                      {d.isToday ? 'Live / Open' : 'Not Closed'}
                    </span>
                  )}
                </td>

                {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                  <>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      {formatCurrency(d.salesGrossRevenue)}
                      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{d.salesCount} sale{d.salesCount !== 1 ? 's' : ''}</div>
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: d.salesNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {d.salesNetProfit >= 0 ? '+' : ''}{formatCurrency(d.salesNetProfit)}
                    </td>
                  </>
                )}

                {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                  <>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      {formatCurrency(d.repairsRevenue)}
                      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{d.repairsCompletedCount} repair{d.repairsCompletedCount !== 1 ? 's' : ''}</div>
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: d.repairsNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {d.repairsNetProfit >= 0 ? '+' : ''}{formatCurrency(d.repairsNetProfit)}
                    </td>
                  </>
                )}

                {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'parts') && (
                  <>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      {formatCurrency(d.partsRevenue)}
                      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{d.partsCount || 0} invoice{(d.partsCount || 0) !== 1 ? 's' : ''}</div>
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: (d.partsNetProfit || 0) >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {(d.partsNetProfit || 0) >= 0 ? '+' : ''}{formatCurrency(d.partsNetProfit || 0)}
                    </td>
                  </>
                )}

                <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ fontWeight: 600 }}>
                  {formatCurrency(d.totalPhysicalCash)}
                </td>

                <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                  <strong style={{ color: d.totalNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {d.totalNetProfit >= 0 ? '+' : ''}{formatCurrency(d.totalNetProfit)}
                  </strong>
                </td>

                <td className={[styles.td, styles.textRight].join(' ')}>
                  {d.isClosed && d.eodRecord ? (
                    <button
                      type="button"
                      className={styles.viewSlipBtn}
                      onClick={() => { setSelectedEodRecord(d.eodRecord!); setIsEodModalOpen(true); }}
                      title="View official verified End-of-Day slip"
                    >
                      <FileText size={12} /> Slip
                    </button>
                  ) : d.isToday ? (
                    <button
                      type="button"
                      className={styles.closeDayBtn}
                      onClick={() => { setSelectedEodRecord(null); setIsEodModalOpen(true); }}
                      title="Declare End of Day for today"
                    >
                      <Moon size={12} /> Close
                    </button>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
        {data.dailyIncomeDetails.length > 0 && (
          <tfoot>
            <tr style={{ background: 'var(--color-surface-container-low)', fontWeight: 700 }}>
              <td className={styles.td}>Total ({data.dailyIncomeDetails.length} days)</td>
              <td className={styles.td} style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
                {data.dailyIncomeDetails.filter(d => d.isClosed).length} sealed / {data.dailyIncomeDetails.length} total
              </td>
              {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
                <>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                    {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.salesGrossRevenue, 0))}
                  </td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                    +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.salesNetProfit, 0))}
                  </td>
                </>
              )}
              {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
                <>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                    {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.repairsRevenue, 0))}
                  </td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                    +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.repairsNetProfit, 0))}
                  </td>
                </>
              )}
              {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'parts') && (
                <>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                    {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.partsRevenue, 0))}
                  </td>
                  <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-success)' }}>
                    +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + (d.partsNetProfit || 0), 0))}
                  </td>
                </>
              )}
              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                {formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.totalPhysicalCash, 0))}
              </td>
              <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                <strong style={{ color: 'var(--color-success)' }}>
                  +{formatCurrency(data.dailyIncomeDetails.reduce((s, d) => s + d.totalNetProfit, 0))}
                </strong>
              </td>
              <td className={styles.td}></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
