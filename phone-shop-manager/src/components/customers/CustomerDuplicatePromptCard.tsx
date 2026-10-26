import React from 'react';
import { UserCheck, Check, Sparkles, UserPlus, AlertTriangle, Store } from 'lucide-react';
import type { Customer } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatStandardPhone } from '../../utils/phoneUtils';
import styles from './CustomerDuplicatePromptCard.module.css';

export interface CustomerDuplicatePromptCardProps {
  existingCustomer: Customer;
  enteredName?: string;
  onUseExisting: () => void;
  onUpdateToNewName?: () => void;
  onSaveAsSeparate?: () => void;
  isUpdating?: boolean;
}

export const CustomerDuplicatePromptCard: React.FC<CustomerDuplicatePromptCardProps> = ({
  existingCustomer,
  enteredName = '',
  onUseExisting,
  onUpdateToNewName,
  onSaveAsSeparate,
  isUpdating = false,
}) => {
  const cleanEnteredName = enteredName.trim();
  const cleanExistingName = (existingCustomer.name || '').trim();
  const namesDiffer = cleanEnteredName.length > 0 && cleanEnteredName.toLowerCase() !== cleanExistingName.toLowerCase();

  const visitsCount = existingCustomer.totalPurchases || 0;
  const debtAmount = existingCustomer.totalDebt || 0;
  const hasDebt = debtAmount > 0;
  const displayPhone = formatStandardPhone(existingCustomer.phone) || existingCustomer.phone;

  return (
    <div className={styles.card} role="region" aria-label="Customer duplicate detected">
      <div className={styles.header}>
        <div className={styles.iconWrapper} title="Existing customer match found">
          <UserCheck size={20} />
        </div>

        <div className={styles.content}>
          <div className={styles.titleRow}>
            <span className={styles.title}>
              Existing customer found:{' '}
              <strong className={styles.customerName}>{cleanExistingName}</strong> ({displayPhone})
            </span>
          </div>

          <div className={styles.badgesRow}>
            {existingCustomer.shopName && (
              <span className={`${styles.badge} ${styles.badgeShop}`}>
                <Store size={11} /> {existingCustomer.shopName}
              </span>
            )}
            <span className={`${styles.badge} ${styles.badgeVisits}`}>
              {visitsCount} {visitsCount === 1 ? 'visit' : 'visits'}
            </span>
            <span
              className={`${styles.badge} ${
                hasDebt ? styles.badgeDebtPositive : styles.badgeDebtZero
              }`}
            >
              {hasDebt ? (
                <>
                  <AlertTriangle size={11} /> {formatCurrency(debtAmount)} Debt
                </>
              ) : (
                <>✓ 0 DZD Debt</>
              )}
            </span>
          </div>
        </div>
      </div>

      <p className={styles.explanation}>
        {namesDiffer ? (
          <>
            You entered <span className={styles.highlightName}>"{cleanEnteredName}"</span> for phone number{' '}
            <strong>{displayPhone}</strong>, which is already registered to{' '}
            <strong>"{cleanExistingName}"</strong>.
          </>
        ) : (
          <>This phone number is already registered under this customer profile.</>
        )}
      </p>

      <div className={styles.actionsRow}>
        <button
          type="button"
          onClick={onUseExisting}
          disabled={isUpdating}
          className={styles.btnUseExisting}
          title={`Keep ${cleanExistingName} and use this profile`}
        >
          <Check size={14} />
          Use Existing Profile
        </button>

        {namesDiffer && onUpdateToNewName && (
          <button
            type="button"
            onClick={onUpdateToNewName}
            disabled={isUpdating}
            className={styles.btnUpdateName}
            title={`Update profile name from "${cleanExistingName}" to "${cleanEnteredName}"`}
          >
            <Sparkles size={14} />
            {isUpdating ? 'Updating...' : `Update to "${cleanEnteredName}"`}
          </button>
        )}

        {onSaveAsSeparate && (
          <button
            type="button"
            onClick={onSaveAsSeparate}
            disabled={isUpdating}
            className={styles.btnSaveSeparate}
            title="Create a separate customer record with this phone number (e.g. family member or company phone)"
          >
            <UserPlus size={13} />
            Save as Separate Contact
          </button>
        )}
      </div>
    </div>
  );
};
