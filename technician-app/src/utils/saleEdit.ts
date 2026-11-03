/**
 * What an edit of a settled invoice does — computed before anything is written.
 * =============================================================================
 * This is the counter terminal's `cartStore.editTransaction` and its
 * `EditTransactionModal`, moved out of the browser so a phone can use the same
 * rules. The phone used to fake it by dropping the old lines into a live cart,
 * which left the invoice untouched and sold the goods a second time.
 *
 * Lines are keyed by PRODUCT ID, exactly as the desktop modal keys its
 * `editedQuantities` / `editedPrices` / `returnToStock`. The consequence is the
 * desktop's: one SKU written on two rows of the same invoice is one control, and
 * changing it moves both rows together.
 *
 * Money rules are the desktop's too — the basket prices off `product.price`, the
 * discount that was granted on the sale stays granted (a percentage scales with
 * the new basket, a flat amount does not), the total is floored at zero, and the
 * status only changes when units actually came off.
 *
 * A product that was never on the invoice can be added to it, on both terminals. The
 * shop asks for it at the counter — the customer who comes back for a second cable —
 * and a new row is planned like a row that grew: its units come off the shelf, and the
 * save refuses what the shelf cannot give.
 */
import type { CartItem, SaleTransaction } from '../types/index.ts';

export interface SaleLineEdit {
  quantity: number;
  unitPrice: number;
}

/** Edits and restock choices are keyed by `product.id`, as on the desktop. */
export type SaleLineEdits = Record<string, SaleLineEdit>;
export type SaleRestockChoices = Record<string, boolean>;

export interface SaleStockLine {
  productId: string;
  name: string;
  quantity: number;
}

export interface SaleEditPlan {
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  /** Taken back from the customer, in dinars. */
  refundDue: number;
  /** Owed to the shop because the invoice grew, in dinars. */
  additionalDue: number;
  status: NonNullable<SaleTransaction['status']>;
  payments: SaleTransaction['payments'];
  /** Units going back on the shelf, and units coming off it, per product. */
  restock: SaleStockLine[];
  deduct: SaleStockLine[];
  hasChanges: boolean;
}

/**
 * The units one SKU owes the shelf, totalled per product AND per kind: an exchange
 * invoice can hold a sale row and a return row of the same model, and those two move
 * the shelf in opposite directions.
 */
interface StockGroup {
  productId: string;
  name: string;
  isReturn: boolean;
  /** How many rows carry this SKU, and how many of them were written off instead of restocked. */
  rows: number;
  writtenOff: number;
  sold: number;
  now: number;
}

const wholeUnits = (value: number, fallback: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const money = (value: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Split the new total across the payments that were actually taken, so a sale that
 * was half cash and half card still reads as half cash and half card after a
 * correction. The last line absorbs the rounding remainder — otherwise a 1 000 DA
 * basket split three ways would record 999.99 and the drawer would never close.
 */
export const rescalePayments = (
  payments: SaleTransaction['payments'],
  total: number,
  /** The desktop divides by the recorded total when the payment lines add up to nothing. */
  fallbackSum = 1
): SaleTransaction['payments'] => {
  if (!payments || payments.length <= 1) {
    return [{ method: payments?.[0]?.method || 'cash', amount: total }];
  }
  const oldSum = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || fallbackSum || 1;
  let running = 0;
  return payments.map((payment, index) => {
    if (index === payments.length - 1) {
      return { ...payment, amount: Math.max(0, Math.round((total - running) * 100) / 100) };
    }
    const share = Math.max(0, Math.round((payment.amount / oldSum) * total * 100) / 100);
    running += share;
    return { ...payment, amount: share };
  });
};

export const planSaleEdit = (
  tx: SaleTransaction,
  edits: SaleLineEdits,
  restockChoices: SaleRestockChoices = {},
  /**
   * Products the cashier puts on an invoice that was already sold — the second
   * cable the customer asks for at the counter. They carry the quantity and price
   * the editor was given, and every unit of them comes off the shelf.
   */
  added: CartItem[] = []
): SaleEditPlan => {
  // The desktop modal builds the new lines first — every row takes the edited
  // quantity and price of its product id, and a row that reaches zero leaves the
  // basket — and only then does the store compare them with the originals.
  const newItems = tx.items
    .map((item): CartItem => {
      const product = item?.product;
      // A row stored without a product id has no product to edit and no shelf to
      // move, so it carries through untouched rather than dropping out of the
      // invoice and quietly taking its money with it.
      if (!product?.id) return item;
      const edit = edits[product.id];
      if (!edit) {
        return { ...item, quantity: wholeUnits(item.quantity, 0) };
      }
      const quantity = wholeUnits(edit.quantity, wholeUnits(item.quantity, 0));
      const unitPrice = money(edit.unitPrice, money(product.price, 0));
      return {
        ...item,
        quantity,
        // Both price fields move: the phone's item list and its WhatsApp receipt read
        // `unitPrice`, the basket prices off `product.price`, and a corrected invoice
        // that updates only one of them prints the old number somewhere.
        unitPrice,
        product: { ...product, price: unitPrice },
      };
    })
    .filter(item => wholeUnits(item.quantity, 0) > 0);

  /**
   * The new rows. Both terminals offer the add control, and the phone sets the shape
   * here: both price fields are written — the item list and the WhatsApp receipt read
   * `unitPrice`, the basket prices off `product.price` — and a SKU that is already on
   * the invoice is refused, because the desktop's rule that one product id is one
   * control means the row on the document owns that product.
   */
  const onInvoice = new Set(tx.items.map(item => item?.product?.id).filter(Boolean));
  const addedItems: CartItem[] = [];
  for (const item of added) {
    const product = item?.product;
    const id = product?.id;
    if (!id || onInvoice.has(id)) continue;
    const quantity = wholeUnits(item.quantity, 0);
    if (quantity <= 0) continue;
    const listed = money(product.price, 0);
    const unitPrice = money(item.unitPrice ?? listed, listed);
    addedItems.push({ ...item, quantity, unitPrice, product: { ...product, price: unitPrice } });
  }

  const items = [...newItems, ...addedItems];

  const restock: SaleStockLine[] = [];
  const deduct: SaleStockLine[] = [];

  /**
   * One signed delta per product AND per kind — the desktop's `planSaleEditStock`.
   * Walking only the originals was the old bug on both terminals: a row the invoice
   * never carried moved nothing, and a return line that shrank was restocked instead
   * of taken back off the shelf. Totalling by group matters because the editor gives
   * one SKU one control and applies it to every row carrying it, so an exchange
   * invoice with a sale row and a return row of the same model moves the shelf twice,
   * in opposite directions.
   */
  const groups = new Map<string, StockGroup>();
  const collect = (list: CartItem[], side: 'sold' | 'now') => {
    list.forEach(item => {
      const id = item?.product?.id;
      if (!id) return;
      const isReturn = Boolean(item.isReturn);
      const key = `${id}::${isReturn ? 'return' : 'sale'}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          productId: id,
          name: item.product?.name || item.product?.model || id,
          isReturn,
          rows: 0,
          writtenOff: 0,
          sold: 0,
          now: 0,
        };
        groups.set(key, group);
      }
      group[side] += wholeUnits(item.quantity, 0);
      group.rows += 1;
      if (item.restock === false) group.writtenOff += 1;
    });
  };
  collect(tx.items, 'sold');
  collect(items, 'now');

  groups.forEach(group => {
    const moved = group.now - group.sold;
    if (moved === 0) return;

    // Goods the customer handed back that were never put on the shelf cannot move it
    // in either direction.
    if (group.isReturn && group.writtenOff === group.rows) return;

    const delta = group.isReturn ? moved : -moved;

    if (delta > 0) {
      if (restockChoices[group.productId] === false) return;
      restock.push({ productId: group.productId, name: group.name, quantity: delta });
    } else {
      deduct.push({ productId: group.productId, name: group.name, quantity: -delta });
    }
  });

  const subtotal = items.reduce(
    // The basket prices off the product snapshot, as the counter does. A row too old
    // to carry one keeps its own line price instead of contributing zero.
    (sum, item) => sum + money(item.product?.price ?? item.unitPrice, 0) * wholeUnits(item.quantity, 0),
    0
  );
  let discountAmount = 0;
  if (tx.discount) {
    discountAmount =
      tx.discount.type === 'percent' ? subtotal * (tx.discount.value / 100) : tx.discount.value;
  }
  const total = Math.max(0, subtotal - discountAmount);

  let status: NonNullable<SaleTransaction['status']> = tx.status || 'completed';
  if (items.length === 0 || total === 0) {
    status = 'refunded';
  } else if (
    tx.items.some(orig => {
      const match = items.find(ni => ni.product?.id === orig.product?.id);
      return !match || wholeUnits(match.quantity, 0) < wholeUnits(orig.quantity, 0);
    })
  ) {
    status = 'partially_refunded';
  }

  const hasChanges =
    addedItems.length > 0 ||
    tx.items.some(item => {
      const edit = item.product?.id ? edits[item.product.id] : undefined;
      if (!edit) return false;
      const originalQty = wholeUnits(item.quantity, 0);
      const originalPrice = money(item.product?.price, 0);
      return (
        wholeUnits(edit.quantity, originalQty) !== originalQty ||
        money(edit.unitPrice, originalPrice) !== originalPrice
      );
    });

  // The desktop's own wording for the two directions of the same difference.
  const diff = (tx.total || 0) - total;

  return {
    items,
    subtotal,
    discountAmount,
    total,
    refundDue: diff > 0 ? diff : 0,
    additionalDue: diff < 0 ? Math.abs(diff) : 0,
    status,
    payments: rescalePayments(tx.payments, total, tx.total),
    restock,
    deduct,
    hasChanges,
  };
};

/**
 * The changes reduced to what a remote admin reads on their own screen before they
 * answer: which line shrank, which price moved, which product was put on the
 * invoice. The screen owns the wording, so this stays numbers and product names
 * rather than sentences.
 */
export type SaleEditChange =
  | { kind: 'quantity'; name: string; from: number; to: number }
  | { kind: 'price'; name: string; from: number; to: number }
  | { kind: 'add'; name: string; quantity: number; unitPrice: number };

export const diffSaleEdit = (
  tx: SaleTransaction,
  edits: SaleLineEdits,
  added: CartItem[] = []
): SaleEditChange[] => {
  const changes: SaleEditChange[] = [];
  const seen = new Set<string>();

  tx.items.forEach(item => {
    const id = item.product?.id;
    const edit = id ? edits[id] : undefined;
    // One entry per product id: two rows of the same SKU share one control on the
    // desktop, so reporting them twice would show an admin one change as two.
    if (!edit || !id || seen.has(id)) return;
    seen.add(id);

    const name = item.product?.name || item.product?.model || id;
    const fromQty = wholeUnits(item.quantity, 0);
    const toQty = wholeUnits(edit.quantity, fromQty);
    const fromUnit = money(item.product?.price, 0);
    const toUnit = money(edit.unitPrice, fromUnit);
    if (toQty !== fromQty) changes.push({ kind: 'quantity', name, from: fromQty, to: toQty });
    if (toUnit !== fromUnit) changes.push({ kind: 'price', name, from: fromUnit, to: toUnit });
  });

  added.forEach(item => {
    const product = item?.product;
    const quantity = wholeUnits(item.quantity, 0);
    if (!product?.id || quantity <= 0) return;
    const listed = money(product.price, 0);
    changes.push({
      kind: 'add',
      name: product.name || product.model || product.id,
      quantity,
      unitPrice: money(item.unitPrice ?? listed, listed),
    });
  });

  return changes;
};
