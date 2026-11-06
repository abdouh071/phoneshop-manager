import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, PhoneModel } from '../types/index.ts';
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
} from './saleEditLines.ts';

const phone: PhoneModel = {
  id: 'sku_phone',
  name: 'Samsung A55',
  model: '128GB',
  price: 20000,
  costPrice: 16000,
  stock: 4,
  stockStatus: 'in_stock',
  sku: 'a55-128',
  category: 'smartphone',
  lowStockThreshold: 1,
};

const cable: PhoneModel = { ...phone, id: 'sku_cable', name: 'Type-C cable', model: '1m', price: 1200, costPrice: 400, stock: 30, sku: 'cable-1m', category: 'accessory', lowStockThreshold: 5 };

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

/** The document's own words for each line: which SKU, and which direction. */
const shapeOf = (items: CartItem[]) =>
  items.map(item => `${item.product?.id || 'none'}:${item.isReturn ? 'return' : 'sale'}:${item.quantity}`);

/** What the line list is worth, credit lines subtracted — what the customer pays. */
const netOf = (items: CartItem[]) => items.reduce((sum, item) => sum + signedLineTotal(item), 0);

test('a unit that comes back stays on the invoice as its own line', () => {
  const lines = buildCorrectedLines([sold(phone, 2)], { sku_phone: { quantity: 1, unitPrice: 20000 } });

  assert.deepEqual(shapeOf(lines), ['sku_phone:sale:2', 'sku_phone:return:1']);
  assert.equal(soldUnits(lines), 2);
  assert.equal(returnedUnits(lines), 1);
  assert.equal(netOf(lines), 20000);
});

test('the credit is priced at the corrected price, not the shelf price', () => {
  const lines = buildCorrectedLines([sold(phone, 2)], { sku_phone: { quantity: 1, unitPrice: 18000 } });

  assert.equal(creditUnit(lines.find(item => item.isReturn)!), 18000);
  assert.equal(netOf(lines), 18000);
});

test('a unit the shelf does not take is written off, not restocked', () => {
  const document = [sold(phone, 2)];
  const lines = buildCorrectedLines(document, { sku_phone: { quantity: 1, unitPrice: 20000 } }, { sku_phone: false });

  assert.equal(lines.find(item => item.isReturn)?.restock, false);
  assert.equal(linesDiffer(document, lines), true);
});

test('a whole invoice handed back lists every product and never goes blank', () => {
  const lines = buildCorrectedLines(
    [sold(phone, 1), sold(cable, 2)],
    { sku_phone: { quantity: 0, unitPrice: 20000 }, sku_cable: { quantity: 0, unitPrice: 1200 } }
  );

  assert.deepEqual(shapeOf(lines), [
    'sku_phone:sale:1',
    'sku_phone:return:1',
    'sku_cable:sale:2',
    'sku_cable:return:2',
  ]);
  assert.equal(netOf(lines), 0);
});

test('correcting an invoice twice re-derives the credit instead of stacking one', () => {
  const document = [sold(phone, 2), back(phone, 1)];

  assert.deepEqual(shapeOf(buildCorrectedLines(document, {})), ['sku_phone:sale:2', 'sku_phone:return:1']);
  assert.deepEqual(
    shapeOf(buildCorrectedLines(document, { sku_phone: { quantity: 0, unitPrice: 20000 } })),
    ['sku_phone:sale:2', 'sku_phone:return:2']
  );
});

test('he can take a returned unit back off the shelf instead of keeping it', () => {
  const lines = buildCorrectedLines([sold(phone, 2), back(phone, 1)], { sku_phone: { quantity: 2, unitPrice: 20000 } });

  assert.deepEqual(shapeOf(lines), ['sku_phone:sale:2']);
  assert.equal(netOf(lines), 40000);
});

test('goods handed over in trade survive a rebuild with no sold line to derive them from', () => {
  const lines = buildCorrectedLines([sold(phone, 1), back(cable, 1, 500)], {
    sku_phone: { quantity: 1, unitPrice: 20000 },
  });

  assert.equal(returnedUnits(lines), 1);
  assert.equal(creditUnit(lines.find(item => item.isReturn)!), 500);
  assert.equal(netOf(lines), 19500);
});

test('one SKU is one control, whatever number of rows carry it', () => {
  const views = groupDocumentLines([sold(phone, 2), back(phone, 1), sold(cable, 3)]);

  assert.equal(views.length, 2);
  assert.deepEqual(
    views.map(view => [view.productId, view.sold, view.returned, view.kept]),
    [['sku_phone', 2, 1, 1], ['sku_cable', 3, 0, 3]]
  );
});

test('a concession is quoted against the price the first sold line carried', () => {
  const views = groupDocumentLines([
    { product: phone, quantity: 1, unitPrice: 20000 },
    { product: phone, quantity: 1, unitPrice: 17000 },
  ]);

  assert.equal(views[0].listedUnit, 20000);
});

test('the counter can sell a unit the invoice never carried', () => {
  const lines = buildCorrectedLines([sold(phone, 1)], { sku_phone: { quantity: 3, unitPrice: 20000 } });

  assert.deepEqual(shapeOf(lines), ['sku_phone:sale:1', 'sku_phone:sale:2']);
  assert.equal(netOf(lines), 60000);
});

test('added and removed lines print together, each with its own sign', () => {
  const lines = buildCorrectedLines(
    [sold(phone, 2)],
    { sku_phone: { quantity: 1, unitPrice: 20000 } },
    {},
    [sold(cable, 1)]
  );

  assert.deepEqual(shapeOf(lines), ['sku_phone:sale:2', 'sku_phone:return:1', 'sku_cable:sale:1']);
  assert.equal(netOf(lines), 21200);
});

test('a credit the document already priced keeps its own buy-back through a no-op save', () => {
  const document = [sold(cable, 2), back(cable, 1, 500)];
  const lines = buildCorrectedLines(document, {});

  // Re-quoting the trade-in at the shelf price would take 700 DA off the customer for a
  // save that moved no goods and changed no price.
  assert.equal(returnedAmount(lines), 500);
  assert.equal(netOf(lines), netOf(document));
});

test('a written-off credit stays written off when the checkbox was never touched', () => {
  const document = [sold(cable, 2), { ...back(cable, 1, 500), restock: false }];
  const lines = buildCorrectedLines(document, {});

  assert.equal(lines.find(item => item.isReturn)?.restock, false);
  assert.equal(linesDiffer(document, lines), false);
});

test('a second unit taken back is credited at the line price, not the trade-in price', () => {
  const lines = buildCorrectedLines([sold(cable, 2), back(cable, 1, 500)], {
    sku_cable: { quantity: 0, unitPrice: 1200 },
  });

  assert.equal(returnedUnits(lines), 2);
  assert.equal(returnedAmount(lines), 1700);
});

test('a corrected price reprices the credit with the line', () => {
  const lines = buildCorrectedLines([sold(cable, 2), back(cable, 1, 500)], {
    sku_cable: { quantity: 1, unitPrice: 1000 },
  });

  assert.equal(returnedAmount(lines), 1000);
  assert.equal(netOf(lines), 1000);
});

test('two prices the shop pays for the same SKU stay two lines', () => {
  const lines = buildCorrectedLines([sold(cable, 3), back(cable, 1, 500)], {
    sku_cable: { quantity: 1, unitPrice: 1200 },
  });
  const credits = lines.filter(item => item.isReturn);

  // Folding a 500 buy-back and a 1 200 line into one average would invent a price
  // nobody agreed to.
  assert.deepEqual(credits.map(item => creditUnit(item)), [500, 1200]);
  assert.equal(returnedAmount(lines), 1700);
});

test('touching nothing is not a change, and a wash still is', () => {
  const document = [sold(phone, 2)];
  assert.equal(linesDiffer(document, buildCorrectedLines(document, {})), false);

  // A unit back and a price pushed up by a unit's worth read as the same total on two
  // different documents: the shelf moved, and what was sold moved.
  const corrected = buildCorrectedLines(document, { sku_phone: { quantity: 1, unitPrice: 40000 } });
  assert.equal(netOf(corrected), netOf(document));
  assert.equal(linesDiffer(document, corrected), true);
});

test('a line no control can reach keeps its goods and its money', () => {
  const orphan: CartItem = { product: {} as PhoneModel, quantity: 1, unitPrice: 9000 };
  const lines = buildCorrectedLines([sold(phone, 1), orphan], { sku_phone: { quantity: 0, unitPrice: 20000 } });

  assert.equal(lines[lines.length - 1], orphan);
  assert.equal(lineUnit(orphan), 9000);
  assert.equal(returnedAmount(lines), 20000);
});

test('the numbers a surface reads off a line', () => {
  const lines = [sold(phone, 3), back(phone, 1)];

  // What the shop let go is what is left after the unit comes back, and every money
  // figure beside it already nets that unit out — a count that ignored the credit line
  // would disagree with the day it prints next to.
  assert.equal(soldUnits(lines), 3);
  assert.equal(netUnitsSold(lines), 2);

  // A credit line draws as a positive magnitude carrying its own minus: the typographic
  // sign belongs to the surface, not to the number the shop adds up.
  assert.deepEqual(lineDisplayOf(sold(phone, 2)), { returned: false, units: 2, unit: 20000, money: 40000 });
  assert.deepEqual(lineDisplayOf(back(phone, 1, 18000)), { returned: true, units: 1, unit: 18000, money: 18000 });

  // A unit that came back restocked takes its cost back with it; a unit written off is
  // gone and the refund is pure loss, so its cost stays on the day.
  assert.equal(netCogsOf([sold(phone, 2), back(phone, 1)]), 16000);
  assert.equal(netCogsOf([sold(phone, 2), { ...back(phone, 1), restock: false }]), 32000);

  // Goods handed over in trade were never sold on this document, and the product
  // breakdown already reads them as cost coming back.
  const traded = [sold(phone, 1), back(cable, 2, 500)];
  assert.equal(netUnitsSold(traded), -1);
  assert.equal(netCogsOf(traded), 16000 - 2 * 400);
});
