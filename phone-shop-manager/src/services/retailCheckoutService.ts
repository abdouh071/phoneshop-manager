import { collection, doc, getDocsFromServer, query, runTransaction, Timestamp, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type {
  Customer,
  CustomerActivityLog,
  CustomerDebtEntry,
  PhoneModel,
  SaleTransaction,
} from '../types';
import { computeStockStatus } from '../utils/stockStatus';
import { saleOpeningPayments } from '../utils/debtPayments';
import { saleStockDeltas } from '../utils/stockDeltas';
import { withTimeout } from '../utils/withTimeout';
import { offlineQueueMirror } from './offlineQueueMirror';
import { invalidateReportsCache } from './reportCacheInvalidation';

const JOURNAL_KEY = 'retail_checkout_journal';
const RETAIL_CHECKOUT_TIMEOUT_MS = 10_000;

export interface RetailCheckoutOptions {
  draftKey: string;
  actorRole?: string;
  refundType?: 'cash' | 'store_credit' | 'debt_deduction';
  storeCreditUsed?: number;
  allowCreditLimitOverride?: boolean;
}

export interface PendingRetailCheckout extends RetailCheckoutOptions {
  transaction: SaleTransaction;
  requestKey: string;
  uncertain?: boolean;
}

export interface RetailCheckoutResult {
  transaction?: SaleTransaction;
  debtEntry?: CustomerDebtEntry;
  updatedDebts?: CustomerDebtEntry[];
  customer?: Customer;
  stock: PhoneModel[];
  cancelled: boolean;
  pending: PendingRetailCheckout;
}

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const cents = (amount: number): number => {
  const result = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(result)) {
    throw new Error('Invalid checkout amount.');
  }
  return result;
};

const requestKeyOf = (
  transaction: Omit<SaleTransaction, 'id'>,
  options: RetailCheckoutOptions
): string =>
  JSON.stringify({
    items: transaction.items.map(item => ({
      id: item.product.id,
      quantity: item.quantity,
      isReturn: item.isReturn === true,
      restock: item.restock !== false,
      price: item.unitPrice ?? item.product.price,
      customReturnPrice: item.customReturnPrice,
    })),
    subtotal: transaction.subtotal,
    discount: transaction.discount,
    total: transaction.total,
    payments: transaction.payments,
    customerId: transaction.customerId,
    customerName: transaction.customerName,
    customerPhone: transaction.customerPhone,
    storeCreditUsed: options.storeCreditUsed ?? 0,
    refundType: options.refundType ?? null,
    processedById: transaction.processedById,
  });

function readJournal(): Record<string, PendingRetailCheckout> {
  const raw = localStorage.getItem(JOURNAL_KEY);
  if (!raw) return {};
  const journal = JSON.parse(raw);
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)) {
    throw new Error('The checkout recovery journal is unreadable. Do not retry the sale.');
  }
  for (const [actorId, pending] of Object.entries(journal) as [string, PendingRetailCheckout][]) {
    if (
      !pending?.transaction?.id
      || pending.transaction.processedById !== actorId
      || typeof pending.requestKey !== 'string'
      || typeof pending.draftKey !== 'string'
    ) {
      throw new Error('The checkout recovery journal is unreadable. Do not retry the sale.');
    }
  }
  return journal;
}

function saveJournal(journal: Record<string, PendingRetailCheckout>): void {
  const raw = JSON.stringify(journal);
  localStorage.setItem(JOURNAL_KEY, raw);
  offlineQueueMirror.write(JOURNAL_KEY, raw);
}

function withJournalLock<T>(change: () => T): Promise<T> {
  if (!navigator.locks) {
    throw new Error('This browser cannot protect checkout recovery. Use the desktop app or an up-to-date browser over HTTPS.');
  }
  return navigator.locks.request(JOURNAL_KEY, async () => change());
}

const isDefinitePreCommitRejection = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.startsWith('INSUFFICIENT_STOCK:')
    || msg.includes('INSUFFICIENT_STORE_CREDIT')
    || msg.includes('Credit limit exceeded')
    || msg.includes('Select an active')
    || msg.includes('no longer exists')
    || msg.includes('A customer account is required')
    || msg.includes('Invalid checkout item')
    || msg.includes('permission-denied')
    || msg.includes('cannot be completed')
  );
};

async function commitPending(pending: PendingRetailCheckout, cancel: boolean): Promise<RetailCheckoutResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Connect to the server to confirm this checkout.');
  }

  const sale = pending.transaction;
  const saleRef = doc(db, 'transactions', sale.id);
  const receiptRef = doc(db, 'operation_receipts', `retail_checkout_${sale.id}`);
  const debtRef = doc(db, 'customer_debts', `retail_${sale.id}`);

  return runTransaction(db, async tx => {
    // 1. ALL READS FIRST
    const saleSnap = await tx.get(saleRef);
    const receiptSnap = await tx.get(receiptRef);

    if (receiptSnap.exists() && receiptSnap.data().checkoutOutcome === 'cancelled') {
      if (!cancel) throw new Error('This checkout was cancelled. Resolve the saved attempt before starting again.');
      return { cancelled: true, stock: [], pending };
    }

    if (saleSnap.exists()) {
      if (saleSnap.data().idempotencyKey !== sale.id) {
        throw new Error('Checkout identity conflict. Do not repeat this sale.');
      }
      const saved = { ...saleSnap.data(), id: sale.id } as SaleTransaction;
      const debtId = saved.accountSettlement?.debtEntryId;
      const debtSnap = debtId ? await tx.get(doc(db, 'customer_debts', debtId)) : null;
      const customerSnap = saved.customerId ? await tx.get(doc(db, 'customers', saved.customerId)) : null;
      const stock: PhoneModel[] = [];
      for (const id of new Set(saved.items.map(item => item.product.id))) {
        let snap = await tx.get(doc(db, 'inventory', id));
        if (!snap.exists()) snap = await tx.get(doc(db, 'products', id));
        if (snap.exists()) stock.push({ ...snap.data(), id } as PhoneModel);
      }
      return {
        transaction: saved,
        debtEntry: debtSnap?.exists() ? ({ ...debtSnap.data(), id: debtId! } as CustomerDebtEntry) : undefined,
        customer: customerSnap?.exists() ? ({ ...customerSnap.data(), id: saved.customerId! } as Customer) : undefined,
        stock,
        cancelled: false,
        pending,
      };
    }

    if (receiptSnap.exists()) {
      throw new Error('This checkout was saved but its invoice is no longer available. Do not repeat the sale.');
    }

    const receipt = {
      category: cancel ? 'system' : 'sales',
      message: cancel
        ? `Unconfirmed Retail checkout cancelled: ${sale.invoiceNumber || sale.id}`
        : `Retail sale ${sale.invoiceNumber || sale.id} completed`,
      entityId: sale.id,
      entityType: 'sale',
      userId: sale.processedById,
      userName: sale.processedByName || 'Staff',
      timestamp: Timestamp.now(),
      checkoutOutcome: cancel ? 'cancelled' : 'committed',
    };

    if (cancel) {
      tx.set(receiptRef, receipt);
      return { cancelled: true, stock: [], pending };
    }

    // Validate all cart items and read every product doc before scheduling writes
    for (const item of sale.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !item.product?.id || item.product.id.startsWith('offline_')) {
        throw new Error('Invalid or unsynced checkout item.');
      }
    }

    const stockDeltas = saleStockDeltas(sale.items, 'retail');
    const stockWrites: Array<{ collection: 'inventory' | 'products'; product: PhoneModel }> = [];

    for (const { productId, delta } of stockDeltas) {
      let col: 'inventory' | 'products' = 'inventory';
      let snap = await tx.get(doc(db, 'inventory', productId));
      if (!snap.exists()) {
        col = 'products';
        snap = await tx.get(doc(db, 'products', productId));
      }
      if (!snap.exists()) {
        throw new Error(`Product no longer exists: ${productId}`);
      }
      const product = { ...snap.data(), id: productId } as PhoneModel;
      if (!Number.isSafeInteger(product.stock) || product.stock < 0) {
        throw new Error(`Invalid stock balance for ${product.name || productId}.`);
      }
      const nextStock = product.stock + delta;
      if (delta < 0 && nextStock < 0) {
        throw new Error(`INSUFFICIENT_STOCK:${productId}:requested=${Math.abs(delta)}:available=${product.stock}`);
      }
      if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
        throw new Error(`INSUFFICIENT_STOCK:${productId}:requested=${Math.abs(delta)}:available=${product.stock}`);
      }
      stockWrites.push({
        collection: col,
        product: {
          ...product,
          stock: nextStock,
          stockStatus: computeStockStatus(nextStock, product.lowStockThreshold ?? 1),
        },
      });
    }

    // Read customer & debt docs before any writes
    const storeCreditUsed = Math.max(0, pending.storeCreditUsed ?? sale.exchangeSummary?.storeCreditUsed ?? 0);
    const redeemCents = storeCreditUsed > 0 ? cents(storeCreditUsed) : 0;
    const debtPayment = (sale.payments || []).find(p => p.method === 'debt' && p.amount > 0);
    const chargedAmount = debtPayment ? debtPayment.amount : 0;
    const chargedCents = chargedAmount > 0 ? cents(chargedAmount) : 0;
    const refundType = sale.total < 0 ? (pending.refundType ?? sale.exchangeSummary?.refundType ?? 'cash') : undefined;
    const surplusCents = sale.total < 0 ? cents(Math.abs(sale.total)) : 0;

    const needsCustomerDoc = Boolean(
      sale.customerId
      || redeemCents > 0
      || chargedCents > 0
      || (refundType && refundType !== 'cash')
    );

    const customerRef = sale.customerId ? doc(db, 'customers', sale.customerId) : null;
    const customerSnap = customerRef ? await tx.get(customerRef) : null;
    const customer = customerSnap?.exists()
      ? ({ ...customerSnap.data(), id: sale.customerId! } as Customer)
      : null;

    if (sale.customerId && (!customer || customer.mergedIntoId || sale.customerId.startsWith('offline_'))) {
      throw new Error('Select an active, synced customer account manually.');
    }
    if ((redeemCents > 0 || chargedCents > 0 || (refundType && refundType !== 'cash')) && (!customer || !customerRef)) {
      throw new Error('A customer account is required for credit or Avoir settlement.');
    }

    let debtEntry: CustomerDebtEntry | undefined;
    let updatedDebts: CustomerDebtEntry[] = [];
    let currentOpenDebtCents = 0;
    const debtSnapshots: CustomerDebtEntry[] = [];

    if (customer && (chargedCents > 0 || refundType === 'debt_deduction')) {
      if (chargedCents > 0 && (await tx.get(debtRef)).exists()) {
        throw new Error('Checkout debt identity conflict. Do not repeat this sale.');
      }
      const debtMatches = await getDocsFromServer(
        query(collection(db, 'customer_debts'), where('customerId', '==', customer.id))
      );
      for (const match of debtMatches.docs) {
        const snap = await tx.get(match.ref);
        if (snap.exists()) {
          const entry = { ...snap.data(), id: match.ref.id } as CustomerDebtEntry;
          debtSnapshots.push(entry);
          if (entry.status !== 'paid' && (entry.remainingBalance ?? 0) > 0) {
            currentOpenDebtCents += cents(entry.remainingBalance);
          }
        }
      }
    }

    // Validate Avoir & credit limit on fresh server numbers
    const customerLogsToWrite: Array<{ id: string; data: CustomerActivityLog }> = [];
    let nextCreditCents = customer ? cents(customer.storeCredit ?? 0) : 0;
    let nextTotalDebtCents = customer ? cents(customer.totalDebt ?? 0) : 0;

    if (customer && redeemCents > 0) {
      if (nextCreditCents < redeemCents) {
        throw new Error('INSUFFICIENT_STORE_CREDIT');
      }
      nextCreditCents -= redeemCents;
      const logId = `credit_${encodeURIComponent(sale.id)}_redeem`;
      customerLogsToWrite.push({
        id: logId,
        data: clean({
          id: logId,
          customerId: customer.id,
          customerName: customer.name,
          actionType: 'store_credit_used',
          actionTitle: 'Store Credit (Avoir) Redeemed',
          actionDescription: `Redeemed ${storeCreditUsed} for POS Sale #${sale.invoiceNumber || sale.id.slice(0, 8)} by ${sale.processedByName || 'Staff'}.`,
          actorId: sale.processedById,
          actorName: sale.processedByName || 'Staff',
          actorRole: pending.actorRole,
          date: sale.date,
          createdAt: sale.date,
          idempotencyKey: logId,
          metadata: {
            operationCustomerId: customer.id,
            signedCents: -redeemCents,
            amount: redeemCents / 100,
            newCredit: nextCreditCents / 100,
            transactionId: sale.id,
          },
        }),
      });
    }

    if (customer && surplusCents > 0 && refundType === 'store_credit') {
      nextCreditCents += surplusCents;
      const logId = `credit_${encodeURIComponent(sale.id)}_surplus`;
      customerLogsToWrite.push({
        id: logId,
        data: clean({
          id: logId,
          customerId: customer.id,
          customerName: customer.name,
          actionType: 'store_credit_issued',
          actionTitle: 'Store Credit (Avoir) Issued',
          actionDescription: `Issued ${surplusCents / 100} Exchange Surplus from Receipt #${sale.invoiceNumber || sale.id.slice(0, 8)} by ${sale.processedByName || 'Staff'}.`,
          actorId: sale.processedById,
          actorName: sale.processedByName || 'Staff',
          actorRole: pending.actorRole,
          date: sale.date,
          createdAt: sale.date,
          idempotencyKey: logId,
          metadata: {
            operationCustomerId: customer.id,
            signedCents: surplusCents,
            amount: surplusCents / 100,
            newCredit: nextCreditCents / 100,
            transactionId: sale.id,
          },
        }),
      });
    }

    const debtPatchUpdates: Array<{ entry: CustomerDebtEntry }> = [];
    if (customer && surplusCents > 0 && refundType === 'debt_deduction') {
      const openDebts = debtSnapshots
        .filter(d => d.status !== 'paid' && (d.remainingBalance ?? 0) > 0)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let remainingSurplusCents = surplusCents;
      let totalDeductedCents = 0;

      for (const open of openDebts) {
        if (remainingSurplusCents <= 0) break;
        const balCents = cents(open.remainingBalance);
        const deductCents = Math.min(balCents, remainingSurplusCents);
        const deductAmount = deductCents / 100;
        const newRemaining = (balCents - deductCents) / 100;
        const newPaid = (cents(open.amountPaid || 0) + deductCents) / 100;
        const newStatus: CustomerDebtEntry['status'] = newRemaining <= 0 ? 'paid' : 'partially_paid';

        const updatedEntry: CustomerDebtEntry = clean({
          ...open,
          amountPaid: newPaid,
          remainingBalance: newRemaining,
          status: newStatus,
          updatedAt: sale.date,
          payments: [
            ...(open.payments || []),
            {
              id: `pay_ded_${sale.id}_${open.id}`,
              amount: deductAmount,
              date: sale.date,
              method: 'debt',
              note: `Exchange Surplus applied from Receipt #${sale.invoiceNumber || sale.id.slice(0, 8)}`,
              receivedByName: sale.processedByName || 'Staff',
            },
          ],
        });
        debtPatchUpdates.push({ entry: updatedEntry });
        updatedDebts.push(updatedEntry);
        totalDeductedCents += deductCents;
        remainingSurplusCents -= deductCents;
      }

      nextTotalDebtCents = Math.max(0, currentOpenDebtCents - totalDeductedCents);

      if (remainingSurplusCents > 0) {
        nextCreditCents += remainingSurplusCents;
        const logId = `credit_${encodeURIComponent(sale.id)}_debt_surplus`;
        customerLogsToWrite.push({
          id: logId,
          data: clean({
            id: logId,
            customerId: customer.id,
            customerName: customer.name,
            actionType: 'store_credit_issued',
            actionTitle: 'Store Credit (Avoir) Issued',
            actionDescription: `Exchange surplus overflow (${remainingSurplusCents / 100}) credited to Avoir from Receipt #${sale.invoiceNumber || sale.id.slice(0, 8)}.`,
            actorId: sale.processedById,
            actorName: sale.processedByName || 'Staff',
            actorRole: pending.actorRole,
            date: sale.date,
            createdAt: sale.date,
            idempotencyKey: logId,
            metadata: {
              operationCustomerId: customer.id,
              signedCents: remainingSurplusCents,
              amount: remainingSurplusCents / 100,
              newCredit: nextCreditCents / 100,
              transactionId: sale.id,
            },
          }),
        });
      }
    }

    if (customer && chargedCents > 0) {
      const projectedCents = currentOpenDebtCents + chargedCents;
      if (
        customer.creditLimit
        && customer.creditLimit > 0
        && projectedCents > cents(customer.creditLimit)
        && !pending.allowCreditLimitOverride
        && pending.actorRole !== 'admin'
      ) {
        throw new Error(
          `Credit limit exceeded for ${customer.name}. Current debt: ${currentOpenDebtCents / 100}, added: ${chargedCents / 100}, limit: ${customer.creditLimit}. Admin approval required.`
        );
      }

      const paidAmount = Math.max(0, sale.total - chargedAmount);
      const itemsSummary = sale.items
        .map(i => `${i.isReturn ? '[RETURN] ' : ''}${i.quantity}x ${i.product.name} ${i.product.model || ''}`.trim())
        .join(', ');

      debtEntry = clean({
        id: debtRef.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone || sale.customerPhone || '',
        productOrService: itemsSummary || `POS Sale #${sale.invoiceNumber || sale.id.slice(0, 6)}`,
        itemsSummary,
        date: sale.date,
        totalAmount: sale.total,
        amountPaid: paidAmount,
        remainingBalance: chargedAmount,
        status: paidAmount > 0 ? 'partially_paid' : 'unpaid',
        notes: `POS Sale Receipt #${sale.invoiceNumber || sale.id}`,
        transactionId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        idempotencyKey: debtRef.id,
        type: 'general',
        payments: saleOpeningPayments(sale.payments, sale.date, sale.processedByName),
        createdAt: sale.date,
        updatedAt: sale.date,
      });

      nextTotalDebtCents = projectedCents;
      const debtLogId = `retail_debt_${encodeURIComponent(sale.id)}`;
      customerLogsToWrite.push({
        id: debtLogId,
        data: clean({
          id: debtLogId,
          customerId: customer.id,
          customerName: customer.name,
          actionType: 'debt_added',
          actionTitle: 'Credit Tab Opened',
          actionDescription: `Retail sale ${sale.invoiceNumber || sale.id}: ${chargedAmount} charged to account.`,
          actorId: sale.processedById,
          actorName: sale.processedByName || 'Staff',
          actorRole: pending.actorRole,
          date: sale.date,
          createdAt: sale.date,
          idempotencyKey: debtLogId,
          metadata: { debtId: debtEntry.id, transactionId: sale.id, totalAmount: sale.total },
        }),
      });
    }

    const paidOnSale = Math.max(0, sale.total - chargedAmount);
    const nextCustomer: Customer | undefined = customer
      ? {
          ...customer,
          storeCredit: nextCreditCents / 100,
          totalDebt: nextTotalDebtCents / 100,
          totalSpent: Math.max(0, Math.round(((customer.totalSpent ?? 0) + (sale.total > 0 ? sale.total : 0)) * 100) / 100),
          totalPurchases: (customer.totalPurchases ?? 0) + (sale.total >= 0 ? 1 : 0),
          lastVisitDate: sale.date,
        }
      : undefined;

    const settlement: SaleTransaction['accountSettlement'] | undefined = debtEntry
      ? {
          type: Math.max(0, paidOnSale) > 0 ? 'partial_payment' : 'charged_to_account',
          paidAmount: paidOnSale,
          chargedAmount,
          debtEntryId: debtEntry.id,
        }
      : sale.accountSettlement;

    const saved: SaleTransaction = clean({
      ...sale,
      stockApplied: true,
      validationStatus: 'confirmed',
      financialRevision: 0,
      ...(settlement ? { accountSettlement: settlement } : {}),
    });

    // 2. ALL WRITES AFTER ALL READS
    for (const item of stockWrites) {
      tx.update(doc(db, item.collection, item.product.id), {
        stock: item.product.stock,
        stockStatus: item.product.stockStatus,
      });
    }
    for (const { entry } of debtPatchUpdates) {
      tx.update(doc(db, 'customer_debts', entry.id), {
        amountPaid: entry.amountPaid,
        remainingBalance: entry.remainingBalance,
        status: entry.status,
        payments: entry.payments,
        updatedAt: entry.updatedAt,
      });
    }
    if (debtEntry) {
      tx.set(debtRef, debtEntry);
    }
    if (customerRef && nextCustomer && needsCustomerDoc) {
      tx.update(customerRef, {
        storeCredit: nextCustomer.storeCredit,
        totalDebt: nextCustomer.totalDebt,
        totalSpent: nextCustomer.totalSpent,
        totalPurchases: nextCustomer.totalPurchases,
        lastVisitDate: nextCustomer.lastVisitDate,
      });
    }
    for (const entry of customerLogsToWrite) {
      tx.set(doc(db, 'customer_activity_logs', entry.id), entry.data);
    }
    tx.set(saleRef, saved);
    tx.set(receiptRef, receipt);

    return {
      transaction: saved,
      debtEntry,
      updatedDebts,
      customer: nextCustomer,
      stock: stockWrites.map(s => s.product),
      cancelled: false,
      pending,
    };
  });
}

function rememberConfirmed(result: RetailCheckoutResult): RetailCheckoutResult {
  const debtsToCache = [
    ...(result.debtEntry ? [result.debtEntry] : []),
    ...(result.updatedDebts ?? []),
  ];
  const records: [string, { id: string }[]][] = [
    ['offline_transactions', result.transaction ? [result.transaction] : []],
    ['offline_customer_debts', debtsToCache],
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
      console.warn('Retail checkout confirmed, local cache update failed:', error);
    }
  }
  invalidateReportsCache();
  return result;
}

export const retailCheckoutService = {
  getPending(actorId: string): PendingRetailCheckout | null {
    return readJournal()[actorId] ?? null;
  },

  async checkout(
    transaction: Omit<SaleTransaction, 'id'>,
    options: RetailCheckoutOptions
  ): Promise<RetailCheckoutResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Connect to the server before running atomic retail checkout.');
    }
    const actorId = transaction.processedById || 'local-cashier';
    const normalizedTx: Omit<SaleTransaction, 'id'> = { ...transaction, processedById: actorId };
    if (!normalizedTx.items.length) throw new Error('The cart is empty.');

    const requestKey = requestKeyOf(normalizedTx, options);
    const pending = await withJournalLock(() => {
      const journal = readJournal();
      let entry = journal[actorId];
      if (entry && entry.requestKey !== requestKey) {
        if (entry.uncertain) {
          throw new Error('A previous timed-out checkout is unconfirmed. Resolve it before starting a different sale.');
        }
        delete journal[actorId];
      }
      if (!journal[actorId]) {
        const id = `retail_${crypto.randomUUID()}`;
        entry = clean({
          ...options,
          requestKey,
          transaction: {
            ...normalizedTx,
            id,
            idempotencyKey: id,
            stockApplied: true,
            validationStatus: 'confirmed',
            financialRevision: 0,
          },
        });
        saveJournal({ ...journal, [actorId]: entry });
      } else {
        entry = journal[actorId];
        if (!entry.allowCreditLimitOverride && (options.allowCreditLimitOverride || options.actorRole === 'admin')) {
          entry = { ...entry, allowCreditLimitOverride: true, actorRole: options.actorRole };
          saveJournal({ ...journal, [actorId]: entry });
        }
      }
      return entry;
    });

    try {
      const result = await withTimeout(
        commitPending(pending, false),
        RETAIL_CHECKOUT_TIMEOUT_MS,
        'RETAIL_CHECKOUT_TIMEOUT'
      );
      return rememberConfirmed(result);
    } catch (err) {
      if (isDefinitePreCommitRejection(err)) {
        await withJournalLock(() => {
          const journal = readJournal();
          if (journal[actorId]?.transaction.id === pending.transaction.id && !journal[actorId]?.uncertain) {
            delete journal[actorId];
            saveJournal(journal);
          }
        }).catch(() => undefined);
      } else {
        // Timeout or lost acknowledgement: preserve the exact operation ID as uncertain for safe reconciliation
        await withJournalLock(() => {
          const journal = readJournal();
          if (journal[actorId]?.transaction.id === pending.transaction.id) {
            journal[actorId] = { ...journal[actorId], uncertain: true };
            saveJournal(journal);
          }
        }).catch(() => undefined);
      }
      throw err;
    }
  },

  async resolve(actorId: string): Promise<RetailCheckoutResult | null> {
    const pending = this.getPending(actorId);
    if (!pending) return null;
    return rememberConfirmed(
      await withTimeout(commitPending(pending, true), RETAIL_CHECKOUT_TIMEOUT_MS, 'RETAIL_CHECKOUT_TIMEOUT')
    );
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
