import React from 'react';
import { LayoutGrid, List } from 'lucide-react';
import type { ProductGroup } from '../../utils/productGrouping';
import { ACCESSORY_SUB_CATEGORIES } from '../../utils/accessorySubCategories';
import { PosDensityToggle } from '../../components/pos/PosDensityToggle';
import { posCategories } from './posConstants';
import styles from './POS.module.css';

interface PosProductsToolbarProps {
  categoryFilter: string;
  setCategoryFilter: React.Dispatch<React.SetStateAction<string>>;
  subCategoryFilter: string;
  setSubCategoryFilter: React.Dispatch<React.SetStateAction<string>>;
  categoryCounts: Record<string, number>;
  groups: ProductGroup[];
  viewMode: 'grid' | 'list';
  setViewMode: React.Dispatch<React.SetStateAction<'grid' | 'list'>>;
}

export const PosProductsToolbar: React.FC<PosProductsToolbarProps> = ({
  categoryFilter,
  setCategoryFilter,
  subCategoryFilter,
  setSubCategoryFilter,
  categoryCounts,
  groups,
  viewMode,
  setViewMode,
}) => {
  return (
    <div className={styles.productsToolbar}>
      {/* Quick Category Filter Bar */}
      <div className={styles.categoryFilterBar}>
        {posCategories.map(cat => {
          const count = categoryCounts[cat.id] || 0;
          if (cat.id !== 'all' && count === 0) return null;
          return (
            <button
              key={cat.id}
              type="button"
              className={[
                styles.categoryFilterPill,
                categoryFilter === cat.id && styles.categoryFilterPillActive
              ].filter(Boolean).join(' ')}
              onClick={() => setCategoryFilter(cat.id)}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              <span className={styles.pillCount}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Accessory Sub-Category Filter Bar */}
      {categoryFilter === 'accessory' && (
        <div className={styles.categoryFilterBar} style={{ marginTop: '6px', gap: '6px' }}>
          {ACCESSORY_SUB_CATEGORIES.map(sub => {
            const count = sub.value === 'all'
              ? groups.filter(g => g.category === 'accessory').length
              : groups.filter(g => g.category === 'accessory' && (g.accessorySubCategory || 'other') === sub.value).length;
            return (
              <button
                key={sub.value}
                type="button"
                style={{ fontSize: '12px', padding: '4px 10px' }}
                className={[
                  styles.categoryFilterPill,
                  subCategoryFilter === sub.value && styles.categoryFilterPillActive
                ].filter(Boolean).join(' ')}
                onClick={() => setSubCategoryFilter(sub.value)}
              >
                <span>{sub.icon}</span>
                <span>{sub.label}</span>
                <span className={styles.pillCount}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <PosDensityToggle />

        {/* View Mode Toggle */}
        <div className={styles.viewModeToggle}>
          <button
            type="button"
            className={[styles.viewModeBtn, viewMode === 'grid' && styles.viewModeBtnActive].filter(Boolean).join(' ')}
            onClick={() => setViewMode('grid')}
            title="Grid View (Cards)"
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={[styles.viewModeBtn, viewMode === 'list' && styles.viewModeBtnActive].filter(Boolean).join(' ')}
            onClick={() => setViewMode('list')}
            title="Compact List View"
          >
            <List size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
