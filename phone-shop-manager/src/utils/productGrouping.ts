import type { PhoneModel } from '../types';

export interface ProductGroup {
  id: string;
  name: string;
  model: string;
  category: PhoneModel['category'];
  totalStock: number;
  stockStatus: PhoneModel['stockStatus'];
  minPrice: number;
  maxPrice: number;
  minCost: number;
  maxCost: number;
  variants: PhoneModel[];
}

export function groupProductsByBaseModel(products: PhoneModel[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();

  for (const p of products) {
    const groupId = `${p.name}-${p.model}`.toLowerCase();
    const cost = p.costPrice || 0;
    
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        id: groupId,
        name: p.name,
        model: p.model,
        category: p.category,
        totalStock: 0,
        stockStatus: 'out_of_stock',
        minPrice: p.price,
        maxPrice: p.price,
        minCost: cost,
        maxCost: cost,
        variants: [],
      });
    }

    const group = groups.get(groupId)!;
    group.variants.push(p);
    group.totalStock += p.stock;
    if (p.price < group.minPrice) group.minPrice = p.price;
    if (p.price > group.maxPrice) group.maxPrice = p.price;
    if (cost < group.minCost) group.minCost = cost;
    if (cost > group.maxCost) group.maxCost = cost;
  }

  // Calculate overall stock status
  return Array.from(groups.values()).map(group => {
    let status: PhoneModel['stockStatus'] = 'in_stock';
    if (group.totalStock === 0) {
      status = 'out_of_stock';
    } else if (group.totalStock <= 5) { // default threshold check
      status = 'low_stock';
    }
    group.stockStatus = status;
    return group;
  });
}
