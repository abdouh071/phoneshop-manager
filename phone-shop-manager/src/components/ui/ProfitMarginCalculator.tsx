import React from 'react';
import { Calculator, TrendingUp, AlertCircle, Sparkles, Package } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import styles from './ProfitMarginCalculator.module.css';

interface ProfitMarginCalculatorProps {
  costPrice: number | string;
  sellPrice: number | string;
  stock?: number | string;
  onApplySellPrice?: (suggestedPrice: number) => void;
}

export const ProfitMarginCalculator: React.FC<ProfitMarginCalculatorProps> = ({
  costPrice,
  sellPrice,
  stock,
  onApplySellPrice,
}) => {
  const cost = Number(costPrice) || 0;
  const price = Number(sellPrice) || 0;
  const stockQty = Number(stock) || 0;

  if (cost <= 0 && price <= 0) return null;

  const profit = price - cost;
  const marginPercent = price > 0 ? (profit / price) * 100 : 0;
  const markupPercent = cost > 0 ? (profit / cost) * 100 : 0;
  const isProfitable = profit >= 0;

  const getHealthBadge = () => {
    if (profit < 0) {
      return <span className={[styles.healthBadge, styles.badgeLoss].join(' ')}>🚨 Loss</span>;
    }
    if (profit === 0) {
      return <span className={[styles.healthBadge, styles.badgeLow].join(' ')}>⚠️ Break Even</span>;
    }
    if (marginPercent >= 40) {
      return <span className={[styles.healthBadge, styles.badgeHigh].join(' ')}>🔥 High Profit</span>;
    }
    if (marginPercent >= 20) {
      return <span className={[styles.healthBadge, styles.badgeHealthy].join(' ')}>✅ Healthy Margin</span>;
    }
    return <span className={[styles.healthBadge, styles.badgeLow].join(' ')}>⚠️ Low Margin</span>;
  };

  const applyMarkup = (percent: number) => {
    if (!onApplySellPrice || cost <= 0) return;
    const targetPrice = Math.round(cost * (1 + percent / 100));
    onApplySellPrice(targetPrice);
  };

  return (
    <div className={[styles.calcCard, isProfitable ? styles.calcCardProfit : styles.calcCardLoss].join(' ')}>
      {/* Header */}
      <div className={styles.calcHeader}>
        <div className={styles.headerTitle}>
          <Calculator size={13} color="#4f46e5" />
          <span>Live Profit & Margin Breakdown</span>
        </div>
        {getHealthBadge()}
      </div>

      {/* Metrics Grid */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>Net Profit / Unit</span>
          <span className={[styles.metricValue, isProfitable ? styles.valueProfit : styles.valueLoss].join(' ')}>
            {isProfitable ? '+' : ''}{formatCurrency(profit)}
          </span>
        </div>

        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>Profit Margin</span>
          <span className={[styles.metricValue, isProfitable ? styles.valueProfit : styles.valueLoss].join(' ')}>
            {marginPercent.toFixed(1)}%
          </span>
        </div>

        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>Markup on Cost</span>
          <span className={styles.metricValue} style={{ color: '#4338ca' }}>
            {markupPercent >= 0 ? '+' : ''}{markupPercent.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Batch Projection if stock > 0 */}
      {stockQty > 0 && cost > 0 && price > 0 && (
        <div className={styles.batchStrip}>
          <span>📦 Batch ({stockQty} units):</span>
          <span>Revenue: {formatCurrency(price * stockQty)}</span>
          <span style={{ color: profit >= 0 ? '#059669' : '#dc2626' }}>
            Total Net: {profit >= 0 ? '+' : ''}{formatCurrency(profit * stockQty)}
          </span>
        </div>
      )}

      {/* Quick Markup Suggestions */}
      {onApplySellPrice && cost > 0 && (
        <div className={styles.presetRow}>
          <span className={styles.presetLabel}>⚡ Quick Markup:</span>
          {[25, 40, 60, 100].map(pct => (
            <button
              key={pct}
              type="button"
              className={styles.presetBtn}
              onClick={() => applyMarkup(pct)}
              title={`Set sell price to cost +${pct}%`}
            >
              +{pct}% ({formatCurrency(Math.round(cost * (1 + pct / 100)))})
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
