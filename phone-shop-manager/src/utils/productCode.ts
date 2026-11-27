/**
 * Matching a scanned or typed product code to a row.
 * ===================================================
 * A product can be identified three ways — `barcode`, `sku` and the Firestore doc
 * `id` — and the shop's three writers (this app, the phone app, and whatever created
 * the first stock list) do not agree on which one is populated. Saving a product
 * whose barcode was left blank copies the sku into it, so one printed code can
 * legitimately sit on two rows.
 *
 * Every lookup here used to be a single `find`, which meant the row that happened to
 * come first won — scanning `kit-bt-hoco-128` could add `kit-bt-hoco-eq2` if eq2 had
 * picked up 128's code in its barcode. Now every row that answers to the code is a
 * claimant, and two claimants means the cashier is told instead of guessed at: at a
 * counter, silently ringing up the wrong item is worse than one extra click.
 *
 * The phone app keeps a copy of this file (android-management-app/src/utils/productCode.ts);
 * the two must resolve a scan the same way or the same sticker means two products.
 */
import type { PhoneModel } from '../types';

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
 * on the wrong product would otherwise outrank the correct product's own sku.
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

/**
 * Codes the row would take that another product already answers to. Saving one of
 * these is what creates the ambiguous scan, so the screen has to see it first.
 *
 * `editingId` is the row being changed: a product keeping its own code is not a collision.
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

/** The two rows a cashier must be told apart by hand. */
export const describeCodeCandidates = (candidates: readonly CodeMatch[]): string =>
  candidates
    .map(({ product }) => `${product.name}${product.model ? ` ${product.model}` : ''}`.trim())
    .join(' / ');
