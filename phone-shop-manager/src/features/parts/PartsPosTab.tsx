import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Eye, Minus, Plus, ShoppingCart, Store, Trash2, User, UserCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { StockBadge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useInventoryStore } from '../../store/inventoryStore';
import { heldBasketDiscountOf, usePartsCartStore } from '../../store/partsCartStore';
import { useAuthStore } from '../../store/authStore';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import {
  DISCOUNT_APPROVAL_PERCENT,
  discountAmountOf,
  discountPercentOf,
  lineDiscountOf,
  requiresDiscountApproval,
  requiresLineDiscountApproval,
  unitPriceAfterDiscount,
} from '../../utils/discountPolicy';
import { groupProductsByBaseModel } from '../../utils/productGrouping';
import type { ProductGroup } from '../../utils/productGrouping';
import { normalizeArabic } from '../../utils/normalizeText';
import { errorMessage } from '../../utils/errorUtils';
import type { CartItem, Customer, CustomerDebtEntry, PaymentMethod, SaleTransaction, SuspendedCart } from '../../types';
import { ReceiptModal } from '../pos/ReceiptModal';
import { CustomerAutocompleteInput } from '../pos/CustomerAutocompleteInput';
import { QuickAddShopModal } from './QuickAddShopModal';
import { B2BPartsCheckoutModal } from './B2BPartsCheckoutModal';
import { PartsInvoiceModal } from './PartsInvoiceModal';
import styles from './Parts.module.css';
import posStyles from '../pos/POS.module.css';
import b2bStyles from './B2BParts.module.css';

interface PartsPosTabProps {
  initialLoading: boolean;
  customerRequest: { customer: Customer; key: string } | null;
  onSelectGroup: (group: ProductGroup) => void;
  onOpenCustomerProfile: (customer: Customer) => void;
}

const ProductCard = memo(function ProductCard({ group, onAdd }: { group: ProductGroup; onAdd: () => void }) {
  const { t } = useTranslation();
  const variant = group.variants[0];
  const metaText = group.variants.length > 1
    ? t('parts.variantCount', '{{count}} variants', { count: group.variants.length })
    : [variant.storage, variant.color].filter(value => value && value !== 'N/A').join(' · ');
  const unavailable = group.stockStatus === 'out_of_stock';

  return (
    <div className={[styles.productCard, unavailable && styles.disabled].filter(Boolean).join(' ')}
      onClick={unavailable ? undefined : onAdd}>
      <div className={styles.productCardTop}>
        <div className={styles.productCardBrand}>{group.name[0]}</div>
        <StockBadge status={group.stockStatus} />
      </div>
      <p className={styles.productCardName}>{group.name} {group.model}</p>
      {metaText && <p className={styles.productCardMeta}>{metaText}</p>}
      <div className={styles.productCardStock}>
        {group.totalStock > 0 ? t('parts.unitsInStock', { count: group.totalStock })
          : <span className={styles.maxReached}>{t('inventory.outOfStock')}</span>}
      </div>
      <p className={styles.productCardPrice}>
        {group.variants.length === 1 ? formatCurrency(variant.price)
          : `${formatCurrency(group.minPrice)} – ${formatCurrency(group.maxPrice)}`}
      </p>
      <button type="button" className={styles.addBtn} disabled={unavailable}
        aria-label={`${t('pos.addToCart')}: ${group.name} ${group.model}`}
        onClick={event => { event.stopPropagation(); onAdd(); }}>
        <Plus size={14} /> {t('common.add')}
      </button>
    </div>
  );
});

export const PartsPosTab = memo(function PartsPosTab({
  initialLoading, customerRequest, onSelectGroup, onOpenCustomerProfile,
}: PartsPosTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { parts, isLoadingParts, error: partsError, fetchParts } = useInventoryStore(useShallow(s => ({
    parts: s.parts, isLoadingParts: s.isLoadingParts, error: s.error, fetchParts: s.fetchParts,
  })));
  const {
    items, customerName, selectedB2BCustomer, discount, suspendedCarts, isCheckingOut, selectedMethod,
    subtotal, total, itemCount, linesConcessionTotal,
    addToCart, removeFromCart, updateQuantity, clearCart, setPayments, setCustomerName, setCustomerPhone,
    setSelectedB2BCustomer, setDiscount, setLineDiscount, checkout, suspendCart, resumeCart, discardSuspendedCart,
  } = usePartsCartStore(useShallow(s => ({
    items: s.items, customerName: s.customerName, selectedB2BCustomer: s.selectedCustomer,
    discount: s.discount, suspendedCarts: s.suspendedCarts, isCheckingOut: s.isCheckingOut,
    selectedMethod: s.payments[0]?.method ?? 'cash',
    subtotal: s.getSubtotal(), total: s.getTotal(), itemCount: s.getItemCount(),
    linesConcessionTotal: s.getLinesConcessionTotal(),
    addToCart: s.addToCart, removeFromCart: s.removeFromCart, updateQuantity: s.updateQuantity,
    clearCart: s.clearCart, setPayments: s.setPayments, setCustomerName: s.setCustomerName,
    setCustomerPhone: s.setCustomerPhone, setSelectedB2BCustomer: s.setSelectedCustomer,
    setDiscount: s.setDiscount, setLineDiscount: s.setLineDiscount, checkout: s.checkout,
    suspendCart: s.suspendCart, resumeCart: s.resumeCart, discardSuspendedCart: s.discardSuspendedCart,
  })));
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  // Re-render private amounts when privacy changes, without subscribing to the whole store.
  usePrivacyStore(s => s.isPrivacyActive);
  const currentAccountDebt = useCustomerStore(s => selectedB2BCustomer
    ? s.getCustomerDebtTotal(selectedB2BCustomer.id)
      || s.customers.find(customer => customer.id === selectedB2BCustomer.id)?.totalDebt
      || selectedB2BCustomer.totalDebt || 0
    : 0);

  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDiscountValue, setPendingDiscountValue] = useState<number | null>(null);
  const [showDiscountUnlock, setShowDiscountUnlock] = useState(false);
  // Keep the exact typed amount rather than rewriting it after unit-price rounding.
  const [lineDiscountText, setLineDiscountText] = useState<Record<string, string>>({});
  const [pendingLine, setPendingLine] = useState<{ productId: string; name: string; amount: number; percent: number } | null>(null);
  const [showLineUnlock, setShowLineUnlock] = useState(false);
  const [completedTx, setCompletedTx] = useState<SaleTransaction | null>(null);
  const [isQuickAddShopOpen, setIsQuickAddShopOpen] = useState(false);
  const [isB2BCheckoutOpen, setIsB2BCheckoutOpen] = useState(false);
  const [completedB2BTx, setCompletedB2BTx] = useState<{
    transaction: SaleTransaction; debtEntry?: CustomerDebtEntry; invoiceNumber: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const checkoutLock = useRef(false);
  const handledCustomerRequest = useRef<string | null>(null);
  const [showSuspended, setShowSuspended] = useState(false);
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<SuspendedCart | null>(null);
  const isLoading = initialLoading || isLoadingParts;
  const isBusy = isProcessing || isCheckingOut;

  // An explicit account object is state-only. Never infer identity from a saved name,
  // and never replay an already-handled link after clear, hold, resume or manual typing.
  useEffect(() => {
    if (!customerRequest || handledCustomerRequest.current === customerRequest.key) return;
    handledCustomerRequest.current = customerRequest.key;
    setSelectedB2BCustomer(customerRequest.customer);
    setCustomerName(customerRequest.customer.name);
    setShowSuspended(false);
  }, [customerRequest, setSelectedB2BCustomer, setCustomerName]);

  // Barcode/variant additions also reset a line's concession in the cart store.
  useEffect(() => {
    setLineDiscountText(previous => {
      const discountedIds = new Set(items.filter(item => item.unitPrice !== undefined).map(item => item.product.id));
      const obsolete = Object.keys(previous).filter(id => !discountedIds.has(id));
      if (!obsolete.length) return previous;
      const next = { ...previous };
      obsolete.forEach(id => { delete next[id]; });
      return next;
    });
  }, [items]);

  const groups = useMemo(() => {
    const words = normalizeArabic(searchQuery).trim().split(/\s+/).filter(Boolean);
    return groupProductsByBaseModel(parts.filter(part => {
      const searchable = normalizeArabic([part.name, part.model, part.sku, part.location, part.supplier, part.notes].filter(Boolean).join(' '));
      return words.every(word => searchable.includes(word));
    }));
  }, [parts, searchQuery]);
  const basketDiscountAmount = discount ? discountAmountOf(subtotal, { mode: discount.type, value: discount.value }) : 0;
  const basketDiscountPercent = discount ? discountPercentOf(subtotal, { mode: discount.type, value: discount.value }) : 0;
  const paymentMethods: { value: PaymentMethod; label: string }[] = [
    { value: 'cash', label: t('pos.payCash') },
    { value: 'card', label: t('pos.payCard') },
    { value: 'mobile', label: t('pos.payMobile') },
  ];

  const forgetLineText = (productId: string) => setLineDiscountText(previous => {
    const next = { ...previous };
    delete next[productId];
    return next;
  });
  const resetDraftUi = () => {
    setSelectedB2BCustomer(null);
    setCustomerPhone('');
    setLineDiscountText({});
    setPendingDiscountValue(null);
    setShowDiscountUnlock(false);
    setPendingLine(null);
    setShowLineUnlock(false);
    setIsB2BCheckoutOpen(false);
    setShowSuspended(false);
  };
  const handleLineDiscount = (item: CartItem, raw: string) => {
    if (isBusy) return;
    const productId = item.product.id;
    if (raw === '') {
      forgetLineText(productId);
      setLineDiscount(productId, 0);
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const charged = unitPriceAfterDiscount(item.product.price, value, item.quantity);
    const { percent } = lineDiscountOf(item.product.price, charged, item.quantity);
    if (requiresLineDiscountApproval(isAdmin ? 'admin' : 'sales_agent', percent)) {
      setPendingLine({ productId, name: `${item.product.name} ${item.product.model || ''}`.trim(), amount: value, percent });
      setShowLineUnlock(true);
      return;
    }
    setLineDiscountText(previous => ({ ...previous, [productId]: raw }));
    setLineDiscount(productId, value);
  };
  const changeLineQuantity = (item: CartItem, quantity: number) => {
    const result = updateQuantity(item.product.id, quantity);
    if (result.success) forgetLineText(item.product.id);
    else if (result.reason === 'max_reached') {
      toast.warning(t('parts.stockLimitReached', 'Stock Limit Reached'),
        t('parts.availableUnits', 'Only {{count}} units available.', { count: result.availableStock }));
    }
  };
  const handleBasketDiscount = (raw: string) => {
    if (isBusy) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (raw === '' || value <= 0) {
      setPendingDiscountValue(null);
      setDiscount(null);
    } else if (requiresDiscountApproval(isAdmin ? 'admin' : 'sales_agent', subtotal, { mode: 'flat', value })) {
      setPendingDiscountValue(value);
      setShowDiscountUnlock(true);
    } else {
      setPendingDiscountValue(null);
      setDiscount({ type: 'flat', value });
    }
  };
  const handleCustomerChange = (name: string, customer?: Customer | null) => {
    if (isBusy) return;
    // Null also means a nonempty manual/name-only entry, not just an empty field.
    setSelectedB2BCustomer(customer ?? null);
    setCustomerPhone(customer?.phone ?? '');
    setCustomerName(name);
    if (customer?.wholesaleDiscountPercent && customer.wholesaleDiscountPercent > 0) {
      // Preserve the registered wholesale promise as a percentage, as in the original POS.
      setDiscount({ type: 'percent', value: customer.wholesaleDiscountPercent });
      toast.success(t('parts.wholesaleDiscountApplied', 'Wholesale Discount Applied'),
        t('parts.wholesaleDiscountAppliedMsg', '{{percent}}% discount applied for {{name}}.', {
          percent: customer.wholesaleDiscountPercent, name: customer.shopName || customer.name,
        }));
    }
  };
  const handleDetachCustomer = () => {
    setSelectedB2BCustomer(null);
    setCustomerPhone('');
    setCustomerName('');
    toast.info(t(selectedB2BCustomer ? 'parts.b2bDetached' : 'parts.customerDetached'),
      t(selectedB2BCustomer ? 'parts.walkInMsg' : 'parts.walkInCustomerMsg'));
  };
  const handleCheckout = async () => {
    if (!items.length || selectedB2BCustomer || isBusy || checkoutLock.current) return;
    checkoutLock.current = true;
    setIsProcessing(true);
    try {
      // Reprice the tender at submission: quantities/discounts may have changed since its button was clicked.
      setPayments([{ method: selectedMethod, amount: total }]);
      const transaction = await checkout();
      if (transaction) {
        resetDraftUi();
        setCompletedTx(transaction);
      }
    } catch (error: unknown) {
      const msg = errorMessage(error) || '';
      if (msg.startsWith('INSUFFICIENT_STOCK')) {
        toast.error(t('parts.insufficientStockTitle'), t('parts.insufficientStock'));
      } else {
        toast.error(t('parts.checkoutFailed'), msg);
      }
    } finally {
      setIsProcessing(false);
      checkoutLock.current = false;
    }
  };

  return (
    <>
      <ConfirmDialog isOpen={confirmClearCart} title={t('parts.clearCartTitle')} message={t('parts.clearCartMsg')}
        confirmLabel={t('parts.clearCartTitle')} variant="danger"
        onConfirm={() => {
          if (isBusy) return;
          clearCart();
          resetDraftUi();
          setConfirmClearCart(false);
        }} onCancel={() => setConfirmClearCart(false)} />
      <ConfirmDialog isOpen={discardTarget !== null} title={t('parts.discardHeldTitle')}
        message={discardTarget ? t('parts.discardHeldMsg', {
          name: discardTarget.customerName || t('parts.walkInCustomer'),
          count: discardTarget.items.reduce((sum, item) => sum + item.quantity, 0),
        }) : ''}
        confirmLabel={t('parts.discard')} variant="danger"
        onConfirm={() => {
          if (discardTarget) discardSuspendedCart(discardTarget.id);
          if (suspendedCarts.length <= 1) setShowSuspended(false);
          setDiscardTarget(null);
        }} onCancel={() => setDiscardTarget(null)} />
      <AdminUnlockModal isOpen={showDiscountUnlock}
        onClose={() => { setShowDiscountUnlock(false); setPendingDiscountValue(null); }}
        onSuccess={() => {
          setShowDiscountUnlock(false);
          if (pendingDiscountValue !== null) {
            setDiscount({ type: 'flat', value: pendingDiscountValue });
            setPendingDiscountValue(null);
            toast.success(t('parts.discountAuthorized', 'Discount Authorized'),
              t('parts.adminAuthorizationVerified', 'Admin authorization verified.'));
          }
        }}
        actionName={t('parts.authorizeBasketDiscount', 'authorize parts discount of {{amount}} ({{percent}}% of the basket)', {
          amount: formatCurrency(pendingDiscountValue ?? 0),
          percent: discountPercentOf(subtotal, { mode: 'flat', value: pendingDiscountValue ?? 0 }).toFixed(1),
        })} />
      <AdminUnlockModal isOpen={showLineUnlock}
        onClose={() => { setShowLineUnlock(false); setPendingLine(null); }}
        onSuccess={() => {
          setShowLineUnlock(false);
          if (pendingLine) {
            const { productId, amount } = pendingLine;
            setLineDiscount(productId, amount);
            setLineDiscountText(previous => ({ ...previous, [productId]: String(amount) }));
            setPendingLine(null);
            toast.success(t('parts.lineDiscountAuthorized', 'Line Discount Authorized'),
              t('parts.adminAuthorizationVerified', 'Admin authorization verified.'));
          }
        }}
        actionName={t('parts.authorizeLineDiscount', 'authorize {{percent}}% off "{{name}}" ({{amount}}) on a parts sale', {
          percent: pendingLine?.percent.toFixed(1) ?? '', name: pendingLine?.name ?? '',
          amount: formatCurrency(pendingLine?.amount ?? 0),
        })} />
      <ReceiptModal transaction={completedTx} onClose={() => setCompletedTx(null)} />
      <QuickAddShopModal isOpen={isQuickAddShopOpen} onClose={() => setIsQuickAddShopOpen(false)}
        onCustomerCreated={customer => {
          setSelectedB2BCustomer(customer);
          setCustomerName(customer.name);
          setIsQuickAddShopOpen(false);
          toast.success(t('parts.b2bAccountAttached', 'B2B Account Attached'),
            t('parts.b2bAccountAttachedMsg', '{{name}} attached to cart.', { name: customer.shopName || customer.name }));
        }} />
      {selectedB2BCustomer && isB2BCheckoutOpen && (
        <B2BPartsCheckoutModal isOpen={isB2BCheckoutOpen} customer={selectedB2BCustomer}
          onClose={() => setIsB2BCheckoutOpen(false)}
          onSuccess={result => { setCompletedB2BTx(result); resetDraftUi(); }} />
      )}
      <PartsInvoiceModal transaction={completedB2BTx?.transaction ?? null} debtEntry={completedB2BTx?.debtEntry}
        onClose={() => setCompletedB2BTx(null)} />

      {/* Named hook for parts-only responsive styling; do not change the shared POS layout. */}
      <div className={`${styles.posContainer} parts-pos-responsive`} style={{ flexWrap: 'wrap' }}>
        <div className={styles.productsPanel} style={{ flex: '999 1 360px' }} aria-busy={isLoading}>
          <div className={styles.catalogCard} style={{ padding: '12px 16px' }}>
            <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('parts.searchPlaceholder')}
              aria-label={t('parts.searchPlaceholder')} className={styles.search} />
          </div>
          {partsError && <div role="alert" className={styles.warningBanner}>
            <AlertCircle size={16} /><span>{t('parts.loadFailed', 'Could not load parts.')}</span>
            <Button size="sm" variant="secondary" disabled={isLoading} onClick={() => { void fetchParts(); }}>{t('parts.retry')}</Button>
          </div>}
          {isLoading && <p role="status">{t('parts.loadingParts')}</p>}
          {!isLoading && !partsError && groups.length === 0 && <EmptyState title={t('parts.noParts')}
            description={searchQuery.trim() ? t('parts.noMatchingParts', 'No parts match your search.') : t('parts.noPartsDesc')} />}
          <div className={styles.productsGrid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
            {groups.map(group => <ProductCard key={group.id} group={group} onAdd={() => {
              if (isBusy) return;
              if (group.variants.length > 1) { onSelectGroup(group); return; }
              const result = addToCart(group.variants[0]);
              if (result.success) forgetLineText(group.variants[0].id);
              else if (result.reason === 'out_of_stock') {
                toast.error(t('parts.outOfStockToast'), `${group.name} ${group.model} ${t('parts.hasNoUnits')}`);
              } else {
                toast.warning(t('parts.stockLimitReached', 'Stock Limit Reached'),
                  t('parts.availableUnits', 'Only {{count}} units available.', { count: result.availableStock }));
              }
            }} />)}
          </div>
        </div>

        <div className={posStyles.cartPanel} style={{ flex: '1 1 370px', maxWidth: '100%' }} aria-busy={isBusy}>
          <div className={posStyles.cartHeader}>
            <div className={posStyles.cartTitle}>
              <ShoppingCart size={20} /><span>{t('parts.cart')}</span>
              {itemCount > 0 && <span className={posStyles.cartCount}>{itemCount}</span>}
              {suspendedCarts.length > 0 && <button type="button" className={posStyles.suspendedBadge}
                aria-expanded={showSuspended} onClick={() => setShowSuspended(value => !value)}>
                {t('parts.onHold', { count: suspendedCarts.length })}
              </button>}
            </div>
            {(items.length > 0 || customerName || selectedB2BCustomer || discount) &&
              <button type="button" className={posStyles.clearBtn} disabled={isBusy} onClick={() => setConfirmClearCart(true)}>{t('parts.clear')}</button>}
          </div>

          {selectedB2BCustomer && !showSuspended ? (
            <div className={b2bStyles.accountCard} style={{ margin: '8px 12px 0' }}>
              <div className={b2bStyles.accountCardHeader}>
                <div className={b2bStyles.accountTitleGroup}>
                  <div className={b2bStyles.shopIconBadge}><Store size={18} /></div>
                  <div className={b2bStyles.shopInfo}>
                    <span className={b2bStyles.shopName}>{selectedB2BCustomer.shopName || selectedB2BCustomer.name}</span>
                    <span className={b2bStyles.ownerName}>{selectedB2BCustomer.name} · {selectedB2BCustomer.phone}</span>
                  </div>
                </div>
                <button type="button" className={posStyles.detachCustomerBtn} disabled={isBusy} onClick={handleDetachCustomer}
                  title={t('parts.detachCustomer', 'Detach customer')} aria-label={t('parts.detachCustomer', 'Detach customer')}><X size={14} /></button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>{t('parts.currentAccountDebt')}</span>
                <strong style={{ color: currentAccountDebt > 0 ? '#dc2626' : '#16a34a' }}>{formatPrivateCurrency(currentAccountDebt)}</strong>
              </div>
              <button type="button" onClick={() => onOpenCustomerProfile(selectedB2BCustomer)}
                style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', textAlign: 'start', padding: '2px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Eye size={12} /> {t('parts.openCustomerProfile', 'Open 360° Profile & Statement')}
              </button>
            </div>
          ) : customerName && !showSuspended ? (
            <div className={posStyles.attachedCustomerCard} style={{ margin: '8px 12px 0' }}>
              <div className={posStyles.attachedCustomerLeft}>
                <div className={posStyles.attachedCustomerAvatar}><User size={14} /></div>
                <div className={posStyles.attachedCustomerInfo}>
                  <span className={posStyles.attachedCustomerShop}>{t('parts.customerAttached', 'Customer Attached')}</span>
                  <span className={posStyles.attachedCustomerName}>{customerName}</span>
                </div>
              </div>
              <button type="button" className={posStyles.detachCustomerBtn} disabled={isBusy} onClick={handleDetachCustomer}
                title={t('parts.detachCustomer', 'Detach customer')} aria-label={t('parts.detachCustomer', 'Detach customer')}><X size={13} /></button>
            </div>
          ) : null}

          {showSuspended && suspendedCarts.length > 0 && <div className={posStyles.suspendedList}>
            <div className={posStyles.suspendedListHeader}>
              <span>{t('parts.heldCarts')}</span>
              <button type="button" className={posStyles.backToCartBtn} aria-label={t('common.close')} onClick={() => setShowSuspended(false)}><X size={14} /></button>
            </div>
            {suspendedCarts.map(cart => {
              const heldSubtotal = cart.items.reduce((sum, item) => sum + (item.unitPrice ?? item.product.price) * item.quantity, 0);
              const heldTotal = Math.max(0, heldSubtotal - heldBasketDiscountOf(cart.items, cart.discount));
              return <div key={cart.id} className={posStyles.suspendedCard}>
                <div className={posStyles.suspendedCustomerInfo}>
                  <span className={posStyles.suspendedCustomerName}>{cart.customerName || t('parts.walkInCustomer')}</span>
                  <span className={posStyles.suspendedTime}>{t('common.quantity')}: {cart.items.reduce((sum, item) => sum + item.quantity, 0)} · {formatCurrency(heldTotal)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button size="sm" disabled={isBusy} onClick={() => {
                    const result = resumeCart(cart.id);
                    if (result.success) resetDraftUi();
                    result.warnings?.forEach(warning => toast.warning(t('parts.stockLevelAlert'), warning));
                  }}>{t('parts.resume')}</Button>
                  <button type="button" className={posStyles.removeBtn} aria-label={t('parts.discardHeldTitle')}
                    onClick={() => setDiscardTarget(cart)}><Trash2 size={14} /></button>
                </div>
              </div>;
            })}
          </div>}

          <div className={posStyles.cartItems}>
            {items.length === 0 ? <div className={posStyles.emptyCart}>
              {selectedB2BCustomer ? <>
                <div className={posStyles.customerEmptyIconWrap} style={{ background: '#eff6ff', color: '#2563eb' }}><Store size={30} /></div>
                <p className={posStyles.emptyCartTitle}>{t('parts.b2bAccountAttached', 'B2B Account Attached')}</p>
                <p className={posStyles.attachedCustomerHighlight}>{selectedB2BCustomer.shopName || selectedB2BCustomer.name}</p>
                <p className={posStyles.emptyCartSub}>{t('parts.selectPartsForAccount', 'Select repair parts to dispatch or charge to this account.')}</p>
              </> : customerName ? <>
                <div className={posStyles.customerEmptyIconWrap}><UserCheck size={30} /></div>
                <p className={posStyles.emptyCartTitle}>{t('parts.customerAttached', 'Customer Attached')}</p>
                <p className={posStyles.attachedCustomerHighlight}>{customerName}</p>
                <p className={posStyles.emptyCartSub}>{t('parts.selectPartsToSell', 'Select parts from the catalog to add items to this sale.')}</p>
              </> : <>
                <ShoppingCart size={40} className={posStyles.emptyCartIcon} />
                <p>{t('pos.emptyCart')}</p>
                <span>{t('parts.selectPartsToSell', 'Select parts from the catalog to add items to this sale.')}</span>
              </>}
            </div> : items.map(item => {
              const charged = item.unitPrice ?? item.product.price;
              const concession = lineDiscountOf(item.product.price, charged, item.quantity);
              const gated = requiresLineDiscountApproval(isAdmin ? 'admin' : 'sales_agent', concession.percent);
              return <div key={item.product.id} className={posStyles.cartItem}>
                <div className={posStyles.cartItemInfo}>
                  <p className={posStyles.cartItemName}>{item.product.name} {item.product.model}</p>
                  <p className={posStyles.cartItemMeta}>
                    {t('pos.unitPrice')}: {formatCurrency(charged)}
                    {concession.granted > 0 && <span style={{ marginInlineStart: 6, fontWeight: 700, color: gated ? '#b45309' : '#dc2626' }}>
                      −{concession.percent.toFixed(1)}%
                    </span>}
                  </p>
                  <input type="number" min="0" step="1" disabled={isBusy}
                    value={lineDiscountText[item.product.id] ?? (concession.granted > 0 ? String(Math.round(concession.granted * 100) / 100) : '')}
                    onChange={event => handleLineDiscount(item, event.target.value)} placeholder={t('common.discount')}
                    aria-label={`${t('common.discount')}: ${item.product.name} ${item.product.model || ''}`.trim()}
                    title={t('parts.lineDiscountHint', 'Dinars off this line. Over {{percent}}% of its value needs an admin.', { percent: DISCOUNT_APPROVAL_PERCENT })}
                    style={{ marginTop: 4, width: 110, maxWidth: '100%', padding: '3px 6px', fontSize: 12, borderRadius: 6, border: `1px solid ${gated ? '#f59e0b' : '#d1d5db'}` }} />
                </div>
                <div className={posStyles.cartItemControls}>
                  <button type="button" className={posStyles.qtyBtn} disabled={isBusy}
                    aria-label={t('parts.decreaseQuantity', 'Decrease quantity')} onClick={() => changeLineQuantity(item, item.quantity - 1)}><Minus size={12} /></button>
                  <span className={posStyles.qty}>{item.quantity}</span>
                  <button type="button" className={posStyles.qtyBtn} disabled={isBusy || item.quantity >= item.product.stock}
                    aria-label={t('parts.increaseQuantity', 'Increase quantity')} onClick={() => changeLineQuantity(item, item.quantity + 1)}><Plus size={12} /></button>
                  <button type="button" className={posStyles.removeBtn} disabled={isBusy} aria-label={t('pos.removeItem')}
                    onClick={() => { removeFromCart(item.product.id); forgetLineText(item.product.id); }}><Trash2 size={14} /></button>
                </div>
              </div>;
            })}
          </div>

          {items.length > 0 && <div className={posStyles.cartFooter}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CustomerAutocompleteInput accountType="shop_repairer" label={t('pos.customer')}
                  placeholder={t('parts.searchShop', 'Search phone shop or repairer...')}
                  value={customerName} onChange={handleCustomerChange} />
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={isBusy}
                style={{ height: 40, padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' }} leftIcon={<Store size={14} />}
                onClick={() => setIsQuickAddShopOpen(true)} title={t('parts.quickAdd.quickAddTitle')}>
                {t('parts.addShop', '+ Shop')}
              </Button>
            </div>
            <div className={posStyles.totalRow}><span>{t('common.subtotal')}</span><span>{formatCurrency(subtotal)}</span></div>
            {linesConcessionTotal > 0 && <div className={posStyles.totalRow}
              title={t('parts.lineConcessionsHint', 'Already deducted from line prices and the subtotal above; not deducted twice.')}>
              <span>{t('parts.lineConcessions', 'Given away on lines')}</span><span style={{ color: '#dc2626' }}>{formatCurrency(linesConcessionTotal)}</span>
            </div>}
            <div className={posStyles.discountRowCompact}>
              <span className={posStyles.discountLabel}>{t('common.discount')}{pendingDiscountValue === null && discount?.type === 'percent' ? ' (%)' : ''}</span>
              <input type="number" min="0" max={subtotal} disabled={isBusy} aria-label={t('common.discount')}
                title={pendingDiscountValue === null && discount?.type === 'percent'
                  ? t('parts.wholesaleDiscountHint', 'A promise of {{percent}}% of the basket; it follows the basket total. Typing here replaces it with dinars.', { percent: discount.value })
                  : t('parts.basketDiscountHint', 'Dinars off the basket. More than {{percent}}% needs an admin.', { percent: DISCOUNT_APPROVAL_PERCENT })}
                value={pendingDiscountValue !== null ? String(pendingDiscountValue) : (discount?.value ? String(discount.value) : '')}
                onChange={event => handleBasketDiscount(event.target.value)} placeholder="0" className={posStyles.discountInputCompact} />
            </div>
            {basketDiscountAmount > 0 && <div className={posStyles.totalRow} style={{ color: '#dc2626' }}>
              <span>{t('common.discount')} ({basketDiscountPercent.toFixed(1)}%)</span><span>−{formatCurrency(basketDiscountAmount)}</span>
            </div>}
            <div className={`${posStyles.totalRow} ${posStyles.grandTotal}`}><span>{t('common.total')}</span><span>{formatCurrency(total)}</span></div>
            {!selectedB2BCustomer ? <div className={posStyles.paymentMethods} role="group" aria-label={t('pos.paymentMethod')}>
              <span>{t('pos.paymentMethod')}</span>
              <div className={posStyles.payBtns}>
                {paymentMethods.map(method => <button key={method.value} type="button" disabled={isBusy}
                  className={[posStyles.payBtn, selectedMethod === method.value && posStyles.payActive].filter(Boolean).join(' ')}
                  aria-pressed={selectedMethod === method.value} onClick={() => setPayments([{ method: method.value, amount: total }])}>
                  {method.label}
                </button>)}
              </div>
            </div> : <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, fontSize: 12, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Store size={14} style={{ color: '#2563eb', flexShrink: 0 }} /><span>{t('parts.b2bSettlementNote')}</span>
            </div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button variant="secondary" disabled={isBusy} onClick={() => { suspendCart(); resetDraftUi(); }} style={{ flex: 1 }}>{t('parts.holdCart')}</Button>
              {selectedB2BCustomer ? <Button onClick={() => setIsB2BCheckoutOpen(true)} isLoading={isBusy} disabled={isBusy}
                style={{ flex: 2, background: '#1d4ed8' }} leftIcon={<Store size={16} />}>
                {t('parts.processB2b', { total: formatCurrency(total) })}
              </Button> : <Button onClick={handleCheckout} isLoading={isBusy} disabled={isBusy} style={{ flex: 2 }}>
                {t('parts.checkout', { total: formatCurrency(total) })}
              </Button>}
            </div>
          </div>}
        </div>
      </div>
    </>
  );
});
