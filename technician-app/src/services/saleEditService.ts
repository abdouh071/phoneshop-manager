/**
 * Writing an edited invoice back, in the order that keeps the shop honest.
 * ========================================================================
 * Three things have to agree after a correction: the transaction document, the
 * shelf counts, and — when the sale went to someone's account — the debt. They are
 * three separate writes on a Spark plan with no Cloud Functions, so the order is
 * the design:
 *
 *   1. the document, because it is what the reports, the receipts and the desktop
 *      read, and a failed write here means nothing else should have moved;
 *   2. the shelf, line by line, through the same atomic primitive the till uses, so
 *      a count another device moved while this sheet was open cannot be overwritten;
 *   3. the debt, last, because it is derived from the total in (1).
 *
 * A stock delta the server never took is not lost — it goes into the same queue the
 * POS uses, and the replay pass applies it. Everything after step 1 is best-effort
 * and reported back, because a corrected invoice that failed to notify the manager
 * is still a corrected invoice.
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
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

const itemsSummary = (plan: SaleEditPlan): string =>
  plan.items.map(i => `${i.quantity}x ${i.product?.name || i.product?.model || ''}`.trim()).join(', ');

/**
 * The debt entry that was written when the sale settled, if this phone can still
 * name it. An offline sale carries a local id, and there is no Firestore document
 * to correct yet — the sync pass creates it from the edited transaction.
 */
const syncLinkedDebt = async (tx: SaleTransaction, plan: SaleEditPlan): Promise<boolean> => {
  const debtId = tx.accountSettlement?.debtEntryId;
  if (!debtId || debtId.startsWith('offline_')) return false;

  const debtRef = doc(db, 'customer_debts', debtId);
  const snap = await getDoc(debtRef);
  if (!snap.exists()) return false;

  const debt = snap.data() as { customerId: string; amountPaid: number; remainingBalance: number };
  const amountPaid = Number(debt.amountPaid) || 0;
  const remaining = Math.max(0, Math.round((plan.total - amountPaid) * 100) / 100);
  const status = remaining <= 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid';
  const now = new Date().toISOString();
  const summary = itemsSummary(plan);

  await updateDoc(debtRef, {
    totalAmount: plan.total,
    remainingBalance: remaining,
    status,
    // Every line taken off the invoice leaves nothing to name; blanking the
    // description would erase what the debt was for on the customer's file.
    ...(summary ? { productOrService: `POS Sale (${summary})` } : {}),
    updatedAt: now,
  });

  // What the customer owes is the sum of what they still owe. Moving it by the
  // difference between the old balance and the new one is the same arithmetic the
  // counter does when it recomputes a profile from scratch, in one read instead of
  // a query over every debt on the account.
  const drift = remaining - (Number(debt.remainingBalance) || 0);
  const spentDrift = plan.total - (tx.total || 0);
  if (debt.customerId && (drift !== 0 || spentDrift !== 0)) {
    const custRef = doc(db, 'customers', debt.customerId);
    const custSnap = await getDoc(custRef);
    if (custSnap.exists()) {
      const cust = custSnap.data() as { totalDebt?: number; totalSpent?: number };
      await updateDoc(custRef, {
        totalDebt: Math.max(0, (Number(cust.totalDebt) || 0) + drift),
        totalSpent: Math.max(0, (Number(cust.totalSpent) || 0) + spentDrift),
      });
    }
  }

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
  if (tx.accountSettlement?.debtEntryId) {
    try {
      debtSynced = await syncLinkedDebt(tx, plan);
    } catch (err) {
      console.warn('[SaleEdit] Linked debt could not be corrected:', err);
    }
  }

  activityLogService
    .log(
      'sales',
      `Edited Sale #${tx.invoiceNumber || tx.id.slice(-6)}: ${tx.total} DA -> ${plan.total} DA`,
      {
        entityId: tx.id,
        entityType: 'sale',
        detail: `${itemsSummary(plan)} · status ${plan.status}${
          stockFailures.length ? ` · ${stockFailures.length} stock delta queued` : ''
        }`,
        userName: user?.name || 'Staff',
        userId: user?.id,
      }
    )
    .catch(err => console.warn('[SaleEdit] Activity log failed:', err));

  return { total: plan.total, status: plan.status, stockFailures, debtSynced };
};
