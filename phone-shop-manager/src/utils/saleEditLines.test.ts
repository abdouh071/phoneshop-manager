/**
 * What a corrected invoice is made of.
 *
 * The shop's rule is that a correction writes a credit note, not an eraser: the units
 * that were sold stay on the document, and the units that come back join them as their
 * own negative line. These tests pin the two things that make that safe — the sold line
 * is never rewritten, and the lines add back up to exactly what the customer keeps — and
 * pin the cases that used to lose money on the way through: a whole invoice handed back,
 * an invoice corrected twice, a phone taken in trade that was never sold on the document,
 * and one SKU written on two rows sharing one control.
 */
import { describe, it, expect } from 'vitest';
import type { CartItem, PhoneModel } from '../types';
import {
  buildCorrectedLines,
  creditUnit,
  groupDocumentLines,
  lineDisplayOf,
  lineUnit,
  linesDiffer,
  netCogsOf,
  netUnitsSold,
  returnedAmount,
  returnedUnits,
  signedLineTotal,
  soldUnits,
} from './saleEditLines';

const phone = {
  id: 'sku_phone',
  name: 'Samsung A55',
  model: '128GB',
  category: 'smartphone',
  price: 20000,
  costPrice: 16000,
  stock: 4,
} as unknown as PhoneModel;

const cable = {
  id: 'sku_cable',
  name: 'Type-C cable',
  model: '1m',
  category: 'accessory',
  price: 1200,
  costPrice: 400,
  stock: 30,
} as unknown as PhoneModel;

const sold = (product: PhoneModel, quantity: number): CartItem => ({
  product,
  quantity,
  unitPrice: product.price,
  totalPrice: product.price * quantity,
});

const back = (product: PhoneModel, quantity: number, credit = product.price): CartItem => ({
  product,
  quantity,
  isReturn: true,
  unitPrice: credit,
  customReturnPrice: credit,
});

/** The document's own words for what each line is: which SKU, and which direction. */
const shapeOf = (items: CartItem[]) =>
  items.map(item => `${item.product?.id || 'none'}:${item.isReturn ? 'return' : 'sale'}:${item.quantity}`);

/** What the whole line list is worth, credit lines subtracted — what the customer pays. */
const netOf = (items: CartItem[]) => items.reduce((sum, item) => sum + signedLineTotal(item), 0);

describe('a unit that comes back', () => {
  it('stays on the invoice as its own line instead of erasing what was sold', () => {
    const document = [sold(phone, 2)];
    const lines = buildCorrectedLines(document, { sku_phone: { quantity: 1, unitPrice: 20000 } });

    expect(shapeOf(lines)).toEqual(['sku_phone:sale:2', 'sku_phone:return:1']);
    expect(soldUnits(lines)).toBe(2);
    expect(returnedUnits(lines)).toBe(1);
    // Two sold at 20 000, one handed back at 20 000: he leaves with one unit's money.
    expect(netOf(lines)).toBe(20000);
  });

  it('is priced by the corrected price the line was knocked down to', () => {
    const lines = buildCorrectedLines([sold(phone, 2)], {
      sku_phone: { quantity: 1, unitPrice: 18000 },
    });
    const credit = lines.find(item => item.isReturn);

    expect(creditUnit(credit!)).toBe(18000);
    // He paid 18 000 for the second unit, so the shop owes him 18 000 back — and the
    // invoice still asks for 18 000, not the 20 000 the shelf shows.
    expect(netOf(lines)).toBe(18000);
  });

  it('is written off the shelf rather than restocked when the counter says so', () => {
    const lines = buildCorrectedLines(
      [sold(phone, 2)],
      { sku_phone: { quantity: 1, unitPrice: 20000 } },
      { sku_phone: false }
    );

    expect(lines.find(item => item.isReturn)?.restock).toBe(false);
    // The choice alone is a change the till has to be allowed to write.
    expect(linesDiffer([sold(phone, 2)], lines)).toBe(true);
  });
});

describe('a whole invoice handed back', () => {
  it('lists every product with its credit line and never goes blank', () => {
    const document = [sold(phone, 1), sold(cable, 2)];
    const lines = buildCorrectedLines(document, {
      sku_phone: { quantity: 0, unitPrice: 20000 },
      sku_cable: { quantity: 0, unitPrice: 1200 },
    });

    expect(shapeOf(lines)).toEqual([
      'sku_phone:sale:1',
      'sku_phone:return:1',
      'sku_cable:sale:2',
      'sku_cable:return:2',
    ]);
    expect(netOf(lines)).toBe(0);
  });
});

describe('an invoice corrected twice', () => {
  it('re-derives the credit line instead of stacking a second one', () => {
    const document = [sold(phone, 2), back(phone, 1)];

    expect(shapeOf(buildCorrectedLines(document, {}))).toEqual([
      'sku_phone:sale:2',
      'sku_phone:return:1',
    ]);
    expect(shapeOf(buildCorrectedLines(document, { sku_phone: { quantity: 0, unitPrice: 20000 } }))).toEqual([
      'sku_phone:sale:2',
      'sku_phone:return:2',
    ]);
  });

  it('takes the returned unit back off the shelf when he keeps it instead', () => {
    const document = [sold(phone, 2), back(phone, 1)];
    const lines = buildCorrectedLines(document, { sku_phone: { quantity: 2, unitPrice: 20000 } });

    expect(shapeOf(lines)).toEqual(['sku_phone:sale:2']);
    expect(netOf(lines)).toBe(40000);
  });
});

describe('goods handed over in trade', () => {
  it('survive a rebuild that has no sold line to derive them from', () => {
    const document = [sold(phone, 1), back(cable, 1, 500)];
    const lines = buildCorrectedLines(document, { sku_phone: { quantity: 1, unitPrice: 20000 } });

    // The trade-in was never sold on this document, so it is not a correction of a
    // sold line — losing it would hand the customer a bill for the shop's second-hand
    // stock.
    expect(returnedUnits(lines)).toBe(1);
    expect(creditUnit(lines.find(item => item.isReturn)!)).toBe(500);
    expect(netOf(lines)).toBe(19500);
  });
});

describe('one control per SKU', () => {
  it('reads the document as what the customer keeps, not what one row says', () => {
    const views = groupDocumentLines([sold(phone, 2), back(phone, 1), sold(cable, 3)]);

    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ productId: 'sku_phone', sold: 2, returned: 1, kept: 1 });
    expect(views[1]).toMatchObject({ productId: 'sku_cable', sold: 3, returned: 0, kept: 3 });
  });

  it('quotes a concession against the price the first sold line carried', () => {
    const views = groupDocumentLines([
      { product: phone, quantity: 1, unitPrice: 20000 },
      { product: phone, quantity: 1, unitPrice: 17000 },
    ]);

    expect(views[0].listedUnit).toBe(20000);
  });
});

describe('what the counter puts on the invoice', () => {
  it('sells the units the document never carried', () => {
    const lines = buildCorrectedLines([sold(phone, 1)], { sku_phone: { quantity: 3, unitPrice: 20000 } });

    expect(shapeOf(lines)).toEqual(['sku_phone:sale:1', 'sku_phone:sale:2']);
    expect(netOf(lines)).toBe(60000);
  });

  it('prints added and removed lines together, each with its own sign', () => {
    const lines = buildCorrectedLines(
      [sold(phone, 2)],
      { sku_phone: { quantity: 1, unitPrice: 20000 } },
      {},
      [sold(cable, 1)]
    );

    expect(shapeOf(lines)).toEqual([
      'sku_phone:sale:2',
      'sku_phone:return:1',
      'sku_cable:sale:1',
    ]);
    expect(netOf(lines)).toBe(21200);
  });
});

describe('a credit the document already priced', () => {
  it('keeps its own buy-back number through a correction that changed nothing', () => {
    const document = [sold(cable, 2), back(cable, 1, 500)];
    const lines = buildCorrectedLines(document, {});

    // Re-quoting the trade-in at the shelf price would take 700 DA off the customer for
    // a save that moved no goods and changed no price.
    expect(returnedAmount(lines)).toBe(500);
    expect(netOf(lines)).toBe(netOf(document));
  });

  it('stays written off the shelf when the counter never touched the checkbox', () => {
    const document = [sold(cable, 2), { ...back(cable, 1, 500), restock: false }];
    const lines = buildCorrectedLines(document, {});

    expect(lines.find(item => item.isReturn)?.restock).toBe(false);
    expect(linesDiffer(document, lines)).toBe(false);
  });

  it('credits a second unit taken back at the line price, not at the trade-in price', () => {
    const lines = buildCorrectedLines([sold(cable, 2), back(cable, 1, 500)], {
      sku_cable: { quantity: 0, unitPrice: 1200 },
    });

    expect(returnedUnits(lines)).toBe(2);
    expect(returnedAmount(lines)).toBe(1700);
  });

  it('is repriced with the line when the counter corrects the price', () => {
    const lines = buildCorrectedLines([sold(cable, 2), back(cable, 1, 500)], {
      sku_cable: { quantity: 1, unitPrice: 1000 },
    });

    // He paid 1 000 for what he keeps and the shop owes him 1 000 for what came back —
    // the till's own rule that a corrected price moves the credit with it.
    expect(returnedAmount(lines)).toBe(1000);
    expect(netOf(lines)).toBe(1000);
  });

  it('stays two lines when the shop pays two different prices for them', () => {
    const lines = buildCorrectedLines([sold(cable, 3), back(cable, 1, 500)], {
      sku_cable: { quantity: 1, unitPrice: 1200 },
    });
    const credits = lines.filter(item => item.isReturn);

    // One unit bought back at 500 and one at the line's own 1 200 are two facts, and
    // folding them into one average would invent a price nobody agreed to.
    expect(credits.map(item => creditUnit(item))).toEqual([500, 1200]);
    expect(returnedAmount(lines)).toBe(1700);
  });
});

describe('what counts as a change', () => {
  it('is nothing at all when the counter touches none of it', () => {
    const document = [sold(phone, 2)];
    expect(linesDiffer(document, buildCorrectedLines(document, {}))).toBe(false);
  });

  it('is a change even when the money lands back where it started', () => {
    // A unit taken back and a price pushed up by a unit's worth read as the same total
    // and are two different documents — the shelf moved, and what was sold moved.
    const document = [sold(phone, 2)];
    const corrected = buildCorrectedLines(document, { sku_phone: { quantity: 1, unitPrice: 40000 } });

    expect(netOf(corrected)).toBe(netOf(document));
    expect(linesDiffer(document, corrected)).toBe(true);
  });
});

describe('a line no control can reach', () => {
  it('keeps its goods and its money through the rebuild', () => {
    const orphan: CartItem = { product: {} as PhoneModel, quantity: 1, unitPrice: 9000 };
    const lines = buildCorrectedLines([sold(phone, 1), orphan], { sku_phone: { quantity: 0, unitPrice: 20000 } });

    expect(lines[lines.length - 1]).toBe(orphan);
    expect(lineUnit(orphan)).toBe(9000);
    expect(returnedAmount(lines)).toBe(20000);
  });
});

describe('the numbers a surface reads off a line', () => {
  it('counts a handed-back unit against what the shop let go', () => {
    const lines = [sold(phone, 3), back(phone, 1)];

    expect(soldUnits(lines)).toBe(3);
    expect(netUnitsSold(lines)).toBe(2);
  });

  it('draws a credit line as a positive magnitude carrying its own sign', () => {
    expect(lineDisplayOf(sold(phone, 2))).toEqual({
      returned: false,
      units: 2,
      unit: 20000,
      money: 40000,
    });
    expect(lineDisplayOf(back(phone, 1, 18000))).toEqual({
      returned: true,
      units: 1,
      unit: 18000,
      money: 18000,
    });
  });

  it('takes the cost back with a restocked unit and holds it on a written-off one', () => {
    // The refund of a restocked unit costs the shop nothing: the goods are back on the
    // shelf. A unit written off is gone and the refund is pure loss, so its cost stays.
    expect(netCogsOf([sold(phone, 2), back(phone, 1)])).toBe(16000);
    expect(netCogsOf([sold(phone, 2), { ...back(phone, 1), restock: false }])).toBe(32000);
  });

  it('reads a trade-in credit the way the product breakdown already does', () => {
    const lines = [sold(phone, 1), back(cable, 2, 500)];

    expect(netUnitsSold(lines)).toBe(-1);
    expect(netCogsOf(lines)).toBe(16000 - 2 * 400);
  });
});
