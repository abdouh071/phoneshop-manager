import React from 'react';
import { Plus } from 'lucide-react';
import type { PhoneModel } from '../../types';
import type { ProductGroup } from '../../utils/productGrouping';
import { formatCurrency } from '../../utils/formatCurrency';
import { getCategoryIcon } from './posConstants';
import styles from './POS.module.css';

export const ProductListItem: React.FC<{
  group: ProductGroup;
  onAdd: (variant?: PhoneModel) => void;
  onSelectVariant: () => void;
}> = ({ group, onAdd, onSelectVariant }) => {
  const isOutOfStock = group.stockStatus === 'out_of_stock' || group.totalStock <= 0;
  const isLowStock = group.stockStatus === 'low_stock' && !isOutOfStock;
  const hasMultipleVariants = group.variants.length > 1;

  return (
    <div
      className={[styles.denseRow, isOutOfStock && styles.denseRowDisabled].filter(Boolean).join(' ')}
      onClick={() => {
        if (isOutOfStock) return;
        if (hasMultipleVariants) onSelectVariant();
        else onAdd(group.variants[0]);
      }}
    >
      <div className={styles.denseBrandCol}>
        <span className={styles.denseCategoryIcon}>{getCategoryIcon(group.category)}</span>
        <span className={styles.denseBrandName}>{group.name}</span>
      </div>

      <div className={styles.denseTitleCol}>
        <span className={styles.denseProductName}>{group.name} {group.model}</span>
        <span className={styles.denseVariantsSummary}>
          {hasMultipleVariants
            ? `${group.variants.length} Variants (${group.variants.map(v => v.storage || v.color).filter(Boolean).slice(0, 3).join(', ')}${group.variants.length > 3 ? '...' : ''})`
            : [group.variants[0]?.storage, group.variants[0]?.color, group.variants[0]?.sku].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div className={styles.denseStockCol}>
        {isOutOfStock ? (
          <span className={styles.stockPillOut}><span className={styles.stockDotOut} /> Out</span>
        ) : isLowStock ? (
          <span className={styles.stockPillLow}><span className={styles.stockDotLow} /> {group.totalStock} left</span>
        ) : (
          <span className={styles.stockPillIn}><span className={styles.stockDotIn} /> {group.totalStock} left</span>
        )}
      </div>

      <div className={styles.densePriceCol}>
        <span className={styles.densePriceText}>
          {hasMultipleVariants && group.minPrice !== group.maxPrice
            ? `${formatCurrency(group.minPrice)} - ${formatCurrency(group.maxPrice)}`
            : formatCurrency(group.variants[0]?.price || group.minPrice)}
        </span>
      </div>

      <div className={styles.denseActionCol}>
        <button
          type="button"
          className={styles.denseAddBtn}
          disabled={isOutOfStock}
          onClick={(e) => {
            e.stopPropagation();
            if (hasMultipleVariants) onSelectVariant();
            else onAdd(group.variants[0]);
          }}
        >
          <Plus size={14} /> {hasMultipleVariants ? 'Select' : 'Add'}
        </button>
      </div>
    </div>
  );
};
