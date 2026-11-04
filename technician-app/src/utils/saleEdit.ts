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
 * save refuses what the shelf cannot give. Units are counted per product and per kind,
 * then merged back into one movement per product, because a stock write reads the shelf
 * and writes it and two of them on one document cannot run at the same time.
 */
import type { CartItem, SaleTransaction } from '../types/index.ts';
import { discountAmountOf, lineDiscountOf } from './discountPolicy.ts';
import type { LineConcession } from './discountPolicy.ts';

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
  /** What the corrected basket holds in purchases, before any line comes back off it. */
  purchases: number;
  /** What the customer handed back, priced at what the counter agreed to pay for it. */
  returns: number;
  /** The net the document carries: purchases less what came back. */
  subtotal: number;
  discountAmount: number;
  /** What each line was knocked down to, kept for the shop's totals. */
  lineDiscounts: LineConcession[];
  /** Negative when the lines coming back outweigh the basket — see `surplusOwedToCustomer`. */
  total: number;
  /** The receipt would leave the shop owing the customer; the save refuses it. */
  surplusOwedToCustomer: boolean;
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
        // A line taken back is priced by what the counter pays for it, not by what the
        // shelf still asks, so a corrected trade-in moves that number with it.
        ...(item.isReturn ? { customReturnPrice: unitPrice } : {}),
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
  const movements = new Map<string, { name: string; delta: number }>();

  /**
   * One signed delta per product AND per kind — the desktop's `planSaleEditStock`.
   * Walking only the originals was the old bug on both terminals: a row the invoice
   * never carried moved nothing, and a return line that shrank was restocked instead
   * of taken back off the shelf. Totalling by group matters because the editor gives
   * one SKU one control and applies it to every row carrying it, so an exchange
   * invoice with a sale row and a return row of the same model moves the shelf twice,
   * in opposite directions. The two directions of one product are then merged into a
   * single restock or deduct line: the till writes the net, because two writes to the
   * same document — and two concurrent transactions on it — would abort each other.
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
    }

    const current = movements.get(group.productId);
    if (current) current.delta += delta;
    else movements.set(group.productId, { name: group.name, delta });
  });

  /**
   * One line per product, with both kinds inside it. Two rows of the same SKU can pull
   * the shelf in opposite directions — a sale row hands a unit back while a return row
   * takes one out — and the till writes their sum, never two moves on one document.
   */
  movements.forEach((movement, productId) => {
    if (movement.delta === 0) return;
    const line = { productId, name: movement.name, quantity: Math.abs(movement.delta) };
    if (movement.delta > 0) restock.push(line);
    else deduct.push(line);
  });

  /**
   * The till's own arithmetic, one rule with `cartTotalsOf` on the counter: the
   * basket is what was BOUGHT, a line the customer handed back comes off it instead
   * of being added to it, and the discount is measured on the purchases — because a
   * phone coming back onto the shelf must not shrink the concession he was owed on
   * what he took. `subtotal` is therefore the net the desktop writes.
   *
   * Not floored at zero: a basket whose returns outweigh its purchases is an
   * exchange surplus, and the till is where the shop decides how that money leaves.
   * `applySaleEdit` refuses to write one; rounding it down here would eat it.
   */
  const unitOf = (item: CartItem): number =>
    // The basket prices off the product snapshot, as the counter does. A row too old
    // to carry one keeps its own line price instead of contributing zero.
    money(item.product?.price ?? item.unitPrice, 0);

  /** What the counter agreed to pay for a line it took back, which is not always the
   *  price the shelf still shows for it. */
  const returnUnitOf = (item: CartItem): number =>
    typeof item.customReturnPrice === 'number' && Number.isFinite(item.customReturnPrice)
      ? money(item.customReturnPrice, 0)
      : unitOf(item);

  const purchases = items.reduce(
    (sum, item) => (item.isReturn ? sum : sum + unitOf(item) * wholeUnits(item.quantity, 0)),
    0
  );
  const returns = items.reduce(
    (sum, item) => (item.isReturn ? sum + returnUnitOf(item) * wholeUnits(item.quantity, 0) : sum),
    0
  );
  const subtotal = purchases - returns;
  // One arithmetic with the counter and the till screen: the share resolved against
  // what was bought, rounded once, never more than it holds. Re-expanding a
  // percentage by hand is how the phone came to a total a dinar away from the one
  // the receipt prints.
  const discountAmount = tx.discount
    ? discountAmountOf(purchases, {
        mode: tx.discount.type === 'percent' ? 'percent' : 'flat',
        value: tx.discount.value,
      })
    : 0;
  const total = purchases - discountAmount - returns;
  /** The receipt would owe the customer money — `applySaleEdit` will not write it. */
  const surplusOwedToCustomer = total < 0;

  /**
   * What this edit knocks off the invoice, line by line, measured against the price
   * the document held for that line before — a row that only just joined the invoice
   * is priced at what it was sold for, so it records nothing. The concession lives
   * inside the line's own price, invisible to anything adding up the discount field,
   * so the shop writes it down where its totals can see it, in the same words the
   * counter uses.
   */
  const lineDiscounts: LineConcession[] = items.reduce<LineConcession[]>((lines, item) => {
    const id = item?.product?.id;
    if (!id) return lines;
    const charged = money(item.unitPrice ?? item.product.price, 0);
    const before = tx.items.find(
      orig => orig.product?.id === id && Boolean(orig.isReturn) === Boolean(item.isReturn)
    );
    const listUnit = before ? money(before.unitPrice ?? before.product?.price, charged) : charged;
    const concession = lineDiscountOf(listUnit, charged, item.quantity);
    if (concession.granted <= 0) return lines;
    lines.push({ productId: id, name: `${item.product.name} ${item.product.model || ''}`.trim(), ...concession });
    return lines;
  }, []);

  let status: NonNullable<SaleTransaction['status']> = tx.status || 'completed';
  if (items.length === 0 || total === 0) {
    status = 'refunded';
  } else if (
    tx.items.some(orig => {
      // By product id AND kind, as the counter does: the trade-in of the same model
      // is a different line, and reading it as the sale row hides the units that
      // came off it.
      const match = items.find(
        ni =>
          ni.product?.id === orig.product?.id &&
          Boolean(ni.isReturn) === Boolean(orig.isReturn)
      );
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
    purchases,
    returns,
    subtotal,
    discountAmount,
    lineDiscounts,
    total,
    surplusOwedToCustomer,
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
