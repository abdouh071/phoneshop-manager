/**
 * Writing an edited invoice back, the way the counter terminal does it.
 * ====================================================================
 * The desktop's `cartStore.editTransaction` moves four things: the stock, the
 * transaction document, the customer's debt entry and the customer's own totals,
 * plus the two audit trails the shop reads (the activity feed and the customer's
 * timeline). This is the same sequence on a phone.
 *
 * Two orders differ from the desktop, deliberately. The document is written
 * FIRST, because it is what the reports, the receipts and the counter read, and a
 * failed write there should move nothing else; the desktop restocks before it
 * saves, so a dead network there leaves goods on the shelf that were never
 * returned. And the shelf deltas go through the till's own atomic writer instead
 * of a read-then-write, so a count another device moved mid-edit cannot be
 * overwritten by this phone.
 *
 * A stock delta the server never took is not lost — it goes into the same queue
 * the POS uses, and the replay pass applies it. Everything after the document is
 * best-effort and reported back, because a corrected invoice that failed to
 * notify the manager is still a corrected invoice.
 */
import { addDoc, collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import type { SaleEditPlan } from '../utils/saleEdit';
import type { SaleTransaction } from '../types';
import { activityLogService } from './activityLogService';
import { notificationService } from './notificationService';
import { offlineSyncService } from './offlineSyncService';
import { applyStockLines, readStockLevels, type StockLine } from './stockService';

export interface SaleEditFailure {
  name: string;
  quantity: number;
  error: string;
}

export interface OversoldLine {
  productId: string;
  name: string;
  wanted: number;
  /** null when the product no longer has an inventory row at all. */
  available: number | null;
}

export interface SaleEditOutcome {
  total: number;
  status: SaleTransaction['status'];
  stockFailures: SaleEditFailure[];
  debtSynced: boolean;
}

/**
 * The units an edit wants to take out, against what the shelf actually holds.
 *
 * Raising a quantity on a settled invoice is the one correction that can sell
 * something twice, and the atomic writer clamps at zero rather than refusing — so
 * without this check the invoice would claim three units while the shelf went to
 * none. Every line for the same product is folded together first, because an old
 * document can carry one SKU on two rows.
 */
export const findOversoldLines = async (plan: SaleEditPlan): Promise<OversoldLine[]> => {
  if (plan.deduct.length === 0) return [];

  const wantedByProduct = new Map<string, { name: string; quantity: number }>();
  for (const line of plan.deduct) {
    const previous = wantedByProduct.get(line.productId);
    wantedByProduct.set(line.productId, {
      name: previous?.name || line.name,
      quantity: (previous?.quantity || 0) + line.quantity,
    });
  }

  const levels = await readStockLevels([...wantedByProduct.keys()]);
  const blocked: OversoldLine[] = [];
  for (const [productId, want] of wantedByProduct) {
    const available = levels.get(productId) ?? null;
    if (available === null || available < want.quantity) {
      blocked.push({ productId, name: want.name, wanted: want.quantity, available });
    }
  }
  return blocked;
};

/** The counter's line description: `2x Hoco EQ2 BT-EQ2`. */
const itemsSummary = (plan: SaleEditPlan): string =>
  plan.items
    .map(i => `${i.quantity}x ${i.product?.name || ''} ${i.product?.model || ''}`.replace(/\s+/g, ' ').trim())
    .join(', ');

/** The counter's price column for the audit trails: `2x Hoco EQ2 @ 4500 DA`. */
const itemsDetail = (plan: SaleEditPlan): string =>
  plan.items
    .map(i => `${i.quantity}x ${i.product?.name || i.product?.model || 'Item'} @ ${i.product?.price ?? 0} DA`)
    .join(', ');

interface FoundDebt {
  id: string;
  customerId: string;
  customerName?: string;
  amountPaid: number;
  remainingBalance: number;
}

/**
 * The debt entry raised when this sale went to someone's account.
 *
 * The desktop matches on three things — the id recorded on the transaction, the
 * transaction id stored on the debt, and its notes carrying the transaction id —
 * because which of the three exists depends on which app wrote the sale and when.
 * Reading three clauses off a phone costs a query, so the first clause is a direct
 * document read and the other two only run for a sale that was not paid in full.
 */
const findLinkedDebt = async (tx: SaleTransaction): Promise<FoundDebt | null> => {
  const toDebt = (id: string, data: Record<string, unknown>): FoundDebt => ({
    id,
    customerId: String(data.customerId || ''),
    customerName: data.customerName ? String(data.customerName) : tx.customerName,
    amountPaid: Number(data.amountPaid) || 0,
    remainingBalance: Number(data.remainingBalance) || 0,
  });

  const debtEntryId = tx.accountSettlement?.debtEntryId;
  // An offline sale carries a local id; there is no Firestore document to correct
  // yet, and the sync pass creates it from the edited transaction.
  if (debtEntryId && !debtEntryId.startsWith('offline_')) {
    const snap = await getDoc(doc(db, 'customer_debts', debtEntryId)).catch(() => null);
    if (snap?.exists()) return toDebt(snap.id, snap.data() as Record<string, unknown>);
  }

  if (!tx.customerId) return null;
  if (tx.accountSettlement?.type === 'paid_full') return null;

  const byAnyOfTheThree = (id: string, data: Record<string, unknown>) =>
    id === debtEntryId || data.transactionId === tx.id || String(data.notes || '').includes(tx.id);

  const found = await getDocs(
    query(
      collection(db, 'customer_debts'),
      where('customerId', '==', tx.customerId),
      limit(100)
    )
  ).catch(() => null);
  if (!found) return null;

  for (const row of found.docs) {
    const data = row.data() as Record<string, unknown>;
    if (byAnyOfTheThree(row.id, data)) return toDebt(row.id, data);
  }
  return null;
};

/**
 * `debtService.updateDebtAmount` plus the totals its store wrapper then puts back
 * on the customer: the new total against what was already paid decides the
 * remaining balance and the state, and what the account owes is the sum of the
 * entries that are not settled.
 */
const syncLinkedDebt = async (
  tx: SaleTransaction,
  plan: SaleEditPlan,
  debt: FoundDebt
): Promise<boolean> => {
  const now = new Date().toISOString();
  const amountPaid = debt.amountPaid;
  const remainingBalance = Math.max(0, plan.total - amountPaid);
  const status = remainingBalance <= 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid';
  const summary = itemsSummary(plan);

  const updates: Record<string, unknown> = {
    totalAmount: plan.total,
    remainingBalance,
    status,
    updatedAt: now,
  };
  if (summary) {
    updates.itemsSummary = summary;
    updates.productOrService = summary;
  }

  await updateDoc(doc(db, 'customer_debts', debt.id), updates);

  const ref = doc(db, 'customers', debt.customerId);
  const custSnap = await getDoc(ref).catch(() => null);
  if (custSnap?.exists()) {
    const cust = custSnap.data() as { totalSpent?: number };
    // What the account owes is every entry on it that is not settled. The desktop
    // reads that off the list already in memory; the phone asks for it — one
    // bounded query, and only for a sale that went to account.
    const openBalance = status === 'paid' ? 0 : remainingBalance;
    const others = await getDocs(
      query(collection(db, 'customer_debts'), where('customerId', '==', debt.customerId), limit(100))
    ).catch(() => null);
    const totalDebt = others
      ? others.docs.reduce((sum, row) => {
          if (row.id === debt.id) return sum; // counted above, at its new balance
          const data = row.data() as { status?: string; remainingBalance?: number };
          return data.status && data.status !== 'paid' ? sum + (Number(data.remainingBalance) || 0) : sum;
        }, openBalance)
      : openBalance;

    await updateDoc(ref, {
      totalDebt: Math.max(0, totalDebt),
      // What the profile has spent is every sale on it; this invoice just changed
      // by the difference, which is what an authoritative recompute would find.
      totalSpent: Math.max(0, (Number(cust.totalSpent) || 0) + (plan.total - (tx.total || 0))),
    });
  }

  const actor = useAuthStore.getState().user;
  await addDoc(collection(db, 'customer_activity_logs'), {
    customerId: debt.customerId,
    customerName: debt.customerName || tx.customerName || 'Customer',
    actionType: 'debt_edited',
    actionTitle: 'Invoice / Debt Balance Adjusted',
    actionDescription: `Invoice total adjusted from ${tx.total || 0} DA to ${plan.total} DA by ${actor?.name || 'Staff'}. New remaining balance: ${remainingBalance} DA.`,
    actorId: actor?.id,
    actorName: actor?.name || 'Staff',
    actorRole: actor?.role || 'sales_agent',
    metadata: { transactionId: tx.id, oldTotal: tx.total || 0, newTotal: plan.total, remainingBalance },
    date: now,
    createdAt: now,
  }).catch(err => console.warn('[SaleEdit] Customer debt log could not be written:', err));

  return true;
};

export const applySaleEdit = async (
  tx: SaleTransaction,
  plan: SaleEditPlan
): Promise<SaleEditOutcome> => {
  const user = useAuthStore.getState().user;
  const now = new Date().toISOString();

  await updateDoc(doc(db, 'transactions', tx.id), {
    items: plan.items,
    subtotal: plan.subtotal,
    total: plan.total,
    status: plan.status,
    payments: plan.payments,
    // A sale parked behind an approval request is no longer waiting on anyone.
    approvalRequestId: null,
    editedAt: now,
    editedById: user?.id ?? null,
    editedByName: user?.name ?? 'Staff',
  });

  const stockFailures: SaleEditFailure[] = [];
  const queued: { line: StockLine; delta: number }[] = [];

  const restock = await applyStockLines(plan.restock, 1);
  for (const f of restock.failed) {
    stockFailures.push({ name: f.line.name, quantity: f.line.quantity, error: f.error });
    queued.push({ line: f.line, delta: f.line.quantity });
  }

  const deduct = await applyStockLines(plan.deduct, -1);
  for (const f of deduct.failed) {
    stockFailures.push({ name: f.line.name, quantity: f.line.quantity, error: f.error });
    queued.push({ line: f.line, delta: -f.line.quantity });
  }
  for (const applied of deduct.ok) {
    if (applied.result.stockStatus !== 'in_stock') {
      notificationService
        .notifyLowStock(applied.line.name, applied.result.stock)
        .catch(err => console.warn('[SaleEdit] Low stock notification error:', err));
    }
  }

  for (const miss of queued) {
    await offlineSyncService
      .saveOfflineStockDelta({
        productId: miss.line.productId,
        name: miss.line.name,
        delta: miss.delta,
        reason: `Edited sale ${tx.invoiceNumber || tx.id.slice(-6)}`,
      })
      .catch(err => console.warn('[SaleEdit] Could not queue a missed stock delta:', err));
  }

  let debtSynced = false;
  try {
    const debt = await findLinkedDebt(tx);
    if (debt) debtSynced = await syncLinkedDebt(tx, plan, debt);
  } catch (err) {
    console.warn('[SaleEdit] Linked debt could not be corrected:', err);
  }

  activityLogService
    .log(
      'sales',
      `Transaction #${tx.invoiceNumber || tx.id} edited: ${tx.total} DA → ${plan.total} DA`,
      {
        entityId: tx.id,
        entityType: 'sale',
        detail: `Updated items: ${itemsDetail(plan)}`,
        userName: user?.name || 'Staff',
        userId: user?.id,
      }
    )
    .catch(err => console.warn('[SaleEdit] Activity log failed:', err));

  if (tx.customerId) {
    await addDoc(collection(db, 'customer_activity_logs'), {
      customerId: tx.customerId,
      customerName: tx.customerName || 'Customer',
      actionType: 'sale_completed',
      actionTitle: `Invoice #${tx.invoiceNumber || tx.id.slice(0, 8)} Modified`,
      actionDescription: `Invoice adjusted from ${tx.total} DA to ${plan.total} DA by ${user?.name || 'Staff'}. Items: ${itemsDetail(plan)}.`,
      actorId: user?.id,
      actorName: user?.name || 'Staff',
      actorRole: user?.role || 'sales_agent',
      metadata: { transactionId: tx.id, oldTotal: tx.total, newTotal: plan.total, itemsDetail: itemsDetail(plan) },
      date: now,
      createdAt: now,
    }).catch(err => console.warn('[SaleEdit] Customer timeline entry could not be written:', err));
  }

  return { total: plan.total, status: plan.status, stockFailures, debtSynced };
};
