import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Download, Plus, Users, RefreshCw, DollarSign, TrendingUp,
  ChevronDown, ChevronUp, Phone, Eye, Edit, MessageCircle, Wrench, ShoppingCart, UserPlus,
  BookOpen, AlertCircle, AlertTriangle, Send, FileText, Store, User, GitMerge, Trash2, ArrowRightLeft,
  Printer, CheckCircle2, Clock, Smartphone
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { SkeletonTableRows } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { RepairStatusBadge } from '../../components/ui/Badge';
import { useCustomerStore } from '../../store/customerStore';
import { useCartStore } from '../../store/cartStore';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import { CustomerProfilePanel } from './CustomerProfilePanel';
import { AddCustomerModal } from './AddCustomerModal';
import { NewTicketModal } from '../repairs/NewTicketModal';
import { TicketDetailPanel } from '../repairs/TicketDetailPanel';
import { PrintRepairTicketModal } from '../repairs/PrintRepairTicketModal';
import { detectIssueTag, getBrandIcon } from '../repairs/repairConstants';
import { AccountStatementModal } from './AccountStatementModal';
import { SwitchAccountTypeModal } from './SwitchAccountTypeModal';
import { MergeCustomersModal } from './MergeCustomersModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useAuthStore } from '../../store/authStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { usePermissions } from '../../hooks/usePermissions';
import type { Customer, RepairTicket } from '../../types';
import { isShopCustomer, isRetailCustomer } from '../../types';
import styles from './Customers.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { getCustomerOverdueInfo, buildWhatsAppDebtReminderUrl, getOverdueDebts } from '../../utils/debtAlerts';
import { offlineCustomerSyncService } from '../../services/offlineCustomerSyncService';
import { isPhoneMatch, normalizePhoneDigits, isDummyPhone, formatWhatsAppUrl } from '../../utils/phoneUtils';
import { matchesCustomer } from '../../utils/customerFinancials';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const formatTimeAgo = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 5) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

type CustomerFilter = 'all' | 'overdue' | 'debt' | 'repeat' | 'new' | 'recent' | 'b2b';
type SortKey = 'name' | 'totalPurchases' | 'totalSpent' | 'totalDebt' | 'lastVisitDate' | 'joinDate';

export const CustomersPage = () => {
  const isPrivacyActive = usePrivacyStore((s) => s.isPrivacyActive);
  const { fetchCustomers, searchQuery, setSearchQuery, isLoading, customers, debts, deleteCustomer, findDuplicates, autoResolveAllDuplicates } = useCustomerStore();
  const { setCustomerName, setCustomerPhone } = useCartStore();
  const { tickets, fetchTickets } = useRepairStore();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuthStore();
  const permissions = usePermissions();
  const [customerRequiringUnlock, setCustomerRequiringUnlock] = useState<Customer | null>(null);

  // Duplication detection
  const detectedDuplicates = useMemo(() => findDuplicates(), [customers, findDuplicates]);
  const [isAutoResolving, setIsAutoResolving] = useState(false);

  const handleAutoResolveAll = async () => {
    if (detectedDuplicates.length === 0) return;
    setIsAutoResolving(true);
    toast.info('Auto-Resolving Duplicates', `Consolidating ${detectedDuplicates.length} duplicate pairs... Preserving all debts, repair tickets, and orders.`);
    try {
      const { mergedCount, deletedCount } = await autoResolveAllDuplicates({ deleteSecondary: true });
      toast.success(
        'Duplicates Cleanly Resolved',
        `Successfully consolidated ${mergedCount} duplicate pairs. Cleaned up ${deletedCount} duplicate accounts from database while preserving all records (debts, repairs, sales).`
      );
    } catch (err) {
      console.error('Failed to auto-resolve duplicates:', err);
      toast.error('Auto-Resolve Failed', 'An error occurred while merging duplicate accounts.');
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
    const map = new Map<string, RepairTicket[]>();
    for (const c of customers) {
      map.set(c.id, tickets.filter(t => matchesCustomer(c, t)));
    }
    return map;
  }, [customers, tickets]);

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
    let totalRepairsCount = 0;
    let totalPhonesTracked = 0;

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

      const cTickets = customerTicketsMap.get(c.id) || [];
      totalRepairsCount += cTickets.length;
      const distinctPhones = new Set<string>();
      (c.registeredDevices || []).forEach(d => {
        if (d.imei) distinctPhones.add(`imei:${d.imei.toLowerCase()}`);
        else if (d.brand || d.model) distinctPhones.add(`dev:${d.brand || ''} ${d.model || ''}`.toLowerCase().trim());
      });
      cTickets.forEach(t => {
        if (t.deviceImei) distinctPhones.add(`imei:${t.deviceImei.toLowerCase()}`);
        else if (t.deviceBrand || t.deviceModel) distinctPhones.add(`dev:${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().trim());
      });
      totalPhonesTracked += distinctPhones.size;
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
      totalRepairsCount,
      totalPhonesTracked,
      avgRevenue: scopedCustomers.length > 0 ? totalLtv / scopedCustomers.length : 0,
    };
  }, [scopedCustomers, debts, customerTicketsMap]);

  // ── Walk-in Repairs (Tickets with missing or invalid phone number OR linked to legacy phoneless accounts) ────
  const walkInTickets = useMemo(() => {
    const legacyPhonelessCustomerIds = new Set(walkInLegacyCustomers.map(c => c.id));
    return tickets.filter((t) => {
      const phoneDigits = t.customerPhone ? normalizePhoneDigits(t.customerPhone) : '';
      if (!t.customerPhone || !t.customerPhone.trim() || phoneDigits.length < 7) {
        return true;
      }
      if (t.customerId && legacyPhonelessCustomerIds.has(t.customerId)) {
        return true;
      }
      return false;
    });
  }, [tickets, walkInLegacyCustomers]);

  const walkInMetrics = useMemo(() => {
    let active = 0;
    let completed = 0;
    let ready = 0;
    let inProgress = 0;
    let pending = 0;
    let totalBilled = 0;
    let totalPaid = 0;

    for (const t of walkInTickets) {
      if (t.status === 'completed') completed++;
      else if (t.status === 'cancelled') { /* ignore */ }
      else active++;

      if (t.status === 'ready') ready++;
      if (t.status === 'in_progress') inProgress++;
      if (t.status === 'pending') pending++;

      const cost = t.actualCost != null && t.actualCost > 0 ? t.actualCost : (t.estimatedCost || 0);
      totalBilled += cost;
      totalPaid += (t.paidAmount || 0);
    }

    return {
      total: walkInTickets.length,
      active,
      completed,
      ready,
      inProgress,
      pending,
      totalBilled,
      totalPaid,
      unpaidBalance: Math.max(0, totalBilled - totalPaid),
    };
  }, [walkInTickets]);

  const filteredWalkInTickets = useMemo(() => {
    const q = walkInSearch.trim().toLowerCase();
    return walkInTickets.filter((t) => {
      if (walkInStatusFilter === 'active') {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
      } else if (walkInStatusFilter === 'completed') {
        if (t.status !== 'completed') return false;
      } else if (walkInStatusFilter !== 'all') {
        if (t.status !== walkInStatusFilter) return false;
      }

      if (!q) return true;
      const matchName = t.customerName?.toLowerCase().includes(q);
      const matchDevice = (t.deviceModel || t.deviceName || '')?.toLowerCase().includes(q);
      const matchIssue = (t.issueDescription || t.problem || '')?.toLowerCase().includes(q);
      const matchTech = t.assignedTechnician?.toLowerCase().includes(q);
      const matchTicket = t.ticketNumber?.toLowerCase().includes(q);
      const matchSerial = (t.serialNumber || t.imei || '')?.toLowerCase().includes(q);
      return Boolean(matchName || matchDevice || matchIssue || matchTech || matchTicket || matchSerial);
    });
  }, [walkInTickets, walkInSearch, walkInStatusFilter]);

  const sortedWalkInTickets = useMemo(() => {
    return [...filteredWalkInTickets].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
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
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Text search (matches name, phone, email, shop, address, notes, registered devices, and linked repair tickets)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const cleanQueryDigits = normalizePhoneDigits(searchQuery);
      const rawQueryDigits = searchQuery.replace(/\D/g, '');

      const matchCustomer = (c: Customer): boolean => {
        // 1. Name & Shop Name
        if (c.name && c.name.toLowerCase().includes(q)) return true;
        if (c.shopName && c.shopName.toLowerCase().includes(q)) return true;

        // 2. Phone matches (exact, normalized, partial digits)
        if (c.phone && c.phone.toLowerCase().includes(q)) return true;
        if (c.normalizedPhone && c.normalizedPhone.includes(q)) return true;
        if (cleanQueryDigits.length >= 2) {
          if (c.normalizedPhone && c.normalizedPhone.includes(cleanQueryDigits)) return true;
          if (normalizePhoneDigits(c.phone).includes(cleanQueryDigits)) return true;
          if (isPhoneMatch(c.phone, searchQuery)) return true;
        }
        if (rawQueryDigits.length >= 2 && c.phone && c.phone.replace(/\D/g, '').includes(rawQueryDigits)) return true;

        // 3. Email, Address, Notes
        if (c.email && c.email.toLowerCase().includes(q)) return true;
        if (c.address && c.address.toLowerCase().includes(q)) return true;
        if (c.notes && c.notes.toLowerCase().includes(q)) return true;

        // 4. Registered Devices (brand, model, combined name, IMEI, device notes)
        if (c.registeredDevices && c.registeredDevices.length > 0) {
          const devMatch = c.registeredDevices.some(d =>
            (d.brand && d.brand.toLowerCase().includes(q)) ||
            (d.model && d.model.toLowerCase().includes(q)) ||
            (`${d.brand || ''} ${d.model || ''}`.toLowerCase().includes(q)) ||
            (d.imei && d.imei.toLowerCase().includes(q)) ||
            (d.notes && d.notes.toLowerCase().includes(q))
          );
          if (devMatch) return true;
        }

        // 5. Linked Repair Tickets (ticket number, device brand/model/IMEI, issue description, technician)
        const cTickets = customerTicketsMap.get(c.id) || [];
        if (cTickets.length > 0) {
          const tktMatch = cTickets.some(t =>
            (t.ticketNumber && t.ticketNumber.toLowerCase().includes(q)) ||
            (t.deviceBrand && t.deviceBrand.toLowerCase().includes(q)) ||
            (t.deviceModel && t.deviceModel.toLowerCase().includes(q)) ||
            (`${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().includes(q)) ||
            (t.deviceImei && t.deviceImei.toLowerCase().includes(q)) ||
            (t.issueDescription && t.issueDescription.toLowerCase().includes(q)) ||
            (t.assignedTechnician && t.assignedTechnician.toLowerCase().includes(q))
          );
          if (tktMatch) return true;
        }

        return false;
      };

      // Search across ALL active customers in the directory
      const allMatches = allActiveCustomers.filter(matchCustomer);

      if (activeFilter !== 'all') {
        const testSubFilter = (c: Customer): boolean => {
          switch (activeFilter) {
            case 'overdue':
              return getCustomerOverdueInfo(debts, c.id).hasOverdue;
            case 'debt':
              return (c.totalDebt || 0) > 0;
            case 'repeat':
              return c.totalPurchases >= 2;
            case 'new':
              return c.totalPurchases <= 1;
            case 'recent':
              return new Date(c.lastVisitDate).getTime() >= thirtyDaysAgo;
            case 'b2b':
              return isShopCustomer(c);
            default:
              return true;
          }
        };

        const filteredMatches = allMatches.filter(testSubFilter);
        return filteredMatches.length > 0 ? filteredMatches : allMatches;
      }

      return allMatches;
    }

    // Default when no search query: Scoped customers filtered by category
    let list = scopedCustomers;
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
  }, [allActiveCustomers, scopedCustomers, debts, searchQuery, activeFilter, customerTicketsMap]);

  // ── Sorting ─────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === 'lastVisitDate' || sortKey === 'joinDate') {
        const timeA = a[sortKey] ? new Date(a[sortKey]).getTime() : 0;
        const timeB = b[sortKey] ? new Date(b[sortKey]).getTime() : 0;
        const valA = isNaN(timeA) ? 0 : timeA;
        const valB = isNaN(timeB) ? 0 : timeB;
        return sortDir === 'asc' ? valA - valB : valB - valA;
      }
      if (sortKey === 'totalPurchases' || sortKey === 'totalSpent' || sortKey === 'totalDebt') {
        const valA = Number(a[sortKey]) || 0;
        const valB = Number(b[sortKey]) || 0;
        return sortDir === 'asc' ? valA - valB : valB - valA;
      }
      // String sorting (e.g. name)
      const valA = (a.name || '').trim().toLowerCase();
      const valB = (b.name || '').trim().toLowerCase();
      return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
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
            {formatPrivateCurrency(metrics.totalLtv)} total lifetime value · {metrics.repeat} repeat buyers
            {permissions.customers_debt && metrics.totalDebt > 0 && ` · ${formatPrivateCurrency(metrics.totalDebt)} active credit balance`}
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
          {pendingSyncCount > 0 && (
            <Button
              variant="secondary"
              leftIcon={<RefreshCw size={15} />}
              style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a', fontWeight: 600 }}
              onClick={() => {
                toast.info('Syncing Offline Queue', 'Sending offline customer profiles to cloud...');
                offlineCustomerSyncService.syncPendingCustomers();
              }}
              title="Offline customers are waiting in queue. Click to trigger cloud sync immediately."
            >
              Sync Queue ({pendingSyncCount})
            </Button>
          )}
          <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExportCSV}>
            Export CSV
          </Button>
          {pageTab === 'walkin' ? (
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setRepairPrefill(null);
                setTicketToEdit(null);
                setIsNewTicketOpen(true);
              }}
            >
              New Repair Ticket
            </Button>
          ) : (
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
          )}
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
                {detectedDuplicates.length} Duplicate Account{detectedDuplicates.length !== 1 ? 's' : ''} Detected
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#a16207' }}>
                Matching customer accounts detected (including walk-ins & phoneless records). Click Auto Resolve to safely consolidate all debts, repairs, and orders into primary accounts and delete duplicate customer records.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMergeInitialA(detectedDuplicates[0].retail);
                setMergeInitialB(detectedDuplicates[0].shop);
                setIsMergeOpen(true);
              }}
              disabled={isAutoResolving}
              style={{ background: '#ffffff', borderColor: '#ca8a04', color: '#854d0e' }}
            >
              Review Individually
            </Button>
            <Button
              size="sm"
              variant="primary"
              leftIcon={<GitMerge size={14} />}
              onClick={handleAutoResolveAll}
              isLoading={isAutoResolving}
              style={{
                background: '#ca8a04',
                borderColor: '#a16207',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              ⚡ Auto Resolve All ({detectedDuplicates.length})
            </Button>
          </div>
        </div>
      )}

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
          <span>Customer Accounts</span>
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
          <span>Walk-in Customers</span>
          <span className={[
            styles.primaryTabCount,
            pageTab === 'walkin' ? styles.primaryTabCountActiveWalkIn : '',
          ].filter(Boolean).join(' ')}>
            {walkInTickets.length}
          </span>
          {walkInTickets.length > 0 && (
            <span className={styles.walkinTag}>
              No Phone Registered
            </span>
          )}
        </button>
      </div>

      {pageTab === 'accounts' && (
        <>
          {/* Admin / Repair Scope Selector: All | Retail | Shops */}
          {(user?.role === 'admin' || user?.role === 'repair_agent') && (
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
            <span>All Accounts ({accountCustomers.length})</span>
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
            <span>👤 Retail Customers ({accountCustomers.filter(isRetailCustomer).length})</span>
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
            <span>🏪 Shops & Parts Buyers ({accountCustomers.filter(isShopCustomer).length})</span>
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
              ? `${metrics.repeat} repeat · ${metrics.totalRepairsCount} repairs · ${metrics.totalPhonesTracked} phones`
              : effectiveScope === 'shop'
              ? `${metrics.repeat} active workshops · ${metrics.totalRepairsCount} repairs`
              : `${metrics.b2b} B2B · ${metrics.totalRepairsCount} repairs · ${metrics.totalPhonesTracked} phones`}
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
              {formatPrivateCurrency(metrics.overdueTotalAmount)}
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
              {formatPrivateCurrency(metrics.totalDebt)}
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
          <p className={styles.summaryValue}>{formatPrivateCurrency(metrics.totalLtv)}</p>
          <p className={styles.summarySub}>Avg {formatPrivateCurrency(metrics.avgRevenue)} / client</p>
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
            placeholder="Search by name, phone, device (e.g. iPhone, Oppo), ticket #, IMEI…"
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
                  const cTickets = customerTicketsMap.get(customer.id) || [];
                  const cRepairsCount = cTickets.length;
                  const distinctPhones = new Set<string>();
                  (customer.registeredDevices || []).forEach(d => {
                    if (d.imei) distinctPhones.add(`imei:${d.imei.toLowerCase()}`);
                    else if (d.brand || d.model) distinctPhones.add(`dev:${d.brand || ''} ${d.model || ''}`.toLowerCase().trim());
                  });
                  cTickets.forEach(t => {
                    if (t.deviceImei) distinctPhones.add(`imei:${t.deviceImei.toLowerCase()}`);
                    else if (t.deviceBrand || t.deviceModel) distinctPhones.add(`dev:${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().trim());
                  });
                  const distinctPhonesCount = distinctPhones.size;

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
                              {customer.id.startsWith('offline_') && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    background: '#fef3c7',
                                    color: '#b45309',
                                    border: '1px solid #fde68a',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title="Created offline. Queued to sync to Firestore automatically when online."
                                >
                                  ☁️ Offline (Queued)
                                </span>
                              )}
                            </div>
                            {customer.shopName && (
                              <span className={styles.customerContactSub}>Contact: {customer.name}</span>
                            )}
                            <span className={styles.customerJoinDate}>
                              Since {formatDate(customer.joinDate)}
                            </span>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                              {distinctPhonesCount > 0 && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    background: '#e0f2fe',
                                    color: '#0369a1',
                                    border: '1px solid #bae6fd',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title={`${distinctPhonesCount} distinct phone(s) tracked`}
                                >
                                  <Smartphone size={11} /> {distinctPhonesCount} {distinctPhonesCount === 1 ? 'Phone' : 'Phones'}
                                </span>
                              )}
                              {cRepairsCount > 0 && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    background: '#f3e8ff',
                                    color: '#7e22ce',
                                    border: '1px solid #e9d5ff',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title={`${cRepairsCount} repair ticket(s) recorded`}
                                >
                                  🛠️ {cRepairsCount} {cRepairsCount === 1 ? 'Repair' : 'Repairs'}
                                </span>
                              )}
                            </div>
                            {permissions.customers_debt && (overdueInfo.hasOverdue ? (
                              <div>
                                <span className={styles.overdueBadgeTag}>
                                  🔴 OVERDUE: {formatPrivateCurrency(overdueInfo.totalOverdueAmount)} ({overdueInfo.maxDaysOverdue}d late)
                                </span>
                              </div>
                            ) : debt > 0 ? (
                              <div>
                                <span className={styles.debtBadgeTag}>
                                  🚨 Debt: {formatPrivateCurrency(debt)}
                                </span>
                              </div>
                            ) : null)}
                          </div>
                        </div>
                      </td>
                      <td className={styles.td}>
                        <div className={styles.contactInfo}>
                          {customer.phone ? (
                            <a
                              href={`tel:${customer.phone}`}
                              className={styles.contactPhone}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={12} /> {customer.phone}
                            </a>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No phone</span>
                          )}
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
                        {cRepairsCount > 0 && (
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#6b7280', fontWeight: 600, marginTop: '2px' }}>
                            + {cRepairsCount} {cRepairsCount === 1 ? 'repair' : 'repairs'}
                          </span>
                        )}
                      </td>
                      <td className={styles.td} data-col="spent">
                        <span className={styles.spentValue}>{formatPrivateCurrency(customer.totalSpent)}</span>
                      </td>
                      {permissions.customers_debt && (
                        <td className={styles.td} data-col="debt">
                          {overdueInfo.hasOverdue ? (
                            <div>
                              <span style={{ fontWeight: 800, color: '#dc2626', display: 'block', fontSize: '13.5px' }}>
                                {formatPrivateCurrency(debt)}
                              </span>
                              <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 700 }}>
                                🔴 {overdueInfo.count} Overdue ({overdueInfo.maxDaysOverdue}d)
                              </span>
                            </div>
                          ) : debt > 0 ? (
                            <div>
                              <span style={{ fontWeight: 800, color: '#d97706', display: 'block', fontSize: '13.5px' }}>
                                {formatPrivateCurrency(debt)}
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
                              🎟️ Avoir: {formatPrivateCurrency(customer.storeCredit || 0)}
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
                          {permissions.customers_debt && debt > 0 && (() => {
                            const reminderUrl = buildWhatsAppDebtReminderUrl({
                              customerName: customer.name,
                              customerPhone: customer.phone,
                              amountOwed: debt,
                              dueDate: overdueInfo.oldestDueDate,
                              daysOverdue: overdueInfo.maxDaysOverdue,
                            });
                            return reminderUrl ? (
                              <a
                                href={reminderUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${styles.quickActionBtn} ${styles.reminderBtn}`}
                                title={overdueInfo.hasOverdue ? `Send WhatsApp Overdue Reminder (${overdueInfo.maxDaysOverdue}d late)` : 'Send WhatsApp Debt Balance Reminder'}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Send size={13} />
                              </a>
                            ) : null;
                          })()}
                          {/* 1-Click Regular WhatsApp */}
                          {(() => {
                            const waUrl = formatWhatsAppUrl(customer.phone);
                            return waUrl ? (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${styles.quickActionBtn} ${styles.whatsappBtn}`}
                                title="WhatsApp Chat"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageCircle size={14} />
                              </a>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className={`${styles.quickActionBtn} ${styles.disabledActionBtn}`}
                                title="No phone number registered"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageCircle size={14} />
                              </button>
                            );
                          })()}
                          {/* 1-Click Call */}
                          {customer.phone && normalizePhoneDigits(customer.phone).length >= 7 ? (
                            <a
                              href={`tel:${customer.phone.replace(/\s+/g, '')}`}
                              className={`${styles.quickActionBtn} ${styles.phoneBtn}`}
                              title={`Call ${customer.phone}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={14} />
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className={`${styles.quickActionBtn} ${styles.disabledActionBtn}`}
                              title="No phone number registered"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={14} />
                            </button>
                          )}
                          {/* New Repair Quick Action */}
                          {permissions.repairs && (
                            <button
                              type="button"
                              className={`${styles.quickActionBtn} ${styles.repairBtn}`}
                              title="New Repair Ticket"
                              onClick={(e) => {
                                e.stopPropagation();
                                const cTickets = customerTicketsMap.get(customer.id) || [];
                                let lastDevice: string | undefined;
                                if (customer.registeredDevices && customer.registeredDevices.length > 0) {
                                  const d = customer.registeredDevices[0];
                                  lastDevice = `${d.brand} ${d.model}`.trim();
                                } else if (cTickets.length > 0) {
                                  const sortedTickets = [...cTickets].sort(
                                    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
                                  );
                                  lastDevice = `${sortedTickets[0].deviceBrand || ''} ${sortedTickets[0].deviceModel || ''}`.trim() || undefined;
                                }
                                setRepairPrefill({ name: customer.name, phone: customer.phone || '', lastDevice });
                                setTicketToEdit(null);
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
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomerName(customer.name);
                              setCustomerPhone(customer.phone || '');
                              toast.success('Customer Attached', `${customer.name} attached to next POS sale.`);
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
        </>
      )}

      {pageTab === 'walkin' && (
        <>
          {/* Walk-in Repairs KPI Summary Grid */}
          <div className={styles.summaryGrid}>
            <div
              className={[
                styles.summaryCard,
                walkInStatusFilter === 'all' && styles.summaryCardActive
              ].filter(Boolean).join(' ')}
              onClick={() => { setWalkInStatusFilter('all'); setWalkInPage(1); }}
              title="Click to view all walk-in repairs"
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Total Walk-in Repairs</span>
                <div className={[styles.summaryIconWrap, styles.iconTotal].join(' ')}>
                  <Wrench size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>{walkInMetrics.total}</p>
              <p className={styles.summarySub}>Repairs without phone number</p>
            </div>

            <div
              className={[
                styles.summaryCard,
                walkInStatusFilter === 'active' && styles.summaryCardActive
              ].filter(Boolean).join(' ')}
              onClick={() => { setWalkInStatusFilter('active'); setWalkInPage(1); }}
              title="Click to filter active repairs in workshop"
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Active in Workshop</span>
                <div className={[styles.summaryIconWrap, styles.iconRepeat].join(' ')}>
                  <Clock size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>{walkInMetrics.active}</p>
              <p className={styles.summarySub}>
                {walkInMetrics.inProgress} in progress · {walkInMetrics.ready} ready
              </p>
            </div>

            <div
              className={[
                styles.summaryCard,
                walkInStatusFilter === 'completed' && styles.summaryCardActive
              ].filter(Boolean).join(' ')}
              onClick={() => { setWalkInStatusFilter('completed'); setWalkInPage(1); }}
              title="Click to filter completed repairs"
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Completed & Picked Up</span>
                <div className={[styles.summaryIconWrap, styles.iconNew].join(' ')}>
                  <CheckCircle2 size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>{walkInMetrics.completed}</p>
              <p className={styles.summarySub}>Picked up by walk-in clients</p>
            </div>

            <div className={styles.summaryCard} style={{ cursor: 'default' }}>
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Total Billed</span>
                <div className={[styles.summaryIconWrap, styles.iconLtv].join(' ')}>
                  <DollarSign size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>
                {formatPrivateCurrency(walkInMetrics.totalBilled)}
              </p>
              <p className={styles.summarySub}>
                {formatPrivateCurrency(walkInMetrics.totalPaid)} collected
                {walkInMetrics.unpaidBalance > 0 && ` · ${formatPrivateCurrency(walkInMetrics.unpaidBalance)} due`}
              </p>
            </div>
          </div>

          {/* Walk-in Status Quick Filter Pills */}
          <div className={styles.filterPills}>
            {[
              { label: 'All Walk-in Repairs', value: 'all', count: walkInTickets.length },
              { label: 'Active in Workshop', value: 'active', count: walkInMetrics.active },
              { label: 'Pending Intake', value: 'pending', count: walkInMetrics.pending },
              { label: 'In Progress', value: 'in_progress', count: walkInMetrics.inProgress },
              { label: 'Ready for Pickup', value: 'ready', count: walkInMetrics.ready },
              { label: 'Completed', value: 'completed', count: walkInMetrics.completed },
            ].map((pill) => (
              <button
                key={pill.value}
                type="button"
                className={[
                  styles.filterPill,
                  walkInStatusFilter === pill.value ? styles.filterPillActive : ''
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  setWalkInStatusFilter(pill.value as any);
                  setWalkInPage(1);
                }}
              >
                <span>{pill.label}</span>
                <span className={styles.pillCount}>{pill.count}</span>
              </button>
            ))}
          </div>

          {/* Walk-in Repair Records Table Card */}
          <div className={styles.catalogCard}>
            <div className={styles.tableHeader}>
              <div className={styles.headerLeft}>
                <h2 className={styles.tableTitle}>Walk-in Repair Directory</h2>
                <span className={styles.itemCountBadge}>
                  {sortedWalkInTickets.length} {sortedWalkInTickets.length === 1 ? 'repair' : 'repairs'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SearchInput
                  value={walkInSearch}
                  onChange={(v) => { setWalkInSearch(v); setWalkInPage(1); }}
                  placeholder="Search by client, device, problem, technician, ticket #…"
                  className={styles.search}
                />
                {walkInSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setWalkInSearch(''); setWalkInPage(1); }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className={styles.tableWrapper}>
              {sortedWalkInTickets.length === 0 ? (
                <div style={{ padding: '48px 20px' }}>
                  <EmptyState
                    title={walkInSearch ? 'No matching walk-in repairs' : 'No walk-in repairs found'}
                    description={
                      walkInSearch
                        ? `No walk-in repairs matched "${walkInSearch}". Try searching with a different term.`
                        : 'All repair tickets have registered customer accounts with phone numbers. When a repair is created without a phone number, it will automatically appear here as a walk-in record.'
                    }
                    action={
                      walkInSearch ? (
                        <Button variant="secondary" size="sm" onClick={() => setWalkInSearch('')}>
                          Clear Search
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Ticket / Date</th>
                      <th className={styles.th}>Walk-in Client</th>
                      <th className={styles.th}>Device & Problem</th>
                      <th className={styles.th}>Status & Tech</th>
                      <th className={styles.th}>Cost & Balance</th>
                      <th className={styles.th} style={{ textAlign: 'right', minWidth: '180px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWalkInTickets.map((ticket) => {
                      const issueTag = detectIssueTag(ticket.issueDescription || '');
                      const brandIcon = getBrandIcon(ticket.deviceModel || '');
                      const cost = ticket.actualCost != null && ticket.actualCost > 0 ? ticket.actualCost : (ticket.estimatedCost || 0);
                      const paid = ticket.paidAmount || 0;
                      const balance = Math.max(0, cost - paid);

                      return (
                        <tr
                          key={ticket.id}
                          className={styles.tr}
                          onClick={() => setSelectedWalkInTicket(ticket)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span className={styles.ticketBadge}>
                                {ticket.ticketNumber || `#${ticket.id.slice(-6)}`}
                              </span>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {ticket.createdAt ? formatDate(ticket.createdAt) : '—'}
                              </span>
                              {ticket.createdAt && (
                                <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                                  {formatTimeAgo(ticket.createdAt)}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div className={styles.customerCell}>
                              <div
                                className={styles.customerAvatar}
                                style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}
                              >
                                {ticket.customerName ? ticket.customerName.charAt(0).toUpperCase() : '?'}
                              </div>
                              <div className={styles.customerInfoGroup}>
                                <div className={styles.customerNameRow}>
                                  <p className={styles.customerName}>{ticket.customerName || 'Anonymous Walk-in'}</p>
                                  <span className={styles.walkinTag}>Walk-in</span>
                                </div>
                                <span style={{ fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                                  <AlertTriangle size={11} /> No phone registered
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '260px' }}>
                              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span>{brandIcon}</span>
                                <span>{ticket.deviceModel || 'Unknown Device'}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: '11px',
                                  background: '#f1f5f9',
                                  color: '#475569',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}>
                                  <span>{issueTag.icon}</span>
                                  <span>{issueTag.label}</span>
                                </span>
                                {ticket.issueDescription && (
                                  <span
                                    style={{
                                      fontSize: '11.5px',
                                      color: '#64748b',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      maxWidth: '170px'
                                    }}
                                    title={ticket.issueDescription}
                                  >
                                    {ticket.issueDescription}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <RepairStatusBadge status={ticket.status} />
                              <span style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <User size={12} />
                                {ticket.assignedTechnician || 'Unassigned'}
                              </span>
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span className={styles.spentValue}>
                                {formatPrivateCurrency(cost)}
                              </span>
                              {balance > 0 ? (
                                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 700 }}>
                                  Due: {formatPrivateCurrency(balance)}
                                </span>
                              ) : (
                                <span className={styles.settledBadge}>
                                  <CheckCircle2 size={11} /> Settled
                                </span>
                              )}
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div className={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={styles.quickActionBtn}
                                title="Print Ticket Label / Receipt"
                                onClick={() => setPrintingWalkInTicket(ticket)}
                              >
                                <Printer size={14} />
                              </button>
                              <button
                                type="button"
                                className={styles.quickActionBtn}
                                title="Edit Repair / Add Phone Number (Converts to Account)"
                                onClick={() => {
                                  setTicketToEdit(ticket);
                                  setIsNewTicketOpen(true);
                                }}
                              >
                                <Edit size={14} />
                              </button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setSelectedWalkInTicket(ticket)}
                                title="Open Sidebar Details Widget"
                              >
                                <Eye size={14} /> Details
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

            {sortedWalkInTickets.length > 0 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0' }}>
                <Pagination
                  currentPage={walkInPage}
                  totalPages={totalWalkInPages}
                  onPageChange={setWalkInPage}
                  itemsPerPage={walkInItemsPerPage}
                  totalItems={sortedWalkInTickets.length}
                />
              </div>
            )}
          </div>
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
        title="Delete Customer Account"
        message={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>
              Are you sure you want to permanently delete <strong>{customerToDelete?.name}</strong>?
            </p>
            {(customerToDelete?.totalDebt || 0) > 0 && (
              <p style={{ margin: 0, color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
                ⚠️ Warning: This customer currently has an unpaid debt of {formatPrivateCurrency(customerToDelete?.totalDebt || 0)}. Deleting the account will also remove all associated debt records.
              </p>
            )}
          </div>
        }
        confirmLabel="Delete Customer"
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
