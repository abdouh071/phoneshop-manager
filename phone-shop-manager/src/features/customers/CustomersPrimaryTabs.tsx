import React from 'react';
import { Users, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Customer, RepairTicket } from '../../types';
import type { PageTab } from './customersPageTypes';
import styles from './Customers.module.css';

interface CustomersPrimaryTabsProps {
  pageTab: PageTab;
  handleTabChange: (tab: PageTab) => void;
  accountCustomers: Customer[];
  walkInTickets: RepairTicket[];
}

export const CustomersPrimaryTabs: React.FC<CustomersPrimaryTabsProps> = ({
  pageTab,
  handleTabChange,
  accountCustomers,
  walkInTickets,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Primary Navigation Tabs */}
      <div className={styles.primaryTabs}>
        <button
          type="button"
          className={[
            styles.primaryTabBtn,
            pageTab === 'accounts' ? styles.primaryTabBtnActiveAccounts : '',
          ].filter(Boolean).join(' ')}
          onClick={() => handleTabChange('accounts')}
        >
          <Users size={17} />
          <span>{t('customers.customerAccounts', 'Customer Accounts')}</span>
          <span className={[
            styles.primaryTabCount,
            pageTab === 'accounts' ? styles.primaryTabCountActiveAccounts : '',
          ].filter(Boolean).join(' ')}>
            {accountCustomers.length}
          </span>
        </button>

        <button
          type="button"
          className={[
            styles.primaryTabBtn,
            pageTab === 'walkin' ? styles.primaryTabBtnActiveWalkIn : '',
          ].filter(Boolean).join(' ')}
          onClick={() => handleTabChange('walkin')}
        >
          <Wrench size={17} />
          <span>{t('customers.walkInCustomers', 'Walk-in Customers')}</span>
          <span className={[
            styles.primaryTabCount,
            pageTab === 'walkin' ? styles.primaryTabCountActiveWalkIn : '',
          ].filter(Boolean).join(' ')}>
            {walkInTickets.length}
          </span>
          {walkInTickets.length > 0 && (
            <span className={styles.walkinTag}>
              {t('customers.noPhoneRegistered', 'No Phone Registered')}
            </span>
          )}
        </button>
      </div>
    </>
  );
};
