import React from 'react';
import { Zap } from 'lucide-react';
import type { PhoneModel } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { getCategoryIcon } from './posConstants';
import styles from './POS.module.css';

interface PosSpeedDialProps {
  items: PhoneModel[];
  onAdd: (product: PhoneModel, productLabel?: string) => void;
}

export const PosSpeedDial: React.FC<PosSpeedDialProps> = ({ items, onAdd }) => {
  return (
    <div className={styles.speedDialSection}>
      <div className={styles.speedDialHeader}>
        <div className={styles.speedDialTitle}>
          <Zap size={13} style={{ color: 'var(--color-primary, #4f46e5)' }} />
          <span>Speed-Dial Fast Keys</span>
        </div>
        <span className={styles.speedDialCount}>⚡ 1-Click Fast Add</span>
      </div>
      <div className={styles.speedDialGrid}>
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className={styles.speedDialCard}
            onClick={() => onAdd(item, `${item.name} ${item.model}`)}
            title={`Quick add ${item.name} ${item.model} (${formatCurrency(item.price)})`}
          >
            <div className={styles.speedDialCardTop}>
              <span className={styles.speedDialIcon}>{getCategoryIcon(item.category)}</span>
              <span className={styles.speedDialStock}>{item.stock} in stock</span>
            </div>
            <span className={styles.speedDialName}>{item.name} {item.model}</span>
            <span className={styles.speedDialPrice}>{formatCurrency(item.price)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
