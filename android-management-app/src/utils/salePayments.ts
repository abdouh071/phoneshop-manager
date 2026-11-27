/**
 * What a phone sale actually put in the drawer.
 * ==============================================
 * The till's money column, the day's totals and the customer's ledger all read the
 * `payments` array, and the desktop counts the debt owed on it
 * (`dayFigures.computeDayFigures` sums the `debt` lines). A phone used to record a
 * credit sale as one line of `0`, so every invoice charged to an account read back
 * as nobody owing anything, and a partly-paid sale recorded only the cash that came
 * in — leaving the day's takings short by whatever went on account.
 *
 * The rule is the counter's: the lines add up to the total, one per tender actually
 * used. An unpaid balance is a tender the shop handed over instead of money, so it
 * gets its own `debt` line like any other.
 */
import type { Customer, PaymentMethod } from '../types';

const money = (n: number): number => Math.round(Math.max(0, n) * 100) / 100;

/**
 * How much of the invoice goes on a customer's account — and the counter's rule
 * that nothing goes on account unless an account holds it. A credit sale with
 * nobody attached used to write the invoice and silently skip the ledger entry,
 * so the shop was owed money no document recorded. Refuse before anything is
 * written, exactly as the desktop till does.
 */
export const creditAmountOf = (
  method: PaymentMethod,
  total: number,
  amountPaid: number,
  customer: Customer | null | undefined
): number => {
  const owed = method === 'debt' ? total : Math.max(0, total - (amountPaid || total));
  if (owed > 0 && !customer) {
    throw new Error('A customer profile is required to put an order on Credit Tab / Debt.');
  }
  return owed;
};

/** A tender line of nothing is noise the drawer would have to reconcile. */
const tender = (method: PaymentMethod, amount: number) => ({ method, amount: money(amount) });

export const salePayments = (
  method: PaymentMethod,
  total: number,
  debtAmount: number
): { method: PaymentMethod; amount: number }[] => {
  const gross = money(total);
  const owed = Math.min(gross, money(debtAmount));

  if (gross <= 0) return [tender(method, 0)];

  // Nothing on account: one tender line for the whole invoice, so an edit that
  // rescales the payments later cannot invent a balance nobody agreed to.
  if (owed <= 0) return [tender(method, gross)];

  // The account carried part or all of it, and what did not go on account is exactly
  // what changed hands — taken from the total rather than from the amount the cashier
  // typed, so the lines always add up to the invoice and the drawer can close.
  const collected = money(gross - owed);

  return [
    ...(method !== 'debt' && collected > 0 ? [tender(method, collected)] : []),
    tender('debt', owed),
  ];
};
