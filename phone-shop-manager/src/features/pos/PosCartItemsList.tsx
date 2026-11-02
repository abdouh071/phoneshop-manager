import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { CartItem, PhoneModel } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import styles from './POS.module.css';

interface PosCartItemsListProps {
  items: CartItem[];
  allProducts: PhoneModel[];
  updateQuantity: (productId: string, quantity: number, isReturn?: boolean) => { success: boolean; reason?: 'max_reached'; availableStock?: number };
  removeFromCart: (productId: string, isReturn?: boolean) => void;
  setTouchQtyTarget: React.Dispatch<React.SetStateAction<{ item: CartItem; maxStock: number; isReturn: boolean } | null>>;
}

export const PosCartItemsList: React.FC<PosCartItemsListProps> = ({
  items,
  allProducts,
  updateQuantity,
  removeFromCart,
  setTouchQtyTarget,
}) => {
  return (
    <>
      {items.map(item => {
        const liveProduct = allProducts.find(p => p.id === item.product.id);
        const isMaxReached = !item.isReturn && (liveProduct ? liveProduct.stock <= item.quantity : true);
        const isReturn = Boolean(item.isReturn);
        const unitPrice = item.customReturnPrice !== undefined ? item.customReturnPrice : item.product.price;
        const lineTotal = unitPrice * item.quantity;

        return (
        <div
          key={`${item.product.id}-${isReturn ? 'return' : 'sale'}`}
          className={[styles.cartItem, isReturn && styles.returnCartItem].filter(Boolean).join(' ')}
        >
          <div className={styles.cartItemInfo}>
            <p className={styles.cartItemName}>
              {isReturn && <span className={styles.returnBadge}>🔄 RETURN</span>}
              {item.product.name} {item.product.model}
            </p>
            <p className={styles.cartItemMeta}>
              {[item.product.storage, item.product.color].filter(Boolean).join(' · ')} {item.product.storage || item.product.color ? '· ' : ''}
              <span style={{ fontWeight: 600 }}>
                {isReturn ? `-${formatCurrency(unitPrice)}` : formatCurrency(unitPrice)}
              </span>
              {isReturn && item.restock !== false && (
                <span className={styles.returnRestockPill}>+1 Stock</span>
              )}
              {isReturn && item.returnReason && (
                <span style={{ fontSize: '10px', color: '#92400e', display: 'block', marginTop: '1px' }}>
                  {item.returnReason}
                </span>
              )}
            </p>
          </div>
          <div className={styles.cartItemControls}>
            <button
              className={styles.qtyBtn}
              onClick={() => updateQuantity(item.product.id, item.quantity - 1, isReturn)}
              title="Decrease quantity"
            >
              <Minus size={11} />
            </button>
            <span
              className={[styles.qty, styles.qtyTouchClickable].join(' ')}
              onClick={() => {
                setTouchQtyTarget({
                  item,
                  maxStock: isReturn ? 999 : (liveProduct ? liveProduct.stock : 999),
                  isReturn,
                });
              }}
              title="Click/tap to enter exact quantity via numeric keypad"
            >
              {item.quantity}
            </span>
            <button
              className={styles.qtyBtn}
              onClick={() => updateQuantity(item.product.id, item.quantity + 1, isReturn)}
              disabled={isMaxReached}
              title={isMaxReached ? 'Max stock reached' : 'Increase quantity'}
            >
              <Plus size={11} />
            </button>
          </div>
          <div className={styles.cartItemRight}>
            <p className={[styles.cartItemTotal, isReturn && styles.returnPriceNegative].filter(Boolean).join(' ')}>
              {isReturn ? `-${formatCurrency(lineTotal)}` : formatCurrency(lineTotal)}
            </p>
            <button
              className={styles.removeBtn}
              onClick={() => removeFromCart(item.product.id, isReturn)}
              title="Remove item"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )})}
    </>
  );
};
