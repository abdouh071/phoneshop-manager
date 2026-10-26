import type { Supplier, PurchaseOrder, PhoneModel } from '../types';

/**
 * Extracts and unifies suppliers from:
 * 1. Registered official suppliers in Firestore (`suppliers` collection)
 * 2. Products and repair parts from inventory (`products` and `parts`)
 * 3. Existing Purchase Orders (`purchaseOrders`)
 *
 * Deduplicates suppliers by case-insensitive name, giving priority to registered
 * suppliers while preserving original casing.
 */
export function extractSuppliersFromInventory(
  registeredSuppliers: Supplier[] = [],
  products: PhoneModel[] = [],
  parts: PhoneModel[] = [],
  purchaseOrders: PurchaseOrder[] = []
): (Supplier & { source: 'registered' | 'product_catalog'; productCount?: number })[] {
  const result: (Supplier & { source: 'registered' | 'product_catalog'; productCount?: number })[] = [];
  const seenLowerNames = new Set<string>();

  // 1. Registered formal suppliers in Firestore
  for (const s of registeredSuppliers) {
    const trimmed = (s.name || '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seenLowerNames.has(lower)) {
      seenLowerNames.add(lower);
      result.push({
        ...s,
        source: 'registered',
        productCount: 0,
      });
    }
  }

  // 2. Count occurrences and collect suppliers from products and parts
  const catalogMap = new Map<string, { originalName: string; count: number }>();
  const allItems = [...products, ...parts];

  for (const item of allItems) {
    const sName = (item.supplier || '').trim();
    if (!sName) continue;
    const lower = sName.toLowerCase();

    // If it's already a registered supplier, increment its product count
    if (seenLowerNames.has(lower)) {
      const reg = result.find(r => r.name.trim().toLowerCase() === lower);
      if (reg) {
        reg.productCount = (reg.productCount || 0) + 1;
      }
      continue;
    }

    const existing = catalogMap.get(lower);
    if (existing) {
      existing.count += 1;
    } else {
      catalogMap.set(lower, { originalName: sName, count: 1 });
    }
  }

  // 3. Add unregistered suppliers discovered from products and parts
  for (const [lower, { originalName, count }] of catalogMap.entries()) {
    seenLowerNames.add(lower);
    const synthId = `inv_sup_${encodeURIComponent(lower)}`;
    result.push({
      id: synthId,
      name: originalName,
      notes: `From product catalog (${count} ${count === 1 ? 'item' : 'items'})`,
      source: 'product_catalog',
      productCount: count,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // 4. Any suppliers from past POs that might not be in registered or products
  for (const po of purchaseOrders) {
    const poSupName = (po.supplierName || '').trim();
    if (!poSupName) continue;
    const lower = poSupName.toLowerCase();
    if (!seenLowerNames.has(lower)) {
      seenLowerNames.add(lower);
      result.push({
        id: po.supplierId || `po_sup_${encodeURIComponent(lower)}`,
        name: poSupName,
        notes: 'From previous purchase order',
        source: 'product_catalog',
        createdAt: po.createdAt || new Date().toISOString(),
        updatedAt: po.updatedAt || new Date().toISOString(),
      });
    }
  }

  // Sort alphabetically by name
  return result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
