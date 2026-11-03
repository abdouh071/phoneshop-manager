/**
 * What an edit of a settled invoice does — computed before anything is written.
 * =============================================================================
 * The counter terminal has had this since forever (`cartStore.editTransaction`);
 * the phone faked it by dropping the old lines into a live cart, which left the
 * invoice untouched and sold the goods a second time. So this planner takes the
 * original document and the cashier's changes and produces the whole write set at
 * once: the new lines, the money, the status, the payment split and — the part that
 * decides whether the shelf count stays true — the per-line stock movement.
 *
 * Lines are keyed by position, not product id. A document written years ago can
 * hold the same SKU twice, and a removal keyed by id would then edit both rows.
 *
 * Money rules are the desktop's: the stored discount stays as it was granted, so a
 * percentage scales with the new basket and a flat amount does not, and payments are
 * rescaled proportionally so they always sum to the recorded total.
 */
import type { CartItem, SaleTransaction } from '../types/index.ts';
import { discountAmountOf } from './discountPolicy.ts';

export interface SaleLineEdit {
  quantity: number;
  unitPrice: number;
}

/** Edits and restock choices are keyed by the line's index in `tx.items`. */
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
  total: number
): SaleTransaction['payments'] => {
  if (!payments || payments.length <= 1) {
    return [{ method: payments?.[0]?.method || 'cash', amount: total }];
  }
  const oldSum = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 1;
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
  restockChoices: SaleRestockChoices = {}
): SaleEditPlan => {
  const items: CartItem[] = [];
  const restock: SaleStockLine[] = [];
  const deduct: SaleStockLine[] = [];
  let hasChanges = false;
  let anyLineReduced = false;

  tx.items.forEach((item, index) => {
    const key = String(index);
    const product = item?.product;
    // A row stored without a product id has no shelf to move. Carry it through
    // untouched rather than dropping it out of `items`, which would quietly take
    // its money off the invoice the customer already paid.
    if (!product?.id) {
      items.push(item);
      return;
    }

    const originalQty = wholeUnits(item.quantity, 0);
    const originalUnit = money(item.unitPrice ?? product.price, 0);

    const edit = edits[key];
    const quantity = edit ? wholeUnits(edit.quantity, originalQty) : originalQty;
    const unitPrice = edit ? money(edit.unitPrice, originalUnit) : originalUnit;

    if (quantity !== originalQty || unitPrice !== originalUnit) hasChanges = true;
    if (quantity < originalQty) anyLineReduced = true;

    const returnedQty = originalQty - quantity;
    if (returnedQty > 0 && restockChoices[key] !== false) {
      restock.push({ productId: product.id, name: product.name || product.model || product.id, quantity: returnedQty });
    } else if (returnedQty < 0) {
      deduct.push({ productId: product.id, name: product.name || product.model || product.id, quantity: -returnedQty });
    }

    if (quantity <= 0) return;

    items.push({
      ...item,
      quantity,
      // The desktop leaves `unitPrice` at the old number while rewriting
      // `product.price`; receipts read either one, so both move together here.
      unitPrice,
      product: { ...product, price: unitPrice },
    });
  });

  const subtotal = items.reduce(
    (sum, item) => sum + money(item.unitPrice ?? item.product?.price, 0) * wholeUnits(item.quantity, 0),
    0
  );
  const discountAmount = discountAmountOf(subtotal, {
    mode: tx.discount?.type ?? 'flat',
    value: tx.discount?.value ?? 0,
  });
  const total = Math.max(0, subtotal - discountAmount);

  let status: NonNullable<SaleTransaction['status']>;
  if (items.length === 0 || total === 0) {
    status = 'refunded';
  } else if (anyLineReduced) {
    status = 'partially_refunded';
  } else {
    status = tx.status ?? 'completed';
  }

  return {
    items,
    subtotal,
    discountAmount,
    total,
    refundDue: Math.max(0, (tx.total || 0) - total),
    additionalDue: Math.max(0, total - (tx.total || 0)),
    status,
    payments: rescalePayments(tx.payments, total),
    restock,
    deduct,
    hasChanges,
  };
};

/**
 * The changes reduced to what a remote admin reads on their own screen before they
 * answer: which line shrank, which price moved. The screen owns the wording, so this
 * stays numbers and product names rather than sentences.
 */
export type SaleEditChange =
  | { kind: 'quantity'; name: string; from: number; to: number }
  | { kind: 'price'; name: string; from: number; to: number };

export const diffSaleEdit = (tx: SaleTransaction, edits: SaleLineEdits): SaleEditChange[] => {
  const changes: SaleEditChange[] = [];
  tx.items.forEach((item, index) => {
    const edit = edits[String(index)];
    if (!edit) return;
    const name = item?.product?.name || item?.product?.model || item?.product?.id || '';
    const fromQty = wholeUnits(item.quantity, 0);
    const toQty = wholeUnits(edit.quantity, fromQty);
    const fromUnit = money(item.unitPrice ?? item.product?.price, 0);
    const toUnit = money(edit.unitPrice, fromUnit);
    if (toQty !== fromQty) changes.push({ kind: 'quantity', name, from: fromQty, to: toQty });
    if (toUnit !== fromUnit) changes.push({ kind: 'price', name, from: fromUnit, to: toUnit });
  });
  return changes;
};
