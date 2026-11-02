import React from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ReportData } from '../../services/reportsService';
import styles from './Reports.module.css';

interface ReportTrendChartProps {
  data: ReportData;
  maxChartRev: number;
}

export const ReportTrendChart: React.FC<ReportTrendChartProps> = ({ data, maxChartRev }) => {
  return (
    <Card>
      <CardHeader 
        title={data.chart.title} 
        subtitle={`Total: ${formatCurrency(data.financialSummary.grossRevenue)} • Profit: ${formatCurrency(data.financialSummary.grossProfit)}`}
      />
      <div className={styles.chartContainer}>
        <div className={styles.barsWrapper}>
          {data.chart.points.map((p, idx) => (
            <div key={idx} className={styles.barCol}>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    height: `${maxChartRev > 0 ? Math.max(4, (p.revenue / maxChartRev) * 100) : 0}%`,
                  }}
                  title={`${p.label}: Revenue ${formatCurrency(p.revenue)} (Profit: ${formatCurrency(p.profit)})`}
                />
              </div>
              <span className={styles.barVal}>{formatCurrency(p.revenue)}</span>
              <span className={styles.barLabel}>{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};
