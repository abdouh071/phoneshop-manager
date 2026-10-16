import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Minus, Trash2, ShoppingCart, CheckCircle, X, Scan, Clock, User, UserCheck, ArrowLeft, Search, LayoutGrid, List, BadgeDollarSign, BookOpen, AlertCircle, RefreshCw, Zap, ChevronDown } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SearchInput, Input } from '../../components/ui/Input';
import { StockBadge } from '../../components/ui/Badge';
import { useInventoryStore } from '../../store/inventoryStore';
import { useCartStore } from '../../store/cartStore';
import { useCustomerStore } from '../../store/customerStore';
import { ReceiptModal } from './ReceiptModal';
import { TransactionHistoryTab } from './TransactionHistoryTab';
import { VariantSelectModal } from './VariantSelectModal';
import { CashDrawerModal } from './CashDrawerModal';
import { ReturnExchangeModal } from './ReturnExchangeModal';
import { CustomerAutocompleteInput } from './CustomerAutocompleteInput';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import type { PaymentMethod, SaleTransaction, SuspendedCart, PhoneModel } from '../../types';
import { groupProductsByBaseModel } from '../../utils/productGrouping';
import type { ProductGroup } from '../../utils/productGrouping';
import styles from './POS.module.css';
import { formatCurrency, getCurrencySymbol } from '../../utils/formatCurrency';
import { useSettingsStore } from '../../store/settingsStore';
import { EndOfDayButton } from '../endofday/EndOfDayButton';

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'smartphone': return '📱';
    case 'tablet': return '📟';
    case 'wearable': return '⌚';
    case 'accessory': return '⚡';
    default: return '📦';
  }
};

const ProductCard: React.FC<{
  group: ProductGroup;
  onAdd: (variant?: PhoneModel) => void;
  onSelectVariant: () => void;
}> = ({ group, onAdd, onSelectVariant }) => {
  const isOutOfStock = group.stockStatus === 'out_of_stock' || group.totalStock <= 0;
  const isLowStock = group.stockStatus === 'low_stock' && !isOutOfStock;
  const hasMultipleVariants = group.variants.length > 1;

  return (
    <div
      className={[styles.productCard, isOutOfStock && styles.cardOutOfStock].filter(Boolean).join(' ')}
      onClick={() => {
        if (isOutOfStock) return;
        if (hasMultipleVariants) {
          onSelectVariant();
        } else {
          onAdd(group.variants[0]);
        }
      }}
    >
      {/* Top Header Row: Category Badge + Stock Pill */}
      <div className={styles.cardHeaderRow}>
        <span className={styles.categoryPill}>
          <span className={styles.categoryIcon}>{getCategoryIcon(group.category)}</span>
          <span className={styles.categoryName}>{group.name}</span>
        </span>

        {isOutOfStock ? (
          <span className={styles.stockPillOut}>
            <span className={styles.stockDotOut} /> Out
          </span>
        ) : isLowStock ? (
          <span className={styles.stockPillLow}>
            <span className={styles.stockDotLow} /> {group.totalStock} left
          </span>
        ) : (
          <span className={styles.stockPillIn}>
            <span className={styles.stockDotIn} /> {group.totalStock} left
          </span>
        )}
      </div>

      {/* Main Info */}
      <div className={styles.cardBody}>
        <h4 className={styles.productCardName}>{group.name} {group.model}</h4>

        {/* Variants display / mini-chips */}
        <div className={styles.variantChipsContainer}>
          {hasMultipleVariants ? (
            <div className={styles.multiVariantRow}>
              {group.variants.slice(0, 3).map((v, i) => (
                <button
                  key={v.id || i}
                  type="button"
                  className={styles.miniVariantChip}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(v);
                  }}
                  disabled={v.stock <= 0}
                  title={`Add ${v.storage || ''} ${v.color || ''} (${formatCurrency(v.price)})`}
                >
                  {v.storage || v.color || `V${i + 1}`}
                </button>
              ))}
              {group.variants.length > 3 && (
                <span className={styles.moreVariantsCount}>
                  +{group.variants.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className={styles.singleVariantMeta}>
              {[group.variants[0]?.storage, group.variants[0]?.color, group.variants[0]?.location ? `📍 ${group.variants[0]?.location}` : null].filter(Boolean).join(' · ') || 'Standard'}
            </span>
          )}
        </div>
      </div>

      {/* Bottom Integrated Price & Action Footer */}
      <div className={styles.cardFooterBar}>
        <div className={styles.cardPriceBlock}>
          <span className={styles.priceLabel}>Price</span>
          <span className={styles.productCardPrice}>
            {hasMultipleVariants && group.minPrice !== group.maxPrice
              ? `${formatCurrency(group.minPrice)} - ${formatCurrency(group.maxPrice)}`
              : formatCurrency(group.variants[0]?.price || group.minPrice)}
          </span>
        </div>

        <button
          type="button"
          className={styles.addBtn}
          disabled={isOutOfStock}
          onClick={(e) => {
            e.stopPropagation();
            if (hasMultipleVariants) {
              onSelectVariant();
            } else {
              onAdd(group.variants[0]);
            }
          }}
          title={hasMultipleVariants ? 'Choose Variant' : 'Add to Cart'}
        >
          {hasMultipleVariants ? (
            <><span>Options</span> <Plus size={14} /></>
          ) : (
            <><span>Add</span> <Plus size={15} /></>
          )}
        </button>
      </div>
    </div>
  );
};

const ProductListItem: React.FC<{
  group: ProductGroup;
  onAdd: (variant?: PhoneModel) => void;
  onSelectVariant: () => void;
}> = ({ group, onAdd, onSelectVariant }) => {
  const isOutOfStock = group.stockStatus === 'out_of_stock' || group.totalStock <= 0;
  const isLowStock = group.stockStatus === 'low_stock' && !isOutOfStock;
  const hasMultipleVariants = group.variants.length > 1;

  return (
    <div
      className={[styles.denseRow, isOutOfStock && styles.denseRowDisabled].filter(Boolean).join(' ')}
      onClick={() => {
        if (isOutOfStock) return;
        if (hasMultipleVariants) onSelectVariant();
        else onAdd(group.variants[0]);
      }}
    >
      <div className={styles.denseBrandCol}>
        <span className={styles.denseCategoryIcon}>{getCategoryIcon(group.category)}</span>
        <span className={styles.denseBrandName}>{group.name}</span>
      </div>

      <div className={styles.denseTitleCol}>
        <span className={styles.denseProductName}>{group.name} {group.model}</span>
        <span className={styles.denseVariantsSummary}>
          {hasMultipleVariants
            ? `${group.variants.length} Variants (${group.variants.map(v => v.storage || v.color).filter(Boolean).slice(0, 3).join(', ')}${group.variants.length > 3 ? '...' : ''})`
            : [group.variants[0]?.storage, group.variants[0]?.color, group.variants[0]?.sku].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div className={styles.denseStockCol}>
        {isOutOfStock ? (
          <span className={styles.stockPillOut}><span className={styles.stockDotOut} /> Out</span>
        ) : isLowStock ? (
          <span className={styles.stockPillLow}><span className={styles.stockDotLow} /> {group.totalStock} left</span>
        ) : (
          <span className={styles.stockPillIn}><span className={styles.stockDotIn} /> {group.totalStock} left</span>
        )}
      </div>

      <div className={styles.densePriceCol}>
        <span className={styles.densePriceText}>
          {hasMultipleVariants && group.minPrice !== group.maxPrice
            ? `${formatCurrency(group.minPrice)} - ${formatCurrency(group.maxPrice)}`
            : formatCurrency(group.variants[0]?.price || group.minPrice)}
        </span>
      </div>

      <div className={styles.denseActionCol}>
        <button
          type="button"
          className={styles.denseAddBtn}
          disabled={isOutOfStock}
          onClick={(e) => {
            e.stopPropagation();
            if (hasMultipleVariants) onSelectVariant();
            else onAdd(group.variants[0]);
          }}
        >
          <Plus size={14} /> {hasMultipleVariants ? 'Select' : 'Add'}
        </button>
      </div>
    </div>
  );
};

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: '💵 Cash' },
];

export const POSPage = () => {
  const { fetchProducts, products: allProducts } = useInventoryStore();
  const [searchQuery, setSearchQuery] = useState('');
  const {
    items, addToCart, addReturnItem, removeFromCart, updateQuantity, clearCart,
    setPayments, setCustomerName, setCustomerPhone, setDiscount, checkout,
    payments, customerName, customerPhone, discount,
    getSubtotal, getPurchasesSubtotal, getReturnsSubtotal, hasReturnItems,
    getDiscountAmount, getTotal, getItemCount,
    suspendedCarts, suspendCart, resumeCart, discardSuspendedCart, fetchCarts,
    fetchTransactions, transactions,
    isCheckingOut
  } = useCartStore();
  const { currency } = useSettingsStore();
  const currencySymbol = getCurrencySymbol(currency);
  const toast = useToast();

  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'products' | 'history'>('products');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [completedTx, setCompletedTx] = useState<SaleTransaction | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null);
  const [showSuspended, setShowSuspended] = useState(false);
  const [isCashDrawerOpen, setIsCashDrawerOpen] = useState(false);
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [showReturnModal, setShowReturnModal] = useState(false);
  // Problem 6 fix: Configurable surplus refund settlement method
  const [surplusRefundMethod, setSurplusRefundMethod] = useState<'cash' | 'store_credit' | 'debt_deduction'>('cash');
  const [applyStoreCredit, setApplyStoreCredit] = useState(false);
  const [heldSearchQuery, setHeldSearchQuery] = useState('');
  const [deepLinkSearch, setDeepLinkSearch] = useState('');
  const [deepLinkFocusId, setDeepLinkFocusId] = useState('');

  // Payment method selection ('cash' | 'mobile' | 'card' | 'debt') (Problem 11 fix)
  const [paymentMode, setPaymentMode] = useState<'cash' | 'mobile' | 'card' | 'debt'>('cash');
  // Partial payment: how much the buyer pays upfront when using Credit Tab
  const [downPayment, setDownPayment] = useState<number>(0);
  // Track whether a customer was explicitly selected (not just typed)
  const [customerAttached, setCustomerAttached] = useState(false);

  // Problem 2 fix: Admin unlock and override for Credit Limit
  const [creditLimitOverrideApproved, setCreditLimitOverrideApproved] = useState(false);
  const [showCreditLimitUnlock, setShowCreditLimitUnlock] = useState(false);

  // Problem 5 fix: Large Manual Discount Admin Authorization
  const [pendingDiscountValue, setPendingDiscountValue] = useState<number | null>(null);
  const [showDiscountUnlock, setShowDiscountUnlock] = useState(false);

  // Hardware barcode scanner pulse state
  const [scannerScanned, setScannerScanned] = useState(false);
  // Cash Tendered & Change Due Calculator
  const [cashTendered, setCashTendered] = useState<number | string>('');

  // Local processing state and synchronous lock to prevent duplicate checkouts
  const [isProcessing, setIsProcessing] = useState(false);
  const checkoutLock = useRef(false);
  const isBusy = isProcessing || isCheckingOut;

  const { customers, fetchCustomers } = useCustomerStore();

  // Fetch transactions and customers on mount
  useEffect(() => {
    fetchTransactions();
    fetchCustomers();
  }, [fetchTransactions, fetchCustomers]);

  // Find attached customer details (including current debt balance) - strictly when customer is attached
  const matchedCustomer = useMemo(() => {
    if (!customerAttached || !customerName || !customerName.trim()) return null;
    const q = customerName.toLowerCase().trim();
    return customers.find(c => c.name.toLowerCase().trim() === q) || null;
  }, [customers, customerName, customerAttached]);

  // Current active debt balance of matched customer
  const currentCustomerDebt = useMemo(() => {
    if (!matchedCustomer) return 0;
    return useCustomerStore.getState().getCustomerDebtTotal(matchedCustomer.id);
  }, [matchedCustomer, customers]);

  // Credit debt amount that would be logged if this sale completes
  const creditDebtToLog = useMemo(() => {
    if (paymentMode !== 'debt') return 0;
    const clampedDown = Math.min(Math.max(downPayment || 0, 0), netPayable);
    return Math.max(0, netPayable - clampedDown);
  }, [paymentMode, downPayment, netPayable]);

  // Problem 2 fix: Real-time credit limit breach check
  const isCreditLimitExceeded = useMemo(() => {
    if (paymentMode !== 'debt' || !matchedCustomer?.creditLimit || matchedCustomer.creditLimit <= 0) return false;
    return (currentCustomerDebt + creditDebtToLog) > matchedCustomer.creditLimit;
  }, [paymentMode, matchedCustomer, currentCustomerDebt, creditDebtToLog]);

  // Real-time Today Net Cash in Drawer
  const todayNetCash = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTxs = transactions.filter(t => new Date(t.date).toISOString().split('T')[0] === todayStr);
    const completed = todayTxs.filter(t => t.status !== 'refunded');
    const refunded = todayTxs.filter(t => t.status === 'refunded');
    const gross = completed.reduce((sum, t) => sum + t.total, 0);
    const ref = refunded.reduce((sum, t) => sum + t.total, 0);
    return Math.max(0, gross - ref);
  }, [transactions]);

  // Net payable amount after applying store credit (if active)
  const netPayable = useMemo(() => {
    const total = getTotal();
    const availableCredit = (applyStoreCredit && matchedCustomer?.storeCredit) ? matchedCustomer.storeCredit : 0;
    const creditToUse = Math.min(availableCredit, Math.max(0, total));
    return Math.max(0, total - creditToUse);
  }, [getTotal, applyStoreCredit, matchedCustomer]);

  // Dynamic quick tender denomination presets for Cash checkout
  const tenderPresets = useMemo(() => {
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
  }, [netPayable]);

  // Fast-Lane Speed-Dial items: high-turnover in-stock items (accessories preferred)
  const speedDialItems = useMemo(() => {
    const inStock = allProducts.filter(p => p.stock > 0 && p.category !== 'repair_part');
    const accessories = inStock.filter(p => p.category === 'accessory');
    const pool = accessories.length >= 6 ? accessories : [...accessories, ...inStock.filter(p => p.category !== 'accessory')];
    return pool.slice(0, 6);
  }, [allProducts]);

  // Hardware barcode scanner listener
  const barcodeBuffer = useRef('');
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddToCart = useCallback((product: import('../../types').PhoneModel, productLabel?: string) => {
    const result = addToCart(product);
    const label = productLabel || `${product.name} ${product.model}`.trim();
    if (!result.success) {
      if (result.reason === 'out_of_stock') {
        toast.error('Out of Stock', `${label} has no units left.`);
      } else if (result.reason === 'max_reached') {
        toast.warning('Stock Limit Reached', `Only ${result.availableStock} unit${result.availableStock === 1 ? '' : 's'} of ${label} available.`);
      }
    }
    return result;
  }, [addToCart, toast]);

  const handleBarcodeInput = useCallback((sku: string) => {
    setScannerScanned(true);
    setTimeout(() => setScannerScanned(false), 1200);

    const product = allProducts.find(p => p.sku.toLowerCase() === sku.toLowerCase());
    if (product) {
      // Safety net — server already excludes repair parts from POS products
      if (product.category === 'repair_part') {
        toast.error('Invalid Product', 'Repair parts cannot be sold via POS.');
        return;
      }
      const result = addToCart(product);
      if (result.success) {
        setActiveTab('products');
        toast.success('Added to Cart', `${product.name} ${product.model} added via barcode.`);
      } else if (result.reason === 'out_of_stock') {
        toast.error('Out of Stock', `${product.name} ${product.model} has no units left.`);
      } else {
        toast.warning('Stock Limit Reached', `Only ${result.availableStock} unit${result.availableStock === 1 ? '' : 's'} of ${product.name} ${product.model} available.`);
      }
    } else {
      toast.error('Product Not Found', `No product found with SKU: ${sku}`);
    }
  }, [allProducts, addToCart, toast]);

  const handleCheckout = useCallback(async () => {
    if (items.length === 0 || checkoutLock.current || isProcessing || isCheckingOut) return;

    checkoutLock.current = true;
    setIsProcessing(true);

    try {
      const total = getTotal();
      const hasReturns = hasReturnItems();

      // 1. SURPLUS CASE: Shop owes customer money (e.g. -400 DA) — use selected refund method (Problem 6 fix)
      if (total < 0) {
        const refundDue = Math.abs(total);
        try {
          setPayments([{ method: 'cash', amount: total }]);
          const tx = await checkout({ refundType: surplusRefundMethod, customerAttached });
          if (tx) {
            setCompletedTx(tx);
            setDownPayment(0);
            setCashTendered('');
            setCustomerAttached(false);
            setCreditLimitOverrideApproved(false);
            const refundLabel = surplusRefundMethod === 'store_credit' ? '🎟️ Store Credit (Avoir)' : surplusRefundMethod === 'debt_deduction' ? '📒 Deducted from Debt' : '💵 Cash Refund';
            toast.success(
              `${refundLabel} Issued!`,
              `Return of ${formatCurrency(refundDue)} settled as ${refundLabel} for ${customerName || 'customer'}.`
            );
          }
        } catch (err) {
          console.error(err);
          toast.error('Failed to complete return. Please try again.');
        }
        return;
      }

      // 2. EVEN EXCHANGE CASE: 0 DA difference
      if (total === 0) {
        try {
          setPayments([{ method: 'cash', amount: 0 }]);
          const tx = await checkout({ customerAttached });
          if (tx) {
            setCompletedTx(tx);
            setDownPayment(0);
            setCashTendered('');
            setCustomerAttached(false);
            setCreditLimitOverrideApproved(false);
            toast.success('Even Exchange Completed! 🔄', '0 DA net difference. Inventory stocks reconciled.');
          }
        } catch (err) {
          console.error(err);
          toast.error('Failed to complete even exchange. Please try again.');
        }
        return;
      }

      // 3. DEFICIT CASE: Customer owes shop (total > 0)
      if (paymentMode === 'debt') {
        if (!customerName || !customerName.trim()) {
          toast.error('Customer Name Required', 'Please enter a customer name for the credit tab.');
          return;
        }

        if (!customerPhone || !customerPhone.trim()) {
          toast.error('Phone Number Required', 'A phone number is required to provide credit to this customer.');
          return;
        }

        // Problem 2 fix: Credit limit check before checkout
        if (isCreditLimitExceeded && !creditLimitOverrideApproved && !isAdmin) {
          setShowCreditLimitUnlock(true);
          return;
        }
      }

      // Handle Store Credit redemption if toggled
      const availableCredit = (applyStoreCredit && matchedCustomer?.storeCredit) ? matchedCustomer.storeCredit : 0;
      const creditToUse = Math.min(availableCredit, total);
      const remainingToPay = total - creditToUse;

      // Problem 7 fix: Prevent underpaid checkout when cash received is less than remaining due
      if (paymentMode === 'cash' && cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < remainingToPay) {
        toast.error('Underpaid Amount', `Cash received (${formatCurrency(Number(cashTendered))}) is less than remaining due (${formatCurrency(remainingToPay)}). Please collect the full amount or put the balance on Credit Tab.`);
        return;
      }

      // Clamp down payment to [0, remainingToPay]
      const clampedDown = Math.min(Math.max(downPayment || 0, 0), remainingToPay);

      // Problem 11 fix: Map paymentMode to the actual PaymentMethod used for the non-debt portion
      const cashMethod: PaymentMethod = (paymentMode === 'mobile' || paymentMode === 'card') ? paymentMode as PaymentMethod : 'cash';

      try {
        let pList: { method: PaymentMethod; amount: number }[] = [];

        if (creditToUse > 0) {
          pList.push({ method: 'store_credit', amount: creditToUse });
        }

        if (remainingToPay > 0) {
          if (paymentMode === 'debt') {
            const debtAmount = remainingToPay - clampedDown;
            if (clampedDown > 0 && debtAmount > 0) {
              pList.push({ method: 'cash', amount: clampedDown });
              pList.push({ method: 'debt', amount: debtAmount });
            } else if (clampedDown >= remainingToPay) {
              pList.push({ method: 'cash', amount: remainingToPay });
            } else {
              pList.push({ method: 'debt', amount: remainingToPay });
            }
          } else {
            pList.push({ method: cashMethod, amount: remainingToPay });
          }
        }

        const isNew = !matchedCustomer;
        setPayments(pList);
        const tx = await checkout({
          storeCreditUsed: creditToUse > 0 ? creditToUse : undefined,
          customerAttached,
          allowCreditLimitOverride: creditLimitOverrideApproved || isAdmin,
        });
        if (tx) {
          setCompletedTx(tx);
          setDownPayment(0);
          setCashTendered('');
          setApplyStoreCredit(false);
          setCustomerAttached(false);
          setCreditLimitOverrideApproved(false);

          if (paymentMode === 'debt') {
            const debtLogged = remainingToPay - clampedDown;
            if (debtLogged > 0) {
              toast.success(
                isNew ? 'New Customer Registered & Debt Logged! 📒' : 'Sale & Debt Logged! 📒',
                isNew
                  ? `${customerName} was automatically created with ${formatCurrency(debtLogged)} on credit.`
                  : (clampedDown > 0
                      ? `${formatCurrency(clampedDown)} paid now, ${formatCurrency(debtLogged)} added to ${customerName}'s Credit Tab.`
                      : `${formatCurrency(remainingToPay)} added to ${customerName}'s Credit Ledger tab.`)
              );
            } else {
              toast.success('Sale Completed!', `${formatCurrency(total)} paid in full by ${customerName}.`);
            }
          } else {
            const methodLabel = cashMethod === 'mobile' ? 'BaridiMob' : cashMethod === 'card' ? 'Card' : 'Cash';
            toast.success(
              hasReturns ? 'Exchange Completed! 🔄' : 'Sale Completed! 💵',
              creditToUse > 0
                ? `${formatCurrency(creditToUse)} paid via Store Credit, ${formatCurrency(remainingToPay)} paid via ${methodLabel}.`
                : `${formatCurrency(total)} paid via ${methodLabel}.`
            );
          }
        }
      } catch (err: any) {
        console.error(err);
        if (err?.message?.includes('Credit limit exceeded')) {
          toast.error('Credit Limit Exceeded', err.message);
        } else {
          toast.error('Failed to complete sale. Please try again.');
        }
      }
    } finally {
      setIsProcessing(false);
      checkoutLock.current = false;
    }
  }, [items, checkout, setPayments, getTotal, hasReturnItems, surplusRefundMethod, applyStoreCredit, matchedCustomer, paymentMode, customerName, customerPhone, downPayment, toast, isProcessing, isCheckingOut, customerAttached, isCreditLimitExceeded, creditLimitOverrideApproved, isAdmin, cashTendered]);

  // Hardware barcode scanner keystroke listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (!isInputFocused) {
        if (e.key === 'Enter') {
          if (barcodeBuffer.current.length > 3) {
            handleBarcodeInput(barcodeBuffer.current);
          }
          barcodeBuffer.current = '';
          if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
          return;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          barcodeBuffer.current += e.key;
          if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
          barcodeTimer.current = setTimeout(() => {
            barcodeBuffer.current = '';
          }, 100);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBarcodeInput]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchCarts(); }, [fetchCarts]);

  // Handle deep links from Activity Log (e.g. /pos?tab=history&search=txId&focusId=txId)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const search = params.get('search') ?? '';
    const focusId = params.get('focusId') ?? '';
    if (tab === 'history') {
      setActiveTab('history');
      if (search) setDeepLinkSearch(search);
      if (focusId) setDeepLinkFocusId(focusId);
    }
  }, [location.search]);

  const getSuspendedCartTotal = (cart: SuspendedCart) => {
    const subtotal = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    let discountAmt = 0;
    if (cart.discount) {
      discountAmt = cart.discount.type === 'percent'
        ? subtotal * (cart.discount.value / 100)
        : cart.discount.value;
    }
    return Math.max(0, subtotal - discountAmt);
  };

  const filteredSuspendedCarts = suspendedCarts.filter(cart => {
    if (!heldSearchQuery.trim()) return true;
    const q = heldSearchQuery.toLowerCase().trim();
    const customerMatch = (cart.customerName || 'walk-in customer').toLowerCase().includes(q);
    const itemsMatch = cart.items.some(i => 
      i.product.name.toLowerCase().includes(q) ||
      i.product.model.toLowerCase().includes(q) ||
      (i.product.color && i.product.color.toLowerCase().includes(q)) ||
      (i.product.storage && i.product.storage.toLowerCase().includes(q)) ||
      (i.product.sku && i.product.sku.toLowerCase().includes(q))
    );
    return customerMatch || itemsMatch;
  });

  // Filter sales catalog using local POS search query (server excluded repair parts from the beginning)
  const posFilteredProducts = useMemo(() => {
    let filtered = allProducts;
    if (searchQuery.trim()) {
      const words = searchQuery.toLowerCase().trim().split(/\s+/);
      filtered = filtered.filter(p => {
        const full = [p.name, p.model, p.sku, p.color, p.storage, p.location, p.supplier].filter(Boolean).join(' ').toLowerCase();
        return words.every(word => full.includes(word));
      });
    }
    return filtered;
  }, [allProducts, searchQuery]);

  // Raw groups from isolated POS catalog (reflect Firestore stock)
  const rawGroups = useMemo(() => groupProductsByBaseModel(posFilteredProducts), [posFilteredProducts]);

  // Build a map of productId → quantity already in cart
  const cartQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items) {
      map[item.product.id] = (map[item.product.id] || 0) + item.quantity;
    }
    return map;
  }, [items]);

  // Adjust each variant's stock by subtracting cart quantities → real-time "available to add"
  const groups = useMemo(() => {
    return rawGroups.map(group => {
      const adjustedVariants = group.variants.map(v => {
        const inCart = cartQtyMap[v.id] || 0;
        const availableStock = Math.max(0, v.stock - inCart);
        const stockStatus: PhoneModel['stockStatus'] =
          availableStock === 0 ? 'out_of_stock' :
          availableStock <= (v.lowStockThreshold ?? 1) ? 'low_stock' : 'in_stock';
        return { ...v, stock: availableStock, stockStatus };
      });
      const totalAvailable = adjustedVariants.reduce((s, v) => s + v.stock, 0);
      const groupStockStatus: PhoneModel['stockStatus'] =
        totalAvailable === 0 ? 'out_of_stock' :
        totalAvailable <= 5 ? 'low_stock' : 'in_stock';
      return { ...group, variants: adjustedVariants, totalStock: totalAvailable, stockStatus: groupStockStatus };
    });
  }, [rawGroups, cartQtyMap]);

  const categories = [
    { id: 'all', label: 'All Items', icon: '✨' },
    { id: 'smartphone', label: 'Phones', icon: '📱' },
    { id: 'accessory', label: 'Accessories', icon: '⚡' },
    { id: 'wearable', label: 'Wearables', icon: '⌚' },
    { id: 'tablet', label: 'Tablets', icon: '📟' },
  ];

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: groups.length };
    for (const g of groups) {
      counts[g.category] = (counts[g.category] || 0) + 1;
    }
    return counts;
  }, [groups]);

  const displayedGroups = useMemo(() => {
    if (categoryFilter === 'all') return groups;
    return groups.filter(g => g.category === categoryFilter);
  }, [groups, categoryFilter]);

  const PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when category or search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, categoryFilter]);

  const paginatedGroups = useMemo(() => {
    return displayedGroups.slice(0, visibleCount);
  }, [displayedGroups, visibleCount]);

  const hasMore = displayedGroups.length > visibleCount;
  const remainingCount = Math.max(0, displayedGroups.length - visibleCount);
  const nextBatchCount = Math.min(PAGE_SIZE, remainingCount);


  return (
    <div className={styles.page}>
      <ReceiptModal
        transaction={completedTx}
        onClose={() => setCompletedTx(null)}
      />

      <CashDrawerModal
        isOpen={isCashDrawerOpen}
        onClose={() => setIsCashDrawerOpen(false)}
      />

      <VariantSelectModal
        group={selectedGroup}
        onClose={() => setSelectedGroup(null)}
        onSelect={(variant) => {
          addToCart(variant);
          setSelectedGroup(null);
        }}
      />

      {/* Left: Main Panel */}
      <div className={styles.productsPanel}>
        <div className={styles.panelHeader}>
          <div className={styles.tabs}>
            <button 
              className={[styles.tab, activeTab === 'products' && styles.tabActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('products')}
            >
              Point of Sale
            </button>
            <button 
              className={[styles.tab, activeTab === 'history' && styles.tabActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('history')}
            >
              Transaction History
            </button>
          </div>
          
          <div className={styles.headerRight}>
            {/* Hardware Barcode Scanner Status Indicator */}
            <div
              className={[styles.scannerBadge, scannerScanned && styles.scannerScanned].filter(Boolean).join(' ')}
              title="Hardware barcode scanner is active. Scanning any SKU adds item directly to cart."
            >
              <span className={styles.scannerDot} />
              <span>{scannerScanned ? 'Barcode Scanned!' : 'Scanner Ready'}</span>
            </div>

            <button
              type="button"
              className={styles.cashDrawerBtn}
              onClick={() => setIsCashDrawerOpen(true)}
              title="View Cash Drawer & End-of-Day (Z-Report) Summary"
            >
              <BadgeDollarSign size={16} />
              <span>Cash Drawer</span>
              <span className={styles.cashDrawerAmount}>{formatCurrency(todayNetCash)}</span>
            </button>

            {activeTab === 'products' && (
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search products…"
                className={styles.search}
              />
            )}
            <EndOfDayButton variant="compact" />
          </div>
        </div>

        {activeTab === 'products' && (
          <div className={styles.productsToolbar}>
            {/* Quick Category Filter Bar */}
            <div className={styles.categoryFilterBar}>
              {categories.map(cat => {
                const count = categoryCounts[cat.id] || 0;
                if (cat.id !== 'all' && count === 0) return null;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={[
                      styles.categoryFilterPill,
                      categoryFilter === cat.id && styles.categoryFilterPillActive
                    ].filter(Boolean).join(' ')}
                    onClick={() => setCategoryFilter(cat.id)}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                    <span className={styles.pillCount}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* View Mode Toggle */}
            <div className={styles.viewModeToggle}>
              <button
                type="button"
                className={[styles.viewModeBtn, viewMode === 'grid' && styles.viewModeBtnActive].filter(Boolean).join(' ')}
                onClick={() => setViewMode('grid')}
                title="Grid View (Cards)"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                className={[styles.viewModeBtn, viewMode === 'list' && styles.viewModeBtnActive].filter(Boolean).join(' ')}
                onClick={() => setViewMode('list')}
                title="Compact List View"
              >
                <List size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Speed-Dial Fast Keys Row */}
        {activeTab === 'products' && speedDialItems.length > 0 && !searchQuery.trim() && categoryFilter === 'all' && (
          <div className={styles.speedDialSection}>
            <div className={styles.speedDialHeader}>
              <div className={styles.speedDialTitle}>
                <Zap size={13} style={{ color: 'var(--color-primary, #4f46e5)' }} />
                <span>Speed-Dial Fast Keys</span>
              </div>
              <span className={styles.speedDialCount}>⚡ 1-Click Fast Add</span>
            </div>
            <div className={styles.speedDialGrid}>
              {speedDialItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.speedDialCard}
                  onClick={() => handleAddToCart(item, `${item.name} ${item.model}`)}
                  title={`Quick add ${item.name} ${item.model} (${formatCurrency(item.price)})`}
                >
                  <div className={styles.speedDialCardTop}>
                    <span className={styles.speedDialIcon}>{getCategoryIcon(item.category)}</span>
                    <span className={styles.speedDialStock}>{item.stock} in stock</span>
                  </div>
                  <span className={styles.speedDialName}>{item.name} {item.model}</span>
                  <span className={styles.speedDialPrice}>{formatCurrency(item.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'products' ? (
          displayedGroups.length === 0 ? (
            <div className={styles.emptyCart}>
              <span className={styles.emptyCartIcon}>🔍</span>
              <p className={styles.emptyCartTitle}>No products found</p>
              <p className={styles.emptyCartSub}>Try a different category or clear your search.</p>
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className={styles.productGrid}>
                  {paginatedGroups.map(group => (
                    <ProductCard 
                      key={group.id} 
                      group={group} 
                      onAdd={(variant) => {
                        const target = variant || (group.variants.length === 1 ? group.variants[0] : null);
                        if (target) {
                          handleAddToCart(target, `${group.name} ${group.model}`);
                        } else {
                          setSelectedGroup(group);
                        }
                      }} 
                      onSelectVariant={() => setSelectedGroup(group)}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.denseList}>
                  {paginatedGroups.map(group => (
                    <ProductListItem
                      key={group.id}
                      group={group}
                      onAdd={(variant) => {
                        const target = variant || (group.variants.length === 1 ? group.variants[0] : null);
                        if (target) {
                          handleAddToCart(target, `${group.name} ${group.model}`);
                        } else {
                          setSelectedGroup(group);
                        }
                      }}
                      onSelectVariant={() => setSelectedGroup(group)}
                    />
                  ))}
                </div>
              )}

              {/* View More Pagination Bar */}
              {hasMore && (
                <div className={styles.viewMoreContainer}>
                  <p className={styles.viewMoreMeta}>
                    Showing <span className={styles.viewMoreMetaHighlight}>{paginatedGroups.length}</span> of <span className={styles.viewMoreMetaHighlight}>{displayedGroups.length}</span> products
                  </p>
                  <div className={styles.viewMoreActions}>
                    <button
                      type="button"
                      className={styles.viewMoreBtn}
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                    >
                      <span>View More (+{nextBatchCount})</span>
                      <ChevronDown size={15} />
                    </button>
                    {remainingCount > nextBatchCount && (
                      <button
                        type="button"
                        className={styles.viewAllBtn}
                        onClick={() => setVisibleCount(displayedGroups.length)}
                      >
                        View All ({displayedGroups.length})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )
        ) : (
          <TransactionHistoryTab initialSearch={deepLinkSearch} initialFocusId={deepLinkFocusId} />
        )}
      </div>

      {/* Right: Cart */}
      <div className={styles.cartPanel}>
        <div className={styles.cartHeader}>
          <div className={styles.cartTitle}>
            <ShoppingCart size={20} />
            <span>Cart</span>
            {getItemCount() > 0 && (
              <span className={styles.cartCount}>{getItemCount()}</span>
            )}
            {suspendedCarts.length > 0 && (
              <button 
                className={styles.suspendedBadge} 
                onClick={() => setShowSuspended(!showSuspended)}
              >
                {suspendedCarts.length} on hold
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button 
              type="button"
              className={styles.exchangeBtn}
              onClick={() => setShowReturnModal(true)}
              title="Add a returned or exchanged product"
            >
              <RefreshCw size={12} /> Exchange
            </button>
            {(items.length > 0 || customerName) && (
              <>
                {items.length > 0 && (
                  <button 
                    className={styles.suspendBtn} 
                    onClick={() => {
                      suspendCart();
                      toast.info('Cart Placed on Hold', 'Cart saved. You can serve another customer and resume anytime.');
                    }}
                  >
                    Hold
                  </button>
                )}
                <button 
                  className={styles.clearBtn} 
                  onClick={() => {
                    clearCart();
                    setCustomerAttached(false);
                    setDownPayment(0);
                    setApplyStoreCredit(false);
                    toast.info('Cart Cleared', 'Cart and customer cleared.');
                  }}
                >
                  <X size={14} /> Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Customer Attachment Bar (Single Unified Top Zone) */}
        {!showSuspended && (
          <div className={styles.cartCustomerTop}>
            {customerAttached && customerName ? (
              <div className={styles.attachedCustomerCard}>
                <div className={styles.attachedCustomerLeft}>
                  <div className={styles.attachedCustomerAvatar}>
                    {customerName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className={styles.attachedCustomerInfo}>
                    <div className={styles.attachedCustomerNameRow}>
                      <span className={styles.attachedCustomerName}>{customerName}</span>
                      {matchedCustomer?.shopName && (
                        <span className={styles.attachedCustomerShop}>• {matchedCustomer.shopName}</span>
                      )}
                    </div>
                    <div className={styles.attachedCustomerSubRow}>
                      <span className={styles.attachedCustomerPhone}>
                        📞 {customerPhone || matchedCustomer?.phone || 'No phone'}
                      </span>
                      {(matchedCustomer?.storeCredit || 0) > 0 && (
                        <span className={styles.attachedStoreCreditBadge}>
                          🎟️ Avoir: {formatCurrency(matchedCustomer?.storeCredit || 0)}
                        </span>
                      )}
                      {(matchedCustomer?.totalDebt || 0) > 0 ? (
                        <span className={styles.attachedDebtBadge}>
                          Debt: {formatCurrency(matchedCustomer?.totalDebt || 0)}
                        </span>
                      ) : (
                        <span className={styles.attachedNoDebtBadge}>
                          Clean Credit
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.detachCustomerBtn}
                  onClick={() => {
                    setCustomerName('');
                    setCustomerPhone('');
                    setCustomerAttached(false);
                    toast.info('Customer Detached', 'Sale will proceed as walk-in buyer.');
                  }}
                  title="Detach customer (switch to walk-in)"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className={styles.customerInputWrap}>
                <CustomerAutocompleteInput
                  accountType="retail"
                  placeholder="👤 Attach customer (optional)..."
                  value={customerName}
                  onChange={(name, cust) => {
                    setCustomerName(name);
                    if (cust) {
                      // Customer selected from dropdown or registered
                      setCustomerAttached(true);
                      if (cust.phone) {
                        setCustomerPhone(cust.phone);
                      }
                    } else {
                      // Detach the registered-customer link, but only
                      // wipe the phone number if the name field was fully cleared.
                      // This way, if a cashier typed "Amine" and also typed a phone
                      // for the credit tab, editing the name won't erase the phone.
                      setCustomerAttached(false);
                      if (!name || !name.trim()) {
                        setCustomerPhone('');
                      }
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Cart Items List */}
        <div className={styles.cartItems}>
          {showSuspended && suspendedCarts.length > 0 ? (
            <div className={styles.suspendedList}>
              <div className={styles.suspendedListHeader}>
                <div className={styles.suspendedListTitle}>
                  <Clock size={16} />
                  <span>Held Carts ({suspendedCarts.length})</span>
                </div>
                <button 
                  className={styles.backToCartBtn}
                  onClick={() => {
                    setShowSuspended(false);
                    setHeldSearchQuery('');
                  }}
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
                  const cartTotal = getSuspendedCartTotal(cart);
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
                          {formatCurrency(cartTotal)}
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
                              {formatCurrency(item.product.price * item.quantity)}
                            </span>
                          </div>
                        ))}
                        {cart.discount && (
                          <div className={styles.suspendedDiscountRow}>
                            <span>Discount Applied</span>
                            <span>
                              {cart.discount.type === 'percent'
                                ? `-${cart.discount.value}%`
                                : `-${formatCurrency(cart.discount.value)}`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className={styles.suspendedCardActions}>
                        <button 
                          className={styles.discardBtn} 
                          onClick={() => {
                            discardSuspendedCart(cart.id);
                            toast.info('Cart Discarded', 'Held cart removed.');
                          }}
                          title="Discard this held cart"
                        >
                          <Trash2 size={13} /> Discard
                        </button>
                        <button 
                          className={styles.resumeBtn} 
                          onClick={() => { 
                            const res = resumeCart(cart.id); 
                            setShowSuspended(false);
                            if (res.warnings && res.warnings.length > 0) {
                              res.warnings.forEach(w => toast.warning('Stock Level Alert', w));
                            } else {
                              toast.success('Cart Resumed', `Active cart set for ${cart.customerName || 'Walk-in Customer'}`);
                            }
                          }}
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
          ) : items.length === 0 ? (
            <div className={styles.emptyCart}>
              {customerName ? (
                <>
                  <div className={styles.customerEmptyIconWrap}>
                    <UserCheck size={30} />
                  </div>
                  <p className={styles.emptyCartTitle}>Customer Attached</p>
                  <p className={styles.attachedCustomerHighlight}>{customerName}</p>
                  <p className={styles.emptyCartSub}>Select products from the catalog to add items to this sale.</p>
                </>
              ) : (
                <>
                  <span className={styles.emptyCartIcon}>🛒</span>
                  <p className={styles.emptyCartTitle}>Cart is empty</p>
                  <p className={styles.emptyCartSub}>Add products from the left to start a sale.</p>
                </>
              )}
            </div>
          ) : (
            items.map(item => {
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
                  <span className={styles.qty}>{item.quantity}</span>
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
            )})
          )}
        </div>

        {/* Order Summary & Checkout Footer */}
        {items.length > 0 && (
          <div className={styles.cartFooter}>
            {/* If net total is negative (Shop owes customer money) — choose settlement method (Problem 6 fix) */}
            {getTotal() < 0 ? (
              <div className={styles.surplusRefundBox}>
                <div className={styles.surplusHeader}>
                  <span>🔄 Product Return — Surplus Due:</span>
                  <span className={styles.surplusDue}>{formatCurrency(Math.abs(getTotal()))}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className={[styles.payBtn, surplusRefundMethod === 'cash' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setSurplusRefundMethod('cash')}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                  >
                    💵 Cash Refund
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, surplusRefundMethod === 'store_credit' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setSurplusRefundMethod('store_credit')}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                  >
                    🎟️ Store Credit (Avoir)
                  </button>
                  {matchedCustomer && currentCustomerDebt > 0 && (
                    <button
                      type="button"
                      className={[styles.payBtn, surplusRefundMethod === 'debt_deduction' && styles.payActive].filter(Boolean).join(' ')}
                      onClick={() => setSurplusRefundMethod('debt_deduction')}
                      style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                    >
                      📒 Deduct Debt
                    </button>
                  )}
                </div>
                <p style={{ fontSize: '11px', color: '#92400e', margin: '6px 0 0', fontWeight: 500 }}>
                  {surplusRefundMethod === 'cash'
                    ? `💵 Return ${formatCurrency(Math.abs(getTotal()))} cash from the drawer to ${customerName || 'customer'}.`
                    : surplusRefundMethod === 'store_credit'
                    ? `🎟️ Issue ${formatCurrency(Math.abs(getTotal()))} Store Credit (Avoir) to ${customerName || 'customer'}.`
                    : `📒 Deduct ${formatCurrency(Math.abs(getTotal()))} from ${customerName}'s open debt balance.`}
                </p>
              </div>
            ) : getTotal() === 0 ? (
              <div className={styles.surplusRefundBox} style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                <div className={styles.surplusHeader} style={{ color: '#166534' }}>
                  <span>🔄 Even Exchange (0 DA Difference)</span>
                  <span style={{ color: '#15803d', fontWeight: 800 }}>0 DA</span>
                </div>
                <p style={{ fontSize: '11px', color: '#15803d', margin: '2px 0 0' }}>
                  Returned items will be restocked and replacement items deducted at no charge.
                </p>
              </div>
            ) : (
              /* Regular or Deficit exchange where customer owes money */
              <div className={styles.paymentMethods}>
                {/* Store credit available banner if customer has active avoir */}
                {matchedCustomer && (matchedCustomer.storeCredit || 0) > 0 && (
                  <label className={styles.storeCreditUseToggle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="checkbox"
                        checked={applyStoreCredit}
                        onChange={e => setApplyStoreCredit(e.target.checked)}
                        style={{ cursor: 'pointer', accentColor: '#16a34a' }}
                      />
                      <span>🎟️ Use Store Credit ({formatCurrency(matchedCustomer.storeCredit || 0)} available)</span>
                    </div>
                    {applyStoreCredit && (
                      <span style={{ color: '#15803d', fontWeight: 800 }}>
                        -{formatCurrency(Math.min(matchedCustomer.storeCredit || 0, getTotal()))}
                      </span>
                    )}
                  </label>
                )}

                <div className={styles.payBtns} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'cash' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('cash')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                  >
                    💵 Cash
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'mobile' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('mobile')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                    title="BaridiMob / Bank Transfer"
                  >
                    📱 Mobile
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'card' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('card')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                    title="CIB / Dahabia Card"
                  >
                    💳 Card
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'debt' && styles.payActiveDebt].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('debt')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                  >
                    📒 Credit
                  </button>
                </div>

                {/* Instant Cash Tendered & Change Due Calculator */}
                {paymentMode === 'cash' && netPayable > 0 && (
                  <div className={styles.tenderCalculator}>
                    <div className={styles.tenderHeader}>
                      <span>💵 Cash Received & Change</span>
                      {cashTendered !== '' && Number(cashTendered) > 0 && (
                        <button
                          type="button"
                          onClick={() => setCashTendered('')}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    {/* Quick Tender Denomination Presets */}
                    <div className={styles.tenderPresetRow}>
                      <button
                        type="button"
                        className={[styles.tenderPresetBtn, Number(cashTendered) === netPayable && styles.tenderPresetBtnActive].filter(Boolean).join(' ')}
                        onClick={() => setCashTendered(netPayable)}
                      >
                        Exact ({formatCurrency(netPayable)})
                      </button>
                      {tenderPresets.map(val => (
                        <button
                          key={val}
                          type="button"
                          className={[styles.tenderPresetBtn, Number(cashTendered) === val && styles.tenderPresetBtnActive].filter(Boolean).join(' ')}
                          onClick={() => setCashTendered(val)}
                        >
                          {formatCurrency(val)}
                        </button>
                      ))}
                    </div>

                    {/* Tender Amount Input */}
                    <div className={styles.tenderInputWrap}>
                      <input
                        type="number"
                        placeholder={`Amount received (e.g. ${netPayable})`}
                        value={cashTendered === '' ? '' : cashTendered}
                        onChange={e => setCashTendered(e.target.value === '' ? '' : Number(e.target.value))}
                        className={styles.tenderInput}
                      />
                      <span className={styles.tenderCurrency}>{currencySymbol}</span>
                    </div>

                    {/* Change Due or Remaining Balance Banner */}
                    {cashTendered !== '' && Number(cashTendered) >= netPayable && (
                      <div className={styles.changeDueBanner}>
                        <span className={styles.changeDueLabel}>
                          <span>🪙</span> Change Due:
                        </span>
                        <span className={styles.changeDueAmount}>
                          {formatCurrency(Number(cashTendered) - netPayable)}
                        </span>
                      </div>
                    )}

                    {cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < netPayable && (
                      <div className={styles.shortAmountBanner}>
                        <span className={styles.shortAmountLabel}>Remaining Due:</span>
                        <span className={styles.shortAmountValue}>
                          {formatCurrency(netPayable - Number(cashTendered))}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Warning if Credit Tab selected without any customer name */}
                {paymentMode === 'debt' && (!customerName || !customerName.trim()) && (
                  <div className={styles.debtWarningBox}>
                    <AlertCircle size={14} />
                    <span>Enter a customer name above to use Credit Tab.</span>
                  </div>
                )}

                {/* Phone required prompt — if customer name is entered but phone is missing */}
                {paymentMode === 'debt' && customerName && customerName.trim() && !(customerAttached && matchedCustomer?.phone) && (
                  <div style={{ marginTop: '2px' }}>
                    <Input
                      label="Customer Phone (Required for Credit)"
                      placeholder="e.g. 0550 123 456"
                      type="tel"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      style={{ borderColor: customerPhone && customerPhone.trim() ? 'var(--color-outline-variant, #cbd5e1)' : '#f59e0b' }}
                    />
                    {!matchedCustomer && (
                      <p style={{ fontSize: '10.5px', color: '#15803d', marginTop: '2px', fontWeight: 600 }}>
                        ✨ New customer profile will be created on checkout.
                      </p>
                    )}
                  </div>
                )}

                {/* Partial Payment & Credit Debt Preview — when customer name is present */}
                {paymentMode === 'debt' && customerName && customerName.trim() && (
                  <div className={styles.creditBoxCompact}>
                    <div className={styles.creditInputRow}>
                      <span className={styles.creditLabel}>💰 Paid Now:</span>
                      <div className={styles.creditInputWrap}>
                        <input
                          type="number"
                          placeholder="0 (Full Credit)"
                          min={0}
                          max={Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0))}
                          value={downPayment === 0 ? '' : downPayment}
                          onChange={e => {
                            const raw = e.target.value;
                            const maxPayable = Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0));
                            if (raw === '') {
                              setDownPayment(0);
                            } else {
                              const v = Math.max(0, Number(raw));
                              setDownPayment(Math.min(v, maxPayable));
                            }
                          }}
                          className={styles.creditInputField}
                        />
                        <span className={styles.creditCurrencyBadge}>DA</span>
                      </div>
                    </div>

                    {downPayment > 0 && (
                      <div className={styles.creditQuickBadges}>
                        {[0.25, 0.5, 0.75].map(pct => (
                          <button
                            key={pct}
                            type="button"
                            className={styles.quickPayBadge}
                            onClick={() => {
                              const maxPayable = Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0));
                              setDownPayment(Math.round(maxPayable * pct));
                            }}
                          >
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                        <button
                          type="button"
                          className={styles.quickPayBadge}
                          onClick={() => {
                            const maxPayable = Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0));
                            setDownPayment(maxPayable);
                          }}
                        >
                          Full
                        </button>
                      </div>
                    )}

                    <div className={styles.creditMetricsRow}>
                      <div className={styles.creditMetric}>
                        <span className={styles.creditMetricLabel}>On Credit:</span>
                        <strong className={styles.creditMetricValue}>
                          +{formatCurrency(Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0) - (downPayment || 0)))}
                        </strong>
                      </div>
                      <div className={styles.creditMetric}>
                        <span className={styles.creditMetricLabel}>New Total:</span>
                        <strong className={styles.creditMetricTotal}>
                          {formatCurrency((matchedCustomer?.totalDebt || 0) + Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0) - (downPayment || 0)))}
                        </strong>
                      </div>
                    </div>

                    {/* Problem 2 fix: Real-time credit limit breach warning banner */}
                    {isCreditLimitExceeded && (
                      <div style={{ background: '#fef2f2', border: '1px solid #ef4444', borderRadius: '6px', padding: '8px 10px', fontSize: '11px', color: '#991b1b', marginTop: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}>
                          <AlertCircle size={14} />
                          <span>Credit Limit Exceeded!</span>
                        </div>
                        <p style={{ margin: '3px 0 0' }}>
                          Current debt: {formatCurrency(currentCustomerDebt)} + New: {formatCurrency(creditDebtToLog)} = {formatCurrency(currentCustomerDebt + creditDebtToLog)}.
                          Limit is {formatCurrency(matchedCustomer?.creditLimit || 0)}.
                        </p>
                        {creditLimitOverrideApproved || isAdmin ? (
                          <p style={{ margin: '4px 0 0', color: '#15803d', fontWeight: 600 }}>
                            ✓ Admin override authorized.
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowCreditLimitUnlock(true)}
                            style={{
                              marginTop: '6px',
                              width: '100%',
                              padding: '5px 8px',
                              background: '#dc2626',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              fontSize: '11px',
                            }}
                          >
                            Authorize Admin Override
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Subtotals & Exchange Breakdown */}
            <div className={styles.totals}>
              {hasReturnItems() && (
                <>
                  <div className={styles.totalRow} style={{ color: 'var(--color-on-surface-variant)', fontSize: '11.5px' }}>
                    <span>Purchases (+):</span>
                    <span>{formatCurrency(getPurchasesSubtotal())}</span>
                  </div>
                  <div className={styles.totalRow} style={{ color: '#b45309', fontSize: '11.5px' }}>
                    <span>Returned Items (-):</span>
                    <span>-{formatCurrency(getReturnsSubtotal())}</span>
                  </div>
                </>
              )}

              <div className={styles.discountRowCompact}>
                <span className={styles.discountLabel}>Discount (DA):</span>
                <input
                  type="number"
                  placeholder="0"
                  value={pendingDiscountValue !== null ? pendingDiscountValue.toString() : (discount?.value ? discount.value.toString() : '')}
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setPendingDiscountValue(null);
                      setDiscount(null);
                      return;
                    }
                    const v = Number(raw);
                    // Problem 5 fix: Require admin authorization for manual discounts > 1,000 DA
                    if (v > 1000 && !isAdmin) {
                      setPendingDiscountValue(v);
                      setShowDiscountUnlock(true);
                    } else if (v > 0) {
                      setPendingDiscountValue(null);
                      setDiscount({ type: 'flat', value: v });
                    } else {
                      setPendingDiscountValue(null);
                      setDiscount(null);
                    }
                  }}
                  className={styles.discountInputCompact}
                />
              </div>

              {getDiscountAmount() > 0 && (
                <div className={styles.totalRow} style={{ color: 'var(--color-danger-text, #dc2626)' }}>
                  <span>Discount</span>
                  <span>-{formatCurrency(getDiscountAmount())}</span>
                </div>
              )}

              <div className={[styles.totalRow, styles.grandTotal].join(' ')}>
                <span>{getTotal() < 0 ? 'Refund Due' : 'Net Total'}</span>
                <span style={{ color: getTotal() < 0 ? '#b45309' : undefined }}>
                  {getTotal() < 0 ? `-${formatCurrency(Math.abs(getTotal()))}` : formatCurrency(getTotal())}
                </span>
              </div>
            </div>

            {/* Problem 7 fix: Underpaid warning banner */}
            {paymentMode === 'cash' && cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < netPayable && (
              <div style={{ background: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', color: '#b91c1c', marginBottom: '8px', textAlign: 'center' }}>
                ⚠️ Underpaid by {formatCurrency(netPayable - Number(cashTendered))}. Collect full cash or switch to Credit Tab.
              </div>
            )}

            <Button
              size="lg"
              className={styles.checkoutBtn}
              onClick={handleCheckout}
              disabled={isBusy || items.length === 0 || (paymentMode === 'cash' && cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < netPayable)}
              isLoading={isBusy}
              leftIcon={<CheckCircle size={18} />}
              style={{
                background: getTotal() < 0 ? '#b45309' : (getTotal() === 0 ? '#15803d' : undefined),
                borderColor: getTotal() < 0 ? '#92400e' : (getTotal() === 0 ? '#166534' : undefined),
              }}
            >
              {isBusy
                ? (hasReturnItems() ? 'Processing Exchange...' : 'Processing Sale...')
                : (getTotal() < 0
                  ? `Complete Exchange • Refund ${formatCurrency(Math.abs(getTotal()))}`
                  : getTotal() === 0
                    ? 'Complete Even Exchange • 0 DA'
                    : hasReturnItems()
                      ? `Complete Exchange • ${formatCurrency(Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0)))}`
                      : `Complete Sale • ${formatCurrency(Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0)))}`)}
            </Button>
          </div>
        )}
      </div>

      {/* Return & Exchange Modal */}
      <ReturnExchangeModal
        isOpen={showReturnModal}
        onClose={() => setShowReturnModal(false)}
      />

      {/* Admin Unlock Modal for Credit Limit Breach (Problem 2) */}
      <AdminUnlockModal
        isOpen={showCreditLimitUnlock}
        onClose={() => setShowCreditLimitUnlock(false)}
        onSuccess={() => {
          setShowCreditLimitUnlock(false);
          setCreditLimitOverrideApproved(true);
          toast.success('Credit Limit Overridden', 'Admin authorization verified.');
        }}
        actionName={`override credit limit for ${matchedCustomer?.name || customerName || 'customer'}`}
      />

      {/* Admin Unlock Modal for Large Manual Discount (Problem 5) */}
      <AdminUnlockModal
        isOpen={showDiscountUnlock}
        onClose={() => {
          setShowDiscountUnlock(false);
          setPendingDiscountValue(null);
        }}
        onSuccess={() => {
          setShowDiscountUnlock(false);
          if (pendingDiscountValue !== null) {
            setDiscount({ type: 'flat', value: pendingDiscountValue });
            setPendingDiscountValue(null);
            toast.success('Discount Authorized', 'Admin authorization verified.');
          }
        }}
        actionName={`authorize discount of ${pendingDiscountValue ? formatCurrency(pendingDiscountValue) : ''}`}
      />
    </div>
  );
};
