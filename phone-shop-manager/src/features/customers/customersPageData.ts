import type { Customer, CustomerDebtEntry, RepairTicket } from '../../types';
import { isShopCustomer } from '../../types';
import { getCustomerOverdueInfo, getOverdueDebts } from '../../utils/debtAlerts';
import { normalizePhoneDigits, isPhoneMatch } from '../../utils/phoneUtils';
import { matchesCustomer } from '../../utils/customerFinancials';
import { formatDate } from './customersPageUtils';
import { normalizeArabic, phoneQueryDigits } from '../../utils/normalizeText';
import type { CustomerFilter, SortKey, WalkInStatusFilter } from './customersPageTypes';

// Fast lookup of tickets per customer (indexed across ALL active customers)
export const buildCustomerTicketsMap = (customers: Customer[], tickets: RepairTicket[]) => {
  const map = new Map<string, RepairTicket[]>();
  for (const c of customers) {
    map.set(c.id, tickets.filter(t => matchesCustomer(c, t)));
  }
  return map;
};

// Pre-computed device count per customer (avoids recomputing per rendered row)
export const buildCustomerDeviceCountMap = (customers: Customer[], customerTicketsMap: Map<string, RepairTicket[]>) => {
  const map = new Map<string, number>();
  for (const c of customers) {
    const cTickets = customerTicketsMap.get(c.id) || [];
    const distinctDevices = new Set<string>();
    (c.registeredDevices || []).forEach(d => {
      if (d.imei) distinctDevices.add(`imei:${d.imei.toLowerCase()}`);
      else if (d.brand || d.model) distinctDevices.add(`dev:${d.brand || ''} ${d.model || ''}`.toLowerCase().trim());
    });
    cTickets.forEach(t => {
      if (t.deviceImei) distinctDevices.add(`imei:${t.deviceImei.toLowerCase()}`);
      else if (t.deviceBrand || t.deviceModel) distinctDevices.add(`dev:${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().trim());
    });
    map.set(c.id, distinctDevices.size);
  }
  return map;
};

// ── Derived metrics ───────────────────────────────────────────────────
export const computeCustomersMetrics = (
  scopedCustomers: Customer[],
  debts: CustomerDebtEntry[],
  customerTicketsMap: Map<string, RepairTicket[]>,
  customerDeviceCountMap: Map<string, number>,
) => {
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
      totalPhonesTracked += customerDeviceCountMap.get(c.id) || 0;
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
};

export type CustomersMetrics = ReturnType<typeof computeCustomersMetrics>;

// ── Walk-in Repairs (Tickets with missing or invalid phone number OR linked to legacy phoneless accounts) ────
export const computeWalkInTickets = (tickets: RepairTicket[], walkInLegacyCustomers: Customer[]) => {
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
};

export const computeWalkInMetrics = (walkInTickets: RepairTicket[]) => {
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
};

export type WalkInMetrics = ReturnType<typeof computeWalkInMetrics>;

export const filterWalkInTickets = (
  walkInTickets: RepairTicket[],
  walkInSearch: string,
  walkInStatusFilter: WalkInStatusFilter,
) => {
  const q = normalizeArabic(walkInSearch);
  return walkInTickets.filter((t) => {
    if (walkInStatusFilter === 'active') {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
    } else if (walkInStatusFilter === 'completed') {
      if (t.status !== 'completed') return false;
    } else if (walkInStatusFilter !== 'all') {
      if (t.status !== walkInStatusFilter) return false;
    }

    if (!q) return true;
    const matchName = normalizeArabic(t.customerName).includes(q);
    const matchDevice = normalizeArabic(t.deviceModel || t.deviceName).includes(q);
    const matchIssue = normalizeArabic(t.issueDescription || t.problem).includes(q);
    const matchTech = normalizeArabic(t.assignedTechnician).includes(q);
    const matchTicket = normalizeArabic(t.ticketNumber).includes(q);
    const matchSerial = normalizeArabic(t.serialNumber || t.imei).includes(q);
    return matchName || matchDevice || matchIssue || matchTech || matchTicket || matchSerial;
  });
};

export const sortWalkInTickets = (filteredWalkInTickets: RepairTicket[]) => {
  return [...filteredWalkInTickets].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });
};

export interface CustomersDirectoryFilterInput {
  allActiveCustomers: Customer[];
  scopedCustomers: Customer[];
  debts: CustomerDebtEntry[];
  searchQuery: string;
  activeFilter: CustomerFilter;
  customerTicketsMap: Map<string, RepairTicket[]>;
}

// ── Filtering ─────────────────────────────────────────────────────────
export const filterCustomersDirectory = ({
  allActiveCustomers,
  scopedCustomers,
  debts,
  searchQuery,
  activeFilter,
  customerTicketsMap,
}: CustomersDirectoryFilterInput): Customer[] => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Text search (matches name, phone, email, shop, address, notes, registered devices, and linked repair tickets)
    if (searchQuery.trim()) {
      const q = normalizeArabic(searchQuery);
      const queryDigits = phoneQueryDigits(searchQuery);
      const cleanQueryDigits = queryDigits ? normalizePhoneDigits(queryDigits) : '';

      const matchCustomer = (c: Customer): boolean => {
        // 1. Name & Shop Name
        if (normalizeArabic(c.name).includes(q)) return true;
        if (normalizeArabic(c.shopName).includes(q)) return true;

        // 2. Phone matches — only when the query is a number, so the digits in a
        //    model name ("A54") stop matching every phone that contains them.
        if (queryDigits.length >= 2) {
          const rawPhoneDigits = normalizeArabic(c.phone).replace(/\s/g, '');
          if (rawPhoneDigits.includes(queryDigits)) return true;
          if (c.normalizedPhone && c.normalizedPhone.includes(queryDigits)) return true;
          if (cleanQueryDigits.length >= 2) {
            if (c.normalizedPhone && c.normalizedPhone.includes(cleanQueryDigits)) return true;
            if (normalizePhoneDigits(c.phone).includes(cleanQueryDigits)) return true;
            if (isPhoneMatch(c.phone, queryDigits)) return true;
          }
        }

        // 3. Email, Address, Notes
        if (c.email && normalizeArabic(c.email).includes(q)) return true;
        if (c.address && normalizeArabic(c.address).includes(q)) return true;
        if (c.notes && normalizeArabic(c.notes).includes(q)) return true;

        // 4. Registered Devices (brand, model, combined name, IMEI, device notes)
        if (c.registeredDevices && c.registeredDevices.length > 0) {
          const devMatch = c.registeredDevices.some(d =>
            (d.brand && normalizeArabic(d.brand).includes(q)) ||
            (d.model && normalizeArabic(d.model).includes(q)) ||
            (normalizeArabic(`${d.brand || ''} ${d.model || ''}`).includes(q)) ||
            (d.imei && normalizeArabic(d.imei).includes(q)) ||
            (d.notes && normalizeArabic(d.notes).includes(q))
          );
          if (devMatch) return true;
        }

        // 5. Linked Repair Tickets (ticket number, device brand/model/IMEI, issue description, technician)
        const cTickets = customerTicketsMap.get(c.id) || [];
        if (cTickets.length > 0) {
          const tktMatch = cTickets.some(t =>
            (t.ticketNumber && normalizeArabic(t.ticketNumber).includes(q)) ||
            (t.deviceBrand && normalizeArabic(t.deviceBrand).includes(q)) ||
            (t.deviceModel && normalizeArabic(t.deviceModel).includes(q)) ||
            (normalizeArabic(`${t.deviceBrand || ''} ${t.deviceModel || ''}`).includes(q)) ||
            (t.deviceImei && normalizeArabic(t.deviceImei).includes(q)) ||
            (t.issueDescription && normalizeArabic(t.issueDescription).includes(q)) ||
            (t.assignedTechnician && normalizeArabic(t.assignedTechnician).includes(q))
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
        // Always return filtered results (even if empty) — don't silently fall back to unfiltered
        return filteredMatches;
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
};

// ── Sorting ───────────────────────────────────────────────────────────
export const sortCustomersDirectory = (filtered: Customer[], sortKey: SortKey, sortDir: 'asc' | 'desc') => {
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
};

// ── Export CSV rows ───────────────────────────────────────────────────
export const buildCustomersCsvContent = (sorted: Customer[], debts: CustomerDebtEntry[]) => {
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

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};
