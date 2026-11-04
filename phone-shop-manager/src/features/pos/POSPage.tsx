import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import '../../components/ui/Badge';
import { useInventoryStore } from '../../store/inventoryStore';
import { useCartStore } from '../../store/cartStore';
import { useCustomerStore } from '../../store/customerStore';
import { useRepairStore } from '../../store/repairStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { computeTodayNetCash } from './posFinancials';
import {
  buildCartQtyMap,
  buildTenderPresets,
  adjustGroupsWithCart,
  countGroupsByCategory,
  filterGroupsByCategory,
  filterProductsBySearch,
  filterSuspendedCarts,
  pickSpeedDialItems,
} from './posFiltering';
import { TransactionHistoryTab } from './TransactionHistoryTab';
import { ReturnExchangeModal } from './ReturnExchangeModal';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import type { PaymentMethod, SaleTransaction, SuspendedCart, PhoneModel, CartItem, Customer } from '../../types';
import { groupProductsByBaseModel } from '../../utils/productGrouping';
import type { ProductGroup } from '../../utils/productGrouping';
import { describeCodeCandidates, resolveProductByCode } from '../../utils/productCode';
import styles from './POS.module.css';
import { formatCurrency, getCurrencySymbol } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePosDensityStore } from '../../store/posDensityStore';
import { errorMessage } from '../../utils/errorUtils';
import { PosOverlayModals } from './PosOverlayModals';
import { PosSpeedDial } from './PosSpeedDial';
import { PosPanelHeader } from './PosPanelHeader';
import { PosProductsToolbar } from './PosProductsToolbar';
import { PosProductGrid } from './PosProductGrid';
import { PosCartHeader } from './PosCartHeader';
import { PosCartCustomerBar } from './PosCartCustomerBar';
import { PosSuspendedCartList } from './PosSuspendedCartList';
import { PosCartItemsList } from './PosCartItemsList';
import { PosCartFooter } from './PosCartFooter';
import { PosCartEmptyState } from './PosCartEmptyState';
import { PosCheckoutUnlockModals } from './PosCheckoutUnlockModals';

export const POSPage = () => {
  usePrivacyStore((s) => s.isPrivacyActive);
  const { fetchProducts, products: allProducts } = useInventoryStore();
  const [searchQuery, setSearchQuery] = useState('');
  const { items, addToCart, removeFromCart, updateQuantity, clearCart, setPayments, setCustomerName, setCustomerPhone, setDiscount, checkout, customerName, customerPhone, discount, getPurchasesSubtotal, getReturnsSubtotal, hasReturnItems, getDiscountAmount, getTotal, getItemCount, suspendedCarts, suspendCart, resumeCart, discardSuspendedCart, fetchCarts, fetchTransactions, transactions, isCheckingOut } = useCartStore();
  const { invoices: partsInvoices } = usePartsCartStore();
  const { tickets } = useRepairStore();
  const { debts } = useCustomerStore();
  const { currency } = useSettingsStore();
  const currencySymbol = getCurrencySymbol(currency);
  const toast = useToast();

  const location = useLocation();
  const posDensity = usePosDensityStore((s) => s.density);
  const [touchQtyTarget, setTouchQtyTarget] = useState<{
    item: CartItem;
    maxStock: number;
    isReturn: boolean;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'products' | 'history'>('products');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>('all');
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
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
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

  // Current cart total
  const total = getTotal();

  // Net payable amount after applying store credit (if active)
  const netPayable = useMemo(() => {
    const availableCredit = (applyStoreCredit && matchedCustomer?.storeCredit) ? matchedCustomer.storeCredit : 0;
    const creditToUse = Math.min(availableCredit, Math.max(0, total));
    return Math.max(0, total - creditToUse);
  }, [total, applyStoreCredit, matchedCustomer]);

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

  // Real-time Today Net Cash in Drawer (strictly cash tender: POS cash + parts cash + repairs cash + debt collections, excluding refunded/cancelled sales)
  const todayNetCash = useMemo(
    () => computeTodayNetCash(transactions, partsInvoices, tickets, debts),
    [transactions, partsInvoices, tickets, debts],
  );

  // Dynamic quick tender denomination presets for Cash checkout
  const tenderPresets = useMemo(
    () => buildTenderPresets(netPayable),
    [netPayable],
  );

  // Fast-Lane Speed-Dial items: high-turnover in-stock items (accessories preferred)
  const speedDialItems = useMemo(
    () => pickSpeedDialItems(allProducts),
    [allProducts],
  );

  // Hardware barcode scanner listener
  const barcodeBuffer = useRef('');
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddToCart = useCallback((product: PhoneModel, productLabel?: string) => {
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

  const handleBarcodeInput = useCallback((code: string) => {
    setScannerScanned(true);
    setTimeout(() => setScannerScanned(false), 1200);

    const resolution = resolveProductByCode(allProducts, code);

    if (resolution.kind === 'ambiguous') {
      // Two rows answer to this code. Guessing here is what sold the neighbour
      // product, so nothing goes in the cart until an admin splits the codes.
      toast.error(
        'Same Code on Two Products',
        `"${code.trim()}" is saved on ${describeCodeCandidates(resolution.candidates)}. Pick the item from the list instead of scanning it.`
      );
      return;
    }

    const product = resolution.kind === 'unique' ? resolution.product : undefined;
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
      toast.error('Product Not Found', `No product found with SKU: ${code.trim()}`);
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
      } catch (err: unknown) {
        console.error(err);
        if (errorMessage(err)?.includes('Credit limit exceeded')) {
          toast.error('Credit Limit Exceeded', errorMessage(err));
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
          // Empty the buffer before handing the code over: a handler that throws
          // used to leave it full, and every scan after it carried the old code.
          const scanned = barcodeBuffer.current;
          barcodeBuffer.current = '';
          if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
          if (scanned.length > 3) {
            handleBarcodeInput(scanned);
          }
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

  const handleBackToCart = () => {
    setShowSuspended(false);
    setHeldSearchQuery('');
  };

  const handleDiscardSuspended = (cart: SuspendedCart) => {
    discardSuspendedCart(cart.id);
    toast.info('Cart Discarded', 'Held cart removed.');
  };

  const handleResumeSuspended = (cart: SuspendedCart) => {
    const res = resumeCart(cart.id);
    setShowSuspended(false);
    if (res.warnings && res.warnings.length > 0) {
      res.warnings.forEach(w => toast.warning('Stock Level Alert', w));
    } else {
      toast.success('Cart Resumed', `Active cart set for ${cart.customerName || 'Walk-in Customer'}`);
    }
  };

  const filteredSuspendedCarts = filterSuspendedCarts(suspendedCarts, heldSearchQuery);

  // Filter sales catalog using local POS search query (server excluded repair parts from the beginning)
  const posFilteredProducts = useMemo(
    () => filterProductsBySearch(allProducts, searchQuery),
    [allProducts, searchQuery],
  );

  // Raw groups from isolated POS catalog (reflect Firestore stock)
  const rawGroups = useMemo(() => groupProductsByBaseModel(posFilteredProducts), [posFilteredProducts]);

  // Build a map of productId → quantity already in cart
  const cartQtyMap = useMemo(() => buildCartQtyMap(items), [items]);

  // Adjust each variant's stock by subtracting cart quantities → real-time "available to add"
  const groups = useMemo(
    () => adjustGroupsWithCart(rawGroups, cartQtyMap),
    [rawGroups, cartQtyMap],
  );

  const categoryCounts = useMemo(() => countGroupsByCategory(groups), [groups]);

  const displayedGroups = useMemo(
    () => filterGroupsByCategory(groups, categoryFilter, subCategoryFilter),
    [groups, categoryFilter, subCategoryFilter],
  );

  const PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when category or search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, categoryFilter, subCategoryFilter]);

  const paginatedGroups = useMemo(() => {
    return displayedGroups.slice(0, visibleCount);
  }, [displayedGroups, visibleCount]);

  const hasMore = displayedGroups.length > visibleCount;
  const remainingCount = Math.max(0, displayedGroups.length - visibleCount);
  const nextBatchCount = Math.min(PAGE_SIZE, remainingCount);

  const handleAddGroupVariant = (group: ProductGroup, variant?: PhoneModel) => {
    const target = variant || (group.variants.length === 1 ? group.variants[0] : null);
    if (target) {
      handleAddToCart(target, `${group.name} ${group.model}`);
    } else {
      setSelectedGroup(group);
    }
  };

  const handleSelectGroup = (group: ProductGroup) => setSelectedGroup(group);

  const handleViewMore = () => setVisibleCount(prev => prev + PAGE_SIZE);

  const handleViewAll = () => setVisibleCount(displayedGroups.length);

  const handleSuspendCart = () => {
    suspendCart();
    toast.info('Cart Placed on Hold', 'Cart saved. You can serve another customer and resume anytime.');
  };

  const handleClearCart = () => {
    clearCart();
    setCustomerAttached(false);
    setDownPayment(0);
    setApplyStoreCredit(false);
    toast.info('Cart Cleared', 'Cart and customer cleared.');
  };

  const handleDetachCustomer = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAttached(false);
    toast.info('Customer Detached', 'Sale will proceed as walk-in buyer.');
  };

  const handleCustomerSelect = (name: string, cust?: Customer | null) => {
    setCustomerName(name);
    if (cust) {
      // Customer selected from dropdown or registered
      setCustomerAttached(true);
      if (cust.phone) {
        setCustomerPhone(cust.phone);
      }
      if (cust.wholesaleDiscountPercent && cust.wholesaleDiscountPercent > 0) {
        setDiscount({ type: 'percent', value: cust.wholesaleDiscountPercent });
        toast.success('Wholesale Discount Applied', `${cust.wholesaleDiscountPercent}% discount applied for ${cust.shopName || cust.name}.`);
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
  };


  return (
    <div
      className={[styles.page, styles[`${posDensity}Density`]].filter(Boolean).join(' ')}
      data-pos-density={posDensity}
      data-pos-root
    >
      <PosOverlayModals
        completedTx={completedTx}
        setCompletedTx={setCompletedTx}
        isCashDrawerOpen={isCashDrawerOpen}
        setIsCashDrawerOpen={setIsCashDrawerOpen}
        selectedGroup={selectedGroup}
        setSelectedGroup={setSelectedGroup}
        addToCart={addToCart}
        touchQtyTarget={touchQtyTarget}
        setTouchQtyTarget={setTouchQtyTarget}
        updateQuantity={updateQuantity}
        isCameraScannerOpen={isCameraScannerOpen}
        setIsCameraScannerOpen={setIsCameraScannerOpen}
      />

      {/* Left: Main Panel */}
      <div className={styles.productsPanel}>
        <PosPanelHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          scannerScanned={scannerScanned}
          setIsCameraScannerOpen={setIsCameraScannerOpen}
          setIsCashDrawerOpen={setIsCashDrawerOpen}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          todayNetCash={todayNetCash}
        />

        {activeTab === 'products' && (
          <PosProductsToolbar
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            subCategoryFilter={subCategoryFilter}
            setSubCategoryFilter={setSubCategoryFilter}
            categoryCounts={categoryCounts}
            groups={groups}
            viewMode={viewMode}
            setViewMode={setViewMode}
          />
        )}

        {/* Speed-Dial Fast Keys Row */}
        {activeTab === 'products' && speedDialItems.length > 0 && !searchQuery.trim() && categoryFilter === 'all' && (
          <PosSpeedDial items={speedDialItems} onAdd={handleAddToCart} />
        )}

        {activeTab === 'products' ? (
          <PosProductGrid
            viewMode={viewMode}
            paginatedGroups={paginatedGroups}
            displayedGroups={displayedGroups}
            onAddToGroup={handleAddGroupVariant}
            onSelectGroup={handleSelectGroup}
            hasMore={hasMore}
            onPageMore={handleViewMore}
            onPageAll={handleViewAll}
            nextBatchCount={nextBatchCount}
            remainingCount={remainingCount}
          />
        ) : (
          <TransactionHistoryTab initialSearch={deepLinkSearch} initialFocusId={deepLinkFocusId} />
        )}
      </div>

      {/* Right: Cart */}
      <div className={styles.cartPanel}>
        <PosCartHeader
          cartBadgeCount={getItemCount()}
          suspendedCount={suspendedCarts.length}
          showSuspended={showSuspended}
          setShowSuspended={setShowSuspended}
          setShowReturnModal={setShowReturnModal}
          hasCartItems={items.length > 0}
          showHoldClear={items.length > 0 || Boolean(customerName)}
          onHold={handleSuspendCart}
          onClear={handleClearCart}
        />

        {/* Customer Attachment Bar (Single Unified Top Zone) */}
        {!showSuspended && (
          <PosCartCustomerBar
            customerAttached={customerAttached}
            customerName={customerName}
            customerPhone={customerPhone}
            matchedCustomer={matchedCustomer}
            onDetach={handleDetachCustomer}
            onSelectCustomer={handleCustomerSelect}
          />
        )}

        {/* Cart Items List */}
        <div className={styles.cartItems}>
          {showSuspended && suspendedCarts.length > 0 ? (
            <PosSuspendedCartList
              suspendedCount={suspendedCarts.length}
              filteredSuspendedCarts={filteredSuspendedCarts}
              heldSearchQuery={heldSearchQuery}
              setHeldSearchQuery={setHeldSearchQuery}
              onBackToCart={handleBackToCart}
              onResume={handleResumeSuspended}
              onDiscard={handleDiscardSuspended}
            />
          ) : items.length === 0 ? (
            <PosCartEmptyState customerName={customerName} />
          ) : (
            <PosCartItemsList
              items={items}
              allProducts={allProducts}
              updateQuantity={updateQuantity}
              removeFromCart={removeFromCart}
              setTouchQtyTarget={setTouchQtyTarget}
            />
          )}
        </div>

        {/* Order Summary & Checkout Footer */}
        {items.length > 0 && (
          <PosCartFooter
            items={items}
            getTotal={getTotal}
            getPurchasesSubtotal={getPurchasesSubtotal}
            getReturnsSubtotal={getReturnsSubtotal}
            getDiscountAmount={getDiscountAmount}
            hasReturnItems={hasReturnItems}
            matchedCustomer={matchedCustomer}
            currentCustomerDebt={currentCustomerDebt}
            creditDebtToLog={creditDebtToLog}
            netPayable={netPayable}
            isCreditLimitExceeded={isCreditLimitExceeded}
            tenderPresets={tenderPresets}
            currencySymbol={currencySymbol}
            isAdmin={isAdmin}
            creditLimitOverrideApproved={creditLimitOverrideApproved}
            isBusy={isBusy}
            handleCheckout={handleCheckout}
            paymentMode={paymentMode}
            setPaymentMode={setPaymentMode}
            surplusRefundMethod={surplusRefundMethod}
            setSurplusRefundMethod={setSurplusRefundMethod}
            applyStoreCredit={applyStoreCredit}
            setApplyStoreCredit={setApplyStoreCredit}
            cashTendered={cashTendered}
            setCashTendered={setCashTendered}
            downPayment={downPayment}
            setDownPayment={setDownPayment}
            customerName={customerName}
            customerPhone={customerPhone}
            setCustomerPhone={setCustomerPhone}
            customerAttached={customerAttached}
            pendingDiscountValue={pendingDiscountValue}
            setPendingDiscountValue={setPendingDiscountValue}
            discount={discount}
            setDiscount={setDiscount}
            setShowCreditLimitUnlock={setShowCreditLimitUnlock}
            setShowDiscountUnlock={setShowDiscountUnlock}
          />
        )}
      </div>

      {/* Return & Exchange Modal */}
      <ReturnExchangeModal
        isOpen={showReturnModal}
        onClose={() => setShowReturnModal(false)}
      />

      <PosCheckoutUnlockModals
        showCreditLimitUnlock={showCreditLimitUnlock}
        setShowCreditLimitUnlock={setShowCreditLimitUnlock}
        setCreditLimitOverrideApproved={setCreditLimitOverrideApproved}
        showDiscountUnlock={showDiscountUnlock}
        setShowDiscountUnlock={setShowDiscountUnlock}
        pendingDiscountValue={pendingDiscountValue}
        setPendingDiscountValue={setPendingDiscountValue}
        setDiscount={setDiscount}
        matchedCustomer={matchedCustomer}
        customerName={customerName}
        total={total}
        discountBase={getPurchasesSubtotal()}
        items={items}
      />
    </div>
  );
};
