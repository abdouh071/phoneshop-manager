import type { StockStatus } from '../types';

/** Single rule behind the stock badge, shared by forms, the local mirror, POS and offline replay. */
export const computeStockStatus = (stock: number, threshold: number): StockStatus => {
  if (stock === 0) return 'out_of_stock';
  if (stock <= threshold) return 'low_stock';
  return 'in_stock';
};
