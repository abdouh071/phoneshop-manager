import type { CustomerDebtEntry, CustomerDebtPayment, PaymentMethod } from '../types';

/**
 * A debt raised by a sale or a repair opens with a row for the money already handed
 * over — but that money is also counted on the sale's own tender lines or on the
 * repair's deposit/handover figures. The drawer, the sealed day and the account
 * statement must count it once, on the document that took it. These two helpers are
 * the single rule for writing and recognising those opening rows.
 */

/** The opening rows for a debt raised at the till: the sale's real tender lines,
 *  minus the `debt` row (that is the balance, not money received). */
export function saleOpeningPayments(
  tender: ReadonlyArray<{ method: PaymentMethod; amount: number }>,
  date: string,
  actorName?: string
): CustomerDebtPayment[] {
  return tender
    .filter(p => p.method !== 'debt' && (Number(p.amount) || 0) > 0)
    .map((p, i) => ({
      id: `pay_down_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      amount: p.amount,
      method: p.method,
      note: 'Initial down payment',
      receivedByName: actorName || 'Staff',
      countedOn: 'sale' as const,
    }));
}

/**
 * True when this debt payment is an opening row whose money another document already
 * counts. New rows carry `countedOn`; rows written before the flag existed are
 * recognised by the id/note shapes their writers used, so historical days recompute
 * correctly without rewriting any stored data. A manual debt has no linked document,
 * so its opening row is the only record of that money and must keep counting.
 */
export function isDebtPaymentCountedElsewhere(
  debt: Pick<CustomerDebtEntry, 'transactionId' | 'invoiceNumber' | 'linkedTicketId' | 'type'>,
  payment: CustomerDebtPayment
): boolean {
  if (payment.countedOn) return true;
  const id = payment.id || '';
  // addDebt's fabricated down payment — only a duplicate when a sale document exists.
  if (id.startsWith('pay_down_')) return Boolean(debt.transactionId || debt.invoiceNumber);
  // RepairSettlementModal's deposit + handover rows; the ticket already counts both.
  if (id.startsWith('pay_dep_') || id.startsWith('pay_handover_')) return true;
  const repairLinked = Boolean(debt.linkedTicketId) || debt.type === 'repair';
  if (repairLinked) {
    const note = payment.note || '';
    // Mobile settle's opening row, and the price-edit legs' prior-payment row.
    if (note.startsWith('Handover payment for Repair') || note.startsWith('Prior payment before price edit')) {
      return true;
    }
  }
  return false;
}