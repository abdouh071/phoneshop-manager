import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  runTransaction,
  writeBatch,
  getDocsFromServer,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { newIdempotencyKey } from './idempotentReplay';
import { offlineQueueMirror } from './offlineQueueMirror';
import { invalidateReportsCache } from './reportCacheInvalidation';
import { UnrecoverableSyncActionError } from './offlineQueue';
import { withTimeout } from '../utils/withTimeout';
import type { Customer, CustomerDebtEntry, PhoneModel, SaleTransaction } from '../types';
import { foldStockDeltas } from '../utils/stockDeltas';
import { computeStockStatus } from '../utils/stockStatus';
import { calculateCustomerFinancials } from '../utils/customerFinancials';

export interface SaleRefundResult {
  outcome: 'refunded' | 'already_closed';
  transaction: SaleTransaction;
  stock: PhoneModel[];
  customer?: Customer;
  debt?: CustomerDebtEntry;
}

export interface PendingSaleRefund {
  operationId: string;
  transactionId: string;
  expected: SaleTransaction;
  actor: { id: string; name: string; role: string };
  refundedAt: string;
  stage: 'claimed' | 'uncertain';
  createdAt: string;
  errorMessage?: string;
}

export interface PendingSaleEdit {
  operationId: string;
  transactionId: string;
  expected: SaleTransaction;
  edit: SaleEditRequest;
  status: 'pending' | 'queued' | 'uncertain' | 'conflict';
  createdAt: string;
  errorMessage?: string;
}

export interface SaleEditResult {
  transaction: SaleTransaction;
  stock: PhoneModel[];
  customer?: Customer;
  debt?: CustomerDebtEntry;
}

export interface SaleEditRequest {
  /** Stable identifier per edit attempt/submission so conflicting replays from stale tills fail loudly. */
  operationId?: string;
  updates: Partial<SaleTransaction>;
  stockDeltas: { productId: string; delta: number }[];
  /** Positive grants Avoir for an over-collection, negative takes it back. */
  creditShift?: { customerId: string; amount: number; note: string };
  debtUpdate?: {
    debtId: string;
    total: number;
    charged: number;
    itemsSummary: string;
    /** What this till believes the customer has already paid — stale money refuses. */
    expectedPaid: number;
  };
}

const stableEditValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableEditValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([k, v]) => [k, stableEditValue(v)]));
  }
  return value;
};

const editRequestFingerprint = (edit: SaleEditRequest): string => JSON.stringify(stableEditValue({
  updates: edit.updates,
  stockDeltas: edit.stockDeltas,
  creditShift: edit.creditShift ?? null,
  debtUpdate: edit.debtUpdate ?? null,
}));

export interface SaleEditResult {
  transaction: SaleTransaction;
  stock: PhoneModel[];
  customer?: Customer;
  debt?: CustomerDebtEntry;
}

const refundSnapshot = (sale: SaleTransaction): string => JSON.stringify([
  sale.financialRevision ?? 0, sale.status ?? 'completed', sale.total, sale.subtotal,
  sale.customerId, sale.invoiceNumber, sale.stockApplied,
  sale.discount?.type, sale.discount?.value,
  sale.items.map(item => [item.product?.id, item.quantity, item.isReturn === true,
    item.restock !== false, item.unitPrice ?? item.product?.price, item.customReturnPrice]),
  sale.payments?.map(payment => [payment.method, payment.amount]),
  sale.accountSettlement?.debtEntryId, sale.accountSettlement?.paidAmount, sale.accountSettlement?.chargedAmount,
  sale.exchangeSummary?.refundType, sale.exchangeSummary?.storeCreditUsed,
]);

const refundCents = (amount: number): number => {
  const value = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(value)) throw new Error('The invoice or account contains an invalid amount. Review it before refunding.');
  return value;
};

const cacheSaleDocuments = <T extends { transaction: SaleTransaction; stock: PhoneModel[]; customer?: Customer; debt?: CustomerDebtEntry }>(result: T): T => {
  const entries: [string, { id: string }[]][] = [
    ['offline_transactions', [result.transaction]],
    ['offline_inventory', result.stock],
    ['offline_customers', result.customer ? [result.customer] : []],
    ['offline_customer_debts', result.debt ? [result.debt] : []],
  ];
  for (const [key, rows] of entries) {
    if (!rows.length) continue;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || '[]') as { id: string }[];
      const ids = new Set(rows.map(row => row.id));
      localStorage.setItem(key, JSON.stringify([...rows, ...cached.filter(row => !ids.has(row.id))]));
    } catch (error) {
      console.warn('Sale confirmed; could not refresh the local cache:', key, error);
    }
  }
  invalidateReportsCache();
  return result;
};

const COLLECTION = 'transactions';
const LOCAL_STORAGE_KEY = 'offline_transactions';
const REFUND_JOURNAL_KEY = 'sale_refund_journal';
const EDIT_JOURNAL_KEY = 'sale_edit_journal';

const readJournal = <T>(key: 'sale_refund_journal' | 'sale_edit_journal'): T[] => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const writeJournal = <T>(key: 'sale_refund_journal' | 'sale_edit_journal', entries: T[]): void => {
  const raw = JSON.stringify(entries);
  try {
    localStorage.setItem(key, raw);
  } catch (err) {
    console.warn(`Failed to persist ${key}:`, err);
  }
  offlineQueueMirror.write(key, raw);
};

const isDefiniteDomainError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: unknown })?.code;
  if (code === 'permission-denied') return true;
  return (
    msg.includes('permission-denied') ||
    msg.includes('Connect and sync') ||
    msg.includes('Connect to the server') ||
    msg.includes('no longer exists') ||
    msg.includes('changed on another device') ||
    msg.includes('closed and cannot be edited') ||
    msg.includes('not fully processed') ||
    msg.includes('not finished syncing') ||
    msg.includes('earlier debts') ||
    msg.includes('invalid item quantities') ||
    msg.includes('invalid amount') ||
    msg.includes('invalid revision') ||
    msg.includes('missing or ambiguous') ||
    msg.includes('missing or merged') ||
    msg.includes('already been spent') ||
    msg.includes('Not enough stock') ||
    msg.includes('Insufficient or invalid stock') ||
    msg.includes('explicitly linked customer') ||
    msg.includes('received a payment on another device') ||
    msg.includes('does not match this invoice')
  );
};

const docToTx = (id: string, data: Record<string, unknown>): SaleTransaction => ({
  ...(data as Omit<SaleTransaction, 'id' | 'items' | 'payments'>),
  id,
  items: Array.isArray(data.items) ? (data.items as SaleTransaction['items']) : [],
  payments: Array.isArray(data.payments) ? (data.payments as SaleTransaction['payments']) : [],
});

/**
 * The mirror is shaped like the server read, because it is read by the same surfaces.
 * A row written by an older build can arrive without its lines; defaulting them here
 * lets one old receipt render empty instead of taking the whole history tab down.
 */
const getLocalTransactions = (): SaleTransaction[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Every caller keys on `id` — `id.startsWith('offline_')` decides what still needs
    // replaying — so a row without one has no identity to print, replay or reference.
    return parsed
      .filter((tx): tx is Record<string, unknown> =>
        Boolean(tx) && typeof tx === 'object' && typeof (tx as { id?: unknown }).id === 'string')
      .map(tx => docToTx(tx.id as string, tx));
  } catch {
    return [];
  }
};

const saveLocalTransactions = (txs: SaleTransaction[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(txs));
  } catch (err) {
    console.error('Failed to save transactions to local storage', err);
  }
};

export const transactionService = {
  // Server-side query: strictly retail POS sales only
  getRetailTransactions: async (): Promise<SaleTransaction[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalTransactions().filter(t => t.saleType === 'retail');
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('saleType', '==', 'retail')
      );
      const snap = await getDocs(q);
      const items = snap.docs
        .map(d => docToTx(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      const local = getLocalTransactions().filter(t => t.saleType === 'retail' && t.id.startsWith('offline_'));
      const serverIds = new Set(items.map(i => i.id));
      const merged = [...local.filter(l => !serverIds.has(l.id)), ...items];
      return merged;
    } catch (err) {
      console.warn('Firestore retail transactions fetch failed, using local cache:', err);
      return getLocalTransactions().filter(t => t.saleType === 'retail');
    }
  },

  // Server-side query: strictly repair parts B2B invoices / sales only
  getPartsTransactions: async (options?: { allowLocalFallback?: boolean }): Promise<SaleTransaction[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalTransactions().filter(t => t.saleType === 'parts_b2b');
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('saleType', '==', 'parts_b2b')
      );
      const snap = await getDocs(q);
      const items = snap.docs
        .map(d => docToTx(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const local = getLocalTransactions();
      const serverIds = new Set(items.map(i => i.id));
      const serverKeys = new Set(items.map(i => i.idempotencyKey).filter(Boolean));
      const pending = local.filter(t => t.saleType === 'parts_b2b' && t.id.startsWith('offline_')
        && !serverIds.has(t.id) && !(t.idempotencyKey && serverKeys.has(t.idempotencyKey)));
      const merged = [...pending, ...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      saveLocalTransactions([...local.filter(t => t.saleType !== 'parts_b2b'), ...merged]);
      return merged;
    } catch (err) {
      if (options?.allowLocalFallback === false) throw err;
      console.warn('Firestore parts transactions fetch failed, using local cache:', err);
      return getLocalTransactions().filter(t => t.saleType === 'parts_b2b');
    }
  },

  /**
   * `allowLocalFallback: false` makes this read throw instead of quietly answering from this
   * device's cache. Screens may show a cache; a caller about to WRITE an absolute figure off
   * what it read has to know when it is not looking at the shop's real history.
   */
  getAll: async (options?: { allowLocalFallback?: boolean }): Promise<SaleTransaction[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!mayFallBack) throw new Error("Offline: the sale history on this device is not the shop's history.");
      return getLocalTransactions();
    }

    try {
      const q = query(collection(db, COLLECTION), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToTx(d.id, d.data() as Record<string, unknown>));

      const local = getLocalTransactions();
      const serverIds = new Set(items.map(i => i.id));
      const pendingLocal = local.filter(l => !serverIds.has(l.id) && l.id.startsWith('offline_'));
      const merged = [...pendingLocal, ...items].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      saveLocalTransactions(merged);
      return merged;
    } catch (err) {
      console.warn('Firestore transactions fetch failed, using local cache:', err);
      if (!mayFallBack) throw err;
      return getLocalTransactions();
    }
  },

  getByDateRange: async (
    startDate: Date,
    endDate: Date,
    options?: { allowLocalFallback?: boolean }
  ): Promise<SaleTransaction[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!mayFallBack) {
        throw new Error("Offline: transactions on this device are cached, not live server records.");
      }
      const local = getLocalTransactions();
      return local.filter(l => {
        const tMs = new Date(l.date).getTime();
        return tMs >= startDate.getTime() && tMs <= endDate.getTime();
      });
    }

    try {
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();
      const q = query(
        collection(db, COLLECTION),
        where('date', '>=', startIso),
        where('date', '<=', endIso),
        orderBy('date', 'desc')
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToTx(d.id, d.data() as Record<string, unknown>));

      const local = getLocalTransactions();
      const serverIds = new Set(items.map(i => i.id));
      const pendingLocal = local.filter(l => {
        if (serverIds.has(l.id) || !l.id.startsWith('offline_')) return false;
        const tMs = new Date(l.date).getTime();
        return tMs >= startDate.getTime() && tMs <= endDate.getTime();
      });

      return [...pendingLocal, ...items].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    } catch (err) {
      if (!mayFallBack) throw err;
      console.warn('Firestore transactions by date range fetch failed, using local cache:', err);
      const local = getLocalTransactions();
      return local.filter(l => {
        const tMs = new Date(l.date).getTime();
        return tMs >= startDate.getTime() && tMs <= endDate.getTime();
      });
    }
  },

  save: async (tx: Omit<SaleTransaction, 'id'>): Promise<SaleTransaction> => {
    invalidateReportsCache();
    const local = getLocalTransactions();
    // Minted before the first attempt and carried by every copy of this sale, so a
    // replay can recognise the document the counter only *thinks* it failed to write.
    const stamped: Omit<SaleTransaction, 'id'> = { ...tx, idempotencyKey: newIdempotencyKey('tx') };

    // If offline, store locally immediately with zero delay
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...stamped, id: offlineId };
      saveLocalTransactions([created, ...local]);
      return created;
    }

    try {
      const addDocPromise = addDoc(collection(db, COLLECTION), stamped);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
      );
      const docRef = await Promise.race([addDocPromise, timeoutPromise]);
      const created = { ...stamped, id: docRef.id };
      saveLocalTransactions([created, ...local.filter(t => t.id !== created.id)]);
      return created;
    } catch (err) {
      console.warn('Failed to save transaction to Firestore, storing locally:', err);
      const offlineId = `offline_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...stamped, id: offlineId };
      saveLocalTransactions([created, ...local]);
      return created;
    }
  },

  refund: async (
    expected: SaleTransaction,
    actor: { id: string; name: string; role: string },
  ): Promise<SaleRefundResult> => {
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || expected.id.startsWith('offline_')) {
      throw new Error('Connect and sync this invoice before refunding it. No refund has been submitted.');
    }

    const existingEntry = readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY)
      .find(r => r.transactionId === expected.id);
    const operationId = existingEntry?.operationId || `refund_${expected.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const refundedAt = existingEntry?.refundedAt || new Date().toISOString();
    const receiptId = `sale_refund_${encodeURIComponent(expected.id)}`;

    // Persist a local claimed marker before sending so any crash, restart, or lost ack
    // keeps the claimed refund visible instead of silently disappearing or double-refunding.
    const claimedEntry: PendingSaleRefund = {
      operationId,
      transactionId: expected.id,
      expected,
      actor,
      refundedAt,
      stage: 'claimed',
      createdAt: existingEntry?.createdAt || refundedAt,
    };
    writeJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY, [
      claimedEntry,
      ...readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY).filter(r => r.transactionId !== expected.id),
    ]);

    try {
      const result = await withTimeout(runTransaction(db, async tx => {
        const saleRef = doc(db, COLLECTION, expected.id);
        const receiptRef = doc(db, 'operation_receipts', receiptId);
        const saleSnap = await tx.get(saleRef);
        const receipt = await tx.get(receiptRef);
        if (!saleSnap.exists()) throw new Error('This invoice no longer exists.');
        const sale = docToTx(saleSnap.id, saleSnap.data());
        if (receipt.exists()) {
          const saved = receipt.data();
          if (saved.kind !== 'sale_refund' || saved.transactionId !== sale.id) {
            throw new Error('The refund record does not match this invoice. Do not repeat the refund.');
          }
          // Complete an uncompleted claim (`stage === 'claimed'` while `sale.status !== 'refunded'`)
          // rather than falsely rejecting or claiming completion.
          if (saved.stage !== 'claimed') {
            if (sale.status !== 'refunded') {
              throw new Error('The refund record does not match this invoice. Do not repeat the refund.');
            }
            const stock: PhoneModel[] = [];
            for (const source of (saved.stockSources as { collection: string; id: string }[] | undefined) || []) {
              const snap = await tx.get(doc(db, source.collection, source.id));
              if (snap.exists()) stock.push({ ...snap.data(), id: snap.id } as PhoneModel);
            }
            const customer = saved.customerId ? await tx.get(doc(db, 'customers', saved.customerId)) : null;
            const debt = saved.debtId ? await tx.get(doc(db, 'customer_debts', saved.debtId)) : null;
            return {
              outcome: 'refunded' as const, transaction: sale, stock,
              customer: customer?.exists() ? { ...customer.data(), id: customer.id } as Customer : undefined,
              debt: debt?.exists() ? { ...debt.data(), id: debt.id } as CustomerDebtEntry : undefined,
            };
          }
        }
        if (['refunded', 'voided', 'cancelled'].includes(sale.status || '')) {
          return { outcome: 'already_closed' as const, transaction: sale, stock: [] };
        }
        if (refundSnapshot(sale) !== refundSnapshot(expected)) throw new Error('This invoice changed on another device. Refresh and review it before refunding.');
        if (sale.status === 'pending_approval' || sale.stockApplied === false) throw new Error('This invoice is not fully processed yet. Finish its sync before refunding.');
        if (sale.total < 0 && sale.exchangeSummary?.refundType === 'debt_deduction') throw new Error('This exchange reduced earlier debts without recording which payments to reverse. Review those account entries manually before closing it.');
        if (!sale.items.length || sale.items.some(item => !item.product?.id || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) throw new Error('This invoice has invalid item quantities. Review it before refunding.');

        const stockWrites = [];
        const movements = foldStockDeltas(sale.items.map(item => ({
          productId: item.product.id,
          delta: item.isReturn ? (item.restock !== false ? -item.quantity : 0) : item.quantity,
        })));
        for (const { productId, delta } of movements) {
          let source = 'inventory';
          let ref = doc(db, source, productId);
          let snap = await tx.get(ref);
          if (!snap.exists()) {
            source = 'products';
            ref = doc(db, source, productId);
            snap = await tx.get(ref);
          }
          if (!snap.exists()) throw new Error(`Product ${productId} no longer exists. Review its stock before refunding.`);
          const data = snap.data();
          const stock = data.stock + delta;
          if (!Number.isSafeInteger(data.stock) || data.stock < 0 || !Number.isSafeInteger(stock) || stock < 0) throw new Error(`Insufficient or invalid stock to reverse ${data.name || productId}.`);
          stockWrites.push({ ref, source, product: { ...data, id: productId, stock, stockStatus: computeStockStatus(stock, data.lowStockThreshold ?? 1) } as PhoneModel });
        }

        const customerRef = sale.customerId ? doc(db, 'customers', sale.customerId) : null;
        const customerSnap = customerRef ? await tx.get(customerRef) : null;
        let customer = customerSnap?.exists() ? { ...customerSnap.data(), id: customerSnap.id } as Customer : undefined;
        if (customerRef && (!customer || customer.mergedIntoId)) throw new Error('The linked customer is missing or merged. Review the account manually before refunding.');
        const debts: CustomerDebtEntry[] = [];
        if (sale.customerId) {
          const matches = await getDocsFromServer(query(collection(db, 'customer_debts'), where('customerId', '==', sale.customerId)));
          for (const match of matches.docs) {
            const snap = await tx.get(match.ref);
            if (snap.exists() && snap.data().customerId === sale.customerId) debts.push({ ...snap.data(), id: snap.id } as CustomerDebtEntry);
          }
        }
        const linked = debts.filter(debt => debt.id === sale.accountSettlement?.debtEntryId || debt.transactionId === sale.id ||
          (!debt.transactionId && !sale.invoiceNumberProvisional && sale.invoiceNumber && debt.invoiceNumber === sale.invoiceNumber));
        const charged = refundCents(sale.accountSettlement?.chargedAmount ?? 0) + (sale.payments || []).filter(p => p.method === 'debt').reduce((sum, p) => sum + refundCents(p.amount), 0);
        if (linked.length > 1 || ((charged > 0 || sale.accountSettlement?.debtEntryId) && linked.length !== 1)) throw new Error('The linked credit record is missing or ambiguous. Review it manually before refunding.');
        const originalDebt = linked[0];
        const restoredCredit = refundCents(sale.exchangeSummary?.storeCreditUsed ?? 0);
        const reversedCredit = sale.total < 0 && sale.exchangeSummary?.refundType === 'store_credit' ? refundCents(-sale.total) : 0;
        // Earlier corrections may already have transferred over-collections to Avoir.
        const paidToCredit = originalDebt ? Math.min(refundCents(originalDebt.amountPaid), refundCents(Math.max(0, sale.total))) : 0;
        const creditDelta = paidToCredit + restoredCredit - reversedCredit;
        if (creditDelta !== 0 && !customer) throw new Error('This refund needs its explicitly linked customer account.');
        let debt: CustomerDebtEntry | undefined;
        const refunded: SaleTransaction = { ...sale, status: 'refunded', refundedAt, financialRevision: (sale.financialRevision ?? 0) + 1 };
        if (originalDebt) debt = { ...originalDebt, totalAmount: 0, amountPaid: 0, remainingBalance: 0, status: 'paid', updatedAt: refundedAt };
        if (customer) {
          const credit = refundCents(customer.storeCredit ?? 0) + creditDelta;
          if (!Number.isSafeInteger(credit) || credit < 0) throw new Error('The Avoir issued by this invoice has already been spent. Review the account before reversing it.');
          const totalDebt = debts.filter(d => d.id !== originalDebt?.id && d.status !== 'paid').reduce((sum, d) => sum + refundCents(d.remainingBalance), 0);
          const before = calculateCustomerFinancials(customer, [], [sale], originalDebt ? [originalDebt] : []);
          const after = calculateCustomerFinancials(customer, [], [refunded], debt ? [debt] : []);
          customer = {
            ...customer, storeCredit: credit / 100, totalDebt: totalDebt / 100,
            totalSpent: Math.max(0, Math.round(((customer.totalSpent ?? 0) + after.totalSpent - before.totalSpent) * 100) / 100),
            totalPurchases: Math.max(0, (customer.totalPurchases ?? 0) + after.totalPurchases - before.totalPurchases),
          };
        }

        for (const { ref, product } of stockWrites) tx.update(ref, { stock: product.stock, stockStatus: product.stockStatus });
        if (debt) tx.update(doc(db, 'customer_debts', debt.id), { totalAmount: 0, amountPaid: 0, remainingBalance: 0, status: 'paid', updatedAt: refundedAt });
        if (customer && customerRef) {
          tx.update(customerRef, { storeCredit: customer.storeCredit, totalDebt: customer.totalDebt, totalSpent: customer.totalSpent, totalPurchases: customer.totalPurchases });
          tx.set(doc(db, 'customer_activity_logs', receiptId), {
            customerId: customer.id, customerName: customer.name || sale.customerName || 'Customer',
            actionType: 'item_return', actionTitle: `Full Refund — Receipt #${sale.invoiceNumber || sale.id}`,
            actionDescription: 'Invoice, stock and account reversed together.',
            actorId: actor.id, actorName: actor.name, actorRole: actor.role, date: refundedAt, createdAt: refundedAt,
            metadata: { transactionId: sale.id, refundedTotal: sale.total, storeCreditChange: creditDelta / 100, debtId: debt?.id ?? null },
          });
        }
        tx.update(saleRef, { status: refunded.status, refundedAt, financialRevision: refunded.financialRevision });
        tx.set(receiptRef, {
          kind: 'sale_refund', stage: 'completed', operationId,
          transactionId: sale.id, refundedAt, customerId: customer?.id ?? null, debtId: debt?.id ?? null,
          stockSources: stockWrites.map(write => ({ collection: write.source, id: write.product.id })),
        });
        tx.set(doc(db, 'activityLogs', receiptId), {
          category: 'sales', message: `Refund processed for transaction #${sale.id}`, entityId: sale.id,
          entityType: 'sale', userId: actor.id, userName: actor.name, timestamp: Timestamp.now(),
        });
        return { outcome: 'refunded' as const, transaction: refunded, stock: stockWrites.map(write => write.product), customer, debt };
      }), 8000, 'saleRefundTransaction');

      writeJournal<PendingSaleRefund>(
        REFUND_JOURNAL_KEY,
        readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY).filter(r => r.transactionId !== expected.id)
      );
      return cacheSaleDocuments(result);
    } catch (err) {
      if (isDefiniteDomainError(err)) {
        writeJournal<PendingSaleRefund>(
          REFUND_JOURNAL_KEY,
          readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY).filter(r => r.transactionId !== expected.id)
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err ?? 'Unknown refund interruption');
        writeJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY, [
          { ...claimedEntry, stage: 'claimed', errorMessage: msg },
          ...readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY).filter(r => r.transactionId !== expected.id),
        ]);
      }
      throw err;
    }
  },

  getPendingRefunds: (): PendingSaleRefund[] => readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY),

  clearPendingRefund: (transactionId: string): void => {
    writeJournal<PendingSaleRefund>(
      REFUND_JOURNAL_KEY,
      readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY).filter(r => r.transactionId !== transactionId)
    );
  },

  reconcilePendingRefunds: async (): Promise<{
    adopted: SaleRefundResult[];
    pending: PendingSaleRefund[];
  }> => {
    const journal = readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY);
    if (journal.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return { adopted: [], pending: journal };
    }
    const adopted: SaleRefundResult[] = [];
    const remaining: PendingSaleRefund[] = [];

    for (const entry of journal) {
      try {
        const receiptId = `sale_refund_${encodeURIComponent(entry.transactionId)}`;
        const [receiptSnap, saleSnap] = await Promise.all([
          getDoc(doc(db, 'operation_receipts', receiptId)),
          getDoc(doc(db, COLLECTION, entry.transactionId)),
        ]);
        if (!saleSnap.exists()) {
          remaining.push(entry);
          continue;
        }
        const sale = docToTx(saleSnap.id, saleSnap.data() as Record<string, unknown>);
        const saved = receiptSnap.exists() ? receiptSnap.data() : null;
        if (saved && saved.kind === 'sale_refund' && saved.stage !== 'claimed' && sale.status === 'refunded') {
          const stock: PhoneModel[] = [];
          for (const source of (saved.stockSources as { collection: string; id: string }[] | undefined) || []) {
            const snap = await getDoc(doc(db, source.collection, source.id));
            if (snap.exists()) stock.push({ ...snap.data(), id: snap.id } as PhoneModel);
          }
          const custSnap = saved.customerId ? await getDoc(doc(db, 'customers', String(saved.customerId))) : null;
          const debtSnap = saved.debtId ? await getDoc(doc(db, 'customer_debts', String(saved.debtId))) : null;
          adopted.push(cacheSaleDocuments<SaleRefundResult>({
            outcome: 'refunded',
            transaction: sale,
            stock,
            customer: custSnap?.exists() ? ({ ...custSnap.data(), id: custSnap.id } as Customer) : undefined,
            debt: debtSnap?.exists() ? ({ ...debtSnap.data(), id: debtSnap.id } as CustomerDebtEntry) : undefined,
          }));
          continue;
        }
        if (['refunded', 'voided', 'cancelled'].includes(sale.status || '')) {
          adopted.push(cacheSaleDocuments<SaleRefundResult>({ outcome: 'already_closed', transaction: sale, stock: [] }));
          continue;
        }
        remaining.push(entry);
      } catch {
        remaining.push(entry);
      }
    }

    writeJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY, remaining);
    return { adopted, pending: remaining };
  },

  getPendingSaleEdits: (): PendingSaleEdit[] => readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY),

  savePendingSaleEdit: (entry: PendingSaleEdit): void => {
    writeJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY, [
      entry,
      ...readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY).filter(e => e.transactionId !== entry.transactionId),
    ]);
  },

  removePendingSaleEdit: (transactionId: string): void => {
    writeJournal<PendingSaleEdit>(
      EDIT_JOURNAL_KEY,
      readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY).filter(e => e.transactionId !== transactionId)
    );
  },

  reconcilePendingSaleEdits: async (): Promise<{
    adopted: SaleEditResult[];
    pending: PendingSaleEdit[];
  }> => {
    const journal = readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY);
    if (journal.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return { adopted: [], pending: journal };
    }
    const adopted: SaleEditResult[] = [];
    const remaining: PendingSaleEdit[] = [];

    for (const entry of journal) {
      if (entry.status === 'queued' || entry.status === 'conflict') {
        remaining.push(entry);
        continue;
      }
      try {
        const nextRevision = (entry.expected.financialRevision ?? 0) + 1;
        const receiptId = `sale_edit_${encodeURIComponent(entry.transactionId)}_${nextRevision}`;
        const [receiptSnap, saleSnap] = await Promise.all([
          getDoc(doc(db, 'operation_receipts', receiptId)),
          getDoc(doc(db, COLLECTION, entry.transactionId)),
        ]);
        if (!saleSnap.exists()) {
          remaining.push(entry);
          continue;
        }
        const sale = docToTx(saleSnap.id, saleSnap.data() as Record<string, unknown>);
        const saved = receiptSnap.exists() ? receiptSnap.data() : null;
        if (saved && saved.kind === 'sale_edit' && (!saved.operationId || saved.operationId === entry.operationId)) {
          const stock: PhoneModel[] = [];
          for (const source of (saved.stockSources as { collection: string; id: string }[] | undefined) || []) {
            const snap = await getDoc(doc(db, source.collection, source.id));
            if (snap.exists()) stock.push({ ...snap.data(), id: snap.id } as PhoneModel);
          }
          const custSnap = saved.customerId ? await getDoc(doc(db, 'customers', String(saved.customerId))) : null;
          const debtSnap = saved.debtId ? await getDoc(doc(db, 'customer_debts', String(saved.debtId))) : null;
          adopted.push(cacheSaleDocuments<SaleEditResult>({
            transaction: sale,
            stock,
            customer: custSnap?.exists() ? ({ ...custSnap.data(), id: custSnap.id } as Customer) : undefined,
            debt: debtSnap?.exists() ? ({ ...debtSnap.data(), id: debtSnap.id } as CustomerDebtEntry) : undefined,
          }));
          continue;
        }
        if ((sale.financialRevision ?? 0) !== (entry.expected.financialRevision ?? 0)) {
          remaining.push({ ...entry, status: 'conflict', errorMessage: 'Modified on another device.' });
          continue;
        }
        remaining.push(entry);
      } catch {
        remaining.push(entry);
      }
    }

    writeJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY, remaining);
    return { adopted, pending: remaining };
  },

  remapJournalIds: (remapped: Map<string, string>): void => {
    if (remapped.size === 0) return;
    const remapField = (v: string | undefined) => (v ? remapped.get(v) || v : v);
    const refunds = readJournal<PendingSaleRefund>(REFUND_JOURNAL_KEY);
    if (refunds.length > 0) {
      writeJournal<PendingSaleRefund>(
        REFUND_JOURNAL_KEY,
        refunds.map(r => ({
          ...r,
          transactionId: remapField(r.transactionId) || r.transactionId,
          expected: {
            ...r.expected,
            id: remapField(r.expected.id) || r.expected.id,
            customerId: remapField(r.expected.customerId),
          },
        }))
      );
    }
    const edits = readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY);
    if (edits.length > 0) {
      writeJournal<PendingSaleEdit>(
        EDIT_JOURNAL_KEY,
        edits.map(e => ({
          ...e,
          transactionId: remapField(e.transactionId) || e.transactionId,
          expected: {
            ...e.expected,
            id: remapField(e.expected.id) || e.expected.id,
            customerId: remapField(e.expected.customerId),
          },
          edit: {
            ...e.edit,
            creditShift: e.edit.creditShift
              ? { ...e.edit.creditShift, customerId: remapField(e.edit.creditShift.customerId) || e.edit.creditShift.customerId }
              : undefined,
            debtUpdate: e.edit.debtUpdate
              ? { ...e.edit.debtUpdate, debtId: remapField(e.edit.debtUpdate.debtId) || e.edit.debtUpdate.debtId }
              : undefined,
          },
        }))
      );
    }
  },

  /**
   * Correct a settled invoice: the document, its shelf movement, the linked credit
   * record and any Avoir shift land in ONE transaction, keyed by the revision the
   * till saw. Two tills editing the same invoice cannot silently overwrite each
   * other — the second one's revision no longer matches and it is refused before
   * anything moves. A lost acknowledgement adopts the recorded outcome instead of
   * applying the correction twice.
   */
  editSale: async (expected: SaleTransaction, edit: SaleEditRequest): Promise<SaleEditResult> => {
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || expected.id.startsWith('offline_')) {
      throw new Error('Connect and sync this invoice before editing it.');
    }
    const nextRevision = (expected.financialRevision ?? 0) + 1;
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) throw new Error('This invoice carries an invalid revision. Refresh it before editing.');
    const receiptId = `sale_edit_${encodeURIComponent(expected.id)}_${nextRevision}`;
    const requestFingerprint = editRequestFingerprint(edit);
    const editedAt = new Date().toISOString();
    const result = await withTimeout(runTransaction(db, async tx => {
      const saleRef = doc(db, COLLECTION, expected.id);
      const receiptRef = doc(db, 'operation_receipts', receiptId);
      const saleSnap = await tx.get(saleRef);
      const receipt = await tx.get(receiptRef);
      if (!saleSnap.exists()) throw new Error('This invoice no longer exists.');
      const sale = docToTx(saleSnap.id, saleSnap.data());
      if (receipt.exists()) {
        const saved = receipt.data();
        if (saved.kind !== 'sale_edit' || saved.transactionId !== sale.id || saved.appliedRevision !== nextRevision) {
          throw new Error('The edit record does not match this invoice. Do not repeat the correction.');
        }
        const mismatchedOperation = Boolean(edit.operationId && saved.operationId && saved.operationId !== edit.operationId);
        const mismatchedPayload = typeof saved.requestFingerprint === 'string' && saved.requestFingerprint !== requestFingerprint;
        if (mismatchedOperation || mismatchedPayload) {
          throw new Error('This invoice was changed on another device. Refresh and review it before editing.');
        }
        const stock: PhoneModel[] = [];
        for (const source of (saved.stockSources as { collection: string; id: string }[]) || []) {
          const snap = await tx.get(doc(db, source.collection, source.id));
          if (snap.exists()) stock.push({ ...snap.data(), id: snap.id } as PhoneModel);
        }
        const customer = saved.customerId ? await tx.get(doc(db, 'customers', saved.customerId)) : null;
        const debt = saved.debtId ? await tx.get(doc(db, 'customer_debts', saved.debtId)) : null;
        return {
          transaction: sale, stock,
          customer: customer?.exists() ? { ...customer.data(), id: customer.id } as Customer : undefined,
          debt: debt?.exists() ? { ...debt.data(), id: debt.id } as CustomerDebtEntry : undefined,
        };
      }
      if ((sale.financialRevision ?? 0) !== (expected.financialRevision ?? 0)) throw new Error('This invoice was changed on another device. Refresh and review it before editing.');
      if (sale.status === 'refunded' || sale.status === 'voided' || sale.status === 'cancelled' || sale.status === 'pending_approval') throw new Error('This invoice is closed and cannot be edited.');
      if (sale.stockApplied === false) throw new Error('This invoice has not finished syncing. Wait for its shelf movement before editing.');

      const stockWrites: { ref: ReturnType<typeof doc>; source: string; product: PhoneModel }[] = [];
      for (const { productId, delta } of edit.stockDeltas) {
        let source = 'inventory';
        let ref = doc(db, source, productId);
        let snap = await tx.get(ref);
        if (!snap.exists()) {
          source = 'products';
          ref = doc(db, source, productId);
          snap = await tx.get(ref);
        }
        if (!snap.exists()) throw new Error(`Product ${productId} no longer exists. Review its stock before editing.`);
        const data = snap.data();
        const stock = (data.stock as number) + delta;
        if (!Number.isSafeInteger(data.stock) || (data.stock as number) < 0 || !Number.isSafeInteger(stock) || stock < 0) {
          throw new Error(`Not enough stock to correct ${data.name || productId}.`);
        }
        stockWrites.push({ ref, source, product: { ...data, id: productId, stock, stockStatus: computeStockStatus(stock, data.lowStockThreshold ?? 1) } as PhoneModel });
      }

      // Firestore transactions read everything before writing anything, so all of
      // these lookups happen before the first tx.update below.
      let customer: Customer | undefined;
      let customerRef: ReturnType<typeof doc> | null = null;
      if (edit.creditShift && edit.creditShift.amount !== 0) {
        customerRef = doc(db, 'customers', edit.creditShift.customerId);
        const snap = await tx.get(customerRef);
        if (!snap.exists() || snap.data().mergedIntoId) throw new Error('The linked customer is missing or merged. Review the account manually before editing.');
        const current = snap.data();
        const credit = Math.round(((current.storeCredit || 0) + edit.creditShift.amount) * 100) / 100;
        if (!Number.isFinite(credit) || credit < 0) throw new Error('The Avoir needed for this correction has already been spent. Review the account before editing.');
        customer = { ...current, id: customerRef.id, storeCredit: credit } as Customer;
      }

      let debt: CustomerDebtEntry | undefined;
      let debtRef: ReturnType<typeof doc> | null = null;
      if (edit.debtUpdate) {
        debtRef = doc(db, 'customer_debts', edit.debtUpdate.debtId);
        const snap = await tx.get(debtRef);
        if (!snap.exists()) throw new Error('The linked credit record no longer exists. Review it before editing.');
        const current = { ...snap.data(), id: snap.id } as CustomerDebtEntry;
        // The correction's numbers were derived from the paid figure this till saw;
        // money recorded by another terminal in the meantime makes them stale.
        if ((current.amountPaid || 0) !== (edit.debtUpdate.expectedPaid || 0)) throw new Error('The credit record received a payment on another device. Refresh and review it before editing.');
        const charged = Math.max(0, Math.round(edit.debtUpdate.charged * 100) / 100);
        const remaining = charged > 0 || edit.debtUpdate.charged === 0
          ? Math.max(0, charged)
          : Math.max(0, Math.round((edit.debtUpdate.total - (current.amountPaid || 0)) * 100) / 100);
        const status: CustomerDebtEntry['status'] = remaining <= 0 ? 'paid' : (current.amountPaid || 0) > 0 ? 'partially_paid' : 'unpaid';
        debt = {
          ...current,
          totalAmount: Math.round(edit.debtUpdate.total * 100) / 100,
          remainingBalance: remaining,
          status,
          updatedAt: editedAt,
          itemsSummary: edit.debtUpdate.itemsSummary,
          productOrService: edit.debtUpdate.itemsSummary,
        };
      }

      for (const { ref, product } of stockWrites) tx.update(ref, { stock: product.stock, stockStatus: product.stockStatus });
      if (customer && customerRef) {
        tx.update(customerRef, { storeCredit: customer.storeCredit });
        tx.set(doc(db, 'customer_activity_logs', receiptId), {
          customerId: customer.id, customerName: customer.name || sale.customerName || 'Customer',
          actionType: 'store_credit_issued', actionTitle: `Invoice #${sale.invoiceNumber || sale.id} corrected`,
          actionDescription: edit.creditShift!.note,
          date: editedAt, createdAt: editedAt,
          metadata: { transactionId: sale.id, storeCreditChange: edit.creditShift!.amount },
        });
      }
      if (debt && debtRef) {
        tx.update(debtRef, { totalAmount: debt.totalAmount, remainingBalance: debt.remainingBalance, status: debt.status, updatedAt: debt.updatedAt, itemsSummary: debt.itemsSummary, productOrService: debt.productOrService });
      }
      tx.update(saleRef, edit.updates);
      tx.set(receiptRef, {
        kind: 'sale_edit', transactionId: sale.id, appliedRevision: nextRevision, editedAt,
        requestFingerprint,
        ...(edit.operationId ? { operationId: edit.operationId } : {}),
        customerId: customer?.id ?? null, debtId: debt?.id ?? null,
        stockSources: stockWrites.map(write => ({ collection: write.source, id: write.product.id })),
        creditShift: edit.creditShift?.amount ?? 0,
      });
      return {
        transaction: { ...sale, ...edit.updates } as SaleTransaction,
        stock: stockWrites.map(write => write.product), customer, debt,
      };
    }), 8000, 'saleEditTransaction');
    return cacheSaleDocuments(result);
  },

  replayQueuedSaleEdit: async (payload: {
    transactionId: string;
    operationId: string;
    expected: SaleTransaction;
    edit: SaleEditRequest;
  }): Promise<SaleEditResult> => {
    try {
      const result = await transactionService.editSale(payload.expected, {
        ...payload.edit,
        operationId: payload.operationId,
      });
      writeJournal<PendingSaleEdit>(
        EDIT_JOURNAL_KEY,
        readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY).filter(e => e.transactionId !== payload.transactionId)
      );
      return result;
    } catch (err) {
      if (isDefiniteDomainError(err)) {
        const msg = err instanceof Error ? err.message : String(err ?? 'Conflict while replaying invoice edit');
        writeJournal<PendingSaleEdit>(
          EDIT_JOURNAL_KEY,
          readJournal<PendingSaleEdit>(EDIT_JOURNAL_KEY).map(e =>
            e.transactionId === payload.transactionId
              ? { ...e, status: 'conflict' as const, errorMessage: msg }
              : e
          )
        );
        throw new UnrecoverableSyncActionError(msg);
      }
      throw err;
    }
  },

  updateTransaction: async (id: string, updates: Partial<SaleTransaction>): Promise<void> => {
    invalidateReportsCache();
    const local = getLocalTransactions();
    saveLocalTransactions(local.map(t => t.id === id ? { ...t, ...updates } : t));

    if (id.startsWith('offline_') || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return;
    }

    try {
      const updatePromise = updateDoc(doc(db, COLLECTION, id), updates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateTransaction timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
    } catch (err) {
      console.warn('Failed to update transaction in Firestore, updated locally:', err);
    }
  },

  /** Problem 4 fix: Batch-update Firestore transactions to reassign from one customer to another during merge */
  reassignTransactionsForCustomer: async (
    primaryId: string,
    mergedName: string,
    mergedPhone: string,
    secondaryId: string
  ): Promise<number> => {
    try {
      const q = query(
        collection(db, COLLECTION),
        where('customerId', '==', secondaryId)
      );
      const snap = await getDocs(q);
      if (snap.empty) return 0;

      // Firestore writeBatch limit is 500 per batch
      const docs = snap.docs;
      let count = 0;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 450);
        for (const txDoc of chunk) {
          batch.update(txDoc.ref, {
            customerId: primaryId,
            customerName: mergedName,
            customerPhone: mergedPhone,
          });
          count++;
        }
        await batch.commit();
      }

      // Also update local storage cache
      const local = getLocalTransactions();
      saveLocalTransactions(
        local.map(t =>
          t.customerId === secondaryId
            ? { ...t, customerId: primaryId, customerName: mergedName, customerPhone: mergedPhone }
            : t
        )
      );

      return count;
    } catch (err) {
      console.warn('Failed to reassign transactions in Firestore:', err);
      return 0;
    }
  },
};
