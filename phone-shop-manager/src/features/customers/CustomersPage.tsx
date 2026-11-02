import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCustomerStore } from '../../store/customerStore';
import { useCartStore } from '../../store/cartStore';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import { CustomerProfilePanel } from './CustomerProfilePanel';
import { AddCustomerModal } from './AddCustomerModal';
import { NewTicketModal } from '../repairs/NewTicketModal';
import { TicketDetailPanel } from '../repairs/TicketDetailPanel';
import { PrintRepairTicketModal } from '../repairs/PrintRepairTicketModal';
import { AccountStatementModal } from './AccountStatementModal';
import { SwitchAccountTypeModal } from './SwitchAccountTypeModal';
import { MergeCustomersModal } from './MergeCustomersModal';
import { CustomersDuplicatesBanner } from './CustomersDuplicatesBanner';
import { CustomerScopeSelector } from './CustomerScopeSelector';
import { CustomersCatalogTable } from './CustomersCatalogTable';
import { WalkInKpiGrid } from './WalkInKpiGrid';
import { WalkInFilterPills } from './WalkInFilterPills';
import { WalkInTicketsTable } from './WalkInTicketsTable';
import { CustomersKpiGrid } from './CustomersKpiGrid';
import { CustomersFilterPills } from './CustomersFilterPills';
import { CustomersPageHeader } from './CustomersPageHeader';
import { CustomersPrimaryTabs } from './CustomersPrimaryTabs';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useAuthStore } from '../../store/authStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { useTranslation } from 'react-i18next';
import type { Customer, RepairTicket } from '../../types';
import { isShopCustomer, isRetailCustomer } from '../../types';
import styles from './Customers.module.css';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { offlineCustomerSyncService } from '../../services/offlineCustomerSyncService';
import { normalizePhoneDigits, isDummyPhone } from '../../utils/phoneUtils';
import type { CustomerFilter, SortKey } from './customersPageTypes';
import {
  buildCustomerTicketsMap,
  buildCustomerDeviceCountMap,
  computeCustomersMetrics,
  computeWalkInTickets,
  computeWalkInMetrics,
  filterWalkInTickets,
  sortWalkInTickets,
  filterCustomersDirectory,
  sortCustomersDirectory,
  buildCustomersCsvContent,
} from './customersPageData';

export const CustomersPage = () => {
  usePrivacyStore((s) => s.isPrivacyActive);
  const { fetchCustomers, searchQuery, setSearchQuery, isLoading, customers, debts, deleteCustomer, findDuplicates, autoResolveAllDuplicates } = useCustomerStore();
  const { setCustomerName, setCustomerPhone } = useCartStore();
  const { tickets, fetchTickets } = useRepairStore();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const [customerRequiringUnlock, setCustomerRequiringUnlock] = useState<Customer | null>(null);

  // Duplication detection
  const detectedDuplicates = useMemo(() => findDuplicates(), [customers, findDuplicates]);
  const [isAutoResolving, setIsAutoResolving] = useState(false);

  const handleAutoResolveAll = async () => {
    if (detectedDuplicates.length === 0) return;
    setIsAutoResolving(true);
    toast.info(t('customers.autoResolvingTitle', 'Auto-Resolving Duplicates'), t('customers.autoResolvingDesc', 'Consolidating {{count}} duplicate pairs... Preserving all debts, repair tickets, and orders.', { count: detectedDuplicates.length }));
    try {
      const { mergedCount, deletedCount } = await autoResolveAllDuplicates({ deleteSecondary: true });
      toast.success(
        t('customers.duplicatesResolvedTitle', 'Duplicates Cleanly Resolved'),
        t('customers.duplicatesResolvedDesc', 'Successfully consolidated {{merged}} duplicate pairs. Cleaned up {{deleted}} duplicate accounts while preserving all records.', { merged: mergedCount, deleted: deletedCount })
      );
    } catch (err) {
      console.error('Failed to auto-resolve duplicates:', err);
      toast.error(t('customers.autoResolveFailedTitle', 'Auto-Resolve Failed'), t('customers.autoResolveFailedDesc', 'An error occurred while merging duplicate accounts.'));
    } finally {
      setIsAutoResolving(false);
    }
  };

  // Merge modal state
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [mergeInitialA, setMergeInitialA] = useState<Customer | null>(null);
  const [mergeInitialB, setMergeInitialB] = useState<Customer | null>(null);

  // Switch account type modal state
  const [customerToSwitch, setCustomerToSwitch] = useState<Customer | null>(null);

  // Delete customer state
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [isDeletingLoading, setIsDeletingLoading] = useState(false);
  // Problem 1 fix: Non-admin needs unlock before delete
  const [deleteRequiringUnlock, setDeleteRequiringUnlock] = useState<Customer | null>(null);

  // Offline sync queue counter
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(offlineCustomerSyncService.getPendingCount());

  useEffect(() => {
    const unsub = offlineCustomerSyncService.subscribe(() => {
      setPendingSyncCount(offlineCustomerSyncService.getPendingCount());
    });
    return unsub;
  }, []);

  const handleDeleteCustomerClick = (customer: Customer) => {
    if (user?.role === 'admin') {
      setCustomerToDelete(customer);
    } else {
      setDeleteRequiringUnlock(customer);
    }
  };

  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;
    setIsDeletingLoading(true);
    try {
      await deleteCustomer(customerToDelete.id, { deleteDebts: true });
      toast.success(t('customers.customerDeletedTitle', 'Customer Deleted'), t('customers.customerDeletedDesc', '{{name}} has been removed.', { name: customerToDelete.name }));
      setCustomerToDelete(null);
    } catch (err) {
      toast.error(t('customers.deleteCustomerError', 'Failed to delete customer'), t('customers.deleteCustomerErrorDesc', 'An error occurred while deleting customer.'));
    } finally {
      setIsDeletingLoading(false);
    }
  };

  const handleEditCustomerClick = (customer: Customer) => {
    if (user?.role === 'admin') {
      setCustomerToEdit(customer);
      setIsAddOpen(true);
    } else {
      setCustomerRequiringUnlock(customer);
    }
  };

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [activeFilter, setActiveFilter] = useState<CustomerFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('lastVisitDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  
  // Handle URL query filter (e.g. /customers?filter=overdue)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const filterParam = params.get('filter');
    if (filterParam === 'overdue' || filterParam === 'debt' || filterParam === 'repeat' || filterParam === 'new' || filterParam === 'recent' || filterParam === 'b2b') {
      setActiveFilter(filterParam as CustomerFilter);
    }
  }, [location.search]);

  // Handle deep-link from Activity Log (e.g. /customers?focusId=abc123)
  useEffect(() => {
    if (!customers.length) return;
    const params = new URLSearchParams(location.search);
    const focusId = params.get('focusId');
    const searchParam = params.get('search');
    if (focusId) {
      const match = customers.find(c => c.id === focusId);
      if (match) setSelectedCustomer(match);
    }
    if (searchParam) {
      setSearchQuery(searchParam);
    }
  }, [location.search, customers]);
  
  // New Repair quick action state
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [repairPrefill, setRepairPrefill] = useState<{ name: string; phone: string; lastDevice?: string } | null>(null);
  const [ticketToEdit, setTicketToEdit] = useState<RepairTicket | null>(null);
  const itemsPerPage = 10;

  // ── Primary Page Tab State: Customer Accounts vs Walk-in Customers ───
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageTab, setPageTabState] = useState<'accounts' | 'walkin'>(() => {
    return searchParams.get('tab') === 'walkin' ? 'walkin' : 'accounts';
  });

  const handleTabChange = useCallback((newTab: 'accounts' | 'walkin') => {
    setPageTabState(newTab);
    const nextParams = new URLSearchParams(searchParams);
    if (newTab === 'walkin') {
      nextParams.set('tab', 'walkin');
    } else {
      nextParams.delete('tab');
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'walkin' && pageTab !== 'walkin') {
      setPageTabState('walkin');
    } else if (!tabParam && pageTab === 'walkin') {
      setPageTabState('accounts');
    }
  }, [searchParams, pageTab]);

  // Walk-in tab filtering, search & detail state
  const [walkInSearch, setWalkInSearch] = useState('');
  const [walkInStatusFilter, setWalkInStatusFilter] = useState<'all' | 'active' | 'completed' | 'pending' | 'in_progress' | 'ready'>('all');
  const [walkInPage, setWalkInPage] = useState(1);
  const [selectedWalkInTicket, setSelectedWalkInTicket] = useState<RepairTicket | null>(null);
  const [printingWalkInTicket, setPrintingWalkInTicket] = useState<RepairTicket | null>(null);

  useEffect(() => {
    fetchCustomers();
    fetchTickets();
  }, [fetchCustomers, fetchTickets]);

  // ── Account Scope & Role Isolation ──────────────────────────────────
  const [adminScope, setAdminScope] = useState<'all' | 'retail' | 'shop'>('all');

  const effectiveScope: 'all' | 'retail' | 'shop' = useMemo(() => {
    if (user?.role === 'sales_agent') return 'retail';
    return adminScope;
  }, [user?.role, adminScope]);

  // Helper: does this customer have a valid phone for account-level display?
  const hasValidAccountPhone = useCallback((c: Customer) => {
    if (!c.phone || !c.phone.trim()) return false;
    if (isDummyPhone(c.phone)) return false;
    return normalizePhoneDigits(c.phone).length >= 7;
  }, []);

  // All active customers (excluding soft-deleted / merged profiles)
  const allActiveCustomers = useMemo(() => {
    return customers.filter(c => !c.mergedIntoId);
  }, [customers]);

  // Customers without a valid phone are considered walk-in legacy accounts
  // and should only appear via the Walk-in Customers tab when browsing lists without an active search.
  // No data is deleted — they're just hidden from the browse list.
  const accountCustomers = useMemo(() => {
    return customers.filter(c => !c.mergedIntoId && hasValidAccountPhone(c));
  }, [customers, hasValidAccountPhone]);

  // Walk-in legacy customer accounts (missing phone) — used for tab count
  const walkInLegacyCustomers = useMemo(() => {
    return customers.filter(c => !c.mergedIntoId && !hasValidAccountPhone(c));
  }, [customers, hasValidAccountPhone]);

  const scopedCustomers = useMemo(() => {
    if (effectiveScope === 'retail') {
      return accountCustomers.filter(isRetailCustomer);
    }
    if (effectiveScope === 'shop') {
      return accountCustomers.filter(isShopCustomer);
    }
    return accountCustomers;
  }, [accountCustomers, effectiveScope]);

  const lockedAccountType = useMemo<'retail' | 'shop_repairer' | undefined>(() => {
    if (user?.role === 'sales_agent') return 'retail';
    return undefined;
  }, [user?.role]);

  const defaultAccountType = useMemo<'retail' | 'shop_repairer'>(() => {
    if (effectiveScope === 'shop') return 'shop_repairer';
    return 'retail';
  }, [effectiveScope]);

  // Fast lookup of tickets per customer (indexed across ALL active customers)
  const customerTicketsMap = useMemo(() => {
    return buildCustomerTicketsMap(customers, tickets);
  }, [customers, tickets]);

  // Pre-computed device count per customer (avoids recomputing per rendered row)
  const customerDeviceCountMap = useMemo(() => {
    return buildCustomerDeviceCountMap(customers, customerTicketsMap);
  }, [customers, customerTicketsMap]);

  // ── Derived metrics ─────────────────────────────────────────────────
  const metrics = useMemo(() => {
    return computeCustomersMetrics(scopedCustomers, debts, customerTicketsMap, customerDeviceCountMap);
  }, [scopedCustomers, debts, customerTicketsMap, customerDeviceCountMap]);

  // ── Walk-in Repairs (Tickets with missing or invalid phone number OR linked to legacy phoneless accounts) ────
  const walkInTickets = useMemo(() => {
    return computeWalkInTickets(tickets, walkInLegacyCustomers);
  }, [tickets, walkInLegacyCustomers]);

  const walkInMetrics = useMemo(() => {
    return computeWalkInMetrics(walkInTickets);
  }, [walkInTickets]);

  const filteredWalkInTickets = useMemo(() => {
    return filterWalkInTickets(walkInTickets, walkInSearch, walkInStatusFilter);
  }, [walkInTickets, walkInSearch, walkInStatusFilter]);

  const sortedWalkInTickets = useMemo(() => {
    return sortWalkInTickets(filteredWalkInTickets);
  }, [filteredWalkInTickets]);

  const walkInItemsPerPage = 10;
  const totalWalkInPages = Math.max(1, Math.ceil(sortedWalkInTickets.length / walkInItemsPerPage));

  // Auto-clamp walkInPage if search/filter shrinks the results
  useEffect(() => {
    if (walkInPage > totalWalkInPages) {
      setWalkInPage(1);
    }
  }, [totalWalkInPages, walkInPage]);

  const pagedWalkInTickets = useMemo(() => {
    const start = (walkInPage - 1) * walkInItemsPerPage;
    return sortedWalkInTickets.slice(start, start + walkInItemsPerPage);
  }, [sortedWalkInTickets, walkInPage, walkInItemsPerPage]);

  // ── Filtering ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return filterCustomersDirectory({ allActiveCustomers, scopedCustomers, debts, searchQuery, activeFilter, customerTicketsMap });
  }, [allActiveCustomers, scopedCustomers, debts, searchQuery, activeFilter, customerTicketsMap]);

  // ── Sorting ─────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return sortCustomersDirectory(filtered, sortKey, sortDir);
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage));

  // Auto-clamp currentPage if filtered/sorted results shrink
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const paginated = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // ── Export CSV ──────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    // Problem 6 fix: Export the filtered/sorted array, not all customers
    if (sorted.length === 0) {
      toast.error(t('customers.noDataToExportTitle', 'No Data'), t('customers.noDataToExportDesc', 'There are no customers matching the current filter to export.'));
      return;
    }

    const csvContent = buildCustomersCsvContent(sorted, debts);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filterSuffix = activeFilter !== 'all' ? `_${activeFilter}` : '';
    link.setAttribute('href', url);
    link.setAttribute('download', `customers_export${filterSuffix}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(t('customers.csvExportedTitle', 'CSV Exported'), t('customers.csvExportedDesc', '{{count}} customers exported successfully.', { count: sorted.length }));
  }, [sorted, debts, activeFilter, toast, t]);

  return (
    <div className={styles.page}>
      <AddCustomerModal
        isOpen={isAddOpen}
        onClose={() => { setIsAddOpen(false); setCustomerToEdit(null); }}
        customerToEdit={customerToEdit}
        lockedAccountType={customerToEdit ? undefined : lockedAccountType}
        defaultAccountType={defaultAccountType}
      />
      <CustomerProfilePanel
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        customer={selectedCustomer ? customers.find(c => c.id === selectedCustomer.id) || selectedCustomer : null}
        onNewRepair={(c, lastDevice) => {
          setRepairPrefill({ name: c.name, phone: c.phone, lastDevice });
          setTicketToEdit(null);
          setIsNewTicketOpen(true);
        }}
      />

      <CustomersPageHeader
        effectiveScope={effectiveScope}
        scopedCustomers={scopedCustomers}
        metrics={metrics}
        pageTab={pageTab}
        pendingSyncCount={pendingSyncCount}
        handleExportCSV={handleExportCSV}
        onMergeAccounts={() => {
          setMergeInitialA(null);
          setMergeInitialB(null);
          setIsMergeOpen(true);
        }}
        onSyncQueue={() => {
          toast.info(t('customers.syncingQueueTitle', 'Syncing Offline Queue'), t('customers.syncingQueueDesc', 'Sending offline customer profiles to cloud...'));
          offlineCustomerSyncService.syncPendingCustomers();
        }}
        onNewWalkInTicket={() => {
          setRepairPrefill(null);
          setTicketToEdit(null);
          setIsNewTicketOpen(true);
        }}
        onAddCustomer={() => { setCustomerToEdit(null); setIsAddOpen(true); }}
      />

      <CustomersDuplicatesBanner
        detectedDuplicates={detectedDuplicates}
        isAutoResolving={isAutoResolving}
        onAutoResolveAll={handleAutoResolveAll}
        onReviewIndividually={() => {
          setMergeInitialA(detectedDuplicates[0].retail);
          setMergeInitialB(detectedDuplicates[0].shop);
          setIsMergeOpen(true);
        }}
      />

      <CustomersPrimaryTabs
        pageTab={pageTab}
        handleTabChange={handleTabChange}
        accountCustomers={accountCustomers}
        walkInTickets={walkInTickets}
      />

      {pageTab === 'accounts' && (
        <>
          {/* Admin / Repair Scope Selector: All | Retail | Shops */}
          {(user?.role === 'admin' || user?.role === 'repair_agent') && (
            <CustomerScopeSelector
              adminScope={adminScope}
              setAdminScope={setAdminScope}
              setCurrentPage={setCurrentPage}
              accountCustomers={accountCustomers}
            />
      )}

      <CustomersKpiGrid
        metrics={metrics}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        setCurrentPage={setCurrentPage}
        effectiveScope={effectiveScope}
      />

      <CustomersFilterPills
        metrics={metrics}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        setCurrentPage={setCurrentPage}
        effectiveScope={effectiveScope}
      />

      <CustomersCatalogTable
        isLoading={isLoading}
        sorted={sorted}
        paginated={paginated}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setCurrentPage={setCurrentPage}
        handleSort={handleSort}
        sortKey={sortKey}
        sortDir={sortDir}
        currentPage={currentPage}
        totalPages={totalPages}
        itemsPerPage={itemsPerPage}
        debts={debts}
        customerTicketsMap={customerTicketsMap}
        customerDeviceCountMap={customerDeviceCountMap}
        userRole={user?.role}
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
        </>
      )}

      {pageTab === 'walkin' && (
        <>
          <WalkInKpiGrid
            walkInMetrics={walkInMetrics}
            walkInStatusFilter={walkInStatusFilter}
            setWalkInStatusFilter={setWalkInStatusFilter}
            setWalkInPage={setWalkInPage}
          />

          <WalkInFilterPills
            walkInTickets={walkInTickets}
            walkInMetrics={walkInMetrics}
            walkInStatusFilter={walkInStatusFilter}
            setWalkInStatusFilter={setWalkInStatusFilter}
            setWalkInPage={setWalkInPage}
          />

          <WalkInTicketsTable
            sortedWalkInTickets={sortedWalkInTickets}
            pagedWalkInTickets={pagedWalkInTickets}
            walkInSearch={walkInSearch}
            setWalkInSearch={setWalkInSearch}
            walkInPage={walkInPage}
            setWalkInPage={setWalkInPage}
            totalWalkInPages={totalWalkInPages}
            walkInItemsPerPage={walkInItemsPerPage}
            setSelectedWalkInTicket={setSelectedWalkInTicket}
            setPrintingWalkInTicket={setPrintingWalkInTicket}
            setTicketToEdit={setTicketToEdit}
            setIsNewTicketOpen={setIsNewTicketOpen}
          />
        </>
      )}

      {/* New or Edit Repair Ticket Modal */}
      <NewTicketModal
        isOpen={isNewTicketOpen}
        onClose={() => {
          setIsNewTicketOpen(false);
          setRepairPrefill(null);
          setTicketToEdit(null);
        }}
        prefillCustomer={repairPrefill}
        ticketToEdit={ticketToEdit}
      />

      {/* B2B Account Statement & Ledger Modal */}
      <AccountStatementModal
        customer={statementCustomer}
        isOpen={!!statementCustomer}
        onClose={() => setStatementCustomer(null)}
      />

      {/* Admin Unlock Modal for editing customer details */}
      <AdminUnlockModal
        isOpen={!!customerRequiringUnlock}
        onClose={() => setCustomerRequiringUnlock(null)}
        onSuccess={() => {
          if (customerRequiringUnlock) {
            setCustomerToEdit(customerRequiringUnlock);
            setIsAddOpen(true);
          }
          setCustomerRequiringUnlock(null);
        }}
        actionName={`Edit customer: ${customerRequiringUnlock?.name || 'Customer'}`}
        actionType="customer_edit"
        targetId={customerRequiringUnlock?.id}
        actionData={customerRequiringUnlock ? {
          customerName: customerRequiringUnlock.name,
          phone: customerRequiringUnlock.phone,
          debt: customerRequiringUnlock.debt,
          creditLimit: customerRequiringUnlock.creditLimit,
        } : undefined}
      />

      {/* Problem 1 fix: Admin Unlock Modal for deleting customer */}
      <AdminUnlockModal
        isOpen={!!deleteRequiringUnlock}
        onClose={() => setDeleteRequiringUnlock(null)}
        onSuccess={() => {
          if (deleteRequiringUnlock) {
            setCustomerToDelete(deleteRequiringUnlock);
          }
          setDeleteRequiringUnlock(null);
        }}
        actionName={`Delete customer: ${deleteRequiringUnlock?.name || 'Customer'}`}
        actionType="customer_delete"
        targetId={deleteRequiringUnlock?.id}
        actionData={deleteRequiringUnlock ? {
          customerName: deleteRequiringUnlock.name,
          phone: deleteRequiringUnlock.phone,
          debt: deleteRequiringUnlock.debt,
        } : undefined}
      />

      {/* Switch Account Type Modal */}
      <SwitchAccountTypeModal
        isOpen={!!customerToSwitch}
        onClose={() => setCustomerToSwitch(null)}
        customer={customerToSwitch}
      />

      {/* Merge Customers Modal */}
      <MergeCustomersModal
        isOpen={isMergeOpen}
        onClose={() => {
          setIsMergeOpen(false);
          setMergeInitialA(null);
          setMergeInitialB(null);
        }}
        initialAccountA={mergeInitialA}
        initialAccountB={mergeInitialB}
      />

      {/* Delete Customer Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!customerToDelete}
        onClose={() => setCustomerToDelete(null)}
        onConfirm={confirmDeleteCustomer}
        title={t('customers.deleteCustomerConfirmTitle', 'Delete Customer Account')}
        message={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>
              {t('customers.deleteCustomerConfirmMsg', 'Are you sure you want to permanently delete {{name}}?', { name: customerToDelete?.name })}
            </p>
            {(customerToDelete?.totalDebt || 0) > 0 && (
              <p style={{ margin: 0, color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
                {t('customers.deleteCustomerDebtWarning', '⚠️ Warning: This customer currently has an unpaid debt of {{amount}}. Deleting the account will also remove all associated debt records.', { amount: formatPrivateCurrency(customerToDelete?.totalDebt || 0) })}
              </p>
            )}
          </div>
        }
        confirmLabel={t('customers.deleteCustomerConfirmBtn', 'Delete Customer')}
        variant="danger"
        isLoading={isDeletingLoading}
      />

      {/* Sidebar Widget for Walk-in Ticket Details */}
      <TicketDetailPanel
        ticket={selectedWalkInTicket}
        onClose={() => setSelectedWalkInTicket(null)}
        onEdit={() => {
          if (selectedWalkInTicket) {
            setTicketToEdit(selectedWalkInTicket);
            setIsNewTicketOpen(true);
            setSelectedWalkInTicket(null);
          }
        }}
        onViewCustomerProfile={(cust) => {
          setSelectedWalkInTicket(null);
          setSelectedCustomer(cust);
          handleTabChange('accounts');
        }}
      />

      {/* Direct Ticket Label / Receipt Print Modal */}
      <PrintRepairTicketModal
        ticket={printingWalkInTicket}
        isOpen={!!printingWalkInTicket}
        onClose={() => setPrintingWalkInTicket(null)}
      />
    </div>
  );
};
