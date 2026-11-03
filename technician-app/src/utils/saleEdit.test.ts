import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PhoneModel, SaleTransaction } from '../types/index.ts';
import { diffSaleEdit, planSaleEdit, rescalePayments } from './saleEdit.ts';

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

const makeTx = (over: Partial<SaleTransaction> = {}): SaleTransaction => {
  const items = over.items ?? [line(makeProduct(), 2)];
  const subtotal = over.subtotal ?? items.reduce((s, i) => s + i.product.price * i.quantity, 0);
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

test('every line gone is a refund, and the payment lines go to zero with it', () => {
  const tx = makeTx({ items: [line(makeProduct(), 1), line(makeProduct({ id: 'p2', name: 'Case' }), 2)] });
  const plan = planSaleEdit(tx, {
    p1: { quantity: 0, unitPrice: 4500 },
    p2: { quantity: 0, unitPrice: 4500 },
  });

  assert.equal(plan.items.length, 0);
  assert.equal(plan.total, 0);
  assert.equal(plan.status, 'refunded');
  assert.deepEqual(plan.payments, [{ method: 'cash', amount: 0 }]);
  assert.equal(plan.restock.length, 2);
});

test('a percentage discount follows the new basket; a flat one does not', () => {
  const percentTx = makeTx({
    items: [line(makeProduct(), 2)],
    discount: { type: 'percent', value: 10 },
    total: 8100,
  });
  const percentPlan = planSaleEdit(percentTx, { p1: { quantity: 1, unitPrice: 4500 } });
  assert.equal(percentPlan.discountAmount, 450);
  assert.equal(percentPlan.total, 4050);

  const flatTx = makeTx({
    items: [line(makeProduct(), 2)],
    discount: { type: 'flat', value: 500 },
    total: 8500,
  });
  const flatPlan = planSaleEdit(flatTx, { p1: { quantity: 1, unitPrice: 4500 } });
  assert.equal(flatPlan.discountAmount, 500);
  assert.equal(flatPlan.total, 4000);
});

test('the discount granted on the sale is taken in full and the total floors at zero', () => {
  const tx = makeTx({
    items: [line(makeProduct({ price: 400 }), 2)],
    subtotal: 800,
    discount: { type: 'flat', value: 700 },
    total: 100,
  });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 400 } });

  // The counter subtracts the 700 DA it was told to subtract, which leaves nothing
  // to collect — the invoice is refunded, and the customer is not left "owing" 300.
  assert.equal(plan.discountAmount, 700);
  assert.equal(plan.total, 0);
  assert.equal(plan.status, 'refunded');
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

test('one SKU written on two rows is one control, and both rows move together', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 1), line(twin, 4)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  assert.deepEqual(
    plan.items.map(i => i.quantity),
    [2, 2]
  );
  // The editor gives one SKU one control and applies it to every row carrying it, so
  // five units sold become four: one comes back, and nothing is taken off again.
  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(plan.deduct, []);
});

test('a sale row and a return row of one model are counted apart and moved once', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 3), returnLine(twin, 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  // One control sets both rows to two: the sale row hands a unit back and the return
  // row takes one more in. Counting them as one row would lose the second movement —
  // but the shelf is told once, because two writes to one product cannot run at once.
  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 2 }]);
  assert.deepEqual(plan.deduct, []);
});

test('the two kinds of one model that cancel each other move no shelf at all', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 2), returnLine(twin, 2)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  // The sale row gives a unit back while the return row takes the same unit out. The
  // shelf ends where it started, so the correction writes no stock movement.
  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, []);
});

test('a line stored without a product id survives the rewrite with its money intact', () => {
  const broken = { product: {} as PhoneModel, quantity: 1, unitPrice: 100 };
  const tx = makeTx({ items: [broken, line(makeProduct(), 1)], subtotal: 4600, total: 4600 });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  // No id means no shelf to move and nothing to edit — the row is carried through,
  // so the invoice still accounts for the 100 DA the customer paid for it.
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].unitPrice, 100);
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

test('a SKU on two rows is reported to the approving admin once', () => {
  const twin = makeProduct();
  const tx = makeTx({ items: [line(twin, 3), line(twin, 1)] });
  const changes = diffSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  assert.deepEqual(changes, [{ kind: 'quantity', name: 'Hoco EQ2', from: 3, to: 2 }]);
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

  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(plan.deduct, [{ productId: 'p9', name: 'Cable', quantity: 2 }]);
  assert.equal(plan.total, 9200);
  assert.equal(plan.refundDue, 4300);
  assert.equal(plan.status, 'partially_refunded');
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

test('a return line that shrank takes its units back off the shelf', () => {
  const tx = makeTx({ items: [returnLine(makeProduct(), 2)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
});

test('a return line that grew puts the extra units back on the shelf', () => {
  const tx = makeTx({ items: [returnLine(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } });

  assert.deepEqual(plan.deduct, []);
  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
});

test('a return the shop wrote off moves no shelf in either direction', () => {
  const tx = makeTx({ items: [returnLine(makeProduct(), 2, false)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 1, unitPrice: 4500 } });

  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, []);
});

test('the do-not-restock choice stops a growing return from stocking the shelf', () => {
  const tx = makeTx({ items: [returnLine(makeProduct(), 1)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } }, { p1: false });

  assert.deepEqual(plan.restock, []);
  assert.deepEqual(plan.deduct, []);
});

test('one edit moves a sale line and a new line in the directions the counter expects', () => {
  const tx = makeTx({ items: [line(makeProduct(), 3)] });
  const plan = planSaleEdit(tx, { p1: { quantity: 2, unitPrice: 4500 } }, {}, [line(cable(), 2)]);

  assert.deepEqual(plan.restock, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(plan.deduct, [{ productId: 'p9', name: 'Cable', quantity: 2 }]);
});
