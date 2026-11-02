import React from 'react';
import { ShoppingBag, BookOpen, Wrench } from 'lucide-react';
import type { CustomerDebtEntry, RepairTicket, SaleTransaction } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import styles from './CustomerProfile.module.css';

type ProfileTab = 'debts' | 'repairs' | 'purchases';

interface CustomerProfileTabBarProps {
  activeTab: ProfileTab;
  setActiveTab: React.Dispatch<React.SetStateAction<ProfileTab>>;
  totalDebtBalance: number;
  customerDebts: CustomerDebtEntry[];
  customerTickets: RepairTicket[];
  customerTxs: SaleTransaction[];
}

export const CustomerProfileTabBar: React.FC<CustomerProfileTabBarProps> = ({
  activeTab,
  setActiveTab,
  totalDebtBalance,
  customerDebts,
  customerTickets,
  customerTxs,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();

  return (
          <div className={styles.tabBar}>
            {permissions.customers_debt && (
              <button
                type="button"
                className={[styles.tabBtn, activeTab === 'debts' && styles.tabBtnActive].filter(Boolean).join(' ')}
                onClick={() => setActiveTab('debts')}
              >
                <BookOpen size={14} />
                <span>{t('customers.creditLedger', 'Credit Ledger')}</span>
                <span className={styles.tabBadge} style={{ background: totalDebtBalance > 0 ? '#fee2e2' : undefined, color: totalDebtBalance > 0 ? '#dc2626' : undefined }}>
                  {customerDebts.length}
                </span>
              </button>
            )}
            {permissions.repairs && (
              <button
                type="button"
                className={[styles.tabBtn, activeTab === 'repairs' && styles.tabBtnActive].filter(Boolean).join(' ')}
                onClick={() => setActiveTab('repairs')}
              >
                <Wrench size={14} />
                <span>{t('common.repairs', 'Repairs')}</span>
                <span className={styles.tabBadge}>{customerTickets.length}</span>
              </button>
            )}
            <button
              type="button"
              className={[styles.tabBtn, activeTab === 'purchases' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('purchases')}
            >
              <ShoppingBag size={14} />
              <span>{t('common.purchases', 'Purchases')}</span>
              <span className={styles.tabBadge}>{customerTxs.length}</span>
            </button>
          </div>
  );
};
