import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SearchInput } from '../../components/ui/Input';
import { SkeletonTableRows } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../../hooks/usePermissions';
import type { Customer, CustomerDebtEntry, RepairTicket } from '../../types';
import type { User as AuthUser } from '../../store/authStore';
import type { SortKey } from './customersPageTypes';
import { CustomerTableRow } from './CustomerTableRow';
import styles from './Customers.module.css';

interface SortIconProps {
  col: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
}

const SortIcon: React.FC<SortIconProps> = ({ col, sortKey, sortDir }) => {
  if (sortKey !== col) return <span className={styles.sortNeutral}><ChevronUp size={12} /><ChevronDown size={12} /></span>;
  return <span>{sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>;
};

interface CustomersCatalogTableProps {
  isLoading: boolean;
  sorted: Customer[];
  paginated: Customer[];
  searchQuery: string;
  setSearchQuery: (searchQuery: string) => void;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  handleSort: (key: SortKey) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  debts: CustomerDebtEntry[];
  customerTicketsMap: Map<string, RepairTicket[]>;
  customerDeviceCountMap: Map<string, number>;
  userRole?: AuthUser['role'];
  setSelectedCustomer: React.Dispatch<React.SetStateAction<Customer | null>>;
  setRepairPrefill: React.Dispatch<React.SetStateAction<{ name: string; phone: string; lastDevice?: string } | null>>;
  setTicketToEdit: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setIsNewTicketOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStatementCustomer: React.Dispatch<React.SetStateAction<Customer | null>>;
  setCustomerToSwitch: React.Dispatch<React.SetStateAction<Customer | null>>;
  setMergeInitialA: React.Dispatch<React.SetStateAction<Customer | null>>;
  setMergeInitialB: React.Dispatch<React.SetStateAction<Customer | null>>;
  setIsMergeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  handleDeleteCustomerClick: (customer: Customer) => void;
  handleEditCustomerClick: (customer: Customer) => void;
}

export const CustomersCatalogTable: React.FC<CustomersCatalogTableProps> = ({
  isLoading,
  sorted,
  paginated,
  searchQuery,
  setSearchQuery,
  setCurrentPage,
  handleSort,
  sortKey,
  sortDir,
  currentPage,
  totalPages,
  itemsPerPage,
  debts,
  customerTicketsMap,
  customerDeviceCountMap,
  userRole,
  setSelectedCustomer,
  setRepairPrefill,
  setTicketToEdit,
  setIsNewTicketOpen,
  setStatementCustomer,
  setCustomerToSwitch,
  setMergeInitialA,
  setMergeInitialB,
  setIsMergeOpen,
  setCustomerName,
  setCustomerPhone,
  handleDeleteCustomerClick,
  handleEditCustomerClick,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();

  return (
    <>
      {/* Customers Catalog Table Card */}
      <div className={styles.catalogCard}>
        <div className={styles.tableHeader}>
          <div className={styles.headerLeft}>
            <h2 className={styles.tableTitle}>{t('customers.customerDirectory', 'Customer Directory')}</h2>
            <span className={styles.itemCountBadge}>{t('customers.results', '{{count}} results', { count: sorted.length })}</span>
          </div>
          <SearchInput
            value={searchQuery}
            onChange={(v) => { setSearchQuery(v); setCurrentPage(1); }}
            onClear={() => { setSearchQuery(''); setCurrentPage(1); }}
            placeholder={t('customers.searchPlaceholder', 'Search by name, phone, device (e.g. iPhone, Oppo), ticket #, IMEI…')}
            className={styles.search}
          />
        </div>

        <div className={styles.tableWrapper}>
          {isLoading ? (
            <table className={styles.table}>
              <tbody><SkeletonTableRows cols={7} /></tbody>
            </table>
          ) : sorted.length === 0 ? (
            <div style={{ padding: '48px 20px' }}>
              <EmptyState
                title={t('customers.noCustomersFoundTitle', 'No customers found')}
                description={t('customers.noCustomersFoundDesc', 'Try adjusting your search or filters, or click \'Add Customer\' to register a new one.')}
              />
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} onClick={() => handleSort('name')}>
                    {t('customers.customer', 'Customer')} <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={styles.th}>{t('customers.contactInfo', 'Contact Info')}</th>
                  <th className={styles.th}>{t('customers.tier', 'Account Tier')}</th>
                  <th className={styles.th} onClick={() => handleSort('totalPurchases')} style={{ textAlign: 'center' }}>
                    {t('common.orders', 'Orders')} <SortIcon col="totalPurchases" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={styles.th} onClick={() => handleSort('totalSpent')}>
                    {t('common.totalSpent', 'Total Spent')} <SortIcon col="totalSpent" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  {permissions.customers_debt && (
                    <th className={styles.th} onClick={() => handleSort('totalDebt')}>
                      {t('common.debtBalance', 'Debt Balance')} <SortIcon col="totalDebt" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                  )}
                  <th className={styles.th} onClick={() => handleSort('lastVisitDate')}>
                    {t('customers.lastVisit', 'Last Visit')} <SortIcon col="lastVisitDate" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={styles.th} style={{ textAlign: 'right', minWidth: '220px' }}>{t('common.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(customer => (
                  <CustomerTableRow
                    key={customer.id}
                    customer={customer}
                    debts={debts}
                    customerTicketsMap={customerTicketsMap}
                    customerDeviceCountMap={customerDeviceCountMap}
                    userRole={userRole}
                    setSelectedCustomer={setSelectedCustomer}
                    setRepairPrefill={setRepairPrefill}
                    setTicketToEdit={setTicketToEdit}
                    setIsNewTicketOpen={setIsNewTicketOpen}
                    setStatementCustomer={setStatementCustomer}
                    setCustomerToSwitch={setCustomerToSwitch}
                    setMergeInitialA={setMergeInitialA}
                    setMergeInitialB={setMergeInitialB}
                    setIsMergeOpen={setIsMergeOpen}
                    setCustomerName={setCustomerName}
                    setCustomerPhone={setCustomerPhone}
                    handleDeleteCustomerClick={handleDeleteCustomerClick}
                    handleEditCustomerClick={handleEditCustomerClick}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {sorted.length > 0 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0' }}>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              itemsPerPage={itemsPerPage}
              totalItems={sorted.length}
            />
          </div>
        )}
      </div>
    </>
  );
};
