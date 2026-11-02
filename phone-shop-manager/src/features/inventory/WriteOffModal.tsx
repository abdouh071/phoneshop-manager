import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import type { PhoneModel, WriteOffReason } from '../../types';
import styles from './WriteOff.module.css';

interface WriteOffModalProps {
  product: PhoneModel | null;
  onClose: () => void;
}

const REASON_VALUES: WriteOffReason[] = ['damaged', 'defective', 'lost', 'stolen', 'expired', 'other'];

export const WriteOffModal: React.FC<WriteOffModalProps> = ({ product, onClose }) => {
  const { t } = useTranslation();
  const { writeOffStock } = useInventoryStore();
  const toast = useToast();
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<WriteOffReason>('damaged');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!product) return null;

  const maxQty = product.stock;
  const reasonOptions = REASON_VALUES.map(value => ({ value, label: t(`inventory.writeOffModal.reasons.${value}`) }));

  const handleSubmit = async () => {
    const amount = parseInt(qty, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error(t('inventory.writeOffModal.invalidQtyTitle'), t('inventory.writeOffModal.invalidQtyBody'));
      return;
    }
    if (amount > maxQty) {
      toast.error(t('inventory.writeOffModal.exceedsTitle'), t('inventory.writeOffModal.exceedsBody', { max: maxQty }));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await writeOffStock(product.id, amount, reason, note || undefined);
      const reasonLabel = t(`inventory.writeOffModal.reasonShort.${reason}`);
      if (result.outcome === 'committed') {
        toast.success(
          t('inventory.writeOffModal.doneTitle'),
          t('inventory.writeOffModal.doneBody', { qty: result.applied, name: product.name, reason: reasonLabel })
        );
        onClose();
      } else if (result.outcome === 'queued') {
        // The delta only waits in this device's queue: the server stock has not moved yet.
        toast.info(
          t('inventory.writeOffModal.queuedTitle'),
          t('inventory.writeOffModal.queuedBody', { qty: result.applied, name: product.name })
        );
        onClose();
      } else if (result.outcome === 'unchanged') {
        toast.warning(t('inventory.writeOffModal.nothingTitle'), t('inventory.writeOffModal.nothingBody', { name: product.name }));
      } else {
        toast.error(t('inventory.writeOffModal.failedTitle'), t('inventory.writeOffModal.failedBody'));
      }
    } catch {
      toast.error(t('inventory.writeOffModal.failedTitle'), t('inventory.writeOffModal.failedBody'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <AlertTriangle size={20} style={{ color: '#dc2626' }} />
            <div>
              <h2 className={styles.title}>{t('inventory.writeOffModal.title')}</h2>
              <p className={styles.subtitle}>{product.name} {product.model}</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </div>

        {/* Current stock indicator */}
        <div className={styles.stockInfo}>
          <span className={styles.stockLabel}>{t('inventory.writeOffModal.currentStock')}</span>
          <span className={styles.stockValue}>{t('inventory.writeOffModal.unitsAvailable', { qty: maxQty })}</span>
        </div>

        {/* Form */}
        <div className={styles.form}>
          <div className={styles.formRow}>
            <div style={{ flex: '0 0 120px' }}>
              <Input
                label={t('inventory.writeOffModal.qtyLabel')}
                type="number"
                min="1"
                max={String(maxQty)}
                value={qty}
                onChange={e => setQty(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label={t('inventory.writeOffModal.reasonLabel')}
                value={reason}
                onChange={v => setReason(v as WriteOffReason)}
                options={reasonOptions}
              />
            </div>
          </div>

          <Input
            label={t('inventory.writeOffModal.noteLabel')}
            placeholder={t('inventory.writeOffModal.notePlaceholder')}
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {/* Warning banner */}
        <div className={styles.warning}>
          <AlertTriangle size={14} />
          <span>
            {t('inventory.writeOffModal.warning', { qty: qty || 0 })}
          </span>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={handleSubmit} isLoading={isSubmitting}>
            {t('inventory.writeOffModal.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};
