import type { Customer, RepairTicket, SaleTransaction, CustomerDebtEntry } from '../types';
import { isPhoneMatch, normalizePhoneDigits } from './phoneUtils';

export interface CustomerFinancialStats {
  totalSpent: number;
  totalPurchases: number;
  totalDebt: number;
  ticketsCount: number;
  lastVisitDate?: string;
}

const GENERIC_NAMES = new Set([
  'client',
  'client pos',
  'customer',
  'passager',
  'inconnu',
  'unknown',
  'walk-in',
  'pos',
  'comptoir',
  'anonyme',
  'anonymous',
]);

export const isGenericCustomerName = (name?: string | null): boolean => {
  if (!name) return true;
  return GENERIC_NAMES.has(name.trim().toLowerCase());
};

/**
 * Robust matching between a customer profile and an entity (Transaction, Ticket, or Debt)
 * Supporting direct customerId match, normalized phone match, and safe non-generic name match.
 */
export const matchesCustomer = (
  customer: Customer,
  entity: { customerId?: string; customerPhone?: string; customerName?: string; shopName?: string }
): boolean => {
  // 1. Direct ID match
  if (entity.customerId && entity.customerId === customer.id) {
    return true;
  }

  // 2. Phone match (requires >= 7 digits for confidence)
  if (entity.customerPhone && customer.phone && isPhoneMatch(entity.customerPhone, customer.phone)) {
    return true;
  }

  // 2b. Shop name match (if entity.shopName matches customer.shopName)
  if (
    entity.shopName &&
    customer.shopName &&
    entity.shopName.trim().toLowerCase() === customer.shopName.trim().toLowerCase() &&
    !isGenericCustomerName(customer.shopName)
  ) {
    if (
      entity.customerPhone &&
      customer.phone &&
      normalizePhoneDigits(entity.customerPhone).length >= 7 &&
      normalizePhoneDigits(customer.phone).length >= 7 &&
      !isPhoneMatch(entity.customerPhone, customer.phone)
    ) {
      return false;
    }
    return true;
  }

  // 3. Name match (only if neither has an ID/phone mismatch, and name is not generic, >= 3 chars)
  if (
    !entity.customerId &&
    entity.customerName &&
    customer.name &&
    !isGenericCustomerName(customer.name) &&
    customer.name.trim().length >= 3
  ) {
    const eName = entity.customerName.trim().toLowerCase();
    const cName = customer.name.trim().toLowerCase();
    const cShop = (customer.shopName || '').trim().toLowerCase();
    if (eName === cName || (cShop && eName === cShop)) {
      // If phone is provided on both but they don't match, do not associate
      if (
        entity.customerPhone &&
        customer.phone &&
        normalizePhoneDigits(entity.customerPhone).length >= 7 &&
        normalizePhoneDigits(customer.phone).length >= 7 &&
        !isPhoneMatch(entity.customerPhone, customer.phone)
      ) {
        return false;
      }
      return true;
    }
  }

  return false;
};

/**
 * Normalizes device brand and model names to prevent duplicates and redundant prefixes.
 * e.g. brand "Apple", model "Apple iPhone 11" -> brand "Apple", model "iPhone 11", displayName "Apple iPhone 11"
 */
export const normalizeDeviceDetails = (brandRaw?: string | null, modelRaw?: string | null) => {
  let brand = (brandRaw || '').trim();
  let model = (modelRaw || '').trim();

  // Strip redundant leading brand from model (case-insensitive)
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) {
    const stripped = model.slice(brand.length).trim();
    if (stripped) {
      model = stripped;
    }
  }

  const displayName = brand && model
    ? `${brand} ${model}`
    : (brand || model || 'Unknown Device');

  const canonicalKey = `${brand.toLowerCase()} ${model.toLowerCase()}`.trim() || 'unknown';

  return {
    brand,
    model,
    cleanBrand: brand,
    cleanModel: model,
    displayName,
    canonicalKey,
  };
};

/**
 * Authoritatively calculates real money spent by a customer from verifiable receipts & records.
 * Rules:
 *  - Only actual money PAID is counted towards totalSpent.
 *  - Any unpaid debt balance is strictly kept in totalDebt and NEVER counted as spent.
 *  - Partial debt payments add to totalSpent as they are paid.
 *  - Fully refunded sales are excluded from totalSpent.
 *  - Completed repairs and sales count towards totalPurchases.
 */
export const calculateCustomerFinancials = (
  customer: Customer,
  tickets: RepairTicket[] = [],
  transactions: SaleTransaction[] = [],
  debts: CustomerDebtEntry[] = []
): CustomerFinancialStats => {
  // Filter matching entities with strict ID deduplication to prevent double counting
  const debtMap = new Map<string, CustomerDebtEntry>();
  for (const d of debts) {
    if (d && d.id && !debtMap.has(d.id) && matchesCustomer(customer, d)) {
      debtMap.set(d.id, d);
    }
  }
  const matchedDebts = Array.from(debtMap.values());

  const ticketMap = new Map<string, RepairTicket>();
  for (const tk of tickets) {
    if (tk && tk.id && !ticketMap.has(tk.id) && matchesCustomer(customer, tk)) {
      ticketMap.set(tk.id, tk);
    }
  }
  const matchedTickets = Array.from(ticketMap.values());

  const txMap = new Map<string, SaleTransaction>();
  for (const tx of transactions) {
    if (tx && tx.id && !txMap.has(tx.id) && matchesCustomer(customer, tx)) {
      txMap.set(tx.id, tx);
    }
  }
  const matchedTxs = Array.from(txMap.values());

  // Current unpaid debt balance
  const totalDebt = matchedDebts.reduce((sum, d) => {
    if (d.status !== 'paid' && d.remainingBalance > 0) {
      return sum + d.remainingBalance;
    }
    return sum;
  }, 0);

  // Set of debt IDs associated with transactions/tickets so we don't double count
  const linkedDebtIds = new Set<string>();

  // 1. Sales Transactions (POS & Parts B2B)
  let salesPaid = 0;
  let completedSalesCount = 0;

  for (const tx of matchedTxs) {
    if (tx.status === 'refunded' || tx.status === 'voided' || tx.status === 'pending_approval') {
      continue;
    }

    completedSalesCount++;

    // Check if there is an associated debt for this transaction
    const linkedDebt = matchedDebts.find(d => 
      d.transactionId === tx.id || 
      (tx.invoiceNumber && d.invoiceNumber === tx.invoiceNumber) ||
      (d.metadata && d.metadata.transactionId === tx.id)
    );

    if (linkedDebt) {
      linkedDebtIds.add(linkedDebt.id);
      const txTotal = tx.total || 0;
      const unpaid = linkedDebt.remainingBalance || 0;
      salesPaid += Math.max(0, txTotal - unpaid);
      continue;
    }

    if (tx.accountSettlement) {
      salesPaid += (tx.accountSettlement.paidAmount || 0);
      if (tx.accountSettlement.debtEntryId) {
        linkedDebtIds.add(tx.accountSettlement.debtEntryId);
      }
      continue;
    }

    if (tx.payments && tx.payments.length > 0) {
      const nonDebtPaid = tx.payments
        .filter(p => p.method !== 'debt')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      salesPaid += Math.min(tx.total || 0, Math.max(0, nonDebtPaid));
      continue;
    }

    // Default regular transaction
    salesPaid += (tx.total || 0);
  }

  // 2. Repair Tickets
  let repairsPaid = 0;
  let completedRepairsCount = 0;

  for (const tk of matchedTickets) {
    const totalCost = tk.actualCost != null && tk.actualCost > 0 ? tk.actualCost : (tk.estimatedCost || 0);
    const deposit = tk.depositAmount || 0;

    if (tk.status === 'completed') {
      completedRepairsCount++;
    }

    // Check for linked debt in debts collection
    // Priority: explicit linkedTicketId → debtEntryId on ticket → legacy string match (fallback for old records)
    const linkedDebt = matchedDebts.find(d =>
      (d.linkedTicketId && d.linkedTicketId === tk.id) ||
      d.id === tk.debtEntryId ||
      (d.productOrService && tk.ticketNumber && d.productOrService.includes(tk.ticketNumber))
    );

    if (linkedDebt) {
      linkedDebtIds.add(linkedDebt.id);
      if (linkedDebt.status === 'paid' || linkedDebt.remainingBalance <= 0) {
        repairsPaid += totalCost;
      } else {
        repairsPaid += Math.max(0, totalCost - linkedDebt.remainingBalance);
      }
      continue;
    }

    if (tk.paymentStatus === 'debt') {
      repairsPaid += deposit;
    } else if (tk.paymentStatus === 'partial') {
      repairsPaid += (tk.paidAmount ?? deposit);
    } else if (tk.paymentStatus === 'paid') {
      repairsPaid += (tk.paidAmount ?? totalCost);
    } else if (tk.status === 'completed') {
      repairsPaid += (tk.paidAmount ?? totalCost);
    } else {
      // In-progress, ready, pending
      repairsPaid += deposit;
    }
  }

  // 3. Standalone General Debts (e.g. opening debt payments)
  let generalDebtPaid = 0;
  for (const d of matchedDebts) {
    if (!linkedDebtIds.has(d.id) && !d.transactionId) {
      const paidOnDebt = d.amountPaid || (d.payments ? d.payments.reduce((s, p) => s + (p.amount || 0), 0) : 0);
      generalDebtPaid += Math.max(0, paidOnDebt);
    }
  }

  // Total spent is the exact sum of real paid money
  const computedTotalSpent = Math.max(0, Math.round((salesPaid + repairsPaid + generalDebtPaid) * 100) / 100);
  const totalPurchases = completedSalesCount + completedRepairsCount;

  // 4. Latest Visit Date
  let latestVisit: number = customer.lastVisitDate ? new Date(customer.lastVisitDate).getTime() : 0;
  for (const tx of matchedTxs) {
    const t = new Date(tx.date).getTime();
    if (!isNaN(t) && t > latestVisit) latestVisit = t;
  }
  for (const tk of matchedTickets) {
    const t = new Date(tk.updatedAt || tk.createdAt).getTime();
    if (!isNaN(t) && t > latestVisit) latestVisit = t;
  }

  return {
    totalSpent: computedTotalSpent,
    totalPurchases,
    totalDebt,
    ticketsCount: matchedTickets.length,
    lastVisitDate: latestVisit > 0 ? new Date(latestVisit).toISOString() : customer.lastVisitDate,
  };
};
