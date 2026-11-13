import type { PhoneModel } from '../types';

/** Trim, collapse inner whitespace, drop empties and case-insensitive duplicates. */
export function normalizeCompatibleModels(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const clean = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * The list an editor should show. Products created before the multi-input
 * feature have only the legacy `model` string; it becomes a single editable
 * entry and is never dropped.
 */
export function modelsFromProduct(product: Pick<PhoneModel, 'model' | 'compatibleModels'>): string[] {
  const list = Array.isArray(product.compatibleModels) ? product.compatibleModels : [];
  if (list.length > 0) return list;
  const legacy = (product.model || '').trim();
  return legacy ? [legacy] : [];
}

/** The legacy `model` field stays the joined string so the sticker, search and reports keep working unchanged. */
export function joinModels(models: readonly string[]): string {
  return normalizeCompatibleModels(models).join(' ');
}
