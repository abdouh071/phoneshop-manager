import React from 'react';
import { Plus } from 'lucide-react';
import type { PhoneModel } from '../../types';
import type { ProductGroup } from '../../utils/productGrouping';
import { formatCurrency } from '../../utils/formatCurrency';
import { getCategoryIcon } from './posConstants';
import styles from './POS.module.css';

export const ProductCard: React.FC<{
  group: ProductGroup;
  onAdd: (variant?: PhoneModel) => void;
  onSelectVariant: () => void;
}> = ({ group, onAdd, onSelectVariant }) => {
  const isOutOfStock = group.stockStatus === 'out_of_stock' || group.totalStock <= 0;
  const isLowStock = group.stockStatus === 'low_stock' && !isOutOfStock;
  const hasMultipleVariants = group.variants.length > 1;

  return (
    <div
      className={[styles.productCard, isOutOfStock && styles.cardOutOfStock].filter(Boolean).join(' ')}
      onClick={() => {
        if (isOutOfStock) return;
        if (hasMultipleVariants) {
          onSelectVariant();
        } else {
          onAdd(group.variants[0]);
        }
      }}
    >
      {/* Top Header Row: Category Badge + Stock Pill */}
      <div className={styles.cardHeaderRow}>
        <span className={styles.categoryPill}>
          <span className={styles.categoryIcon}>{getCategoryIcon(group.category)}</span>
          <span className={styles.categoryName}>{group.name}</span>
        </span>

        {isOutOfStock ? (
          <span className={styles.stockPillOut}>
            <span className={styles.stockDotOut} /> Out
          </span>
        ) : isLowStock ? (
          <span className={styles.stockPillLow}>
            <span className={styles.stockDotLow} /> {group.totalStock} left
          </span>
        ) : (
          <span className={styles.stockPillIn}>
            <span className={styles.stockDotIn} /> {group.totalStock} left
          </span>
        )}
      </div>

      {/* Main Info */}
      <div className={styles.cardBody}>
        <h4 className={styles.productCardName}>{group.name} {group.model}</h4>

        {/* Variants display / mini-chips */}
        <div className={styles.variantChipsContainer}>
          {hasMultipleVariants ? (
            <div className={styles.multiVariantRow}>
              {group.variants.slice(0, 3).map((v, i) => (
                <button
                  key={v.id || i}
                  type="button"
                  className={styles.miniVariantChip}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(v);
                  }}
                  disabled={v.stock <= 0}
                  title={`Add ${v.storage || ''} ${v.color || ''} (${formatCurrency(v.price)})`}
                >
                  {v.storage || v.color || `V${i + 1}`}
                </button>
              ))}
              {group.variants.length > 3 && (
                <span className={styles.moreVariantsCount}>
                  +{group.variants.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className={styles.singleVariantMeta}>
              {[group.variants[0]?.storage, group.variants[0]?.color, group.variants[0]?.location ? `📍 ${group.variants[0]?.location}` : null].filter(Boolean).join(' · ') || 'Standard'}
            </span>
          )}
        </div>
      </div>

      {/* Bottom Integrated Price & Action Footer */}
      <div className={styles.cardFooterBar}>
        <div className={styles.cardPriceBlock}>
          <span className={styles.priceLabel}>Price</span>
          <span className={styles.productCardPrice}>
            {hasMultipleVariants && group.minPrice !== group.maxPrice
              ? `${formatCurrency(group.minPrice)} - ${formatCurrency(group.maxPrice)}`
              : formatCurrency(group.variants[0]?.price || group.minPrice)}
          </span>
        </div>

        <button
          type="button"
          className={styles.addBtn}
          disabled={isOutOfStock}
          onClick={(e) => {
            e.stopPropagation();
            if (hasMultipleVariants) {
              onSelectVariant();
            } else {
              onAdd(group.variants[0]);
            }
          }}
          title={hasMultipleVariants ? 'Choose Variant' : 'Add to Cart'}
        >
          {hasMultipleVariants ? (
            <><span>Options</span> <Plus size={14} /></>
          ) : (
            <><span>Add</span> <Plus size={15} /></>
          )}
        </button>
      </div>
    </div>
  );
};
