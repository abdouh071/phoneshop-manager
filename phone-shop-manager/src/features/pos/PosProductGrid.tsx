import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { PhoneModel } from '../../types';
import type { ProductGroup } from '../../utils/productGrouping';
import { ProductCard } from './ProductCard';
import { ProductListItem } from './ProductListItem';
import styles from './POS.module.css';

interface PosProductGridProps {
  viewMode: 'grid' | 'list';
  paginatedGroups: ProductGroup[];
  displayedGroups: ProductGroup[];
  onAddToGroup: (group: ProductGroup, variant?: PhoneModel) => void;
  onSelectGroup: (group: ProductGroup) => void;
  hasMore: boolean;
  onPageMore: () => void;
  onPageAll: () => void;
  nextBatchCount: number;
  remainingCount: number;
}

export const PosProductGrid: React.FC<PosProductGridProps> = ({
  viewMode,
  paginatedGroups,
  displayedGroups,
  onAddToGroup,
  onSelectGroup,
  hasMore,
  onPageMore,
  onPageAll,
  nextBatchCount,
  remainingCount,
}) => {
  if (displayedGroups.length === 0) {
    return (
      <div className={styles.emptyCart}>
        <span className={styles.emptyCartIcon}>🔍</span>
        <p className={styles.emptyCartTitle}>No products found</p>
        <p className={styles.emptyCartSub}>Try a different category or clear your search.</p>
      </div>
    );
  }

  return (
    <>
      {viewMode === 'grid' ? (
        <div className={styles.productGrid}>
          {paginatedGroups.map(group => (
            <ProductCard 
              key={group.id} 
              group={group} 
              onAdd={(variant) => onAddToGroup(group, variant)} 
              onSelectVariant={() => onSelectGroup(group)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.denseList}>
          {paginatedGroups.map(group => (
            <ProductListItem
              key={group.id}
              group={group}
              onAdd={(variant) => onAddToGroup(group, variant)}
              onSelectVariant={() => onSelectGroup(group)}
            />
          ))}
        </div>
      )}

      {/* View More Pagination Bar */}
      {hasMore && (
        <div className={styles.viewMoreContainer}>
          <p className={styles.viewMoreMeta}>
            Showing <span className={styles.viewMoreMetaHighlight}>{paginatedGroups.length}</span> of <span className={styles.viewMoreMetaHighlight}>{displayedGroups.length}</span> products
          </p>
          <div className={styles.viewMoreActions}>
            <button
              type="button"
              className={styles.viewMoreBtn}
              onClick={onPageMore}
            >
              <span>View More (+{nextBatchCount})</span>
              <ChevronDown size={15} />
            </button>
            {remainingCount > nextBatchCount && (
              <button
                type="button"
                className={styles.viewAllBtn}
                onClick={onPageAll}
              >
                View All ({displayedGroups.length})
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};
