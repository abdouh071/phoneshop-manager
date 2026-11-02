import React from 'react';
import { ShoppingCart, RefreshCw, X } from 'lucide-react';
import styles from './POS.module.css';

interface PosCartHeaderProps {
  cartBadgeCount: number;
  suspendedCount: number;
  showSuspended: boolean;
  setShowSuspended: React.Dispatch<React.SetStateAction<boolean>>;
  setShowReturnModal: React.Dispatch<React.SetStateAction<boolean>>;
  hasCartItems: boolean;
  showHoldClear: boolean;
  onHold: () => void;
  onClear: () => void;
}

export const PosCartHeader: React.FC<PosCartHeaderProps> = ({
  cartBadgeCount,
  suspendedCount,
  showSuspended,
  setShowSuspended,
  setShowReturnModal,
  hasCartItems,
  showHoldClear,
  onHold,
  onClear,
}) => {
  return (
    <div className={styles.cartHeader}>
      <div className={styles.cartTitle}>
        <ShoppingCart size={20} />
        <span>Cart</span>
        {cartBadgeCount > 0 && (
          <span className={styles.cartCount}>{cartBadgeCount}</span>
        )}
        {suspendedCount > 0 && (
          <button 
            className={styles.suspendedBadge} 
            onClick={() => setShowSuspended(!showSuspended)}
          >
            {suspendedCount} on hold
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button 
          type="button"
          className={styles.exchangeBtn}
          onClick={() => setShowReturnModal(true)}
          title="Add a returned or exchanged product"
        >
          <RefreshCw size={12} /> Exchange
        </button>
        {showHoldClear && (
          <>
            {hasCartItems && (
              <button 
                className={styles.suspendBtn} 
                onClick={onHold}
              >
                Hold
              </button>
            )}
            <button 
              className={styles.clearBtn} 
              onClick={onClear}
            >
              <X size={14} /> Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
};
