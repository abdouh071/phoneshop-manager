import React from 'react';
import { Users, User, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Customer } from '../../types';
import { isShopCustomer, isRetailCustomer } from '../../types';
import type { AdminScope } from './customersPageTypes';

interface CustomerScopeSelectorProps {
  adminScope: AdminScope;
  setAdminScope: React.Dispatch<React.SetStateAction<AdminScope>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  accountCustomers: Customer[];
}

export const CustomerScopeSelector: React.FC<CustomerScopeSelectorProps> = ({
  adminScope,
  setAdminScope,
  setCurrentPage,
  accountCustomers,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Admin / Repair Scope Selector: All | Retail | Shops */}
        <div style={{
          display: 'inline-flex',
          background: '#f1f5f9',
          padding: '4px',
          borderRadius: '10px',
          gap: '4px',
          marginBottom: '16px',
          border: '1px solid #e2e8f0',
          width: 'fit-content',
        }}>
          <button
            type="button"
            style={{
              padding: '6px 16px',
              borderRadius: '7px',
              border: 'none',
              background: adminScope === 'all' ? '#ffffff' : 'transparent',
              color: adminScope === 'all' ? '#0f172a' : '#64748b',
              fontWeight: adminScope === 'all' ? 700 : 500,
              fontSize: '13px',
              boxShadow: adminScope === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onClick={() => { setAdminScope('all'); setCurrentPage(1); }}
          >
            <Users size={14} />
            <span>{t('customers.allAccounts', 'All Accounts')} ({accountCustomers.length})</span>
          </button>

          <button
            type="button"
            style={{
              padding: '6px 16px',
              borderRadius: '7px',
              border: 'none',
              background: adminScope === 'retail' ? '#ffffff' : 'transparent',
              color: adminScope === 'retail' ? '#2563eb' : '#64748b',
              fontWeight: adminScope === 'retail' ? 700 : 500,
              fontSize: '13px',
              boxShadow: adminScope === 'retail' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onClick={() => { setAdminScope('retail'); setCurrentPage(1); }}
          >
            <User size={14} />
            <span>👤 {t('customers.retailCustomers', 'Retail Customers')} ({accountCustomers.filter(isRetailCustomer).length})</span>
          </button>

          <button
            type="button"
            style={{
              padding: '6px 16px',
              borderRadius: '7px',
              border: 'none',
              background: adminScope === 'shop' ? '#ffffff' : 'transparent',
              color: adminScope === 'shop' ? '#d97706' : '#64748b',
              fontWeight: adminScope === 'shop' ? 700 : 500,
              fontSize: '13px',
              boxShadow: adminScope === 'shop' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onClick={() => { setAdminScope('shop'); setCurrentPage(1); }}
          >
            <Store size={14} />
            <span>🏪 {t('customers.shopsB2B', 'Shops & Parts Buyers')} ({accountCustomers.filter(isShopCustomer).length})</span>
          </button>
        </div>
    </>
  );
};
