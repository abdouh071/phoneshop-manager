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
import { openDebtTotal, surplusShiftOf, type SaleEditPlan } from '../utils/saleEdit';
import type { SaleTransaction } from '../types';
import { activityLogService } from './activityLogService';
import { customerService } from './customerService';
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
  /**
   * What the customer still owes on this invoice when the phone could not find the
   * entry to correct — non-zero only when the corrected invoice itself carries a
   * balance. The reports and the account then disagree until someone closes it.
   */
  accountUnreconciled: number;
  /**
   * What this correction absorbed from money the customer had already handed over and
   * the counter therefore holds for him as Avoir. The invoice says it owes him nothing
   * back; only this figure says where the difference went.
   */
  avoirHeld: number;
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

/**
 * The counter's line description: `2x Hoco EQ2 BT-EQ2`.
 *
 * A unit the correction hands back is drawn with its minus, as on the desktop. A note
 * that reads `2x Phone, 1x Phone` in the account statement hides what happened to the
 * invoice — the credit line is a separate fact the shop has to be able to read.
 */
const itemsSummary = (plan: SaleEditPlan): string =>
  plan.items
    .map(i => `${i.isReturn ? '−' : ''}${i.quantity}x ${i.product?.name || ''} ${i.product?.model || ''}`.replace(/\s+/g, ' ').trim())
    .join(', ');

/** The counter's price column for the audit trails: `2x Hoco EQ2 @ 4500 DA`. */
const itemsDetail = (plan: SaleEditPlan): string =>
  plan.items
    .map(i => `${i.isReturn ? '−' : ''}${i.quantity}x ${i.product?.name || i.product?.model || 'Item'} @ ${i.product?.price ?? 0} DA`)
    .join(', ');

export interface FoundDebt {
  id: string;
  customerId: string;
  customerName?: string;
  amountPaid: number;
  remainingBalance: number;
}

/**
 * The debt entry raised when this sale went to someone's account.
 *
 * Four things can identify it — the id recorded on the transaction, the transaction
 * id stored on the debt, the debt's notes carrying the transaction id, and the two
 * invoice numbers — because which of them exists depends on which app wrote the sale
 * and when. A counter-written credit sale answers the first three; a phone written
 * offline answers only the last, since no transaction id existed yet when its debt
 * row was queued. Reading them off a phone costs a query, so the first clause is a
 * direct document read and the rest only run for a sale that was not paid in full.
 */
export const findLinkedDebt = async (tx: SaleTransaction): Promise<FoundDebt | null> => {
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

  const invoice = String(tx.invoiceNumber || '').trim();
  const matchesThisInvoice = (id: string, data: Record<string, unknown>) => {
    if (id === debtEntryId || data.transactionId === tx.id) return true;
    if (String(data.notes || '').includes(tx.id)) return true;
    // A phone writes the invoice number on both sides; an invoice raised offline has no
    // transaction id for either party to remember, so this clause is what lets a
    // credit sale that was queued in a back room still be corrected a week later.
    // Both sides must actually carry one — two absent numbers are not a match.
    const debtInvoice = String(data.invoiceNumber || '').trim();
    return !!invoice && !!debtInvoice && debtInvoice === invoice;
  };

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
    if (matchesThisInvoice(row.id, data)) return toDebt(row.id, data);
  }
  return null;
};

/**
 * Put a profile's own numbers back after one of its invoices changed.
 *
 * What a customer has spent is the money that actually changed hands, so an invoice
 * that moved value between the drawer and the account leaves the figure alone and only
 * a real gain or loss moves it. Passing `openBalance` as null leaves what the account
 * owes untouched — an edit that never reached a debt entry cannot recompute it.
 */
export const writeCustomerTotals = async (
  customerId: string,
  paidDelta: number,
  openBalance: number | null
): Promise<void> => {
  const ref = doc(db, 'customers', customerId);
  const snap = await getDoc(ref).catch(() => null);
  if (!snap?.exists()) return;
  const cust = snap.data() as { totalSpent?: number };

  const updates: Record<string, unknown> = { lastVisitDate: new Date().toISOString() };
  if (paidDelta !== 0) {
    updates.totalSpent = Math.max(0, (Number(cust.totalSpent) || 0) + paidDelta);
  }
  if (openBalance !== null) updates.totalDebt = Math.max(0, openBalance);

  await updateDoc(ref, updates)
    .catch(err => console.warn('[SaleEdit] Customer totals could not be written:', err));
};

/**
 * Every entry on an account that is not settled, with `thisId` counted at the balance
 * it has just been given rather than the one the server still holds.
 *
 * The desktop reads this off the debt list already in memory; a phone has to ask —
 * one bounded query, and only for a sale that went to account. Null when the query
 * failed: the callers pass it straight to `writeCustomerTotals`, which then leaves
 * the profile's absolute totalDebt untouched instead of erasing the other debts.
 */
export const sumOpenDebt = async (
  customerId: string,
  thisId: string,
  thisBalance: number
): Promise<number | null> => {
  const others = await getDocs(
    query(collection(db, 'customer_debts'), where('customerId', '==', customerId), limit(100))
  ).catch(() => null);
  return openDebtTotal(
    others
      ? others.docs.map(row => ({ id: row.id, ...(row.data() as { status?: string; remainingBalance?: number }) }))
      : null,
    thisId,
    thisBalance
  );
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
  // What the account owes is what the corrected invoice says it owes. The rescaled
  // payment lines are the document the till, the drawer and the reports all read, so
  // taking the balance from the account's old paid amount instead would leave the two
  // differing by whatever the proportional split rounded away. An invoice that carries
  // no debt line at all keeps the old rule — silence there is not evidence that a
  // standing balance was paid.
  const accountLines = plan.payments.filter(p => p.method === 'debt');
  const charged = accountLines.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remainingBalance = accountLines.length > 0
    ? Math.max(0, Math.round(charged * 100) / 100)
    : Math.max(0, plan.total - amountPaid);
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

  const totalDebt = await sumOpenDebt(
    debt.customerId,
    debt.id,
    status === 'paid' ? 0 : remainingBalance
  );

  // What the profile has spent is the money that changed hands. This invoice held
  // `paidBefore` of it and now holds `paidAfter`; the rest of its value sat on the
  // account before this edit and sits there after, so it is not spending.
  const paidBefore = Math.max(0, (tx.total || 0) - debt.remainingBalance);
  const paidAfter = Math.max(0, plan.total - remainingBalance);
  await writeCustomerTotals(debt.customerId, paidAfter - paidBefore, totalDebt);

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
  // A basket whose returns outweigh its purchases leaves the receipt owing the
  // customer money. Only the counter gets to decide how that leaves the shop — cash
  // back, onto the account, or off what he owes — and writing it here would either
  // round it down to nothing or hand the account a balance nobody settled.
  if (plan.surplusOwedToCustomer) {
    throw new Error(
      `This correction leaves the receipt owing ${Math.abs(plan.total)} DA to the customer. ` +
        'Settle that exchange at the counter, where the shop can record how it was paid back.'
    );
  }

  const user = useAuthStore.getState().user;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = {
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
  };

  // A sale written before the till stored its discount in dinars still carries a
  // percentage, and re-expanding one at print time is how a reprint comes out a
  // dinar off its own lines. The corrected invoice is written once, in the dinars
  // the customer was actually given.
  if (tx.discount?.type === 'percent' && plan.discountAmount > 0) {
    updates.discount = { type: 'flat', value: plan.discountAmount };
  }

  // What each line was knocked down to, kept where the shop's totals can read it:
  // the concession itself lives inside the line's price, so nothing that adds up
  // the discount field ever saw the money. Written only when there is something to
  // say — a correction that hands a price back leaves the earlier record standing,
  // which over-counts a giveaway rather than hiding it.
  if (plan.lineDiscounts.length > 0) updates.lineDiscounts = plan.lineDiscounts;

  await updateDoc(doc(db, 'transactions', tx.id), updates);

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
  let accountUnreconciled = 0;
  let avoirHeld = 0;
  // What the corrected invoice itself puts on the account.
  //
  // A balance standing there with no entry reached is a second document telling a
  // different story about the same customer. The link is written on the debt row only
  // from this revision, so an invoice raised before it lands here every time — naming
  // it is honest, guessing which row to zero is not. The same applies when the search
  // itself failed: nothing was corrected, so nothing may be reported as corrected.
  const chargedOnAccount = plan.payments.reduce(
    (sum, p) => (p.method === 'debt' ? sum + (Number(p.amount) || 0) : sum), 0
  );
  try {
    const debt = await findLinkedDebt(tx);
    if (debt) {
      debtSynced = await syncLinkedDebt(tx, plan, debt);

      // Money the customer already handed over is a fact; correcting the invoice
      // cannot un-pay it. What the account held before this edit and what it holds
      // after is the difference between the two over-collections, and the counter's
      // rule for absorbed money — the one a void already uses — is to keep it as
      // Avoir on the profile rather than let the correction quietly eat it. The
      // difference is what keeps a second correction of the same invoice from
      // granting the same money again.
      const paid = Number(debt.amountPaid) || 0;
      const surplusShift = surplusShiftOf(paid, plan.total, tx.total || 0);
      const creditHolder = tx.customerId || debt.customerId;
      const receipt = tx.invoiceNumber || tx.id.slice(0, 8);

      if (surplusShift !== 0 && creditHolder) {
        try {
          await customerService.shiftStoreCredit(
            creditHolder,
            surplusShift,
            surplusShift > 0
              ? `Over-collection on corrected Receipt #${receipt} held as Avoir`
              : `Avoir released by corrected Receipt #${receipt}`,
            user?.name || 'Staff'
          );
          avoirHeld = Math.max(0, surplusShift);
        } catch (err) {
          // The correction itself stands; the Avoir that could not be written is
          // surfaced to the caller rather than silently dropped.
          console.warn('[SaleEdit] Avoir could not be written:', err);
          accountUnreconciled = Math.max(accountUnreconciled, Math.abs(surplusShift));
        }
      }
    } else {
      accountUnreconciled = chargedOnAccount;
      // No entry involved means the whole invoice was handed over, so its profile
      // moved by the whole difference — and still has to hear about it. A sale whose
      // account entry could not be found is left alone: its own numbers would be
      // computed from a balance this phone never read.
      if (tx.customerId && chargedOnAccount <= 0) {
        await writeCustomerTotals(tx.customerId, plan.total - (tx.total || 0), null);
      }
    }
  } catch (err) {
    console.warn('[SaleEdit] Linked debt could not be corrected:', err);
    accountUnreconciled = chargedOnAccount;
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

  return { total: plan.total, status: plan.status, stockFailures, debtSynced, accountUnreconciled, avoirHeld };
};
