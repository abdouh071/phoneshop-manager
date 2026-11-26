/**
 * Voiding a settled invoice, the way the counter refunds one.
 * ==========================================================
 * Two screens void a sale on a phone: the till's own void of today's invoice, and an
 * admin answering a request over the rail. They used to do different things — the
 * first put the goods back on the shelf, the second only changed a status — so the
 * same request moved stock or not depending on who pressed it. Neither went near the
 * money: a sale that had gone to a customer's account left its balance standing on
 * his name after the goods were back in the case, so the shop kept billing him for
 * what he had handed back.
 *
 * The order differs from the desktop deliberately. The document is written FIRST,
 * because it is what the reports, the receipts and the counter read, and a failure
 * there should move nothing else. The account entry is settled at zero rather than
 * deleted: deleting a credit record is the one write the rules reserve for an admin,
 * and a silent failure there is exactly how an open balance survives a refund.
 *
 * What the phone cannot copy is the desktop's store-credit refund — the terminal turns
 * money already paid on a voided credit record into credit on the account. A phone has
 * no credit ledger to write to, so the collected part simply leaves what the profile
 * has spent and the counter hands the cash back across the till.
 */
import { addDoc, collection, doc, runTransaction, updateDoc, type DocumentReference, type Transaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import type { SaleTransaction } from '../types';
import { activityLogService } from './activityLogService';
import { offlineSyncService } from './offlineSyncService';
import { applyStockLines } from './stockService';
import { runSaleVoidClaimTx, type FirestoreTxOps, type TxRef } from './stockTransactionCore';
import type { SaleStockLine } from '../utils/saleEdit';
import { isSaleClosed, voidStockLines } from '../utils/saleVoid';
import { findLinkedDebt, sumOpenDebt, writeCustomerTotals } from './saleEditService';

const toTxOps = (tx: Transaction): FirestoreTxOps => ({
  doc: (col, id) => doc(db, col, id) as unknown as TxRef,
  get: async (ref) => {
    const snap = await tx.get(ref as unknown as DocumentReference);
    return {
      exists: () => snap.exists(),
      data: () => snap.data() as Record<string, unknown> | undefined,
    };
  },
  update: (ref, data) => tx.update(ref as unknown as DocumentReference, data),
  set: (ref, data) => tx.set(ref as unknown as DocumentReference, data),
});

/** Claiming the void is one read and one write; a till must not hang on a locked row. */
const VOID_TX_TIMEOUT_MS = 6_000;

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

export interface SaleVoidFailure {
  name: string;
  quantity: number;
  error: string;
}

export interface SaleVoidOutcome {
  /** False when the invoice was already closed, so nothing here was touched again. */
  voided: boolean;
  /** Units the server refused to take back; each one is queued for the next sync. */
  stockFailures: SaleVoidFailure[];
  debtSettled: boolean;
  /**
   * What this invoice still puts on the account when the entry could not be reached.
   * Non-zero only for a credit sale whose debt row predates the link — see the edit
   * service: naming it is honest, guessing which row to zero is not.
   */
  accountUnreconciled: number;
}

/** What the account was charged for this invoice, by whichever document states it. */
const chargedOnAccount = (tx: SaleTransaction): number => {
  const fromLines = (tx.payments || []).reduce(
    (sum, p) => (p.method === 'debt' ? sum + (Number(p.amount) || 0) : sum),
    0
  );
  return Math.max(fromLines, Number(tx.accountSettlement?.chargedAmount) || 0);
};

/**
 * Close the account entry this sale raised, and put the profile's numbers back.
 *
 * What the customer spent loses the money this invoice had claimed. The balance he had
 * not yet paid was never spending, so it does not come off `totalSpent` — it simply
 * stops being owed, which is what the account total is recomputed for.
 */
const settleLinkedDebt = async (
  tx: SaleTransaction,
  debt: { id: string; customerId: string; remainingBalance: number },
  now: string
): Promise<void> => {
  await updateDoc(doc(db, 'customer_debts', debt.id), {
    totalAmount: 0,
    amountPaid: 0,
    remainingBalance: 0,
    status: 'paid',
    updatedAt: now,
  });

  const totalDebt = await sumOpenDebt(debt.customerId, debt.id, 0);
  const paid = Math.max(0, (tx.total || 0) - debt.remainingBalance);
  await writeCustomerTotals(debt.customerId, -paid, totalDebt);
};

export const voidSale = async (
  tx: SaleTransaction,
  reason: string
): Promise<SaleVoidOutcome> => {
  const empty: SaleVoidOutcome = { voided: false, stockFailures: [], debtSettled: false, accountUnreconciled: 0 };
  // A cheap refusal when the caller already knows. It is not the gate: the copy in the
  // list is whatever this phone last fetched.
  if (isSaleClosed(tx.status)) return empty;

  const user = useAuthStore.getState().user;
  const now = new Date().toISOString();
  const invoice = tx.invoiceNumber || tx.id.slice(-6);

  const redeemedAvoir = (tx.payments || []).reduce(
    (sum, p) => (p.method === 'store_credit' ? sum + (Number(p.amount) || 0) : sum),
    0
  );

  // Two phones on the same day, or an admin answering a stale request, both reach here
  // holding `completed` for an invoice one of them is about to close. Reading the status,
  // checking financialRevision, restoring redeemed Avoir, and stamping voided inside one
  // reads-before-writes transaction keeps both desktop and mobile ledgers consistent.
  const voidOutcome = await withTimeout(
    runTransaction(db, async (t) =>
      runSaleVoidClaimTx(toTxOps(t), {
        txId: tx.id,
        expectedRevision: tx.financialRevision,
        reason,
        now,
        voidedBy: user ? { uid: user.id, name: user.name } : null,
        customerId: tx.customerId,
        storeCreditToRestore: redeemedAvoir,
      })
    ),
    VOID_TX_TIMEOUT_MS,
    'saleVoidTransaction'
  );
  if (!voidOutcome.voided) return empty;

  // Purchases go back on the shelf, exchange lines come off it — the counter's refund
  // makes the same split, and an invoice a till edited can now carry both kinds.
  const { restore, deduct } = voidStockLines(tx.items);

  const stockFailures: SaleVoidFailure[] = [];
  const queued: { line: SaleStockLine; delta: number }[] = [];

  const restocked = await applyStockLines(restore, 1);
  for (const f of restocked.failed) {
    stockFailures.push({ name: f.line.name, quantity: f.line.quantity, error: f.error });
    queued.push({ line: f.line, delta: f.line.quantity });
  }

  const redeemed = await applyStockLines(deduct, -1);
  for (const f of redeemed.failed) {
    stockFailures.push({ name: f.line.name, quantity: f.line.quantity, error: f.error });
    queued.push({ line: f.line, delta: -f.line.quantity });
  }

  for (const miss of queued) {
    await offlineSyncService
      .saveOfflineStockDelta({
        productId: miss.line.productId,
        name: miss.line.name,
        delta: miss.delta,
        reason: `Voided sale ${invoice}`,
      })
      .catch(err => console.warn('[SaleVoid] Could not queue a missed stock delta:', err));
  }

  let debtSettled = false;
  let unreconciled = 0;
  const account = chargedOnAccount(tx);
  try {
    // Re-read through the same link the editor uses: the entry holds the balance, and
    // this phone must not zero a row it has not seen.
    const debt = await findLinkedDebt(tx);
    if (debt) {
      await settleLinkedDebt(tx, debt, now);
      debtSettled = true;
    } else {
      unreconciled = account;
      // Nothing on account means the whole invoice was money that changed hands, so the
      // profile loses all of it now that the sale never happened.
      if (tx.customerId && account <= 0) {
        await writeCustomerTotals(tx.customerId, -(tx.total || 0), null);
      }
    }
  } catch (err) {
    console.warn('[SaleVoid] Linked debt could not be closed:', err);
    unreconciled = account;
  }

  activityLogService
    .log('sales', `Sale voided: #${invoice} (${tx.total} DA)`, {
      entityId: tx.id,
      entityType: 'sale',
      detail: `${reason} · Items returned: ${(tx.items || []).length}`,
      userName: user?.name || 'Staff',
      userId: user?.id,
    })
    .catch(err => console.warn('[SaleVoid] Activity log failed:', err));

  if (tx.customerId) {
    await addDoc(collection(db, 'customer_activity_logs'), {
      customerId: tx.customerId,
      customerName: tx.customerName || 'Customer',
      actionType: 'item_return',
      actionTitle: `Invoice #${invoice} Voided`,
      actionDescription: `Invoice of ${tx.total} DA was voided by ${user?.name || 'Staff'}. ${reason}${
        debtSettled ? ' The credit record was closed.' : ''
      }`,
      actorId: user?.id,
      actorName: user?.name || 'Staff',
      actorRole: user?.role || 'sales_agent',
      metadata: { transactionId: tx.id, voidedTotal: tx.total, debtSettled },
      date: now,
      createdAt: now,
    }).catch(err => console.warn('[SaleVoid] Customer timeline entry could not be written:', err));
  }

  return { voided: true, stockFailures, debtSettled, accountUnreconciled: unreconciled };
};
