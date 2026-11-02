import React, { useMemo, useState } from 'react';
import { LabelsPrintModal, type LabelsPrintCopy } from '../../components/labels/LabelsPrintModal';
import { useInventoryStore } from '../../store/inventoryStore';
import { ACCESSORY_SUB_CATEGORIES } from '../../utils/accessorySubCategories';
import type { PhoneModel } from '../../types';
import styles from './PrintLabels.module.css';

const LABEL_CATEGORIES: { value: string; label: string }[] = [
  { value: 'all', label: '🗂 All' },
  { value: 'smartphone', label: '📱 Phones' },
  { value: 'tablet', label: '📟 Tablets' },
  { value: 'accessory', label: '🎧 Accessories' },
  { value: 'wearable', label: '⌚ Wearables' },
];

interface PrintLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: PhoneModel[]; // initially selected products
  categoryFilter?: string; // optional: only show products of this category
}

const searchFields = (p: PhoneModel) => [p.name, p.model, p.sku, p.accessorySubCategory];

const COPY: Omit<LabelsPrintCopy, 'searchPlaceholder'> = {
  modalTitle: 'Configure Barcode Labels',
  previewTitle: 'Preview Labels',
  previewIframeTitle: 'Label Preview',
  emptySelection: 'No products selected. Search above to add products to your print queue.',
  noLabelsWarning: 'Set a quantity for at least one product.',
  totalQtyLabel: 'Total Quantity',
  withPriceLabel: 'Qty w/ Price',
  withoutPriceLabel: 'Qty w/o Price',
  printWindowTitle: 'Product Labels',
};

export const PrintLabelsModal: React.FC<PrintLabelsModalProps> = ({ isOpen, onClose, products: initialProducts, categoryFilter }) => {
  const { products: allProducts } = useInventoryStore();

  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>(categoryFilter || 'all');
  const [activeSubCategoryFilter, setActiveSubCategoryFilter] = useState<string>('all');

  const items = useMemo(() => allProducts.filter(p => {
    if (p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-')) return false;
    if (activeCategoryFilter && activeCategoryFilter !== 'all' && p.category !== activeCategoryFilter) return false;
    if (activeCategoryFilter === 'accessory' && activeSubCategoryFilter !== 'all') {
      if ((p.accessorySubCategory || 'other') !== activeSubCategoryFilter) return false;
    }
    return true;
  }), [allProducts, activeCategoryFilter, activeSubCategoryFilter]);

  const searchPlaceholder = `Search ${activeCategoryFilter === 'all' ? 'all products' : LABEL_CATEGORIES.find(c => c.value === activeCategoryFilter)?.label ?? 'products'}…`;

  return (
    <LabelsPrintModal
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      initialItems={initialProducts}
      withPriceColumn
      clearSearchAfterAdd={false}
      searchFields={searchFields}
      copy={{ ...COPY, searchPlaceholder }}
      classes={styles}
      onOpen={() => {
        setActiveCategoryFilter(categoryFilter || 'all');
        setActiveSubCategoryFilter('all');
      }}
      renderAboveSearch={({ clearSearch }) => (
        <>
          {/* Category filter pills */}
          <div className={styles.categoryFilterBar}>
            {LABEL_CATEGORIES.map(cat => (
              <button
                key={cat.value}
                type="button"
                className={[
                  styles.categoryFilterPill,
                  activeCategoryFilter === cat.value && styles.categoryFilterPillActive,
                ].filter(Boolean).join(' ')}
                onClick={() => { setActiveCategoryFilter(cat.value); setActiveSubCategoryFilter('all'); clearSearch(); }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Accessory sub-category pills */}
          {activeCategoryFilter === 'accessory' && (
            <div className={styles.categoryFilterBar} style={{ marginTop: '-8px', marginBottom: '14px', gap: '6px' }}>
              {ACCESSORY_SUB_CATEGORIES.map(sub => (
                <button
                  key={sub.value}
                  type="button"
                  style={{ fontSize: '12px', padding: '4px 10px' }}
                  className={[
                    styles.categoryFilterPill,
                    activeSubCategoryFilter === sub.value && styles.categoryFilterPillActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => { setActiveSubCategoryFilter(sub.value); clearSearch(); }}
                >
                  <span>{sub.icon}</span> {sub.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    />
  );
};
