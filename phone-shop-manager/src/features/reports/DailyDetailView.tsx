import React from 'react';
import {
  Printer, CheckCircle2, Clock, Package, DollarSign, ShoppingBag, Wrench,
  FileText, Moon, AlertTriangle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/formatCurrency';
import type { DailyIncomeDetail } from '../../services/reportsService';
import type { EndOfDayRecord } from '../../services/endOfDayService';
import type { DailyCategoryFilter } from './reportTypes';
import styles from './Reports.module.css';

interface DailyDetailViewProps {
  day: DailyIncomeDetail;
  dailyCategoryFilter: DailyCategoryFilter;
  handlePrintThermalZReport: (day: DailyIncomeDetail) => Promise<void>;
  setSelectedEodRecord: (record: EndOfDayRecord | null) => void;
  setIsEodModalOpen: (open: boolean) => void;
}

export const DailyDetailView: React.FC<DailyDetailViewProps> = ({
  day,
  dailyCategoryFilter,
  handlePrintThermalZReport,
  setSelectedEodRecord,
  setIsEodModalOpen,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Day Status Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: day.isClosed ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
        border: `1px solid ${day.isClosed ? '#bbf7d0' : '#fde68a'}`,
        borderRadius: '10px',
        flexWrap: 'wrap',
        gap: '10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className={day.isClosed ? (day.isAutoClose ? styles.eodBadgeAuto : styles.eodBadgeClosed) : styles.eodBadgeOpen}>
            {day.isClosed ? <CheckCircle2 size={13} /> : <Clock size={13} />}
            {day.isClosed
              ? `Day Sealed ${day.isAutoClose ? '(Auto at 00:00)' : `at ${new Date(day.closedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${day.closedByName}`}`
              : 'Day In Progress (Live Calculations)'}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
            📅 {day.dayLabel} {day.isToday && '(Today)'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={styles.viewSlipBtn}
            onClick={() => handlePrintThermalZReport(day)}
            title={t('reports.printThermalZ', 'Print Thermal Z-Report')}
          >
            <Printer size={13} /> {t('reports.printThermalZ', 'Print Thermal Z-Report')}
          </button>
          {day.isClosed && day.eodRecord ? (
            <button
              type="button"
              className={styles.viewSlipBtn}
              onClick={() => { setSelectedEodRecord(day.eodRecord!); setIsEodModalOpen(true); }}
            >
              <FileText size={13} /> {t('reports.viewEodSlip', 'View Official EOD Report & Slip')}
            </button>
          ) : day.isToday ? (
            <button
              type="button"
              className={styles.closeDayBtn}
              onClick={() => { setSelectedEodRecord(null); setIsEodModalOpen(true); }}
            >
              <Moon size={13} /> {t('reports.declareEod', 'Declare End of Day Now')}
            </button>
          ) : null}
        </div>
      </div>

      {day.isClosed && day.eodDrift?.hasDrift && (
        <div style={{
          padding: '10px 12px',
          background: 'var(--color-warning-container, #fff7ed)',
          border: '1px solid #fdba74',
          borderRadius: '8px',
          fontSize: '12px',
          color: 'var(--color-on-surface-variant)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#c2410c', marginBottom: '6px' }}>
            <AlertTriangle size={14} />
            {t('reports.eodDriftTitle', 'Records changed after this day was sealed')}
          </div>
          <p style={{ margin: '0 0 6px' }}>
            {t('reports.eodDriftLead', 'The sealed figures below are what the day was counted at and stay as reported. These records moved since then:')}
          </p>
          <ul style={{ margin: 0, paddingLeft: '16px', display: 'grid', gap: '2px' }}>
            {day.eodDrift.drifts.map(drift => (
              <li key={drift.field}>
                {t(`reports.eodDriftFields.${drift.field}`, drift.label)}: {formatCurrency(drift.sealed)} → {formatCurrency(drift.live)}{' '}
                <strong style={{ color: drift.delta > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                  ({drift.delta > 0 ? '+' : ''}{formatCurrency(drift.delta)})
                </strong>
              </li>
            ))}
          </ul>
          {day.eodDrift.isLocalOnly && (
            <p style={{ margin: '6px 0 0', fontStyle: 'italic' }}>
              {t('reports.eodDriftLocalOnly', 'This day was sealed while the till was offline, so the report exists only on this device.')}
            </p>
          )}
        </div>
      )}

      {day.notes && (
        <div style={{ padding: '8px 12px', background: 'var(--color-surface-container-low)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          <strong>📝 Closing Remark:</strong> {day.notes}
        </div>
      )}

      {/* Detail Cards (POS, Repairs, Parts B2B & Drawer) */}
      <div className={styles.dayCardGrid}>
        {/* 1. POS Sales Detailed */}
        {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'pos') && (
          <div className={styles.dayCard}>
            <div className={styles.dayCardHeader}>
              <span className={styles.dayCardTitle}>
                <ShoppingBag size={16} color="#4f46e5" /> POS Direct Sales
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#4f46e5', background: '#eef2ff', padding: '2px 7px', borderRadius: '4px' }}>
                {day.salesCount} sale{day.salesCount !== 1 ? 's' : ''}
              </span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Gross Sales Revenue</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.salesGrossRevenue)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Product COGS</span>
              <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.salesCOGS)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Net Sales Profit</span>
              <span className={styles.dayCardValue} style={{ color: day.salesNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 700 }}>
                {day.salesNetProfit >= 0 ? '+' : ''}{formatCurrency(day.salesNetProfit)}
              </span>
            </div>
            <div className={styles.dayCardDivider} />
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>💵 Cash Collected</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.salesCash)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>💳 Card Payments</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.salesCard)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>📱 Mobile / BaridiMob</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.salesMobile)}</span>
            </div>
            {day.salesDebt > 0 && (
              <div className={styles.dayCardRow}>
                <span className={styles.dayCardLabel} style={{ color: 'var(--color-warning)' }}>⚠️ On Credit (Dette tab)</span>
                <span className={styles.dayCardValue} style={{ color: 'var(--color-warning)' }}>{formatCurrency(day.salesDebt)}</span>
              </div>
            )}
          </div>
        )}

        {/* 2. Workshop Repairs Detailed */}
        {(dailyCategoryFilter === 'all' || dailyCategoryFilter === 'repairs') && (
          <div className={styles.dayCard}>
            <div className={styles.dayCardHeader}>
              <span className={styles.dayCardTitle}>
                <Wrench size={16} color="#d97706" /> Workshop Repairs
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '2px 7px', borderRadius: '4px' }}>
                {day.repairsCompletedCount} completed
              </span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Repair Services Revenue</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.repairsRevenue)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Spare Parts Used (Cost)</span>
              <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.repairsPartsCost)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Net Repair Profit</span>
              <span className={styles.dayCardValue} style={{ color: day.repairsNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 700 }}>
                {day.repairsNetProfit >= 0 ? '+' : ''}{formatCurrency(day.repairsNetProfit)}
              </span>
            </div>
            <div className={styles.dayCardDivider} />
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>💵 Handover Collections</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.repairsCashHandovers)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>↳ Intake Phone Deposits</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.repairsCashDeposits)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Total Repair Cash</span>
              <span className={styles.dayCardValue} style={{ fontWeight: 700 }}>{formatCurrency(day.repairsCashTotal)}</span>
            </div>
            {day.repairsDebt > 0 && (
              <div className={styles.dayCardRow}>
                <span className={styles.dayCardLabel} style={{ color: 'var(--color-error)' }}>⚠️ Unpaid Repair Debt</span>
                <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>{formatCurrency(day.repairsDebt)}</span>
              </div>
            )}
          </div>
        )}

        {/* 2.5. Parts B2B Wholesale Detailed */}
        {((dailyCategoryFilter === 'all' && ((day.partsRevenue || 0) > 0 || (day.partsCount || 0) > 0)) || dailyCategoryFilter === 'parts') && (
          <div className={styles.dayCard}>
            <div className={styles.dayCardHeader}>
              <span className={styles.dayCardTitle}>
                <Package size={16} color="#0284c7" /> Parts B2B Wholesale
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#0284c7', background: '#e0f2fe', padding: '2px 7px', borderRadius: '4px' }}>
                {day.partsCount || 0} invoice{(day.partsCount || 0) !== 1 ? 's' : ''}
              </span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Parts Sales Revenue</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.partsRevenue)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Spare Parts Cost (COGS)</span>
              <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.partsCOGS || 0)}</span>
            </div>
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Net Parts Profit</span>
              <span className={styles.dayCardValue} style={{ color: (day.partsNetProfit || 0) >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 700 }}>
                {(day.partsNetProfit || 0) >= 0 ? '+' : ''}{formatCurrency(day.partsNetProfit || 0)}
              </span>
            </div>
            <div className={styles.dayCardDivider} />
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>💵 Cash Collected</span>
              <span className={styles.dayCardValue} style={{ fontWeight: 700 }}>{formatCurrency(day.partsCash || 0)}</span>
            </div>
          </div>
        )}

        {/* 3. Reconciled Drawer Cash & Profit */}
        <div className={styles.dayCard}>
          <div className={styles.dayCardHeader}>
            <span className={styles.dayCardTitle}>
              <DollarSign size={16} color="#059669" /> Drawer & Total Profit
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#059669', background: '#d1fae5', padding: '2px 7px', borderRadius: '4px' }}>
              Net Verified
            </span>
          </div>
          <div className={styles.dayCardRow}>
            <span className={styles.dayCardLabel}>Combined Day Revenue</span>
            <span className={styles.dayCardValue} style={{ fontSize: '14px', fontWeight: 700 }}>{formatCurrency(day.totalRevenue)}</span>
          </div>
          <div className={styles.dayCardRow}>
            <span className={styles.dayCardLabel}>Combined Day Profit</span>
            <span className={styles.dayCardValue} style={{ fontSize: '14px', fontWeight: 700, color: day.totalNetProfit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
              {day.totalNetProfit >= 0 ? '+' : ''}{formatCurrency(day.totalNetProfit)}
            </span>
          </div>
          <div className={styles.dayCardDivider} />
          <div className={styles.dayCardRow}>
            <span className={styles.dayCardLabel}>POS Cash in Till</span>
            <span className={styles.dayCardValue}>{formatCurrency(day.salesCash)}</span>
          </div>
          <div className={styles.dayCardRow}>
            <span className={styles.dayCardLabel}>Repairs Cash in Till</span>
            <span className={styles.dayCardValue}>{formatCurrency(day.repairsCashTotal)}</span>
          </div>
          {(day.partsCash || 0) > 0 && (
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Parts B2B Cash in Till</span>
              <span className={styles.dayCardValue}>{formatCurrency(day.partsCash || 0)}</span>
            </div>
          )}
          {day.debtCollectedCash > 0 && (
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Old Debt Paid in Cash</span>
              <span className={styles.dayCardValue} style={{ color: 'var(--color-success)' }}>+{formatCurrency(day.debtCollectedCash)}</span>
            </div>
          )}
          {day.refundsCash > 0 && (
            <div className={styles.dayCardRow}>
              <span className={styles.dayCardLabel}>Cash Refunds Paid</span>
              <span className={styles.dayCardValue} style={{ color: 'var(--color-error)' }}>-{formatCurrency(day.refundsCash)}</span>
            </div>
          )}
          <div className={styles.dayCardDivider} />
          <div className={styles.dayCardRow} style={{ background: '#f0fdf4', padding: '6px 8px', borderRadius: '6px' }}>
            <span style={{ fontWeight: 700, color: '#166534' }}>💰 Total Physical Cash</span>
            <span style={{ fontWeight: 700, fontSize: '15px', color: '#15803d' }}>{formatCurrency(day.totalPhysicalCash)}</span>
          </div>
        </div>
      </div>
    </>
  );
};
