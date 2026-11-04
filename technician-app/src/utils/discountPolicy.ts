/**
 * The discount rule, in one place.
 * ================================
 * The counter may knock any percentage off on its own; a sales or repair agent
 * needs an admin above 15%. A flat amount is the same decision seen from the other
 * side of the till — 300 DA off a 1 000 DA basket is 30% — so the screen has to
 * show the percentage it is really granting, otherwise a technician approving a
 * "small" number has no idea what they gave away.
 *
 * The amount is rounded to the dinar here and nowhere else, because the POS used
 * to round for display while `checkout` recorded the unrounded fraction: the
 * customer was shown one number, the transaction stored another, and the Z-report
 * reconciled neither.
 */
import type { User } from '../types/index.ts';

export const DISCOUNT_APPROVAL_PERCENT = 15;

export type DiscountMode = 'percent' | 'flat';

export interface DiscountInput {
  mode: DiscountMode;
  value: number;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const usable = (subtotal: number, value: number): boolean =>
  Number.isFinite(subtotal) && subtotal > 0 && Number.isFinite(value) && value > 0;

/** Dinars taken off the basket, never more than the basket itself. */
export const discountAmountOf = (subtotal: number, { mode, value }: DiscountInput): number => {
  if (!usable(subtotal, value)) return 0;
  const raw = mode === 'percent' ? (subtotal * clamp(value, 0, 100)) / 100 : value;
  return Math.min(subtotal, Math.round(raw));
};

/**
 * The share of the subtotal this discount really is. A typed percentage is taken
 * at face value — deriving it back from the rounded amount would make a clean 15%
 * read as 15.02% and demand an approval the shop did not grant.
 */
export const discountPercentOf = (subtotal: number, { mode, value }: DiscountInput): number => {
  if (mode === 'percent') return usable(subtotal, value) ? clamp(value, 0, 100) : 0;
  if (!usable(subtotal, value)) return 0;
  return (value / subtotal) * 100;
};

/** Admins are the ones who set the shop's thresholds, so they are not stopped by them. */
export const requiresDiscountApproval = (
  role: User['role'] | undefined,
  subtotal: number,
  input: DiscountInput
): boolean => {
  if (role === 'admin') return false;
  if (discountAmountOf(subtotal, input) <= 0) return false;
  return discountPercentOf(subtotal, input) > DISCOUNT_APPROVAL_PERCENT;
};

/**
 * One line of a settled invoice, seen the same way.
 * -----------------------------------------------
 * The counter's editor and this phone's sheet both let a single product be
 * discounted — the customer who comes back for a second cable is answered on the
 * invoice he already left with. The concession is written into that line's own unit
 * price rather than stored beside it, because every renderer (the till's ESC-POS
 * server, its browser receipt, the ledger, the customer statement) prices the line
 * from its unit price and the reports add those lines back up. Kept separately, the
 * printed lines would stop footing to the printed total.
 */

/** What one line gives away, and how deep that is against what it was listed at. */
export interface LineDiscount {
  granted: number;
  percent: number;
}

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * The concession a line actually carries, measured from the price the document held
 * before this edit. Raising a price is not a discount, so the share never goes
 * negative; a line with no units, or no price to measure against, has nothing.
 */
export const lineDiscountOf = (
  listUnitPrice: number,
  chargedUnitPrice: number,
  quantity: number
): LineDiscount => {
  const units = Math.trunc(Number(quantity));
  const listed = Number(listUnitPrice);
  const charged = Number(chargedUnitPrice);
  if (!Number.isFinite(units) || units <= 0) return { granted: 0, percent: 0 };
  if (!Number.isFinite(listed) || listed <= 0) return { granted: 0, percent: 0 };
  if (!Number.isFinite(charged)) return { granted: 0, percent: 0 };
  const granted = roundCents((listed - charged) * units);
  if (granted <= 0) return { granted: 0, percent: 0 };
  return { granted, percent: (granted / (listed * units)) * 100 };
};

/**
 * The unit price that takes `amount` dinars off a line of `quantity` units. The
 * discount is spread over the units because the document stores a unit price and
 * every renderer multiplies it back out — and a line cannot fall below nothing.
 */
export const unitPriceAfterDiscount = (
  listUnitPrice: number,
  amount: number,
  quantity: number
): number => {
  const listed = Number(listUnitPrice);
  if (!Number.isFinite(listed) || listed <= 0) return 0;
  const units = Math.trunc(Number(quantity));
  if (!Number.isFinite(units) || units <= 0) return roundCents(listed);
  const wanted = Number(amount);
  if (!Number.isFinite(wanted) || wanted <= 0) return roundCents(listed);
  // A discount deeper than the line is taken as the whole line, so the field never
  // shows a negative price the till would then have to explain.
  return roundCents(listed - Math.min(listed, wanted / units));
};

export const requiresLineDiscountApproval = (
  role: User['role'] | undefined,
  percent: number
): boolean => role !== 'admin' && Number.isFinite(percent) && percent > DISCOUNT_APPROVAL_PERCENT;
