import React from 'react';
import { DollarSign, TrendingUp, Package, ShoppingBag, Wrench, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface ReportSummaryCardsProps {
  data: ReportData;
}

/** Format margin as a coloured badge string */
const marginPct = (profit: number, revenue: number) =>
  revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0';

export const ReportSummaryCards: React.FC<ReportSummaryCardsProps> = ({ data }) => {
  const { t } = useTranslation();
  const fs = data.financialSummary;

  // Per-stream profits (derived from report totals)
  const posProfit   = fs.productSalesRevenue - fs.salesCOGS;
  const repProfit   = fs.repairRevenue - fs.repairsCOGS;
  const partsProfit = fs.partsSalesRevenue - fs.partsCOGS;

  return (
    <>
      {/* ── ROW 1: 4 executive KPI cards ──────────────────────── */}
      <div className={styles.kpiGrid}>

        {/* Total Revenue */}
        <div className={[styles.kpiCard, styles.kpiRevenue].join(' ')}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>{t('reports.grossRevenue', 'Total Revenue')}</span>
            <div className={styles.kpiIcon}><DollarSign size={16} /></div>
          </div>
          <div className={styles.kpiValue}>{formatPrivateCurrency(fs.grossRevenue)}</div>
          <div className={styles.kpiSubtext}>
            <span>POS: {formatPrivateCurrency(fs.productSalesRevenue)}</span>
            <span>•</span>
            <span>Repairs: {formatPrivateCurrency(fs.repairRevenue)}</span>
            {fs.partsSalesRevenue > 0 && (
              <><span>•</span><span>Parts: {formatPrivateCurrency(fs.partsSalesRevenue)}</span></>
            )}
          </div>
        </div>

        {/* Net Profit */}
        <div className={[styles.kpiCard, styles.kpiNetProfit].join(' ')}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>{t('reports.netProfit', 'Net Profit (Benefit)')}</span>
            <div className={styles.kpiIcon}><TrendingUp size={16} /></div>
          </div>
          <div className={styles.kpiValue}>{formatPrivateCurrency(fs.grossProfit)}</div>
          <div className={styles.kpiSubtext}>
            <span className={fs.profitMarginPercent >= 0 ? styles.badgeSuccess : styles.badgeDanger}>
              {fs.profitMarginPercent}% {t('reports.profitMargin', 'Margin')}
            </span>
            <span>After COGS &amp; parts</span>
          </div>
        </div>

        {/* Total COGS */}
        <div className={[styles.kpiCard, styles.kpiCost].join(' ')}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>{t('reports.totalCOGS', 'Total Cost (COGS)')}</span>
            <div className={styles.kpiIcon}><Package size={16} /></div>
          </div>
          <div className={styles.kpiValue}>{formatPrivateCurrency(fs.totalCOGS)}</div>
          <div className={styles.kpiSubtext}>
            <span>Items: {formatPrivateCurrency(fs.salesCOGS)}</span>
            <span>•</span>
            <span>Repair Parts: {formatPrivateCurrency(fs.repairsCOGS)}</span>
            {fs.partsCOGS > 0 && (
              <><span>•</span><span>B2B: {formatPrivateCurrency(fs.partsCOGS)}</span></>
            )}
          </div>
        </div>

        {/* Activity Volume — replaces misleading "Orders & Activity" single number */}
        <div className={[styles.kpiCard, styles.kpiOrders].join(' ')}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Activity Volume</span>
            <div className={styles.kpiIcon}><ShoppingBag size={16} /></div>
          </div>
          <div className={styles.kpiActivityList}>
            <div className={styles.kpiActivityRow}>
              <span>🛍️ POS Sales</span>
              <strong>{fs.completedSalesCount} sales · {fs.totalUnitsSold} units</strong>
            </div>
            <div className={styles.kpiActivityRow}>
              <span>🔧 Repairs</span>
              <strong>{fs.completedRepairsCount} completed</strong>
            </div>
            {(fs.partsSalesCount || 0) > 0 && (
              <div className={styles.kpiActivityRow}>
                <span>📦 Parts B2B</span>
                <strong>{fs.partsSalesCount} invoices</strong>
              </div>
            )}
            {fs.averageOrderValue > 0 && (
              <div className={styles.kpiActivityRow} style={{ marginTop: 4, borderTop: '1px solid var(--color-outline-variant)', paddingTop: 4 }}>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Avg. Ticket</span>
                <strong>{formatPrivateCurrency(fs.averageOrderValue)}</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ROW 2: Income breakdown (3 stream cards) ──────────── */}
      <div>
        <p className={styles.breakdownSectionTitle}>📈 Income Breakdown by Stream</p>
        <div className={styles.streamBreakdownGrid}>

          {/* POS Sales Income */}
          <div className={styles.streamCard}>
            <div className={styles.streamCardTop}>
              <div className={[styles.streamIcon, styles.streamIconPos].join(' ')}><ShoppingBag size={15} /></div>
              <span className={[
                styles.streamMarginBadge,
                posProfit >= 0 ? styles.streamMarginPos : styles.streamMarginNeg,
              ].join(' ')}>
                {marginPct(posProfit, fs.productSalesRevenue)}% margin
              </span>
            </div>
            <div className={styles.streamRevenue}>{formatPrivateCurrency(fs.productSalesRevenue)}</div>
            <div className={styles.streamLabel}>POS Sales Income</div>
            <div className={styles.streamMeta}>
              <span>COGS: {formatPrivateCurrency(fs.salesCOGS)}</span>
              <span className={posProfit >= 0 ? styles.streamProfitPos : styles.streamProfitNeg}>
                Profit: {posProfit >= 0 ? '+' : ''}{formatPrivateCurrency(posProfit)}
              </span>
            </div>
          </div>

          {/* Repairs Income */}
          <div className={styles.streamCard}>
            <div className={styles.streamCardTop}>
              <div className={[styles.streamIcon, styles.streamIconRepairs].join(' ')}><Wrench size={15} /></div>
              <span className={[
                styles.streamMarginBadge,
                repProfit >= 0 ? styles.streamMarginPos : styles.streamMarginNeg,
              ].join(' ')}>
                {marginPct(repProfit, fs.repairRevenue)}% margin
              </span>
            </div>
            <div className={styles.streamRevenue}>{formatPrivateCurrency(fs.repairRevenue)}</div>
            <div className={styles.streamLabel}>Repairs Income</div>
            <div className={styles.streamMeta}>
              <span>Parts used: {formatPrivateCurrency(fs.repairsCOGS)}</span>
              <span className={repProfit >= 0 ? styles.streamProfitPos : styles.streamProfitNeg}>
                Profit: {repProfit >= 0 ? '+' : ''}{formatPrivateCurrency(repProfit)}
              </span>
            </div>
          </div>

          {/* Parts B2B Income */}
          <div className={styles.streamCard}>
            <div className={styles.streamCardTop}>
              <div className={[styles.streamIcon, styles.streamIconParts].join(' ')}><ReceiptText size={15} /></div>
              <span className={[
                styles.streamMarginBadge,
                partsProfit >= 0 ? styles.streamMarginPos : styles.streamMarginNeg,
              ].join(' ')}>
                {marginPct(partsProfit, fs.partsSalesRevenue)}% margin
              </span>
            </div>
            <div className={styles.streamRevenue}>{formatPrivateCurrency(fs.partsSalesRevenue)}</div>
            <div className={styles.streamLabel}>Parts B2B Income</div>
            <div className={styles.streamMeta}>
              <span>COGS: {formatPrivateCurrency(fs.partsCOGS)}</span>
              <span className={partsProfit >= 0 ? styles.streamProfitPos : styles.streamProfitNeg}>
                Profit: {partsProfit >= 0 ? '+' : ''}{formatPrivateCurrency(partsProfit)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
