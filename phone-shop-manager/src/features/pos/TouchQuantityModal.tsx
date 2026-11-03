import React, { useEffect, useState } from 'react';
import { X, Delete, Check, Hash } from 'lucide-react';
import type { CartItem } from '../../types';
import styles from './TouchQuantityModal.module.css';

interface Props {
  isOpen: boolean;
  item: CartItem | null;
  maxStock: number;
  onClose: () => void;
  onApply: (newQty: number) => void;
}

export const TouchQuantityModal: React.FC<Props> = ({
  isOpen,
  item,
  maxStock,
  onClose,
  onApply,
}) => {
  const [inputVal, setInputVal] = useState<string>('');

  // The hook used to sit under an early return, so closing this modal handed React a
  // render with one fewer hook than the one that opened it — an invariant violation
  // on the money screen. Opening a second line now seeds its own quantity instead of
  // the digits typed into the first.
  useEffect(() => {
    if (isOpen && item) setInputVal(String(item.quantity));
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleDigit = (digit: string) => {
    setInputVal((prev) => {
      if (prev === '0' || prev === '') return digit;
      const next = prev + digit;
      const num = parseInt(next, 10);
      if (isNaN(num)) return prev;
      if (num > maxStock) return String(maxStock);
      return next;
    });
  };

  const handleClear = () => {
    setInputVal('1');
  };

  const handleBackspace = () => {
    setInputVal((prev) => {
      if (prev.length <= 1) return '1';
      return prev.slice(0, -1);
    });
  };

  const handlePreset = (amount: number) => {
    const clamped = Math.max(1, Math.min(maxStock, amount));
    setInputVal(String(clamped));
  };

  const handleApply = () => {
    const qty = parseInt(inputVal, 10);
    const finalQty = isNaN(qty) || qty <= 0 ? 1 : Math.min(qty, maxStock);
    onApply(finalQty);
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Hash size={18} className={styles.headerIcon} />
            <span>Set Quantity</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <div className={styles.itemSummary}>
            <span className={styles.itemName} title={item.product.name}>
              {item.product.name} {item.product.model}
            </span>
            <span className={styles.stockBadge}>Max: {maxStock}</span>
          </div>

          {/* Big Number Display */}
          <div className={styles.display}>
            <span className={styles.displayLabel}>Units:</span>
            <span className={styles.displayValue}>{inputVal || '1'}</span>
          </div>

          {/* Quick Presets */}
          <div className={styles.presetsRow}>
            <button type="button" className={styles.presetBtn} onClick={() => handlePreset(1)}>
              1
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => handlePreset(2)}>
              2
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => handlePreset(5)}>
              5
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => handlePreset(maxStock)}>
              Max ({maxStock})
            </button>
          </div>

          {/* Keypad */}
          <div className={styles.keypad}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                type="button"
                className={styles.keyBtn}
                onClick={() => handleDigit(String(n))}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className={[styles.keyBtn, styles.keyClear].join(' ')}
              onClick={handleClear}
            >
              C
            </button>
            <button
              type="button"
              className={styles.keyBtn}
              onClick={() => handleDigit('0')}
            >
              0
            </button>
            <button
              type="button"
              className={[styles.keyBtn, styles.keyBackspace].join(' ')}
              onClick={handleBackspace}
              title="Delete last digit"
            >
              <Delete size={20} />
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.applyBtn} onClick={handleApply}>
            <Check size={18} />
            <span>Apply Quantity</span>
          </button>
        </div>
      </div>
    </div>
  );
};
