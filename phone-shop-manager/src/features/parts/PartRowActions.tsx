import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Eye, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { PhoneModel } from '../../types';
import styles from './Parts.module.css';

interface PartRowActionsProps {
  product: PhoneModel;
  isRestocking: boolean;
  restockAmt: string;
  restockCost: string;
  canViewCosts: boolean;
  onView: () => void;
  onEdit: () => void;
  onRestockOpen: () => void;
  onWriteOff: () => void;
  onDelete: () => void;
  onRestockAmtChange: (value: string) => void;
  onRestockCostChange: (value: string) => void;
  onSaveRestock: () => void;
  onCancelRestock: () => void;
}

/**
 * The action cell of a catalog row: either the inline restock form or the
 * view/edit/restock/write-off buttons. One component for both the group row
 * and its variant rows so the form cannot drift out of sync.
 */
export const PartRowActions: React.FC<PartRowActionsProps> = ({
  product,
  isRestocking,
  restockAmt,
  restockCost,
  canViewCosts,
  onView,
  onEdit,
  onRestockOpen,
  onWriteOff,
  onDelete,
  onRestockAmtChange,
  onRestockCostChange,
  onSaveRestock,
  onCancelRestock,
}) => {
  const { t } = useTranslation();

  if (isRestocking) {
    return (
      <div className={styles.restockInline} style={{ justifyContent: 'flex-end' }}>
        <input
          autoFocus
          type="number"
          min="1"
          placeholder={t('parts.qty')}
          value={restockAmt}
          onChange={e => onRestockAmtChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onCancelRestock(); if (e.key === 'Enter') onSaveRestock(); }}
          className={styles.restockInput}
          style={{ width: '64px' }}
        />
        {canViewCosts && (
          <input
            type="number"
            placeholder={t('parts.unitCost')}
            value={restockCost}
            onChange={e => onRestockCostChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancelRestock(); if (e.key === 'Enter') onSaveRestock(); }}
            className={styles.restockInput}
            style={{ width: '80px' }}
          />
        )}
        <Button size="sm" onClick={onSaveRestock}>{t('parts.save')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancelRestock}>✕</Button>
      </div>
    );
  }

  return (
    <div className={styles.actionButtons} style={{ justifyContent: 'flex-end' }}>
      <Button variant="ghost" size="sm" onClick={onView} title={t('parts.viewDetails')}>
        <Eye size={15} />
      </Button>
      <Button variant="secondary" size="sm" onClick={onEdit}>
        {t('parts.edit')}
      </Button>
      <Button variant="secondary" size="sm" onClick={onRestockOpen}>
        {t('parts.restock')}
      </Button>
      <Button variant="danger" size="sm" onClick={onWriteOff} disabled={product.stock === 0} title={t('parts.writeOff')}>
        <AlertTriangle size={15} />
      </Button>
      <Button variant="danger" size="sm" onClick={onDelete} title={t('parts.deletePart')}>
        <Trash2 size={15} />
      </Button>
    </div>
  );
};
