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
