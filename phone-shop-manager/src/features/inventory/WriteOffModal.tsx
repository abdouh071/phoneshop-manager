import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
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

const REASON_OPTIONS: { value: WriteOffReason; label: string }[] = [
  { value: 'damaged', label: '💥 Damaged (physical damage)' },
  { value: 'defective', label: '⚠️ Defective (factory/DOA)' },
  { value: 'lost', label: '🔍 Lost (misplaced / unknown)' },
  { value: 'stolen', label: '🚨 Stolen / Theft' },
  { value: 'expired', label: '⏰ Expired / Obsolete' },
  { value: 'other', label: '📝 Other' },
];

export const WriteOffModal: React.FC<WriteOffModalProps> = ({ product, onClose }) => {
  const { writeOffStock } = useInventoryStore();
  const toast = useToast();
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<WriteOffReason>('damaged');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!product) return null;

  const maxQty = product.stock;

  const handleSubmit = async () => {
    const amount = parseInt(qty, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid Quantity', 'Please enter a valid quantity to write off.');
      return;
    }
    if (amount > maxQty) {
      toast.error('Exceeds Stock', `You only have ${maxQty} units in stock.`);
      return;
    }
    setIsSubmitting(true);
    try {
      await writeOffStock(product.id, amount, reason, note || undefined);
      const reasonLabel = reason.charAt(0).toUpperCase() + reason.slice(1);
      toast.success('Write-Off Recorded', `${amount} unit(s) of ${product.name} marked as ${reasonLabel}.`);
      onClose();
    } catch {
      toast.error('Error', 'Failed to record write-off. Please try again.');
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
              <h2 className={styles.title}>Mark as Defective / Write Off</h2>
              <p className={styles.subtitle}>{product.name} {product.model}</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        {/* Current stock indicator */}
        <div className={styles.stockInfo}>
          <span className={styles.stockLabel}>Current Stock</span>
          <span className={styles.stockValue}>{maxQty} units available</span>
        </div>

        {/* Form */}
        <div className={styles.form}>
          <div className={styles.formRow}>
            <div style={{ flex: '0 0 120px' }}>
              <Input
                label="Qty to Write Off"
                type="number"
                min="1"
                max={String(maxQty)}
                value={qty}
                onChange={e => setQty(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label="Reason"
                value={reason}
                onChange={v => setReason(v as WriteOffReason)}
                options={REASON_OPTIONS}
              />
            </div>
          </div>

          <Input
            label="Note (optional)"
            placeholder="e.g. Dropped during demo, screen cracked"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {/* Warning banner */}
        <div className={styles.warning}>
          <AlertTriangle size={14} />
          <span>
            This will permanently remove <strong>{qty || 0}</strong> unit(s) from stock.
            This action is logged and cannot be undone.
          </span>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button variant="danger" onClick={handleSubmit} isLoading={isSubmitting}>
            Confirm Write-Off
          </Button>
        </div>
      </div>
    </div>
  );
};
