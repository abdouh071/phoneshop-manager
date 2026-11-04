/**
 * How deep a discount is, and who has to answer for it.
 *
 * The till used to compare a typed number to 1 000 DA and call that the whole rule,
 * which meant a 20% off a phone was free while 1 001 DA off a cable was not — and a
 * percentage discount, which the wholesale price applies on its own, was never
 * measured at all. These cases hold the rule the phone already runs: the share of
 * the basket is the thing an admin is being asked to sign for, whatever the cashier
 * typed into the field.
 */
import { describe, it, expect } from 'vitest';
import {
  DISCOUNT_APPROVAL_PERCENT,
  discountAmountOf,
  discountPercentOf,
  discountsGivenOf,
  lineDiscountOf,
  requiresDiscountApproval,
  requiresLineDiscountApproval,
  unitPriceAfterDiscount,
} from './discountPolicy';

describe('discountAmountOf', () => {
  it('turns a flat number into the dinars it is', () => {
    expect(discountAmountOf(1000, { mode: 'flat', value: 300 })).toBe(300);
  });

  it('rounds a percentage to the dinar the till will record', () => {
    expect(discountAmountOf(999, { mode: 'percent', value: 15 })).toBe(150);
  });

  it('never takes more than the basket itself', () => {
    expect(discountAmountOf(400, { mode: 'flat', value: 900 })).toBe(400);
  });

  it('gives nothing for a basket it cannot measure', () => {
    expect(discountAmountOf(0, { mode: 'flat', value: 200 })).toBe(0);
    expect(discountAmountOf(1000, { mode: 'flat', value: -50 })).toBe(0);
    expect(discountAmountOf(1000, { mode: 'percent', value: NaN })).toBe(0);
  });
});

describe('discountPercentOf', () => {
  it('reads a flat amount as the share it really is', () => {
    expect(discountPercentOf(1000, { mode: 'flat', value: 300 })).toBe(30);
  });

  it('takes a typed percentage at face value instead of its rounded dinars', () => {
    // 15% of 999 is 149.85, which records as 150 — deriving the share back from the
    // amount would make the cashier ask for an approval they never granted.
    expect(discountPercentOf(999, { mode: 'percent', value: 15 })).toBe(15);
  });
});

describe('requiresDiscountApproval', () => {
  it('stops a cashier above the threshold and lets the admin through it', () => {
    const deep = { mode: 'flat', value: 151 } as const;
    expect(requiresDiscountApproval('sales_agent', 1000, deep)).toBe(true);
    expect(requiresDiscountApproval('repair_agent', 1000, deep)).toBe(true);
    expect(requiresDiscountApproval('admin', 1000, deep)).toBe(false);
    expect(requiresDiscountApproval(undefined, 1000, deep)).toBe(true);
  });

  it('draws the line above 15%, not at it', () => {
    expect(requiresDiscountApproval('sales_agent', 1000, { mode: 'flat', value: DISCOUNT_APPROVAL_PERCENT * 10 })).toBe(false);
    expect(
      requiresDiscountApproval('sales_agent', 1000, { mode: 'flat', value: DISCOUNT_APPROVAL_PERCENT * 10 + 1 })
    ).toBe(true);
  });

  it('measures a percentage discount, which the old 1 000 DA rule never looked at', () => {
    // 40% of a basket of 4 000 DA is 1 600 DA of giveaway and nobody stopped it.
    expect(requiresDiscountApproval('sales_agent', 4000, { mode: 'percent', value: 40 })).toBe(true);
  });

  it('asks for no approval when nothing is being given away', () => {
    expect(requiresDiscountApproval('sales_agent', 1000, { mode: 'flat', value: 0 })).toBe(false);
  });
});

describe('lineDiscountOf', () => {
  it('measures one line against what it was listed at', () => {
    const line = lineDiscountOf(1000, 800, 2);
    expect(line.granted).toBe(400);
    expect(line.percent).toBe(20);
  });

  it('does not call a raised price a discount', () => {
    expect(lineDiscountOf(1000, 1100, 1)).toEqual({ granted: 0, percent: 0 });
  });

  it('has nothing to measure on a line with no units', () => {
    expect(lineDiscountOf(1000, 500, 0)).toEqual({ granted: 0, percent: 0 });
  });

  it('has nothing to measure against a line that was stored without a price', () => {
    expect(lineDiscountOf(0, 0, 3)).toEqual({ granted: 0, percent: 0 });
  });

  it('reports the dinars the line really carries, not the ones that were typed', () => {
    // 1 DA split over 3 units stores as 99.67 each, so the line gives 0.99 away.
    const line = lineDiscountOf(100, 99.67, 3);
    expect(line.granted).toBe(0.99);
    expect(line.percent).toBeCloseTo(0.33, 6);
  });
});

describe('unitPriceAfterDiscount', () => {
  it('spreads the dinars over the units and keeps two decimals', () => {
    expect(unitPriceAfterDiscount(1000, 100, 3)).toBe(966.67);
  });

  it('leaves a one-unit line at exactly the discounted price', () => {
    expect(unitPriceAfterDiscount(4500, 500, 1)).toBe(4000);
  });

  it('floors a discount deeper than the line at nothing, never below', () => {
    expect(unitPriceAfterDiscount(300, 900, 1)).toBe(0);
  });

  it('keeps the listed price when the field is empty or half-typed', () => {
    expect(unitPriceAfterDiscount(1200, 0, 2)).toBe(1200);
    expect(unitPriceAfterDiscount(1200, NaN, 2)).toBe(1200);
  });

  it('round-trips: the price it writes is the discount it reads back', () => {
    const unit = unitPriceAfterDiscount(1000, 100, 3);
    expect(lineDiscountOf(1000, unit, 3).granted).toBe(99.99);
  });
});

describe('requiresLineDiscountApproval', () => {
  it('stops a cashier putting 20% of one product onto a settled invoice', () => {
    expect(requiresLineDiscountApproval('sales_agent', 20)).toBe(true);
    expect(requiresLineDiscountApproval('sales_agent', 14.9)).toBe(false);
    expect(requiresLineDiscountApproval('admin', 90)).toBe(false);
  });
});

describe('discountsGivenOf', () => {
  it('counts the basket promise the till recorded in dinars', () => {
    expect(discountsGivenOf({ subtotal: 1000, discount: { type: 'flat', value: 200 } })).toBe(200);
  });

  it('reads a percentage as the dinars it came to, not the figure itself', () => {
    expect(discountsGivenOf({ subtotal: 1000, discount: { type: 'percent', value: 10 } })).toBe(100);
    // A sale written before the till stored its discount in dinars.
    expect(discountsGivenOf({ subtotal: 1000, discount: 250 })).toBe(250);
  });

  it('counts what each line was knocked down to, which the discount field never saw', () => {
    const tx = {
      subtotal: 9300,
      discount: { type: 'flat' as const, value: 300 },
      lineDiscounts: [{ granted: 100 }, { granted: 50 }],
    };
    expect(discountsGivenOf(tx)).toBe(450);
  });

  it('reports nothing on a sale that gave nothing away', () => {
    expect(discountsGivenOf({ subtotal: 500 })).toBe(0);
    expect(discountsGivenOf({ subtotal: 500, lineDiscounts: [] })).toBe(0);
  });

  it('shrugs off a line written without a number', () => {
    expect(discountsGivenOf({ subtotal: 500, lineDiscounts: [{ granted: NaN }, { granted: 50 }] })).toBe(50);
  });
});
