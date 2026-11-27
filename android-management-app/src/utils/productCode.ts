/**
 * Matching a scanned or typed product code to a row.
 * ===================================================
 * A product can be identified three ways — `barcode`, `sku` and the Firestore doc
 * `id` — and the shop's three writers (this app, the counter app, and whatever
 * created the first stock list) do not agree on which one is populated. Inventory
 * even defaults `barcode` to the sku when the field is left blank, so one printed
 * code can legitimately sit on two rows.
 *
 * The old lookup was a single `find` over all three fields, which meant the row
 * that happened to come first in Firestore order won — scanning `kit-bt-hoco-128`
 * could add `kit-bt-hoco-eq2` if eq2 had picked up 128's code in its barcode.
 * Now every row that answers to the code is a claimant, and two claimants means
 * the technician chooses: at a counter, silently adding the wrong item is worse
 * than one extra tap. Which field answered only decides the order they are shown in.
 */
import type { PhoneModel } from '../types/index.ts';

/** Codes are typed, scanned and stored by three apps — compare them the same way everywhere. */
export const normalizeCode = (value: unknown): string => String(value ?? '').trim().toLowerCase();

export type CodeField = 'barcode' | 'sku' | 'id';

const FIELD_RANK: Record<CodeField, number> = { barcode: 0, sku: 1, id: 2 };

export interface CodeMatch {
  product: PhoneModel;
  /** The strongest field of this row that answered to the code. */
  field: CodeField;
}

/**
 * One entry per matching row, carrying the strongest field that matched. A row is
 * never listed twice, so `matchesForCode(...).length` is the number of products in play.
 */
export const matchesForCode = (products: readonly PhoneModel[], code: unknown): CodeMatch[] => {
  const target = normalizeCode(code);
  if (!target) return [];

  const matches: CodeMatch[] = [];
  for (const product of products) {
    if (normalizeCode(product.barcode) === target) matches.push({ product, field: 'barcode' });
    else if (normalizeCode(product.sku) === target) matches.push({ product, field: 'sku' });
    else if (normalizeCode(product.id) === target) matches.push({ product, field: 'id' });
  }
  return matches;
};

export type CodeResolution =
  | { kind: 'unique'; product: PhoneModel; field: CodeField }
  | { kind: 'ambiguous'; candidates: CodeMatch[] }
  | { kind: 'none' };

/**
 * Resolve a code to one product, or say why it could not. Two rows claiming the same
 * code is decided on the row count, not on which field answered first: a stale barcode
 * on the wrong product would otherwise outrank the correct product's own sku, and the
 * whole complaint this file exists for is a scan adding the neighbour row.
 */
export const resolveProductByCode = (
  products: readonly PhoneModel[],
  code: unknown
): CodeResolution => {
  const matches = matchesForCode(products, code);
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'unique', product: matches[0].product, field: matches[0].field };
  return {
    kind: 'ambiguous',
    candidates: [...matches].sort((a, b) => FIELD_RANK[a.field] - FIELD_RANK[b.field]),
  };
};

export type DisplayCode = { kind: 'sku' | 'barcode'; value: string };

/**
 * The codes a row should show, in the order a technician reads them.
 *
 * This exists because two products whose SKUs share a prefix are told apart by
 * their codes, and the screens used to print only the sku. A row that copied its
 * sku into the barcode (which is what saving here does when the field is left
 * blank) is not shown saying the same thing twice.
 */
export const codesToShow = (item: { sku?: unknown; barcode?: unknown }): DisplayCode[] => {
  const sku = String(item.sku ?? '').trim();
  const barcode = String(item.barcode ?? '').trim();
  const codes: DisplayCode[] = [];
  if (sku) codes.push({ kind: 'sku', value: sku });
  if (barcode && normalizeCode(barcode) !== normalizeCode(sku)) {
    codes.push({ kind: 'barcode', value: barcode });
  }
  return codes;
};

/**
 * Codes the row would take that another product already answers to. The counter app
 * and hand-typed lists both create these, and the screen cannot save its way out of a
 * collision it cannot see.
 *
 * `editingId` is the row being changed: a product keeping its own sku is not a collision.
 */
export const findCodeCollisions = (
  products: readonly PhoneModel[],
  candidate: { id?: string; sku?: unknown; barcode?: unknown }
): string[] => {
  const sku = normalizeCode(candidate.sku);
  const barcode = normalizeCode(candidate.barcode);
  const editingId = candidate.id ?? '';
  const collisions: string[] = [];

  for (const other of products) {
    if (other.id === editingId) continue;
    const otherSku = normalizeCode(other.sku);
    const otherBarcode = normalizeCode(other.barcode);
    const claimedBy = `${other.name}${other.model ? ` (${other.model})` : ''}`;

    for (const [field, value] of [
      ['SKU', sku],
      ['barcode', barcode],
    ] as const) {
      if (!value) continue;
      if (otherSku === value || otherBarcode === value) {
        collisions.push(`${field} "${value}" is already used by ${claimedBy}`);
      }
    }
  }
  return collisions;
};
