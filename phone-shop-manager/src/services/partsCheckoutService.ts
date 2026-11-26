import { collection, doc, getDocsFromServer, query, runTransaction, Timestamp, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Customer, CustomerDebtEntry, PhoneModel, SaleTransaction } from '../types';
import { computeStockStatus } from '../utils/stockStatus';
import { saleOpeningPayments } from '../utils/debtPayments';
import { offlineQueueMirror } from './offlineQueueMirror';
import { invalidateReportsCache } from './reportCacheInvalidation';

const JOURNAL_KEY = 'parts_checkout_journal';

type CheckoutOptions = { draftKey: string; allowCreditLimitOverride?: boolean; actorRole?: string };

export interface PendingPartsCheckout extends CheckoutOptions {
  transaction: SaleTransaction;
  requestKey: string;
}

export interface PartsCheckoutResult {
  transaction?: SaleTransaction;
  debtEntry?: CustomerDebtEntry;
  customer?: Customer;
  stock: PhoneModel[];
  cancelled: boolean;
  pending: PendingPartsCheckout;
}

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const cents = (amount: number): number => {
  const result = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(result) || result < 0) throw new Error('Invalid checkout amount.');
  return result;
};

const requestKeyOf = (transaction: Omit<SaleTransaction, 'id'>): string => JSON.stringify({
  items: transaction.items.map(item => ({
    id: item.product.id, quantity: item.quantity, price: item.unitPrice ?? item.product.price,
  })),
  subtotal: transaction.subtotal,
  discount: transaction.discount,
  lineDiscounts: transaction.lineDiscounts,
  total: transaction.total,
  payments: transaction.payments,
  customerId: transaction.customerId,
  customerName: transaction.customerName,
  customerPhone: transaction.customerPhone,
  accountSettlement: transaction.accountSettlement,
  processedById: transaction.processedById,
});

function readJournal(): Record<string, PendingPartsCheckout> {
  const raw = localStorage.getItem(JOURNAL_KEY);
  if (!raw) return {};
  const journal = JSON.parse(raw);
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)) throw new Error('The checkout recovery journal is unreadable. Do not retry the sale.');
  for (const [actorId, pending] of Object.entries(journal) as [string, PendingPartsCheckout][]) {
    if (!pending?.transaction?.id || pending.transaction.processedById !== actorId || typeof pending.requestKey !== 'string' || typeof pending.draftKey !== 'string') throw new Error('The checkout recovery journal is unreadable. Do not retry the sale.');
  }
  return journal;
}

function saveJournal(journal: Record<string, PendingPartsCheckout>): void {
  const raw = JSON.stringify(journal);
  // A sale cannot start unless its retry identity has actually reached local storage.
  localStorage.setItem(JOURNAL_KEY, raw);
  offlineQueueMirror.write(JOURNAL_KEY, raw);
}

function withJournalLock<T>(change: () => T): Promise<T> {
  if (!navigator.locks) throw new Error('This browser cannot protect checkout recovery. Use the desktop app or an up-to-date browser over HTTPS.');
  return navigator.locks.request(JOURNAL_KEY, async () => change());
}

async function commitPending(pending: PendingPartsCheckout, cancel: boolean): Promise<PartsCheckoutResult> {
  if (!navigator.onLine) throw new Error('Connect to the server to confirm this checkout. No offline sale has been recorded.');
  const sale = pending.transaction;
  const saleRef = doc(db, 'transactions', sale.id);
  const receiptRef = doc(db, 'operation_receipts', `parts_checkout_${sale.id}`);
  const debtRef = doc(db, 'customer_debts', `parts_${sale.id}`);

  return runTransaction(db, async tx => {
    const saleSnap = await tx.get(saleRef);
    const receiptSnap = await tx.get(receiptRef);
    if (receiptSnap.exists() && receiptSnap.data().checkoutOutcome === 'cancelled') {
      if (!cancel) throw new Error('This checkout was cancelled. Resolve the saved attempt before starting again.');
      return { cancelled: true, stock: [], pending };
    }
    if (saleSnap.exists()) {
      if (saleSnap.data().idempotencyKey !== sale.id) throw new Error('Checkout identity conflict. Do not repeat this sale.');
      const saved = { ...saleSnap.data(), id: sale.id } as SaleTransaction;
      const debtId = saved.accountSettlement?.debtEntryId;
      const debtSnap = debtId ? await tx.get(doc(db, 'customer_debts', debtId)) : null;
      const customerSnap = saved.customerId ? await tx.get(doc(db, 'customers', saved.customerId)) : null;
      const stock: PhoneModel[] = [];
      for (const id of new Set(saved.items.map(item => item.product.id))) {
        const snap = await tx.get(doc(db, 'inventory', id));
        if (snap.exists()) stock.push({ ...snap.data(), id } as PhoneModel);
      }
      return {
        transaction: saved,
        debtEntry: debtSnap?.exists() ? { ...debtSnap.data(), id: debtId! } as CustomerDebtEntry : undefined,
        customer: customerSnap?.exists() ? { ...customerSnap.data(), id: saved.customerId! } as Customer : undefined,
        cancelled: false, stock, pending,
      };
    }
    if (receiptSnap.exists()) throw new Error('This checkout was saved but its invoice is no longer available. Do not repeat the sale.');

    const receipt = {
      category: cancel ? 'system' : 'sales',
      message: cancel ? `Unconfirmed Parts checkout cancelled: ${sale.invoiceNumber}` : `Parts invoice ${sale.invoiceNumber} completed`,
      entityId: sale.id, entityType: 'sale',
      userId: sale.processedById, userName: sale.processedByName || 'Staff',
      timestamp: Timestamp.now(),
      checkoutOutcome: cancel ? 'cancelled' : 'committed',
    };
    if (cancel) {
      // This tombstone conflicts with any late commit, so cancellation is not a local guess.
      tx.set(receiptRef, receipt);
      return { cancelled: true, stock: [], pending };
    }

    const quantities = new Map<string, number>();
    for (const item of sale.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.product.id.startsWith('offline_')) throw new Error('Invalid or unsynced checkout item.');
      quantities.set(item.product.id, (quantities.get(item.product.id) ?? 0) + item.quantity);
    }
    const stock: PhoneModel[] = [];
    for (const [id, quantity] of quantities) {
      const snap = await tx.get(doc(db, 'inventory', id));
      if (!snap.exists()) throw new Error(`Part no longer exists: ${id}`);
      const product = { ...snap.data(), id } as PhoneModel;
      if (!Number.isSafeInteger(product.stock) || product.stock < quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${id}:requested=${quantity}:available=${product.stock}`);
      }
      const nextStock = product.stock - quantity;
      stock.push({ ...product, stock: nextStock, stockStatus: computeStockStatus(nextStock, product.lowStockThreshold ?? 1) });
    }

    const customerRef = sale.customerId ? doc(db, 'customers', sale.customerId) : null;
    const customerSnap = customerRef ? await tx.get(customerRef) : null;
    const customer = customerSnap?.exists() ? customerSnap.data() as Customer : null;
    if (sale.customerId && (!customer || customer.mergedIntoId || sale.customerId.startsWith('offline_'))) {
      throw new Error('Select an active, synced customer account manually.');
    }
    const settlement = sale.accountSettlement;
    let debtEntry: CustomerDebtEntry | undefined;
    let currentDebtCents = 0;
    if (settlement && settlement.chargedAmount > 0) {
      if (!customer || !customerRef) throw new Error('A customer account is required for a credit sale.');
      if ((await tx.get(debtRef)).exists()) throw new Error('Checkout debt identity conflict. Do not repeat this sale.');
      const debts = await getDocsFromServer(query(collection(db, 'customer_debts'), where('customerId', '==', sale.customerId)));
      for (const entry of debts.docs) {
        const snap = await tx.get(entry.ref);
        if (snap.exists() && snap.data().status !== 'paid') currentDebtCents += cents(snap.data().remainingBalance ?? 0);
      }
      const projectedCents = currentDebtCents + cents(settlement.chargedAmount);
      if (customer.creditLimit && projectedCents > cents(customer.creditLimit) && !pending.allowCreditLimitOverride && pending.actorRole !== 'admin') {
        throw new Error('Credit limit exceeded. Admin override required.');
      }
      const itemsSummary = sale.items.map(item => `${item.quantity}x ${item.product.name} ${item.product.model || ''}`.trim()).join(', ');
      debtEntry = clean({
        id: debtRef.id, customerId: sale.customerId!, customerName: customer.name,
        customerPhone: customer.phone || '', productOrService: itemsSummary,
        date: sale.date, totalAmount: sale.total, amountPaid: settlement.paidAmount,
        remainingBalance: settlement.chargedAmount,
        status: settlement.paidAmount > 0 ? 'partially_paid' : 'unpaid',
        dueDate: settlement.dueDate, notes: settlement.notes ? `${settlement.notes} (Invoice #${sale.invoiceNumber})` : `Parts Invoice #${sale.invoiceNumber}`,
        transactionId: sale.id, invoiceNumber: sale.invoiceNumber, idempotencyKey: debtRef.id,
        itemsSummary, type: 'parts_b2b',
        payments: saleOpeningPayments(sale.payments, sale.date, sale.processedByName),
        createdAt: sale.date, updatedAt: sale.date,
      });
    }

    const saved: SaleTransaction = clean({
      ...sale,
      ...(settlement ? { accountSettlement: { ...settlement, debtEntryId: debtEntry?.id } } : {}),
    });
    for (const product of stock) tx.update(doc(db, 'inventory', product.id), { stock: product.stock, stockStatus: product.stockStatus });
    if (debtEntry && customerRef) {
      tx.set(debtRef, debtEntry);
      tx.update(customerRef, { totalDebt: (currentDebtCents + cents(debtEntry.remainingBalance)) / 100 });
      tx.set(doc(db, 'customer_activity_logs', `parts_debt_${sale.id}`), clean({
        customerId: sale.customerId, customerName: customer!.name,
        actionType: 'debt_added', actionTitle: 'Credit Tab Opened',
        actionDescription: `Parts invoice ${sale.invoiceNumber}: ${debtEntry.remainingBalance} charged to account.`,
        actorId: sale.processedById, actorName: sale.processedByName || 'Staff', actorRole: pending.actorRole,
        date: sale.date, createdAt: sale.date, idempotencyKey: `parts_debt_${sale.id}`,
        metadata: { debtId: debtEntry.id, transactionId: sale.id, totalAmount: sale.total, isLimitOverridden: Boolean(customer!.creditLimit && currentDebtCents + cents(debtEntry.remainingBalance) > cents(customer!.creditLimit)) },
      }));
    }
    tx.set(saleRef, saved);
    tx.set(receiptRef, receipt);
    return {
      transaction: saved, debtEntry, stock, cancelled: false, pending,
      customer: customer ? { ...customer, id: sale.customerId!, ...(debtEntry ? { totalDebt: (currentDebtCents + cents(debtEntry.remainingBalance)) / 100 } : {}) } : undefined,
    };
  });
}

function rememberConfirmed(result: PartsCheckoutResult): PartsCheckoutResult {
  const records: [string, { id: string }[]][] = [
    ['offline_transactions', result.transaction ? [result.transaction] : []],
    ['offline_customer_debts', result.debtEntry ? [result.debtEntry] : []],
    ['offline_inventory', result.stock],
    ['offline_customers', result.customer ? [result.customer] : []],
  ];
  for (const [key, additions] of records) {
    if (!additions.length) continue;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || '[]') as { id: string }[];
      const ids = new Set(additions.map(record => record.id));
      localStorage.setItem(key, JSON.stringify([...additions, ...cached.filter(record => !ids.has(record.id))]));
    } catch (error) {
      console.warn('Checkout confirmed, but its local cache could not be updated:', error);
    }
  }
  invalidateReportsCache();
  return result;
}

export const partsCheckoutService = {
  getPending(actorId: string): PendingPartsCheckout | null {
    return readJournal()[actorId] ?? null;
  },

  async checkout(transaction: Omit<SaleTransaction, 'id'>, options: CheckoutOptions): Promise<PartsCheckoutResult> {
    if (!navigator.onLine) throw new Error('Connect to the server before completing a Parts sale.');
    const actorId = transaction.processedById;
    if (!actorId) throw new Error('Sign in before completing a Parts sale.');
    if (!transaction.items.length) throw new Error('The cart is empty.');
    const totalCents = cents(transaction.total);
    cents(transaction.subtotal);
    if (transaction.payments.some(payment => !['cash', 'card', 'mobile'].includes(payment.method))) throw new Error('Unsupported Parts payment method.');
    const paidCents = transaction.payments.reduce((sum, payment) => sum + cents(payment.amount), 0);
    const chargedCents = cents(transaction.accountSettlement?.chargedAmount ?? 0);
    if (paidCents + chargedCents !== totalCents || (transaction.accountSettlement && cents(transaction.accountSettlement.paidAmount) !== paidCents)) throw new Error('The payment and account amounts must match the invoice total.');
    const requestKey = requestKeyOf(transaction);
    const pending = await withJournalLock(() => {
      const journal = readJournal();
      let entry = journal[actorId];
      if (entry && entry.requestKey !== requestKey) throw new Error('A previous checkout is unconfirmed. Resolve it before starting a different sale.');
      if (!entry) {
        const id = `parts_${crypto.randomUUID()}`;
        entry = clean({ ...options, requestKey, transaction: { ...transaction, id, idempotencyKey: id, stockApplied: true, financialRevision: 0 } });
        saveJournal({ ...journal, [actorId]: entry });
      } else if (!entry.allowCreditLimitOverride && (options.allowCreditLimitOverride || options.actorRole === 'admin')) {
        entry = { ...entry, allowCreditLimitOverride: true, actorRole: options.actorRole };
        saveJournal({ ...journal, [actorId]: entry });
      }
      return entry;
    });
    return rememberConfirmed(await commitPending(pending, false));
  },

  async resolve(actorId: string): Promise<PartsCheckoutResult | null> {
    const pending = this.getPending(actorId);
    return pending ? rememberConfirmed(await commitPending(pending, true)) : null;
  },

  acknowledge(actorId: string, operationId: string): Promise<void> {
    return withJournalLock(() => {
      const journal = readJournal();
      if (journal[actorId]?.transaction.id !== operationId) return;
      delete journal[actorId];
      saveJournal(journal);
    });
  },
};
