import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, PhoneModel, SaleTransaction } from '../types/index.ts';
import { diffSaleEdit, planSaleEdit, rescalePayments, surplusShiftOf } from './saleEdit.ts';

const makeProduct = (over: Partial<PhoneModel> = {}): PhoneModel => ({
  id: over.id ?? 'p1',
  name: over.name ?? 'Hoco EQ2',
  model: over.model ?? 'BT-EQ2',
  price: over.price ?? 4500,
  costPrice: over.costPrice ?? 3000,
  stock: over.stock ?? 7,
  stockStatus: over.stockStatus ?? 'in_stock',
  sku: over.sku ?? 'kit-bt-hoco-eq2',
  category: over.category ?? 'accessory',
  lowStockThreshold: over.lowStockThreshold ?? 2,
});

const line = (product: PhoneModel, quantity: number) => ({
  product,
  quantity,
  unitPrice: product.price,
});

const returnLine = (product: PhoneModel, quantity: number, restock = true) => ({
  product,
  quantity,
  unitPrice: product.price,
  isReturn: true,
  restock,
});

/** The document's own words for each line: which SKU, and which direction. */
const shapeOf = (items: SaleTransaction['items']) =>
  items.map(i => `${i.product?.id || 'none'}:${i.isReturn ? 'return' : 'sale'}:${i.quantity}`);

const makeTx = (over: Partial<SaleTransaction> = {}): SaleTransaction => {
  const items: CartItem[] = over.items ?? [line(makeProduct(), 2)];
  // A document that carries a credit line is worth its lines netted, the way the counter
  // stored it — adding the handed-back units as purchases would give the fixture an
  // invoice that never footed to its own lines.
  const subtotal =
    over.subtotal ??
    items.reduce((s, i) => s + (i.isReturn ? -1 : 1) * i.product.price * i.quantity, 0);
  return {
    id: 'tx1',
    date: '2026-11-02T10:00:00.000Z',
    items,
    subtotal,
    total: over.total ?? subtotal,
    payments: over.payments ?? [{ method: 'cash', amount: subtotal }],
    status: 'completed',
    ...over,
  };
};

test('a price correction moves the money and touches no shelf', () => {
  const tx = makeTx({ items: [line(makeProduct(), 2)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4000 } });

  assert.equal(plan.subtotal, 8000);
  assert.equal(plan.total, 8000);
  assert.equal(plan.refundDue, 1000);
  assert.equal(plan.additionalDue, 0);
  assert.equal(plan.status, 'completed');
  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, []);
  assert.equal(plan.hasChanges, true);
});

test('the stored price and the line price move together, or the receipt shows two numbers', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 3900 } });

  assert.equal(plan.items[0].unitPrice, 3900);
  assert.equal(plan.items[0].product.price, 3900);
});

test('returning a unit puts it back on the shelf and marks the sale partially refunded', () => {
  const tx = makeTx({ items: [line(makeProduct(), 3)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 2 }]);
  assert.deepEqual(plan.deduct, []);
  assert.equal(plan.total, 4500);
  assert.equal(plan.refundDue, 9000);
  assert.equal(plan.status, 'partially_refunded');
});

test('a refund the shop keeps out of stock — goods went home broken — still corrects the money', () => {
  const tx = makeTx({ items: [line(makeProduct(), 2)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } }, { p1: false });

  assert.deepEqual(plan.restock, []);
  assert.equal(plan.total, 4500);
  assert.equal(plan.status, 'partially_refunded');
});

test('adding a unit to a settled invoice takes it off the shelf and asks for the difference', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  assert.deepEqual(plan.deduct, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(plan.restock, []);
  assert.equal(plan.additionalDue, 4500);
  assert.equal(plan.status, 'completed');
});

test('every line gone lists what was sold, hands it back with its own minus and refunds in full', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1), line(makeProduct({ id: 'p2', name: 'Case' }), 2)] });
  const plan = planSaleEdit(tx, {
    p1: { quantity: 0, unitPrice: 4500 },
    p2: { quantity: 0, unitPrice: 4500 },
  });

  // A customer handed a blank sheet cannot be told the sale never happened. What was
  // sold stays on the document, and each unit that comes back joins it as its own line
  // — the money nets to nothing and the invoice still states what left the shop.
  assert.deepEqual(shapeOf(plan.items), ['p1:sale:1', 'p1:return:1', 'p2:sale:2', 'p2:return:2']);
  assert.equal(plan.purchases, 13500);
  assert.equal(plan.returns, 13500);
  assert.equal(plan.total, 0);
  assert.equal(plan.status, 'refunded');
  assert.deepEqual(plan.payments, [{ method: 'cash', amount: 0 }]);
  assert.deepEqual(plan.restock, [
    { productId: 'p1', name: 'Hoco EQ2', quantity: 1 },
    { productId: 'p2', name: 'Case', quantity: 2 },
  ]);
});

test('a percentage discount follows the units bought, not the units left after a return', () => {
  const percentTx = makeTx({
    items: [line(makeProduct(), 2)],
    discount: { type: 'percent', value: 10 },
    total: 8100,
  });
  const percentPlan = planSaleEdit(percentTx, { p1: { quantity: 1, unitPrice: 4500 } });

  // The promise was made on the 9 000 DA he took, and one unit of it came back at its
  // own line price. Shrinking the promise because the shelf took a phone back would
  // charge him for returning something.
  assert.deepEqual(shapeOf(percentPlan.items), ['p1:sale:2', 'p1:return:1']);
  assert.equal(percentPlan.discountAmount, 900);
  assert.equal(percentPlan.total, 3600);

  const flatTx = makeTx({
    items: [line(makeProduct(), 2)],
    discount: { type: 'flat', value: 500 },
    total: 8500,
  });
  const flatPlan = planSaleEdit(flatTx, { p1: { quantity: 1, unitPrice: 4500 } });
  assert.equal(flatPlan.discountAmount, 500);
  assert.equal(flatPlan.total, 4000);
});

test('a giveaway bigger than what came back is reported, not floored to nothing', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 400 }), 2)],
    subtotal: 800,
    discount: { type: 'flat', value: 700 },
    total: 100,
  });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 400 } });

  // The cap is on the 800 DA bought, and the unit that came back is worth 400 of it:
  // the receipt would leave the shop owing 300 DA. Flooring it at zero ate that money
  // in silence — the planner now states the shortfall and `applySaleEdit` refuses to
  // write it, because only the counter decides how it leaves the till.
  assert.equal(plan.discountAmount, 700);
  assert.equal(plan.total, -300);
  assert.equal(plan.surplusOwedToCustomer, true);
});

test('a split payment keeps its shape and sums exactly to the new total', () => {
  const payments = [
    { method: 'cash' as const, amount: 333 },
    { method: 'card' as const, amount: 333 },
    { method: 'mobile' as const, amount: 334 },
  ];
  const rescaled = rescalePayments(payments, 100);
  const sum = rescaled.reduce((s, p) => s + p.amount, 0);

  assert.equal(sum, 100);
  assert.deepEqual(rescaled.map(p => p.method), ['cash', 'card', 'mobile']);
});

test('one SKU written on two rows is one control, and the rows it never touches stay standing', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 1), line(twin, 4)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  // Five units were sold on two rows and he leaves with two, so three come back — as
  // their own line. Rewriting the rows to a shared number used to move the shelf by
  // one unit and leave the receipt claiming four were ever sold.
  assert.deepEqual(shapeOf(plan.items), ['p1:sale:1', 'p1:sale:4', 'p1:return:3']);
  assert.equal(plan.purchases, 22500);
  assert.equal(plan.returns, 13500);
  assert.equal(plan.total, 9000);
  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 3 }]);
  assert.deepEqual(plan.deduct, []);
});

test('a sold line and a credit line of one model fold into one control and move the shelf once', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 3), returnLine(twin, 1)] });

  // The document already says he keeps two, so a control left on two writes nothing at
  // all: the credit line is re-derived from the same number rather than added to it.
  const left = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });
  assert.deepEqual(shapeOf(left.items), ['p1:sale:3', 'p1:return:1']);
  assert.deepEqual(left.restock, []);
  assert.deepEqual(left.deduct, []);
  assert.equal(left.hasChanges, false);

  // One unit further down and the shelf is told about the difference once, not twice —
  // two writes to one product cannot run at the same moment.
  const deeper = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });
  assert.deepEqual(shapeOf(deeper.items), ['p1:sale:3', 'p1:return:2']);
  assert.deepEqual(deeper.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(deeper.deduct, []);

  // And taking the credit away puts the unit back on the road: the line leaves the
  // invoice, and the shelf gives the unit it never got back.
  const undone = planSaleEdit(tx, { p1: { quantity: 3, unitPrice: 4500 } });
  assert.deepEqual(shapeOf(undone.items), ['p1:sale:3']);
  assert.deepEqual(undone.restock, []);
  assert.deepEqual(undone.deduct, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
});

test('a sold line and a credit line that net to nothing are a standing document, not a movement', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 2), returnLine(twin, 2)] });

  // Two sold and two handed back: the customer left with nothing and the shelf already
  // absorbed both units. Touching no control moves no shelf.
  const left = planSaleEdit(tx, {});
  assert.deepEqual(shapeOf(left.items), ['p1:sale:2', 'p1:return:2']);
  assert.equal(left.total, 0);
  assert.equal(left.status, 'refunded');
  assert.deepEqual(left.restock, []);
  assert.deepEqual(left.deduct, []);
  assert.equal(left.hasChanges, false);

  // Selling one of them back to him is a unit going out, not a cancellation.
  const oneBack = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });
  assert.deepEqual(shapeOf(oneBack.items), ['p1:sale:2', 'p1:return:1']);
  assert.deepEqual(oneBack.restock, []);
  assert.deepEqual(oneBack.deduct, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
});

test('a line stored without a product id survives the rewrite with its money intact', () => {
  const broken = { product: {} as PhoneModel, quantity: 1, unitPrice: 100 };
  const tx = makeTx({ items: [broken, line(makeProduct(), 1)], subtotal: 4600, total: 4600 });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  // No id means no shelf to move and nothing to edit. The row is carried through — last,
  // because every line a control could reach is rebuilt first — so the invoice still
  // accounts for the 100 DA the customer paid for it.
  assert.deepEqual(shapeOf(plan.items), ['p1:sale:1', 'none:sale:1']);
  assert.equal(plan.items[1].unitPrice, 100);
  assert.equal(plan.subtotal, 4600);
  assert.deepEqual(plan.restock, []);
  assert.equal(plan.hasChanges, false);
});

test('an untouched invoice reports no changes so nothing is written', () => {
  const tx = makeTx({ items: [line(makeProduct(), 2), line(makeProduct({ id: 'p2', price: 900 }), 1)] });
  const plan = planSaleEdit(tx, {
    p1: { quantity: 2, unitPrice: 4500 },
    p2: { quantity: 1, unitPrice: 900 },
  });

  assert.equal(plan.hasChanges, false);
  assert.equal(plan.total, tx.total);
  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, []);
});

test('the diff names the lines an admin is being asked to allow', () => {
  const tx = makeTx({ items: [line(makeProduct({ name: 'Hoco EQ2' }), 2), line(makeProduct({ id: 'p2', name: 'Case' }), 1)] });
  const changes = diffSaleEdit(tx, {
    p1: { quantity: 1, unitPrice: 4500 },
    p2: { quantity: 1, unitPrice: 700 },
  });

  assert.deepEqual(changes, [
    { kind: 'quantity', name: 'Hoco EQ2', from: 2, to: 1 },
    { kind: 'price', name: 'Case', from: 4500, to: 700 },
  ]);
});

test('a SKU on two rows is reported to the approving admin once, at the units he kept', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 3), line(twin, 1)] });
  const changes = diffSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  // Four units were sold on two rows; quoting one of them would have the admin read a
  // change from three to two on an invoice that held four.
  assert.deepEqual(changes, [{ kind: 'quantity', name: 'Hoco EQ2', from: 4, to: 2 }]);
});

const cable = (over: Partial<PhoneModel> = {}) =>
  makeProduct({ id: 'p9', name: 'Cable', model: 'USB-C', price: 100, ...over });

test('a product the invoice never carried is added and the whole quantity leaves the shelf', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } }, {}, [line(cable(), 2)]);

  assert.equal(plan.subtotal, 4700);
  assert.equal(plan.additionalDue, 200);
  assert.equal(plan.refundDue, 0);
  assert.deepEqual(plan.deduct, [{ productId: 'p9', name: 'Cable', quantity: 2 }]);
  assert.deepEqual(plan.restock, []);
  assert.equal(plan.status, 'completed');
  // Nothing on the document moved, yet there is a sale to write.
  assert.equal(plan.hasChanges, true);
});

test('a new line carries both prices, or the till and the receipt tell two stories', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, {}, {}, [{ product: cable(), quantity: 1, unitPrice: 80 }]);

  assert.equal(plan.items[1].unitPrice, 80);
  assert.equal(plan.items[1].product.price, 80);
  assert.equal(plan.subtotal, 4580);
});

test('a new line named at zero units is not on the invoice and does not unlock the save', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, {}, {}, [{ product: cable(), quantity: 0 }]);

  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.deduct, []);
  assert.equal(plan.hasChanges, false);
});

test('a product already on the invoice is edited on its own row, not stacked as a second one', () => {
  const tx = makeTx({ items: [line(makeProduct(), 2)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } }, {}, [line(makeProduct(), 3)]);

  assert.equal(plan.items.length, 1);
  assert.equal(plan.subtotal, 9000);
  assert.deepEqual(plan.deduct, []);
  assert.equal(plan.hasChanges, false);
});

test('a row that gives units back and a new row that takes them both reach the shelf', () => {
  const tx = makeTx({ items: [line(makeProduct(), 3)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } }, {}, [line(cable(), 2)]);

  assert.deepEqual(shapeOf(plan.items), ['p1:sale:3', 'p1:return:1', 'p9:sale:2']);
  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(plan.deduct, [{ productId: 'p9', name: 'Cable', quantity: 2 }]);
  assert.equal(plan.total, 9200);
  assert.equal(plan.refundDue, 4300);
  // The status records whether the sale shrank. He came back three units shorter on the
  // headset and left two units longer on the cables: what he walks out with grew, so the
  // invoice is a corrected sale, not a partial refund.
  assert.equal(plan.status, 'completed');
});

test('a credit sale that grows by a new line puts its share on the account', () => {
  const tx = makeTx({
    items: [line(makeProduct(), 2)],
    total: 9000,
    payments: [
      { method: 'cash', amount: 4500 },
      { method: 'debt', amount: 4500 },
    ],
  });
  const plan = planSaleEdit(tx, {}, {}, [line(cable(), 3)]);

  const debtLine = plan.payments.find(p => p.method === 'debt');
  assert.equal(debtLine?.amount, 4650);
  assert.equal(plan.payments.reduce((sum, p) => sum + p.amount, 0), 9300);
  assert.equal(plan.additionalDue, 300);
});

test('the discount granted on the sale follows the basket into the new line', () => {
  const tx = makeTx({
    items: [line(makeProduct(), 2)],
    discount: { type: 'percent', value: 10 },
    total: 8100,
  });
  const plan = planSaleEdit(tx, {}, {}, [line(cable(), 5)]);

  assert.equal(plan.subtotal, 9500);
  assert.equal(plan.discountAmount, 950);
  assert.equal(plan.total, 8550);
  assert.equal(plan.additionalDue, 450);
});

test('the approving admin is told which product was put on the invoice', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const changes = diffSaleEdit(tx, {}, [line(cable(), 2)]);

  assert.deepEqual(changes, [{ kind: 'add', name: 'Cable', quantity: 2, unitPrice: 100 }]);
});

test('a SKU that was only ever handed over is a trade-in, and its control sells rather than shrinks the credit', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 20000 }), 1), returnLine(tradeIn(5000), 2)],
    subtotal: 10000,
    total: 10000,
  });

  // Nothing was sold of it, so there is no sold line for a correction to take back:
  // left at zero the credit rides through on its own terms and the shelf hears nothing.
  const left = planSaleEdit(tx, {});
  assert.deepEqual(shapeOf(left.items), ['p1:sale:1', 'p9:return:2']);
  assert.deepEqual(left.restock, []);
  assert.deepEqual(left.deduct, []);
  assert.equal(left.hasChanges, false);

  // Raising that control is the counter selling one of the units back — a new sold line
  // and a unit off the shelf — while the 5 000 DA buy-back the document stated stands.
  const sold = planSaleEdit(tx, { p9: { quantity: 1, unitPrice: 5000 } });
  assert.deepEqual(shapeOf(sold.items), ['p1:sale:1', 'p9:sale:1', 'p9:return:2']);
  assert.deepEqual(sold.restock, []);
  assert.deepEqual(sold.deduct, [{ productId: 'p9', name: 'Old phone in trade', quantity: 1 }]);
});

test('the restock flag moves the shelf by the units it changes, in either direction', () => {
  const writtenOff = makeTx({ items: [line(makeProduct(), 2), returnLine(makeProduct(), 2, false)] });

  // Both units came back and neither went on the shelf. Putting them there is two units
  // the till has to hear about, although the invoice's money does not move by one.
  const ontoShelf = planSaleEdit(writtenOff, { p1: { quantity: 0, unitPrice: 4500 } }, { p1: true });
  assert.deepEqual(ontoShelf.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 2 }]);
  assert.deepEqual(ontoShelf.deduct, []);

  // The same flip the other way — the goods are faulty after all — takes those two units
  // back off the shelf.
  const restocked = makeTx({ items: [line(makeProduct(), 2), returnLine(makeProduct(), 2)] });
  const offShelf = planSaleEdit(restocked, { p1: { quantity: 0, unitPrice: 4500 } }, { p1: false });
  assert.deepEqual(offShelf.deduct, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 2 }]);
  assert.deepEqual(offShelf.restock, []);

  // Leaving the checkbox alone on a document that already wrote its units off is nothing.
  const untouched = planSaleEdit(writtenOff, {});
  assert.deepEqual(untouched.restock, []);
  assert.deepEqual(untouched.deduct, []);
  assert.equal(untouched.hasChanges, false);
});

test('writing off a unit the document had restocked takes it back off the shelf', () => {
  const tx = makeTx({ items: [line(makeProduct(), 2), returnLine(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } }, { p1: false });

  // The control did not move — he still leaves with one — but the goods went home faulty,
  // so the unit the shelf is holding has to be given back by this correction.
  assert.deepEqual(shapeOf(plan.items), ['p1:sale:2', 'p1:return:1']);
  assert.equal(plan.items[1].restock, false);
  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
});

test('one edit moves a sale line and a new line in the directions the counter expects', () => {
  const tx = makeTx({ items: [line(makeProduct(), 3)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } }, {}, [line(cable(), 2)]);

  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(plan.deduct, [{ productId: 'p9', name: 'Cable', quantity: 2 }]);
});

test('a line knocked down on the invoice is written down where the shop can total it', () => {
  const tx = makeTx({ items: [line(makeProduct(), 2)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4050 } });

  // 900 DA off two units listed at 4 500. The concession lives inside the line's own
  // price — that is what makes the printed receipt foot — so nothing that adds up the
  // document's discount field ever saw it, and the giveaway has to be written beside it.
  assert.deepEqual(plan.lineDiscounts, [
    { productId: 'p1', name: 'Hoco EQ2 BT-EQ2', granted: 900, percent: 10 },
  ]);
  assert.equal(plan.subtotal, 8100);
  assert.equal(plan.total, 8100);
});

test('a row that only just joined the invoice gave nothing away', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, {}, {}, [line(cable(), 2)]);

  // A new row is priced at what it was sold for, so there is no earlier price to
  // measure a concession against — and inventing one would double-count the shelf.
  assert.deepEqual(plan.lineDiscounts, []);
});

test('a price handed back on a correction is not recorded as money given away', () => {
  const tx = makeTx({ items: [line(makeProduct({ price: 4000 }), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  assert.deepEqual(plan.lineDiscounts, []);
});

test('a line discounted on an invoice that also carries a basket promise keeps both', () => {
  const tx = makeTx({
    items: [line(makeProduct(), 2), line(cable(), 2)],
    discount: { type: 'flat', value: 200 },
    total: 9000,
  });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4300 } });

  // The basket promise stays the basket promise; the 400 DA taken off the headset is
  // the part the discount field never held.
  assert.equal(plan.discountAmount, 200);
  assert.deepEqual(plan.lineDiscounts, [
    { productId: 'p1', name: 'Hoco EQ2 BT-EQ2', granted: 400, percent: 4.444444444444445 },
  ]);
  assert.equal(plan.subtotal, 8800);
  assert.equal(plan.total, 8600);
});

/**
 * The same two directions of money the counter sees. The phone used to add every line
 * up as a purchase, so a trade-in was billed a second time and the payment lines were
 * rescaled to the inflated figure; and it floored the total at zero, which ate an
 * exchange surplus and flipped the sale to refunded. Both terminals now run one
 * arithmetic: purchases, less what came back, less the concession measured on the
 * purchases.
 */
const tradeIn = (price: number): PhoneModel =>
  makeProduct({ id: 'p9', name: 'Old phone in trade', price });

test('a line the customer handed back comes off the invoice instead of onto it', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 20000 }), 1), returnLine(tradeIn(5000), 1)],
    subtotal: 15000,
    total: 15000,
  });
  const plan = planSaleEdit(tx, {});

  assert.equal(plan.purchases, 20000);
  assert.equal(plan.returns, 5000);
  assert.equal(plan.subtotal, 15000);
  // The sum of every line read as a purchase would have been 25 000 DA.
  assert.equal(plan.total, 15000);
  assert.equal(plan.status, 'completed');
});

test('the discount is measured on what was bought, not on the net of a return', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 20000 }), 1), returnLine(tradeIn(5000), 1)],
    discount: { type: 'percent', value: 10 },
    subtotal: 15000,
    total: 13000,
  });
  const plan = planSaleEdit(tx, {});

  // Ten per cent of the 20 000 DA he took, not of the 15 000 DA left after the trade.
  assert.equal(plan.discountAmount, 2000);
  assert.equal(plan.total, 13000);
});

test('a taken-back line is priced at what the counter agreed to pay for it', () => {
  const tx = makeTx({
    items: [
      line(makeProduct({ price: 20000 }), 1),
      // The shelf still asks 5 000 for the old phone; the counter paid him 3 000.
      { ...returnLine(tradeIn(5000), 1), customReturnPrice: 3000 },
    ],
    subtotal: 17000,
    total: 17000,
  });
  const plan = planSaleEdit(tx, {});

  assert.equal(plan.returns, 3000);
  assert.equal(plan.total, 17000);
});

test('a corrected price reprices the unit handed back with the unit sold', () => {
  const tx = makeTx({
    items: [
      line(makeProduct(), 2),
      // An earlier correction bought a unit back for 3 000 DA.
      { ...returnLine(makeProduct(), 1), customReturnPrice: 3000 },
    ],
    subtotal: 6000,
    total: 6000,
  });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4000 } });

  // One control holds both directions of a SKU, so the price typed moves the credit
  // with the sale: a unit handed back is worth what the shop now says a unit is.
  assert.deepEqual(shapeOf(plan.items), ['p1:sale:2', 'p1:return:1']);
  assert.equal(plan.returns, 4000);
  assert.equal(plan.total, 4000);
  assert.equal(plan.refundDue, 2000);
  assert.deepEqual(plan.lineDiscounts, [
    { productId: 'p1', name: 'Hoco EQ2 BT-EQ2', granted: 1000, percent: 11.11111111111111 },
  ]);
});

test('a price typed on a trade-in row writes nothing, because no sold line carries it', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 20000 }), 1), returnLine(tradeIn(5000), 1)],
    subtotal: 15000,
    total: 15000,
  });
  const plan = planSaleEdit(tx, { p9: { quantity: 0, unitPrice: 3500 } });

  // A credit line is re-priced from the sold line of its own SKU, and a row that only
  // ever handed goods over has none — so the 5 000 DA written on the document stands
  // and there is nothing for the save to write. The counter behaves the same way: a
  // buy-back is agreed at the till, not on a correction. The diff still names the
  // price typed, so an approving admin sees a promise the document cannot keep.
  assert.equal(plan.returns, 5000);
  assert.equal(plan.total, 15000);
  assert.equal(plan.hasChanges, false);
  assert.deepEqual(diffSaleEdit(tx, { p9: { quantity: 0, unitPrice: 3500 } }), [
    { kind: 'price', name: 'Old phone in trade', from: 5000, to: 3500 },
  ]);
});

test('a receipt that would come out owed is reported, not floored to nothing', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 20000 }), 1), returnLine(tradeIn(5000), 1)],
    subtotal: 15000,
    total: 15000,
  });
  const plan = planSaleEdit(tx, { p1: { quantity: 0, unitPrice: 20000 } });

  // The sale line is gone and the trade-in stands: the shop would owe 5 000 DA. The
  // planner says so — `applySaleEdit` refuses to write it, because only the counter
  // decides how a surplus like that leaves the shop.
  assert.equal(plan.total, -5000);
  assert.equal(plan.surplusOwedToCustomer, true);
});

test('a correction that swallows money the account already held puts it in the Avoir', () => {
  // 8 000 DA was handed over against a 20 000 DA invoice; the correction knocks the
  // invoice to 5 000, so 3 000 of what he gave is now more than the receipt is worth.
  assert.equal(surplusShiftOf(8000, 5000, 20000), 3000);
});

test('a correction that lifts the invoice back over what was paid hands the Avoir back', () => {
  // The earlier correction granted 3 000 DA of Avoir; this one prices the receipt
  // above what was handed over, so that credit is covered again and must come off.
  assert.equal(surplusShiftOf(8000, 9000, 5000), -3000);
});

test('a correction of a fully paid invoice moves no Avoir', () => {
  // Nothing was absorbed before and nothing is absorbed now — a till that re-priced
  // an invoice under its own payments would otherwise grant the surplus every time.
  assert.equal(surplusShiftOf(8000, 8000, 8000), 0);
  assert.equal(surplusShiftOf(8000, 12000, 8000), 0);
  assert.equal(surplusShiftOf(0, 5000, 20000), 0);
});

test('a trade-in of more units than were sold is not read as a shrinking sale', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 20000 }), 1), returnLine(tradeIn(5000), 2)],
    subtotal: 10000,
    total: 10000,
  });
  const plan = planSaleEdit(tx, {});

  // Nothing moved, yet measuring the rows against each other by product id alone made
  // the sale look short of the units it sold, and marked an untouched invoice
  // partially refunded.
  assert.equal(plan.total, 10000);
  assert.equal(plan.status, 'completed');
  assert.equal(plan.hasChanges, false);
});
