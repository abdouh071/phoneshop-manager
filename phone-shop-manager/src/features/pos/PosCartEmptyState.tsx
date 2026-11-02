import React from 'react';
import { UserCheck } from 'lucide-react';
import styles from './POS.module.css';

interface PosCartEmptyStateProps {
  customerName: string;
}

export const PosCartEmptyState: React.FC<PosCartEmptyStateProps> = ({ customerName }) => {
  return (
    <div className={styles.emptyCart}>
      {customerName ? (
        <>
          <div className={styles.customerEmptyIconWrap}>
            <UserCheck size={30} />
          </div>
          <p className={styles.emptyCartTitle}>Customer Attached</p>
          <p className={styles.attachedCustomerHighlight}>{customerName}</p>
          <p className={styles.emptyCartSub}>Select products from the catalog to add items to this sale.</p>
        </>
      ) : (
        <>
          <span className={styles.emptyCartIcon}>🛒</span>
          <p className={styles.emptyCartTitle}>Cart is empty</p>
          <p className={styles.emptyCartSub}>Add products from the left to start a sale.</p>
        </>
      )}
    </div>
  );
};
