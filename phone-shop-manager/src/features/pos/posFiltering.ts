import type { CartItem, PhoneModel, SuspendedCart } from '../../types';
import type { ProductGroup } from '../../utils/productGrouping';
import { computeStockStatus } from '../../utils/stockStatus';
import { normalizeArabic } from '../../utils/normalizeText';

// Pure POS catalog/cart computations extracted verbatim from POSPage.
// Every function takes all inputs as arguments and is side-effect free;
// POSPage keeps the surrounding useMemo wrappers and dependency arrays unchanged.

// Filter sales catalog using local POS search query (server excluded repair parts from the beginning)
export const filterProductsBySearch = (allProducts: PhoneModel[], searchQuery: string): PhoneModel[] => {
  const query = normalizeArabic(searchQuery);
  if (!query) return allProducts;
  const words = query.split(' ');
  return allProducts.filter(p => {
    const full = normalizeArabic([p.name, p.model, p.sku, p.color, p.storage, p.location, p.supplier, p.accessorySubCategory].filter(Boolean).join(' '));
    return words.every(word => full.includes(word));
  });
};

// Build a map of productId → quantity already in cart
export const buildCartQtyMap = (items: CartItem[]): Record<string, number> => {
  const map: Record<string, number> = {};
  for (const item of items) {
    map[item.product.id] = (map[item.product.id] || 0) + item.quantity;
  }
  return map;
};

// Adjust each variant's stock by subtracting cart quantities → real-time "available to add"
export const adjustGroupsWithCart = (rawGroups: ProductGroup[], cartQtyMap: Record<string, number>): ProductGroup[] => {
  return rawGroups.map(group => {
    const adjustedVariants = group.variants.map(v => {
      const inCart = cartQtyMap[v.id] || 0;
      const availableStock = Math.max(0, v.stock - inCart);
      const stockStatus = computeStockStatus(availableStock, v.lowStockThreshold ?? 1);
      return { ...v, stock: availableStock, stockStatus };
    });
    const totalAvailable = adjustedVariants.reduce((s, v) => s + v.stock, 0);
    const groupStockStatus = computeStockStatus(totalAvailable, 5);
    return { ...group, variants: adjustedVariants, totalStock: totalAvailable, stockStatus: groupStockStatus };
  });
};

export const countGroupsByCategory = (groups: ProductGroup[]): Record<string, number> => {
  const counts: Record<string, number> = { all: groups.length };
  for (const g of groups) {
    counts[g.category] = (counts[g.category] || 0) + 1;
  }
  return counts;
};

export const filterGroupsByCategory = (groups: ProductGroup[], categoryFilter: string, subCategoryFilter: string): ProductGroup[] => {
  let result = groups;
  if (categoryFilter !== 'all') {
    result = result.filter(g => g.category === categoryFilter);
  }
  if (categoryFilter === 'accessory' && subCategoryFilter !== 'all') {
    result = result.filter(g => (g.accessorySubCategory || 'other') === subCategoryFilter);
  }
  return result;
};

export const filterSuspendedCarts = (suspendedCarts: SuspendedCart[], heldSearchQuery: string): SuspendedCart[] => {
  const q = normalizeArabic(heldSearchQuery);
  return suspendedCarts.filter(cart => {
    if (!q) return true;
    if (normalizeArabic(cart.customerName || 'walk-in customer').includes(q)) return true;
    const items = Array.isArray(cart.items) ? cart.items : [];
    return items.some(i =>
      normalizeArabic(i?.product?.name).includes(q) ||
      normalizeArabic(i?.product?.model).includes(q) ||
      normalizeArabic(i?.product?.color).includes(q) ||
      normalizeArabic(i?.product?.storage).includes(q) ||
      normalizeArabic(i?.product?.sku).includes(q)
    );
  });
};

// Dynamic quick tender denomination presets for Cash checkout
export const buildTenderPresets = (netPayable: number): number[] => {
  if (netPayable <= 0) return [];
  const presets: number[] = [];
  const candidates = [
    50, 100, 200, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000
  ];
  for (const c of candidates) {
    if (c > netPayable && presets.length < 3) {
      presets.push(c);
    }
  }
  return presets;
};

// Fast-Lane Speed-Dial items: high-turnover in-stock items (accessories preferred)
export const pickSpeedDialItems = (allProducts: PhoneModel[]): PhoneModel[] => {
  const inStock = allProducts.filter(p => p.stock > 0 && p.category !== 'repair_part');
  const accessories = inStock.filter(p => p.category === 'accessory');
  const pool = accessories.length >= 6 ? accessories : [...accessories, ...inStock.filter(p => p.category !== 'accessory')];
  return pool.slice(0, 6);
};
