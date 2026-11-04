import React from 'react';
import { Clock, ArrowLeft, Search, X, User, Trash2 } from 'lucide-react';
import type { SuspendedCart } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { cartTotalsOf } from '../../store/cartStore';
import styles from './POS.module.css';

interface PosSuspendedCartListProps {
  suspendedCount: number;
  filteredSuspendedCarts: SuspendedCart[];
  heldSearchQuery: string;
  setHeldSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onBackToCart: () => void;
  onResume: (cart: SuspendedCart) => void;
  onDiscard: (cart: SuspendedCart) => void;
}

export const PosSuspendedCartList: React.FC<PosSuspendedCartListProps> = ({
  suspendedCount,
  filteredSuspendedCarts,
  heldSearchQuery,
  setHeldSearchQuery,
  onBackToCart,
  onResume,
  onDiscard,
}) => {
  return (
    <div className={styles.suspendedList}>
      <div className={styles.suspendedListHeader}>
        <div className={styles.suspendedListTitle}>
          <Clock size={16} />
          <span>Held Carts ({suspendedCount})</span>
        </div>
        <button 
          className={styles.backToCartBtn}
          onClick={onBackToCart}
        >
          <ArrowLeft size={13} /> Back to Cart
        </button>
      </div>

      {/* Search Bar for Held Carts */}
      <div className={styles.heldSearchBar}>
        <Search size={14} className={styles.heldSearchIcon} />
        <input
          type="text"
          placeholder="Search customer or item..."
          value={heldSearchQuery}
          onChange={e => setHeldSearchQuery(e.target.value)}
          className={styles.heldSearchInput}
        />
        {heldSearchQuery && (
          <button
            className={styles.heldSearchClear}
            onClick={() => setHeldSearchQuery('')}
            title="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {filteredSuspendedCarts.length === 0 ? (
        <div className={styles.noHeldResults}>
          <Search size={22} className={styles.noHeldResultsIcon} />
          <p className={styles.noHeldResultsText}>No held carts matching "{heldSearchQuery}"</p>
          <button 
            className={styles.clearSearchBtn}
            onClick={() => setHeldSearchQuery('')}
          >
            Clear Filter
          </button>
        </div>
      ) : (
        filteredSuspendedCarts.map(cart => {
          const { discountAmount, total } = cartTotalsOf(cart.items, cart.discount);
          const totalUnits = cart.items.reduce((sum, i) => sum + i.quantity, 0);
          return (
            <div key={cart.id} className={styles.suspendedCard}>
              <div className={styles.suspendedCardTop}>
                <div className={styles.suspendedCustomerInfo}>
                  <div className={styles.customerAvatar}>
                    <User size={13} />
                  </div>
                  <div>
                    <div className={styles.suspendedCustomerName}>
                      {cart.customerName || 'Walk-in Customer'}
                    </div>
                    <div className={styles.suspendedTime}>
                      <Clock size={11} /> {new Date(cart.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {totalUnits} {totalUnits === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                </div>
                <div className={styles.suspendedCardTotalBadge}>
                  {formatCurrency(total)}
                </div>
              </div>

              {/* Order Summary Item Breakdown */}
              <div className={styles.suspendedItemsSummary}>
                {cart.items.map((item, idx) => (
                  <div key={idx} className={styles.suspendedItemRow}>
                    <span className={styles.suspendedItemQtyBadge}>{item.quantity}x</span>
                    <span className={styles.suspendedItemName}>
                      {item.product.name} {item.product.model}
                      {item.product.storage ? ` (${item.product.storage})` : ''}
                      {item.product.color ? ` • ${item.product.color}` : ''}
                    </span>
                    <span className={styles.suspendedItemPrice}>
                      {item.isReturn
                        ? `−${formatCurrency((item.customReturnPrice ?? item.product.price) * item.quantity)}`
                        : formatCurrency(item.product.price * item.quantity)}
                    </span>
                  </div>
                ))}
                {discountAmount > 0 && (
                  <div className={styles.suspendedDiscountRow}>
                    <span>
                      Discount Applied{cart.discount?.type === 'percent' ? ` (${cart.discount.value}%)` : ''}
                    </span>
                    <span>−{formatCurrency(discountAmount)}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className={styles.suspendedCardActions}>
                <button 
                  className={styles.discardBtn} 
                  onClick={() => onDiscard(cart)}
                  title="Discard this held cart"
                >
                  <Trash2 size={13} /> Discard
                </button>
                <button 
                  className={styles.resumeBtn} 
                  onClick={() => onResume(cart)}
                  title="Resume this cart"
                >
                  Resume
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
