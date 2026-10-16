import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Download, Plus, Users, RefreshCw, DollarSign, TrendingUp,
  ChevronDown, ChevronUp, Phone, Eye, Edit, MessageCircle, Wrench, ShoppingCart, UserPlus,
  BookOpen, AlertCircle, AlertTriangle, Send, FileText, Store, User, GitMerge, Trash2, ArrowRightLeft
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { SkeletonTableRows } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCustomerStore } from '../../store/customerStore';
import { useCartStore } from '../../store/cartStore';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import { CustomerProfilePanel } from './CustomerProfilePanel';
import { AddCustomerModal } from './AddCustomerModal';
import { NewTicketModal } from '../repairs/NewTicketModal';
import { AccountStatementModal } from './AccountStatementModal';
import { SwitchAccountTypeModal } from './SwitchAccountTypeModal';
import { MergeCustomersModal } from './MergeCustomersModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import type { Customer, RepairTicket } from '../../types';
import { isShopCustomer, isRetailCustomer } from '../../types';
import styles from './Customers.module.css';
import { formatCurrency } from '../../utils/formatCurrency';
import { getCustomerOverdueInfo, buildWhatsAppDebtReminderUrl, getOverdueDebts } from '../../utils/debtAlerts';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

type CustomerFilter = 'all' | 'overdue' | 'debt' | 'repeat' | 'new' | 'recent' | 'b2b';
type SortKey = 'name' | 'totalPurchases' | 'totalSpent' | 'totalDebt' | 'lastVisitDate' | 'joinDate';

export const CustomersPage = () => {
  const { fetchCustomers, searchQuery, setSearchQuery, isLoading, customers, debts, deleteCustomer, findDuplicates } = useCustomerStore();
  const { setCustomerName } = useCartStore();
  const { tickets } = useRepairStore();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuthStore();
  const permissions = usePermissions();
  const [customerRequiringUnlock, setCustomerRequiringUnlock] = useState<Customer | null>(null);

  // Duplication detection
  const detectedDuplicates = useMemo(() => findDuplicates(), [customers, findDuplicates]);

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
      toast.success('Customer Deleted', `${customerToDelete.name} has been removed.`);
      setCustomerToDelete(null);
    } catch (err) {
      toast.error('Failed to delete customer', 'An error occurred while deleting customer.');
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

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // ── Account Scope & Role Isolation ──────────────────────────────────
  const [adminScope, setAdminScope] = useState<'all' | 'retail' | 'shop'>('all');

  const effectiveScope: 'all' | 'retail' | 'shop' = useMemo(() => {
    if (user?.role === 'sales_agent') return 'retail';
    if (user?.role === 'repair_agent') return 'shop';
    return adminScope;
  }, [user?.role, adminScope]);

  const scopedCustomers = useMemo(() => {
    if (effectiveScope === 'retail') {
      return customers.filter(isRetailCustomer);
    }
    if (effectiveScope === 'shop') {
      return customers.filter(isShopCustomer);
    }
    return customers;
  }, [customers, effectiveScope]);

  const lockedAccountType = useMemo<'retail' | 'shop_repairer' | undefined>(() => {
    if (user?.role === 'sales_agent') return 'retail';
    if (user?.role === 'repair_agent') return 'shop_repairer';
    return undefined;
  }, [user?.role]);

  const defaultAccountType = useMemo<'retail' | 'shop_repairer'>(() => {
    if (effectiveScope === 'shop') return 'shop_repairer';
    return 'retail';
  }, [effectiveScope]);

  // ── Derived metrics ─────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    let repeatCount = 0;
    let newCount = 0;
    let recentCount = 0;
    let b2bCount = 0;
    let totalLtv = 0;
    let totalDebt = 0;
    let withDebtCount = 0;
    let overdueCount = 0;
    let overdueTotalAmount = 0;

    const overdueDebtsList = getOverdueDebts(debts);
    const overdueCustomerIds = new Set(overdueDebtsList.map(d => d.customerId));

    for (const c of scopedCustomers) {
      totalLtv += c.totalSpent;
      const debt = c.totalDebt || 0;
      if (debt > 0) {
        totalDebt += debt;
        withDebtCount++;
      }
      if (overdueCustomerIds.has(c.id)) {
        overdueCount++;
        const info = getCustomerOverdueInfo(debts, c.id);
        overdueTotalAmount += info.totalOverdueAmount;
      }
      if (c.totalPurchases >= 2) repeatCount++;
      if (c.totalPurchases <= 1) newCount++;
      if (new Date(c.lastVisitDate).getTime() >= thirtyDaysAgo) recentCount++;
      if (isShopCustomer(c)) b2bCount++;
    }

    return {
      total: scopedCustomers.length,
      repeat: repeatCount,
      new: newCount,
      recent: recentCount,
      b2b: b2bCount,
      totalLtv,
      totalDebt,
      withDebt: withDebtCount,
      overdueCount,
      overdueTotalAmount,
      totalOverdueDebtsCount: overdueDebtsList.length,
      avgRevenue: scopedCustomers.length > 0 ? totalLtv / scopedCustomers.length : 0,
    };
  }, [scopedCustomers, debts]);

  // ── Filtering ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    let list = scopedCustomers;

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.shopName && c.shopName.toLowerCase().includes(q))
      );
    }

    // Category filter
    switch (activeFilter) {
      case 'overdue':
        list = list.filter(c => getCustomerOverdueInfo(debts, c.id).hasOverdue);
        break;
      case 'debt':
        list = list.filter(c => (c.totalDebt || 0) > 0);
        break;
      case 'repeat':
        list = list.filter(c => c.totalPurchases >= 2);
        break;
      case 'new':
        list = list.filter(c => c.totalPurchases <= 1);
        break;
      case 'recent':
        list = list.filter(c => new Date(c.lastVisitDate).getTime() >= thirtyDaysAgo);
        break;
      case 'b2b':
        list = list.filter(isShopCustomer);
        break;
    }

    return list;
  }, [scopedCustomers, debts, searchQuery, activeFilter]);

  // ── Sorting ─────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let valA: any = a[sortKey] ?? '';
      let valB: any = b[sortKey] ?? '';
      if (sortKey === 'lastVisitDate' || sortKey === 'joinDate') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      }
      if (typeof valA === 'string') { valA = valA.toLowerCase(); valB = (valB as string).toLowerCase(); }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const paginated = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className={styles.sortNeutral}><ChevronUp size={12} /><ChevronDown size={12} /></span>;
    return <span>{sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>;
  };

  // ── Export CSV ──────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    // Problem 6 fix: Export the filtered/sorted array, not all customers
    if (sorted.length === 0) {
      toast.error('No Data', 'There are no customers matching the current filter to export.');
      return;
    }

    const headers = ['Name', 'Phone', 'Email', 'Total Orders', 'Total Spent', 'Debt Balance', 'Overdue Debt', 'Overdue Status', 'Last Visit', 'Join Date'];
    const rows = sorted.map(c => {
      const info = getCustomerOverdueInfo(debts, c.id);
      return [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.phone}"`,
        `"${c.email || ''}"`,
        String(c.totalPurchases),
        String(c.totalSpent),
        String(c.totalDebt || 0),
        String(info.totalOverdueAmount),
        info.hasOverdue ? `"OVERDUE (${info.maxDaysOverdue} days late)"` : '"Current"',
        formatDate(c.lastVisitDate),
        formatDate(c.joinDate),
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
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

    toast.success('CSV Exported', `${sorted.length} customers exported successfully.`);
  }, [sorted, debts, activeFilter, toast]);

  // ── Loyalty badge helper ────────────────────────────────────────────
  const getLoyaltyBadge = (c: Customer) => {
    if (c.accountType === 'shop_repairer' || c.accountType === 'b2b' || c.shopName) {
      return <span className={`${styles.loyaltyBadge} ${styles.loyaltyB2B}`}>🏪 B2B Shop</span>;
    }
    if (c.totalSpent >= 1000) {
      return <span className={`${styles.loyaltyBadge} ${styles.loyaltyVIP}`}>⭐ VIP Tier</span>;
    }
    if (c.totalPurchases >= 2) {
      return <span className={`${styles.loyaltyBadge} ${styles.loyaltyRepeat}`}>🔄 Repeat</span>;
    }
    return <span className={`${styles.loyaltyBadge} ${styles.loyaltyNew}`}>🌱 New</span>;
  };

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

      {/* Modern Page Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>
            {effectiveScope === 'retail'
              ? 'Retail Customer Directory'
              : effectiveScope === 'shop'
              ? 'B2B Shops & Parts Accounts'
              : 'Customer Directory'}
            <span className={styles.titleBadge}>{scopedCustomers.length} total</span>
          </h1>
          <p className={styles.subtitle}>
            {formatCurrency(metrics.totalLtv)} total lifetime value · {metrics.repeat} repeat buyers
            {permissions.customers_debt && metrics.totalDebt > 0 && ` · ${formatCurrency(metrics.totalDebt)} active credit balance`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            leftIcon={<GitMerge size={16} />}
            onClick={() => {
              setMergeInitialA(null);
              setMergeInitialB(null);
              setIsMergeOpen(true);
            }}
          >
            Merge Accounts
          </Button>
          <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExportCSV}>
            Export CSV
          </Button>
          <Button
            leftIcon={effectiveScope === 'shop' ? <Store size={16} /> : <Plus size={16} />}
            onClick={() => { setCustomerToEdit(null); setIsAddOpen(true); }}
          >
            {effectiveScope === 'shop'
              ? 'Add Shop / Client'
              : effectiveScope === 'retail'
              ? 'Add Retail Customer'
              : 'Add Customer'}
          </Button>
        </div>
      </div>

      {/* Detected Duplicates Alert Banner */}
      {detectedDuplicates.length > 0 && (
        <div style={{
          background: '#fefce8',
          border: '1px solid #fde047',
          borderRadius: '10px',
          padding: '12px 18px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          flexWrap: 'wrap',
          boxShadow: '0 1px 4px rgba(234, 179, 8, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              background: '#fef08a',
              color: '#854d0e',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <GitMerge size={20} />
            </div>
            <div>
              <h4 style={{ margin: '0 0 2px 0', fontSize: '13.5px', fontWeight: 700, color: '#854d0e' }}>
                {detectedDuplicates.length} Duplicate Account{detectedDuplicates.length !== 1 ? 's' : ''} Detected Between Clients & Shops
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#a16207' }}>
                Accounts exist in both Retail Clients and B2B Shops with matching contact info. You can declare them as one and choose where to keep them.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<GitMerge size={14} />}
            onClick={() => {
              setMergeInitialA(detectedDuplicates[0].retail);
              setMergeInitialB(detectedDuplicates[0].shop);
              setIsMergeOpen(true);
            }}
          >
            Resolve Duplicates ({detectedDuplicates.length})
          </Button>
        </div>
      )}

      {/* Admin Scope Selector: All | Retail | Shops */}
      {user?.role === 'admin' && (
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
            <span>All Accounts ({customers.length})</span>
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
            <span>👤 Retail Customers ({customers.filter(isRetailCustomer).length})</span>
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
            <span>🏪 Shops & Parts Buyers ({customers.filter(isShopCustomer).length})</span>
          </button>
        </div>
      )}

      {/* Interactive KPI Summary Grid */}
      <div className={styles.summaryGrid}>
        <div
          className={[styles.summaryCard, activeFilter === 'all' && styles.summaryCardActive].filter(Boolean).join(' ')}
          onClick={() => { setActiveFilter('all'); setCurrentPage(1); }}
          title="Click to view all customers"
        >
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>
              {effectiveScope === 'retail' ? 'Retail Customers' : effectiveScope === 'shop' ? 'B2B Shops' : 'Total Accounts'}
            </span>
            <div className={[styles.summaryIconWrap, styles.iconTotal].join(' ')}><Users size={16} /></div>
          </div>
          <p className={styles.summaryValue}>{metrics.total}</p>
          <p className={styles.summarySub}>
            {effectiveScope === 'retail'
              ? `${metrics.repeat} repeat buyers · ${metrics.new} new`
              : effectiveScope === 'shop'
              ? `${metrics.repeat} active workshops · ${metrics.withDebt} on credit`
              : `${metrics.b2b} B2B shops · ${metrics.repeat} repeat`}
          </p>
        </div>

        {/* Overdue Debts KPI Card */}
        {permissions.customers_debt && (
          <div
            className={[
              styles.summaryCard,
              activeFilter === 'overdue' && styles.summaryCardActive
            ].filter(Boolean).join(' ')}
            onClick={() => { setActiveFilter(activeFilter === 'overdue' ? 'all' : 'overdue'); setCurrentPage(1); }}
            title="Click to filter customers with OVERDUE debts"
            style={metrics.overdueCount > 0 ? { borderColor: '#fca5a5', background: '#fff5f5' } : undefined}
          >
            <div className={styles.summaryCardTop}>
              <span className={styles.summaryLabel} style={{ color: metrics.overdueCount > 0 ? '#b91c1c' : undefined, fontWeight: 700 }}>
                🔴 Overdue Debts
              </span>
              <div className={[styles.summaryIconWrap, styles.iconOverdue].join(' ')}><AlertTriangle size={16} /></div>
            </div>
            <p className={styles.summaryValue} style={{ color: metrics.overdueCount > 0 ? '#dc2626' : '#64748b' }}>
              {formatCurrency(metrics.overdueTotalAmount)}
            </p>
            <p className={styles.summarySub} style={{ color: metrics.overdueCount > 0 ? '#b91c1c' : '#64748b', fontWeight: 600 }}>
              {metrics.overdueCount} customer{metrics.overdueCount !== 1 ? 's' : ''} ({metrics.totalOverdueDebtsCount} record{metrics.totalOverdueDebtsCount !== 1 ? 's' : ''})
            </p>
          </div>
        )}

        {permissions.customers_debt && (
          <div
            className={[styles.summaryCard, activeFilter === 'debt' && styles.summaryCardActive].filter(Boolean).join(' ')}
            onClick={() => { setActiveFilter(activeFilter === 'debt' ? 'all' : 'debt'); setCurrentPage(1); }}
            title="Click to filter customers with unpaid debt tabs"
            style={metrics.totalDebt > 0 ? { borderColor: '#fed7aa' } : undefined}
          >
            <div className={styles.summaryCardTop}>
              <span className={styles.summaryLabel} style={{ color: metrics.totalDebt > 0 ? '#d97706' : undefined }}>
                Total Outstanding
              </span>
              <div className={[styles.summaryIconWrap, styles.iconDebt].join(' ')}><BookOpen size={16} /></div>
            </div>
            <p className={styles.summaryValue} style={{ color: metrics.totalDebt > 0 ? '#d97706' : '#64748b' }}>
              {formatCurrency(metrics.totalDebt)}
            </p>
            <p className={styles.summarySub}>
              {metrics.withDebt} customer{metrics.withDebt !== 1 ? 's' : ''} with active tab
            </p>
          </div>
        )}

        <div
          className={[styles.summaryCard, activeFilter === 'repeat' && styles.summaryCardActive].filter(Boolean).join(' ')}
          onClick={() => { setActiveFilter(activeFilter === 'repeat' ? 'all' : 'repeat'); setCurrentPage(1); }}
          title="Click to filter repeat customers"
        >
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>Repeat Buyers</span>
            <div className={[styles.summaryIconWrap, styles.iconRepeat].join(' ')}><RefreshCw size={16} /></div>
          </div>
          <p className={styles.summaryValue} style={{ color: '#16a34a' }}>{metrics.repeat}</p>
          <p className={styles.summarySub}>{metrics.total > 0 ? ((metrics.repeat / metrics.total) * 100).toFixed(0) : 0}% retention rate</p>
        </div>

        <div className={styles.summaryCard} style={{ cursor: 'default' }}>
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>Lifetime Value</span>
            <div className={[styles.summaryIconWrap, styles.iconLtv].join(' ')}><DollarSign size={16} /></div>
          </div>
          <p className={styles.summaryValue}>{formatCurrency(metrics.totalLtv)}</p>
          <p className={styles.summarySub}>Avg {formatCurrency(metrics.avgRevenue)} / client</p>
        </div>
      </div>

      {/* Fast Filter Pills */}
      <div className={styles.filterPills}>
        {([
          {
            value: 'all' as CustomerFilter,
            label: effectiveScope === 'shop' ? '🏪 All Shops' : effectiveScope === 'retail' ? '👤 All Retail Clients' : '👥 All Accounts',
            count: metrics.total
          },
          ...(effectiveScope === 'all'
            ? [{ value: 'b2b' as CustomerFilter, label: '🏪 Shops / B2B', count: metrics.b2b }]
            : []),
          ...(permissions.customers_debt ? [
            { value: 'overdue' as CustomerFilter, label: '🔴 Overdue Debts', count: metrics.overdueCount, highlight: metrics.overdueCount > 0 },
            { value: 'debt' as CustomerFilter, label: '📒 All Debt Tabs', count: metrics.withDebt }
          ] : []),
          { value: 'repeat' as CustomerFilter, label: '🔄 Repeat (2+ Visits)', count: metrics.repeat },
          { value: 'new' as CustomerFilter, label: '🌱 New Clients', count: metrics.new },
          { value: 'recent' as CustomerFilter, label: '🕒 Recent (30 Days)', count: metrics.recent },
        ]).map(pill => (
          <button
            key={pill.value}
            type="button"
            className={[
              styles.filterPill,
              activeFilter === pill.value && styles.filterPillActive,
              pill.highlight && activeFilter !== pill.value ? styles.filterPillOverdue : ''
            ].filter(Boolean).join(' ')}
            onClick={() => { setActiveFilter(pill.value); setCurrentPage(1); }}
            style={pill.highlight && activeFilter !== pill.value ? { borderColor: '#fca5a5', color: '#dc2626' } : {}}
          >
            <span>{pill.label}</span>
            <span
              className={styles.pillCount}
              style={pill.highlight && activeFilter !== pill.value ? { background: '#fee2e2', color: '#dc2626' } : {}}
            >
              {pill.count}
            </span>
          </button>
        ))}
      </div>

      {/* Customers Catalog Table Card */}
      <div className={styles.catalogCard}>
        <div className={styles.tableHeader}>
          <div className={styles.headerLeft}>
            <h2 className={styles.tableTitle}>Customer Directory</h2>
            <span className={styles.itemCountBadge}>{sorted.length} results</span>
          </div>
          <SearchInput
            value={searchQuery}
            onChange={(v) => { setSearchQuery(v); setCurrentPage(1); }}
            placeholder="Search by name, phone, email, shop…"
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
                title="No customers found"
                description="Try adjusting your search or filters, or click 'Add Customer' to register a new one."
              />
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} onClick={() => handleSort('name')}>
                    Customer <SortIcon col="name" />
                  </th>
                  <th className={styles.th}>Contact Info</th>
                  <th className={styles.th}>Account Tier</th>
                  <th className={styles.th} onClick={() => handleSort('totalPurchases')} style={{ textAlign: 'center' }}>
                    Orders <SortIcon col="totalPurchases" />
                  </th>
                  <th className={styles.th} onClick={() => handleSort('totalSpent')}>
                    Total Spent <SortIcon col="totalSpent" />
                  </th>
                  {permissions.customers_debt && (
                    <th className={styles.th} onClick={() => handleSort('totalDebt')}>
                      Debt Balance <SortIcon col="totalDebt" />
                    </th>
                  )}
                  <th className={styles.th} onClick={() => handleSort('lastVisitDate')}>
                    Last Visit <SortIcon col="lastVisitDate" />
                  </th>
                  <th className={styles.th} style={{ textAlign: 'right', minWidth: '220px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(customer => {
                  const debt = customer.totalDebt || 0;
                  const overdueInfo = getCustomerOverdueInfo(debts, customer.id);
                  return (
                    <tr
                      key={customer.id}
                      className={styles.tr}
                      onClick={() => setSelectedCustomer(customer)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className={styles.td}>
                        <div className={styles.customerCell}>
                          <div
                            className={[
                              styles.customerAvatar,
                              overdueInfo.hasOverdue
                                ? styles.customerAvatarOverdue
                                : customer.shopName
                                  ? styles.customerAvatarB2B
                                  : ''
                            ].filter(Boolean).join(' ')}
                          >
                            {customer.shopName ? '🏪' : customer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className={styles.customerInfoGroup}>
                            <div className={styles.customerNameRow}>
                              <p className={styles.customerName}>{customer.shopName || customer.name}</p>
                              {customer.shopName && (
                                <span className={styles.customerB2BTag}>B2B</span>
                              )}
                            </div>
                            {customer.shopName && (
                              <span className={styles.customerContactSub}>Contact: {customer.name}</span>
                            )}
                            <span className={styles.customerJoinDate}>
                              Since {formatDate(customer.joinDate)}
                            </span>
                            {permissions.customers_debt && (overdueInfo.hasOverdue ? (
                              <div>
                                <span className={styles.overdueBadgeTag}>
                                  🔴 OVERDUE: {formatCurrency(overdueInfo.totalOverdueAmount)} ({overdueInfo.maxDaysOverdue}d late)
                                </span>
                              </div>
                            ) : debt > 0 ? (
                              <div>
                                <span className={styles.debtBadgeTag}>
                                  🚨 Debt: {formatCurrency(debt)}
                                </span>
                              </div>
                            ) : null)}
                          </div>
                        </div>
                      </td>
                      <td className={styles.td}>
                        <div className={styles.contactInfo}>
                          <a
                            href={`tel:${customer.phone}`}
                            className={styles.contactPhone}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={12} /> {customer.phone}
                          </a>
                          {customer.email && (
                            <a
                              href={`mailto:${customer.email}`}
                              className={styles.contactEmail}
                              title={customer.email}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {customer.email}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className={styles.td}>
                        {getLoyaltyBadge(customer)}
                      </td>
                      <td className={styles.td} style={{ textAlign: 'center' }}>
                        <span className={styles.ordersCount}>{customer.totalPurchases}</span>
                      </td>
                      <td className={styles.td}>
                        <span className={styles.spentValue}>{formatCurrency(customer.totalSpent)}</span>
                      </td>
                      {permissions.customers_debt && (
                        <td className={styles.td}>
                          {overdueInfo.hasOverdue ? (
                            <div>
                              <span style={{ fontWeight: 800, color: '#dc2626', display: 'block', fontSize: '13.5px' }}>
                                {formatCurrency(debt)}
                              </span>
                              <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 700 }}>
                                🔴 {overdueInfo.count} Overdue ({overdueInfo.maxDaysOverdue}d)
                              </span>
                            </div>
                          ) : debt > 0 ? (
                            <div>
                              <span style={{ fontWeight: 800, color: '#d97706', display: 'block', fontSize: '13.5px' }}>
                                {formatCurrency(debt)}
                              </span>
                              <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
                                Active Tab
                              </span>
                            </div>
                          ) : (
                            <span className={styles.settledBadge}>
                              ✓ Settled
                            </span>
                          )}
                          {(customer.storeCredit || 0) > 0 && (
                            <span style={{ fontSize: '10.5px', color: '#047857', fontWeight: 700, background: '#d1fae5', border: '1px solid #a7f3d0', borderRadius: '4px', padding: '1px 5px', display: 'inline-block', marginTop: '3px' }}>
                              🎟️ Avoir: {formatCurrency(customer.storeCredit || 0)}
                            </span>
                          )}
                        </td>
                      )}
                      <td className={styles.td}>
                        <span className={styles.lastVisitText}>{formatDate(customer.lastVisitDate)}</span>
                      </td>
                      <td className={styles.td} style={{ textAlign: 'right' }}>
                        <div className={styles.actionButtons}>
                          {/* WhatsApp Reminder (Pre-filled Debt Notice) */}
                          {permissions.customers_debt && debt > 0 && (
                            <a
                              href={buildWhatsAppDebtReminderUrl({
                                customerName: customer.name,
                                customerPhone: customer.phone,
                                amountOwed: debt,
                                dueDate: overdueInfo.oldestDueDate,
                                daysOverdue: overdueInfo.maxDaysOverdue,
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${styles.quickActionBtn} ${styles.reminderBtn}`}
                              title={overdueInfo.hasOverdue ? `Send WhatsApp Overdue Reminder (${overdueInfo.maxDaysOverdue}d late)` : 'Send WhatsApp Debt Balance Reminder'}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Send size={13} />
                            </a>
                          )}
                          {/* 1-Click Regular WhatsApp */}
                          <a
                            href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${styles.quickActionBtn} ${styles.whatsappBtn}`}
                            title="WhatsApp Chat"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageCircle size={14} />
                          </a>
                          {/* 1-Click Call */}
                          <a
                            href={`tel:${customer.phone}`}
                            className={`${styles.quickActionBtn} ${styles.phoneBtn}`}
                            title="Call Customer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={14} />
                          </a>
                          {/* New Repair Quick Action */}
                          {permissions.repairs && (
                            <button
                              type="button"
                              className={`${styles.quickActionBtn} ${styles.repairBtn}`}
                              title="New Repair Ticket"
                              onClick={() => {
                                const custTickets = tickets.filter(
                                  tk => tk.customerPhone?.replace(/\D/g, '') === customer.phone.replace(/\D/g, '')
                                    || tk.customerName.toLowerCase().trim() === customer.name.toLowerCase().trim()
                                );
                                const lastDevice = custTickets.length > 0
                                  ? `${custTickets[0].deviceBrand} ${custTickets[0].deviceModel}`
                                  : undefined;
                                setRepairPrefill({ name: customer.name, phone: customer.phone, lastDevice });
                                setIsNewTicketOpen(true);
                              }}
                            >
                              <Wrench size={14} />
                            </button>
                          )}
                          {/* New Sale Quick Action */}
                          <button
                            type="button"
                            className={`${styles.quickActionBtn} ${styles.posBtn}`}
                            title="New POS Sale"
                            onClick={() => {
                              setCustomerName(customer.name);
                              toast.success('Customer Attached', `${customer.name} has been set as the customer for the next sale.`);
                              navigate('/pos');
                            }}
                          >
                            <ShoppingCart size={14} />
                          </button>
                          {/* Account Statement Quick Action */}
                          {permissions.customers_debt && (
                            <button
                              type="button"
                              className={`${styles.quickActionBtn} ${styles.statementBtn}`}
                              title="Account Statement / Relevé de Compte"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStatementCustomer(customer);
                              }}
                            >
                              <FileText size={14} />
                            </button>
                          )}
                          {/* Switch Account Type Quick Action */}
                          <button
                            type="button"
                            className={styles.quickActionBtn}
                            title={isShopCustomer(customer) ? 'Switch to Retail Client' : 'Switch to B2B Shop'}
                            style={{
                              background: isShopCustomer(customer) ? '#eff6ff' : '#fef3c7',
                              color: isShopCustomer(customer) ? '#1e40af' : '#b45309',
                              borderColor: isShopCustomer(customer) ? '#bfdbfe' : '#fde68a',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomerToSwitch(customer);
                            }}
                          >
                            {isShopCustomer(customer) ? <User size={14} /> : <Store size={14} />}
                          </button>
                          {/* Merge Account Quick Action */}
                          <button
                            type="button"
                            className={styles.quickActionBtn}
                            title="Merge with another account"
                            style={{
                              background: '#f8fafc',
                              color: '#475569',
                              borderColor: '#cbd5e1',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMergeInitialA(customer);
                              setMergeInitialB(null);
                              setIsMergeOpen(true);
                            }}
                          >
                            <GitMerge size={14} />
                          </button>
                          {/* Delete Customer Quick Action */}
                          <button
                            type="button"
                            className={styles.quickActionBtn}
                            title={user?.role === 'admin' ? 'Delete customer account' : 'Delete customer account (Requires Admin Password)'}
                            style={{
                              background: '#fff5f5',
                              color: '#dc2626',
                              borderColor: '#fca5a5',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomerClick(customer);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditCustomerClick(customer);
                            }}
                            title={user?.role === 'admin' ? 'Edit Customer Details' : 'Edit Customer Details (Requires Admin Password)'}
                          >
                            <Edit size={14} />
                            {user?.role !== 'admin' && <span style={{ fontSize: '9px', marginLeft: '2px' }}>🔒</span>}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCustomer(customer);
                            }}
                            title="View Customer 360° Profile"
                          >
                            <Eye size={14} /> View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
        actionName="edit customer information"
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
        actionName="delete a customer account"
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
        title="Delete Customer Account"
        message={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>
              Are you sure you want to permanently delete <strong>{customerToDelete?.name}</strong>?
            </p>
            {(customerToDelete?.totalDebt || 0) > 0 && (
              <p style={{ margin: 0, color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
                ⚠️ Warning: This customer currently has an unpaid debt of {formatCurrency(customerToDelete?.totalDebt || 0)}. Deleting the account will also remove all associated debt records.
              </p>
            )}
          </div>
        }
        confirmLabel="Delete Customer"
        variant="danger"
        isLoading={isDeletingLoading}
      />
    </div>
  );
};
