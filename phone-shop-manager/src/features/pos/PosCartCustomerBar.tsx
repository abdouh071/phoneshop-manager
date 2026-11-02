import React from 'react';
import { X } from 'lucide-react';
import type { Customer } from '../../types';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { CustomerAutocompleteInput } from './CustomerAutocompleteInput';
import styles from './POS.module.css';

interface PosCartCustomerBarProps {
  customerAttached: boolean;
  customerName: string;
  customerPhone: string;
  matchedCustomer: Customer | null;
  onDetach: () => void;
  onSelectCustomer: (name: string, cust?: Customer | null) => void;
}

export const PosCartCustomerBar: React.FC<PosCartCustomerBarProps> = ({
  customerAttached,
  customerName,
  customerPhone,
  matchedCustomer,
  onDetach,
  onSelectCustomer,
}) => {
  return (
    <div className={styles.cartCustomerTop}>
      {customerAttached && customerName ? (
        <div className={styles.attachedCustomerCard}>
          <div className={styles.attachedCustomerLeft}>
            <div className={styles.attachedCustomerAvatar}>
              {customerName.slice(0, 2).toUpperCase()}
            </div>
            <div className={styles.attachedCustomerInfo}>
              <div className={styles.attachedCustomerNameRow}>
                <span className={styles.attachedCustomerName}>{customerName}</span>
                {matchedCustomer?.shopName && (
                  <span className={styles.attachedCustomerShop}>• {matchedCustomer.shopName}</span>
                )}
              </div>
              <div className={styles.attachedCustomerSubRow}>
                <span className={styles.attachedCustomerPhone}>
                  📞 {customerPhone || matchedCustomer?.phone || 'No phone'}
                </span>
                {(matchedCustomer?.storeCredit || 0) > 0 && (
                  <span className={styles.attachedStoreCreditBadge}>
                    🎟️ Avoir: {formatPrivateCurrency(matchedCustomer?.storeCredit || 0)}
                  </span>
                )}
                {(matchedCustomer?.totalDebt || 0) > 0 ? (
                  <span className={styles.attachedDebtBadge}>
                    Debt: {formatPrivateCurrency(matchedCustomer?.totalDebt || 0)}
                  </span>
                ) : (
                  <span className={styles.attachedNoDebtBadge}>
                    Clean Credit
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            className={styles.detachCustomerBtn}
            onClick={onDetach}
            title="Detach customer (switch to walk-in)"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className={styles.customerInputWrap}>
          <CustomerAutocompleteInput
            accountType="retail"
            placeholder="👤 Attach customer (optional)..."
            value={customerName}
            onChange={onSelectCustomer}
          />
        </div>
      )}
    </div>
  );
};
