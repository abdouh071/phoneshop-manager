/**
 * The discount rule, in one place — the technician phone's `discountPolicy.ts`.
 * =============================================================================
 * The counter may knock any percentage off on its own; anybody else needs an admin
 * above 15%. A flat amount is the same decision seen from the other side of the
 * till — 300 DA off a 1 000 DA basket is 30% — so a screen has to show the
 * percentage it is really granting, otherwise someone approving a "small" number
 * has no idea what they gave away.
 *
 * Both terminals had their own arithmetic before this: the phone measured the share
 * of the basket, the till compared a typed number to 1 000 DA and never looked at a
 * percentage discount at all. Two tills writing one shop's invoices cannot run two
 * rules, so the percentage is the rule here too.
 *
 * A discount on one line of a settled invoice is not a new number on the document.
 * Every renderer — the ESC-POS server, the browser receipt, the ledger, the customer
 * statement — prices that line from its own unit price, and the reports add those
 * lines back up. A discount stored beside the line would print a sum of lines that
 * does not foot to the printed total and would leave the reports charging money the
 * customer never paid, so `unitPriceAfterDiscount` writes the concession into the
 * price and the whole money path sees one truth.
 */

export const DISCOUNT_APPROVAL_PERCENT = 15;

export type DiscountMode = 'percent' | 'flat';

export interface DiscountInput {
  mode: DiscountMode;
  value: number;
}

/** An admin is the one who sets the shop's thresholds, so they are not stopped by them. */
export type DiscountRole = 'admin' | 'sales_agent' | 'repair_agent' | undefined;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const usable = (subtotal: number, value: number): boolean =>
  Number.isFinite(subtotal) && subtotal > 0 && Number.isFinite(value) && value > 0;

const roundDinar = (n: number): number => Math.round(n * 100) / 100;

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

export const requiresDiscountApproval = (
  role: DiscountRole,
  subtotal: number,
  input: DiscountInput
): boolean => {
  if (role === 'admin') return false;
  if (discountAmountOf(subtotal, input) <= 0) return false;
  return discountPercentOf(subtotal, input) > DISCOUNT_APPROVAL_PERCENT;
};

/** What one line gives away, and how deep that is against what the line was listed at. */
export interface LineDiscount {
  granted: number;
  percent: number;
}

/**
 * The concession a line actually carries, measured from the price the document held
 * before this edit. Raising a price is not a discount, so the share never goes
 * negative; a line with no units has nothing to discount.
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
  const granted = roundDinar((listed - charged) * units);
  if (granted <= 0) return { granted: 0, percent: 0 };
  return { granted, percent: (granted / (listed * units)) * 100 };
};

/**
 * The unit price that takes `amount` dinars off a line of `quantity` units. The
 * discount is spread over the units because the document stores a unit price and
 * every renderer multiplies it back out — and a line cannot go below nothing.
 */
export const unitPriceAfterDiscount = (
  listUnitPrice: number,
  amount: number,
  quantity: number
): number => {
  const listed = Number(listUnitPrice);
  if (!Number.isFinite(listed) || listed <= 0) return 0;
  const units = Math.trunc(Number(quantity));
  if (!units || units <= 0) return roundDinar(Math.max(0, listed));
  const wanted = Number(amount);
  if (!Number.isFinite(wanted) || wanted <= 0) return roundDinar(listed);
  // A discount the line cannot cover is taken as the whole line, so the field never
  // shows a negative price the till would then have to explain.
  const perUnit = Math.min(listed, wanted / units);
  return roundDinar(listed - perUnit);
};

export const requiresLineDiscountApproval = (role: DiscountRole, percent: number): boolean =>
  role !== 'admin' && Number.isFinite(percent) && percent > DISCOUNT_APPROVAL_PERCENT;
