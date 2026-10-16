import React from 'react';
import { Modal } from '../../components/ui/Modal';
import { StockBadge } from '../../components/ui/Badge';
import type { ProductGroup } from '../../utils/productGrouping';
import type { PhoneModel } from '../../types';
import styles from './VariantSelect.module.css';
import { formatCurrency } from '../../utils/formatCurrency';

interface VariantSelectModalProps {
  group: ProductGroup | null;
  onClose: () => void;
  onSelect: (variant: PhoneModel) => void;
}


export const VariantSelectModal: React.FC<VariantSelectModalProps> = ({ group, onClose, onSelect }) => {
  if (!group) return null;

  return (
    <Modal
      isOpen={!!group}
      onClose={onClose}
      title={`Select Variant`}
      subtitle={`${group.name} ${group.model}`}
      size="md"
    >
      <div className={styles.grid}>
        {group.variants.map(variant => (
          <div
            key={variant.id}
            className={[
              styles.variantCard,
              variant.stock === 0 && styles.variantDisabled
            ].filter(Boolean).join(' ')}
            onClick={() => {
              if (variant.stock > 0) {
                onSelect(variant);
              }
            }}
          >
            <div className={styles.variantHeader}>
              <span className={styles.colorName}>{variant.color}</span>
              <StockBadge status={variant.stockStatus} />
            </div>
            
            <div className={styles.variantDetails}>
              <span className={styles.storage}>{variant.storage}</span>
              <span className={styles.price}>{formatCurrency(variant.price)}</span>
            </div>

            <div className={styles.variantFooter}>
              <span className={styles.stock}>
                {variant.stock > 0 ? `${variant.stock} units left` : 'Out of stock'}
              </span>
              <code className={styles.sku}>{variant.sku}</code>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};
