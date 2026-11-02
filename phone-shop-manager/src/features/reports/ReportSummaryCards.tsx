import React from 'react';
import { DollarSign, TrendingUp, Package, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface ReportSummaryCardsProps {
  data: ReportData;
}

export const ReportSummaryCards: React.FC<ReportSummaryCardsProps> = ({ data }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.kpiGrid}>
      <div className={[styles.kpiCard, styles.kpiRevenue].join(' ')}>
        <div className={styles.kpiTop}>
          <span className={styles.kpiLabel}>{t('reports.grossRevenue', 'Gross Revenue')}</span>
          <div className={styles.kpiIcon}><DollarSign size={16} /></div>
        </div>
        <div className={styles.kpiValue}>{formatPrivateCurrency(data.financialSummary.grossRevenue)}</div>
        <div className={styles.kpiSubtext}>
          <span>Sales: {formatPrivateCurrency(data.financialSummary.productSalesRevenue)}</span>
          <span>•</span>
          <span>Repairs: {formatPrivateCurrency(data.financialSummary.repairRevenue)}</span>
          {data.financialSummary.partsSalesRevenue > 0 && (
            <>
              <span>•</span>
              <span>Parts: {formatPrivateCurrency(data.financialSummary.partsSalesRevenue)}</span>
            </>
          )}
        </div>
      </div>

      <div className={[styles.kpiCard, styles.kpiNetProfit].join(' ')}>
        <div className={styles.kpiTop}>
          <span className={styles.kpiLabel}>{t('reports.netProfit', 'Net Profit')}</span>
          <div className={styles.kpiIcon}><TrendingUp size={16} /></div>
        </div>
        <div className={styles.kpiValue}>{formatPrivateCurrency(data.financialSummary.grossProfit)}</div>
        <div className={styles.kpiSubtext}>
          <span className={data.financialSummary.profitMarginPercent >= 0 ? styles.badgeSuccess : styles.badgeDanger}>
            {data.financialSummary.profitMarginPercent}% {t('reports.profitMargin', 'Margin')}
          </span>
          <span>After COGS & parts</span>
        </div>
      </div>

      <div className={[styles.kpiCard, styles.kpiCost].join(' ')}>
        <div className={styles.kpiTop}>
          <span className={styles.kpiLabel}>{t('reports.totalCOGS', 'Total Cost (COGS)')}</span>
          <div className={styles.kpiIcon}><Package size={16} /></div>
        </div>
        <div className={styles.kpiValue}>{formatPrivateCurrency(data.financialSummary.totalCOGS)}</div>
        <div className={styles.kpiSubtext}>
          <span>Items: {formatPrivateCurrency(data.financialSummary.salesCOGS)}</span>
          <span>•</span>
          <span>Repair Parts: {formatPrivateCurrency(data.financialSummary.repairsCOGS)}</span>
          {data.financialSummary.partsCOGS > 0 && (
            <>
              <span>•</span>
              <span>B2B Parts: {formatPrivateCurrency(data.financialSummary.partsCOGS)}</span>
            </>
          )}
        </div>
      </div>

      <div className={[styles.kpiCard, styles.kpiOrders].join(' ')}>
        <div className={styles.kpiTop}>
          <span className={styles.kpiLabel}>Orders & Activity</span>
          <div className={styles.kpiIcon}><ShoppingBag size={16} /></div>
        </div>
        <div className={styles.kpiValue}>
          {data.financialSummary.completedSalesCount + data.financialSummary.completedRepairsCount + (data.financialSummary.partsSalesCount || 0)}
        </div>
        <div className={styles.kpiSubtext}>
          <span>{data.financialSummary.totalUnitsSold} items sold</span>
          <span>•</span>
          <span>{data.financialSummary.completedRepairsCount} repairs</span>
          {(data.financialSummary.partsSalesCount || 0) > 0 && (
            <>
              <span>•</span>
              <span>{data.financialSummary.partsSalesCount} parts inv</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
