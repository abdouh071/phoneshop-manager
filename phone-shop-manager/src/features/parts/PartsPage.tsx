import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Minus, Trash2, ShoppingCart, X, Package, AlertTriangle, ChevronDown, ChevronUp, ChevronRight, CornerDownRight, Eye, ClipboardList, TrendingUp, DollarSign, User, UserCheck, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { StockBadge } from '../../components/ui/Badge';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { useInventoryStore } from '../../store/inventoryStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { groupProductsByBaseModel } from '../../utils/productGrouping';
import type { ProductGroup } from '../../utils/productGrouping';
import type { PhoneModel, PaymentMethod, SuspendedCart } from '../../types';

// Modals
import { ReceiptModal } from '../pos/ReceiptModal';
import { VariantSelectModal } from '../pos/VariantSelectModal';
import { AddPartModal } from './AddPartModal';
import { EditPartPanel } from './EditPartPanel';
import { ProductDetailPanel } from '../inventory/ProductDetailPanel';
import { WriteOffModal } from '../inventory/WriteOffModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { PrintPartsLabelsModal } from './PrintPartsLabelsModal';
import { RestockHistoryPanel } from '../inventory/RestockHistoryPanel';
import { WriteOffLogPanel } from '../inventory/WriteOffLogPanel';
import { useRestockHandler } from '../inventory/useRestockHandler';
import { CustomerAutocompleteInput } from '../pos/CustomerAutocompleteInput';
import { QuickAddShopModal } from './QuickAddShopModal';
import { B2BPartsCheckoutModal } from './B2BPartsCheckoutModal';
import { PartsInvoiceModal } from './PartsInvoiceModal';
import { PartsInvoicesTab } from './PartsInvoicesTab';
import { RestockAssistantModal } from './RestockAssistantModal';
import { CustomerProfilePanel } from '../customers/CustomerProfilePanel';
import { useCustomerStore } from '../../store/customerStore';
import type { Customer, CustomerDebtEntry, SaleTransaction } from '../../types';
import { Store, Bell } from 'lucide-react';

import styles from './Parts.module.css';
import posStyles from '../pos/POS.module.css';
import b2bStyles from './B2BParts.module.css';
import { errorMessage } from '../../utils/errorUtils';

// ─── HELPER COMPONENTS & UTILS ───────────────────────────────────────────

const margin = (p: PhoneModel) =>
  p.price > 0 ? (((p.price - p.costPrice) / p.price) * 100) : 0;


const ProductCard: React.FC<{ group: ProductGroup; onAdd: () => void }> = ({ group, onAdd }) => {
  const metaText = (() => {
    if (group.variants.length > 1) return `${group.variants.length} Variants`;
    const v = group.variants[0];
    const parts = [
      v.storage && v.storage !== 'N/A' ? v.storage : null,
      v.color && v.color !== 'N/A' ? v.color : null,
    ].filter(Boolean);
    return parts.join(' · ');
  })();

  return (
    <div
      className={[styles.productCard, group.stockStatus === 'out_of_stock' && styles.disabled].filter(Boolean).join(' ')}
      onClick={group.stockStatus !== 'out_of_stock' ? onAdd : undefined}
    >
      <div className={styles.productCardTop}>
        <div className={styles.productCardBrand}>{group.name[0]}</div>
        <StockBadge status={group.stockStatus} />
      </div>
      <p className={styles.productCardName}>{group.name} {group.model}</p>
      {metaText ? <p className={styles.productCardMeta}>{metaText}</p> : null}
      <div className={styles.productCardStock}>
        {group.totalStock > 0 ? (
          <span>📦 {group.totalStock} units left</span>
        ) : (
          <span className={styles.maxReached}>⚠️ Out of stock</span>
        )}
      </div>
      <p className={styles.productCardPrice}>
        {group.variants.length === 1 
          ? formatCurrency(group.variants[0].price) 
          : `${formatCurrency(group.minPrice)} - ${formatCurrency(group.maxPrice)}`}
      </p>
      <button
        type="button"
        className={styles.addBtn}
        disabled={group.stockStatus === 'out_of_stock'}
        onClick={e => { e.stopPropagation(); onAdd(); }}
      >
        <Plus size={14} /> Add
      </button>
    </div>
  );
};

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: '💵 Cash' },
  { value: 'card', label: '💳 Card' },
  { value: 'mobile', label: '📱 Mobile Pay' },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────

export const PartsPage = () => {
  const { t } = useTranslation();
  const { fetchParts, parts } = useInventoryStore();
  const partsOnly = parts;
  const { items, addToCart, removeFromCart, updateQuantity, clearCart, setPayments, setCustomerName, setDiscount, checkout, customerName, discount, getSubtotal, getTotal, getItemCount, suspendedCarts, suspendCart, resumeCart, discardSuspendedCart, fetchCarts } = usePartsCartStore();
  const permissions = usePermissions();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const [pendingDiscountValue, setPendingDiscountValue] = useState<number | null>(null);
  const [showDiscountUnlock, setShowDiscountUnlock] = useState(false);

  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);

  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'inventory' | 'pos' | 'invoices'>('inventory');

  // Local isolated search query & sorting (completely separated from POS Page and Inventory Page)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortKey, setSortKey] = useState<keyof PhoneModel>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Modals & Panels state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isRestockAssistantOpen, setIsRestockAssistantOpen] = useState(false);
  const [isRestockLogOpen, setIsRestockLogOpen] = useState(false);
  const [isWriteOffLogOpen, setIsWriteOffLogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PhoneModel | null>(null);
  const [detailProduct, setDetailProduct] = useState<PhoneModel | null>(null);
  const [writeOffProduct, setWriteOffProduct] = useState<PhoneModel | null>(null);
  const [completedTx, setCompletedTx] = useState<SaleTransaction | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null);
  const [actionRequiringUnlock, setActionRequiringUnlock] = useState<{ name: string; callback: () => void } | null>(null);

  // B2B State
  const { customers, fetchCustomers, getCustomerDebtTotal } = useCustomerStore();
  const [selectedB2BCustomer, setSelectedB2BCustomer] = useState<Customer | null>(null);
  const [isQuickAddShopOpen, setIsQuickAddShopOpen] = useState(false);
  const [isB2BCheckoutOpen, setIsB2BCheckoutOpen] = useState(false);
  const [completedB2BTx, setCompletedB2BTx] = useState<{ transaction: SaleTransaction; debtEntry?: CustomerDebtEntry; invoiceNumber: string } | null>(null);
  const [profilePanelCustomer, setProfilePanelCustomer] = useState<Customer | null>(null);

  // Inventory Table State
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [restockAmt, setRestockAmt] = useState('');
  const [restockMeta, setRestockMeta] = useState({ supplier: '', cost: '', note: '' });

  // Load parts from server (where category == 'repair_part' from the beginning), carts & customers
  useEffect(() => { fetchParts(); }, [fetchParts]);
  useEffect(() => { fetchCarts(); }, [fetchCarts]);
  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Handle deep links from Activity Log or Customer Profile (e.g. /parts?b2bCustomer=...)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const b2bCustId = params.get('b2bCustomer');
    if (b2bCustId && customers.length > 0) {
      const match = customers.find(c => c.id === b2bCustId);
      if (match) {
        setSelectedB2BCustomer(match);
        setCustomerName(match.name);
        setActiveTab('pos');
      }
    }
  }, [location.search, customers, setCustomerName]);

  // Handle deep links from Activity Log (e.g. /parts?search=Screen&focusId=...)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get('search');
    const focusId = params.get('focusId');
    const target = focusId || search;

    if (search && !focusId) {
      setSearchQuery(search);
    }

    if (!target || parts.length === 0) return;

    const q = target.toLowerCase().trim();
    const match = parts.find(p => {
      const full = (p.name + ' ' + p.model).toLowerCase().trim();
      const name = p.name.toLowerCase().trim();
      const sku = (p.sku || '').toLowerCase().trim();
      return (
        p.id === target ||
        sku === q ||
        full.includes(q) ||
        q.includes(full) ||
        name.includes(q) ||
        q.includes(name)
      );
    });

    if (match) {
      setActiveTab('inventory');
      const timer = setTimeout(() => {
        setDetailProduct(match);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [location.search, parts]);

  const requirePermission = (actionName: string, callback: () => void) => {
    if (user?.role === 'admin' || permissions.inventory_edit) {
      callback();
    } else {
      setActionRequiringUnlock({ name: actionName, callback });
    }
  };

  // Hardware barcode scanner listener for Parts POS (Problem 9 fix)
  const barcodeBuffer = useRef('');
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarcodeInput = (sku: string) => {
    const part = parts.find(p => p.sku && p.sku.toLowerCase() === sku.toLowerCase());
    if (part) {
      const result = addToCart(part);
      if (result.success) {
        setActiveTab('pos');
        toast.success('Added to Cart', `${part.name} ${part.model} added via barcode.`);
      } else if (result.reason === 'out_of_stock') {
        toast.error('Out of Stock', `${part.name} ${part.model} has no units left.`);
      } else {
        toast.warning('Stock Limit Reached', `Only ${result.availableStock} unit${result.availableStock === 1 ? '' : 's'} available.`);
      }
    } else {
      toast.error('Part Not Found', `No spare part found with SKU/barcode: ${sku}`);
    }
  };

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
  }, [parts, addToCart, toast]);

  // Filter products for Parts ONLY (isolated local filters)
  // The server only returned repair parts from the beginning (no client category filter needed)
  const rawFilteredProducts = useMemo(() => {
    let p = parts;
    if (statusFilter !== 'all') {
      p = p.filter(prod => prod.stockStatus === statusFilter);
    }
    if (searchQuery.trim()) {
      const words = searchQuery.toLowerCase().trim().split(/\s+/);
      p = p.filter(prod => {
        const full = [prod.name, prod.model, prod.sku, prod.location, prod.supplier, prod.notes].filter(Boolean).join(' ').toLowerCase();
        return words.every(w => full.includes(w));
      });
    }
    return p;
  }, [parts, statusFilter, searchQuery]);

  const groups = useMemo(() => groupProductsByBaseModel(rawFilteredProducts), [rawFilteredProducts]);

  // Sort groups
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      let valA: string | number = (a[sortKey as keyof ProductGroup] ?? '') as string | number;
      let valB: string | number = (b[sortKey as keyof ProductGroup] ?? '') as string | number;
      if (sortKey === 'price') { valA = a.minPrice; valB = b.minPrice; }
      if (sortKey === 'costPrice') { valA = a.minCost; valB = b.minCost; }
      if (sortKey === 'stock') { valA = a.totalStock; valB = b.totalStock; }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [groups, sortKey, sortDir]);

  // Pagination for Inventory
  const totalPages = Math.ceil(sortedGroups.length / itemsPerPage);
  const paginatedGroups = sortedGroups.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Financials & Stock metrics
  const totalInventoryValue = useMemo(() => {
    return partsOnly.reduce((sum, p) => sum + (p.costPrice || 0) * (p.stock || 0), 0);
  }, [partsOnly]);

  const potentialRevenue = useMemo(() => {
    return partsOnly.reduce((sum, p) => sum + (p.price || 0) * (p.stock || 0), 0);
  }, [partsOnly]);

  const lowStockCount = useMemo(() => {
    return partsOnly.filter(p => p.stockStatus === 'low_stock' || p.stockStatus === 'out_of_stock').length;
  }, [partsOnly]);

  const handleSort = (key: keyof PhoneModel) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: keyof PhoneModel }) => {
    if (sortKey !== col) return <span className={styles.sortNeutral}><ChevronUp size={12} /><ChevronDown size={12} /></span>;
    return <span>{sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>;
  };

  const toggleExpand = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Restock handler
  const handleRestock = useRestockHandler(() => restockAmt, restockMeta, () => {
    setRestockingId(null);
    setRestockAmt('');
    setRestockMeta({ supplier: '', note: '', cost: '' });
  });

  // POS State
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('cash');
  const [, setAmountPaid] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // Synchronous lock prevents duplicate submissions even on rapid multi-clicks
  const checkoutLock = useRef(false);
  const [showSuspended, setShowSuspended] = useState(false);

  const handleCheckout = async () => {
    if (items.length === 0 || isProcessing || checkoutLock.current) return;
    checkoutLock.current = true;
    setIsProcessing(true);
    try {
      const tx = await checkout();
      setCompletedTx(tx);
      setAmountPaid('');
    } catch (err: unknown) {
      toast.error('Checkout failed', errorMessage(err));
    } finally {
      setIsProcessing(false);
      checkoutLock.current = false;
    }
  };

  return (
    <div className={styles.page}>
      {/* Modals & Dialogs */}
      <AddPartModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
      <EditPartPanel product={editingProduct} onClose={() => setEditingProduct(null)} />
      <ProductDetailPanel product={detailProduct} onClose={() => setDetailProduct(null)} onEdit={(p) => { setDetailProduct(null); requirePermission('edit this product', () => setEditingProduct(p)); }} />
      <WriteOffModal product={writeOffProduct} onClose={() => setWriteOffProduct(null)} />
      <PrintPartsLabelsModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} />
      <RestockHistoryPanel isOpen={isRestockLogOpen} onClose={() => setIsRestockLogOpen(false)} />
      <WriteOffLogPanel isOpen={isWriteOffLogOpen} onClose={() => setIsWriteOffLogOpen(false)} />
      
      <AdminUnlockModal 
        isOpen={actionRequiringUnlock !== null} 
        onClose={() => setActionRequiringUnlock(null)} 
        onSuccess={() => { actionRequiringUnlock?.callback(); setActionRequiringUnlock(null); }}
        actionName={actionRequiringUnlock?.name} 
      />

      <AdminUnlockModal
        isOpen={showDiscountUnlock}
        onClose={() => {
          setShowDiscountUnlock(false);
          setPendingDiscountValue(null);
        }}
        onSuccess={() => {
          setShowDiscountUnlock(false);
          if (pendingDiscountValue !== null) {
            setDiscount(pendingDiscountValue);
            setPendingDiscountValue(null);
            toast.success('Discount Authorized', 'Admin authorization verified.');
          }
        }}
        actionName={`authorize parts discount of ${pendingDiscountValue ? formatCurrency(pendingDiscountValue) : ''}`}
      />

      <ReceiptModal
        transaction={completedTx}
        onClose={() => setCompletedTx(null)}
      />

      <QuickAddShopModal
        isOpen={isQuickAddShopOpen}
        onClose={() => setIsQuickAddShopOpen(false)}
        onCustomerCreated={(newCust) => {
          setSelectedB2BCustomer(newCust);
          setCustomerName(newCust.name);
          toast.success('B2B Account Attached', `${newCust.shopName || newCust.name} attached to cart.`);
        }}
      />

      {selectedB2BCustomer && (
        <B2BPartsCheckoutModal
          isOpen={isB2BCheckoutOpen}
          onClose={() => setIsB2BCheckoutOpen(false)}
          customer={selectedB2BCustomer}
          onSuccess={(result) => {
            setCompletedB2BTx(result);
            setSelectedB2BCustomer(null);
          }}
        />
      )}

      <PartsInvoiceModal
        transaction={completedB2BTx?.transaction || null}
        debtEntry={completedB2BTx?.debtEntry}
        onClose={() => setCompletedB2BTx(null)}
      />

      <CustomerProfilePanel
        customer={profilePanelCustomer}
        isOpen={!!profilePanelCustomer}
        onClose={() => setProfilePanelCustomer(null)}
      />

      <VariantSelectModal
        group={selectedGroup}
        onClose={() => setSelectedGroup(null)}
        onSelect={(variant) => {
          addToCart(variant);
          setSelectedGroup(null);
        }}
      />

      <RestockAssistantModal
        isOpen={isRestockAssistantOpen}
        onClose={() => setIsRestockAssistantOpen(false)}
      />

      {/* Warning Banner (matches Inventory style with 1-click filter) */}
      {lowStockCount > 0 && activeTab === 'inventory' && (
        <div className={styles.warningBanner}>
          <div className={styles.warningLeft}>
            <AlertTriangle size={18} />
            <span><strong>Attention Needed:</strong> {lowStockCount} repair parts are running low or out of stock.</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className={styles.warningActionBtn}
              onClick={() => requirePermission('open Restock Assistant', () => setIsRestockAssistantOpen(true))}
              style={{ background: '#d97706', color: '#ffffff', borderColor: '#b45309', fontWeight: 700 }}
            >
              ⚡ Restock Assistant & PO
            </button>
            <button
              type="button"
              className={styles.warningActionBtn}
              onClick={() => {
                setStatusFilter(statusFilter === 'low_stock' ? 'all' : 'low_stock');
                setCurrentPage(1);
              }}
            >
              {statusFilter === 'low_stock' ? 'Show All Parts' : 'Filter Low Stock'}
            </button>
          </div>
        </div>
      )}

      {/* Modern Page Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('parts.title', 'Parts Management')}</h1>
          <p className={styles.subtitle}>{partsOnly.length} parts available · {partsOnly.reduce((s, p) => s + p.stock, 0)} units in stock</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant={lowStockCount > 0 ? 'primary' : 'secondary'}
            leftIcon={<Bell size={16} />}
            onClick={() => requirePermission('open Restock Assistant', () => setIsRestockAssistantOpen(true))}
            style={lowStockCount > 0 ? { background: '#d97706', borderColor: '#b45309' } : undefined}
            title="Smart Restock Assistant & Supplier PO Generator"
          >
            {t('parts.restockAssistant', 'Restock Assistant')} {lowStockCount > 0 && `(${lowStockCount})`}
          </Button>
          <Button variant="secondary" leftIcon={<ClipboardList size={16} />} onClick={() => requirePermission('view restock log', () => setIsRestockLogOpen(true))}>
            {t('inventory.restockHistory', 'Restock Log')}
          </Button>
          <Button variant="secondary" leftIcon={<AlertTriangle size={16} />} onClick={() => requirePermission('view write-off log', () => setIsWriteOffLogOpen(true))}>
            {t('inventory.writeOffLog', 'Write-Off Log')}
          </Button>
          <Button variant="secondary" leftIcon={<Package size={16} />} onClick={() => setIsPrintOpen(true)}>
            {t('parts.printLabels', 'Print Labels')}
          </Button>
          <Button leftIcon={<Plus size={16} />} onClick={() => requirePermission('add a new part', () => setIsAddOpen(true))}>
            {t('parts.addPart', 'Add Part')}
          </Button>
        </div>
      </div>

      {/* Mode Tabs (Segmented Apple Pill style) */}
      <div className={styles.categoryTabs}>
        <button
          type="button"
          className={[styles.categoryTab, activeTab === 'inventory' && styles.categoryTabActive].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('inventory')}
        >
          <span>📦 {t('parts.title', 'Parts Inventory')}</span>
          <span className={styles.tabCount}>{partsOnly.length}</span>
        </button>
        {permissions.parts_sell && (
          <button 
            type="button"
            className={[styles.categoryTab, activeTab === 'pos' && styles.categoryTabActive].filter(Boolean).join(' ')}
            onClick={() => setActiveTab('pos')}
          >
            <span>🛒 {t('sidebar.pos', 'Sell Parts (POS)')}</span>
            <span className={styles.tabCount}>{getItemCount() > 0 ? `${getItemCount()} in cart` : 'POS'}</span>
          </button>
        )}
        <button
          type="button"
          className={[styles.categoryTab, activeTab === 'invoices' && styles.categoryTabActive].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('invoices')}
        >
          <span>📄 Invoices & Orders</span>
        </button>
      </div>

      {activeTab === 'inventory' ? (
        // ─── INVENTORY TAB ──────────────────────────────────────────────
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Interactive 6-KPI Summary Grid */}
          <div className={styles.summaryGrid}>
            <div
              className={[styles.summaryCard, statusFilter === 'all' && styles.summaryCardActive].filter(Boolean).join(' ')}
              onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
              title="Click to view all parts"
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Total Parts</span>
                <div className={[styles.summaryIconWrap, styles.iconTotal].join(' ')}><Package size={16} /></div>
              </div>
              <p className={styles.summaryValue}>{partsOnly.length}</p>
            </div>

            <div
              className={[styles.summaryCard, statusFilter === 'in_stock' && styles.summaryCardActive].filter(Boolean).join(' ')}
              onClick={() => { setStatusFilter(statusFilter === 'in_stock' ? 'all' : 'in_stock'); setCurrentPage(1); }}
              title="Click to filter In Stock"
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>In Stock</span>
                <div className={[styles.summaryIconWrap, styles.iconInStock].join(' ')}><CheckCircle2 size={16} /></div>
              </div>
              <p className={styles.summaryValue} style={{ color: '#16a34a' }}>
                {partsOnly.filter(p => p.stockStatus === 'in_stock').length}
              </p>
            </div>

            <div
              className={[styles.summaryCard, statusFilter === 'low_stock' && styles.summaryCardActive].filter(Boolean).join(' ')}
              onClick={() => { setStatusFilter(statusFilter === 'low_stock' ? 'all' : 'low_stock'); setCurrentPage(1); }}
              title="Click to filter Low Stock"
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Low Stock</span>
                <div className={[styles.summaryIconWrap, styles.iconLowStock].join(' ')}><AlertCircle size={16} /></div>
              </div>
              <p className={styles.summaryValue} style={{ color: '#d97706' }}>
                {partsOnly.filter(p => p.stockStatus === 'low_stock').length}
              </p>
            </div>

            <div
              className={[styles.summaryCard, statusFilter === 'out_of_stock' && styles.summaryCardActive].filter(Boolean).join(' ')}
              onClick={() => { setStatusFilter(statusFilter === 'out_of_stock' ? 'all' : 'out_of_stock'); setCurrentPage(1); }}
              title="Click to filter Out of Stock"
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Out of Stock</span>
                <div className={[styles.summaryIconWrap, styles.iconOutStock].join(' ')}><XCircle size={16} /></div>
              </div>
              <p className={styles.summaryValue} style={{ color: '#dc2626' }}>
                {partsOnly.filter(p => p.stockStatus === 'out_of_stock').length}
              </p>
            </div>

            {canViewCosts && (
              <div className={styles.summaryCard} style={{ cursor: 'default' }}>
                <div className={styles.summaryCardTop}>
                  <span className={styles.summaryLabel}>Cost Valuation</span>
                  <div className={[styles.summaryIconWrap, styles.iconValuation].join(' ')}><DollarSign size={16} /></div>
                </div>
                <p className={styles.summaryValue}>{formatPrivateCurrency(totalInventoryValue)}</p>
              </div>
            )}

            <div className={styles.summaryCard} style={{ cursor: 'default' }}>
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>Potential Revenue</span>
                <div className={[styles.summaryIconWrap, styles.iconRevenue].join(' ')}><TrendingUp size={16} /></div>
              </div>
              <p className={styles.summaryValue}>{formatCurrency(potentialRevenue)}</p>
            </div>
          </div>

          {/* Catalog Table Card */}
          <div className={styles.catalogCard}>
            <div className={styles.tableHeader}>
              <div className={styles.headerLeft}>
                <h2 className={styles.tableTitle}>Parts Catalog</h2>
                <span className={styles.itemCountBadge}>{sortedGroups.length} models</span>
              </div>
              <div className={styles.headerActions}>
                <Select
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'in_stock', label: 'In Stock' },
                    { value: 'low_stock', label: 'Low Stock' },
                    { value: 'out_of_stock', label: 'Out of Stock' },
                  ]}
                  value={statusFilter}
                  onChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}
                />
                <SearchInput
                  value={searchQuery}
                  onChange={(v) => { setSearchQuery(v); setCurrentPage(1); }}
                  placeholder="Search parts, SKU, location..."
                  className={styles.search}
                />
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th className={styles.th} onClick={() => handleSort('name')}>
                      Part Name <SortIcon col="name" />
                    </th>
                    <th className={styles.th} onClick={() => handleSort('sku')}>
                      SKU <SortIcon col="sku" />
                    </th>
                    <th className={styles.th} onClick={() => handleSort('location')}>
                      Location <SortIcon col="location" />
                    </th>
                    {canViewCosts && (
                      <th className={styles.th} onClick={() => handleSort('costPrice')}>
                        Buy Price / Cost <SortIcon col="costPrice" />
                      </th>
                    )}
                    <th className={styles.th} onClick={() => handleSort('price')}>
                      Sell Price <SortIcon col="price" />
                    </th>
                    <th className={styles.th} onClick={() => handleSort('stock')}>
                      Stock <SortIcon col="stock" />
                    </th>
                    {canViewCosts && (
                      <th className={styles.th}>Margin</th>
                    )}
                    <th className={styles.th} onClick={() => handleSort('stockStatus')}>
                      Status <SortIcon col="stockStatus" />
                    </th>
                    <th className={styles.th} style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedGroups.length === 0 ? (
                    <tr>
                      <td colSpan={canViewCosts ? 10 : 8} style={{ padding: '40px 20px', textAlign: 'center' }}>
                        <EmptyState
                          title="No repair parts found"
                          description="Click 'Add Part' in the header to register new repair inventory."
                        />
                      </td>
                    </tr>
                  ) : paginatedGroups.map(group => {
                    const isExpanded = expandedGroups.has(group.id);
                    const isSingle = group.variants.length === 1;
                    const single = group.variants[0];
                    const singleMargin = isSingle ? margin(single) : null;
                    
                    return (
                      <React.Fragment key={group.id}>
                        <tr className={[styles.tr, styles.trGroup].join(' ')}>
                          <td className={styles.td} onClick={() => !isSingle && toggleExpand(group.id)} style={{ cursor: !isSingle ? 'pointer' : 'default' }}>
                            {!isSingle ? (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
                          </td>
                          <td className={styles.td} onClick={() => !isSingle ? toggleExpand(group.id) : null} style={{ cursor: !isSingle ? 'pointer' : 'default' }}>
                            <div className={styles.productCell}>
                              <div className={styles.productAvatar}>{group.name[0]}</div>
                              <div>
                                <p className={styles.productName}>{group.name} {group.model}</p>
                                <div className={styles.productMeta}>
                                  {!isSingle ? (
                                    <span className={styles.tagPill}>{group.variants.length} Variants</span>
                                  ) : (
                                    <span>{single.color || 'Standard'}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className={styles.td}>
                            {isSingle ? <code className={styles.sku}>{single.sku}</code> : <span style={{ color: 'var(--color-on-surface-variant)' }}>-</span>}
                          </td>
                          <td className={styles.td}>{isSingle ? single.location || '-' : '-'}</td>
                          {canViewCosts && (
                            <td className={styles.td} data-col="cost">
                              <span data-privacy-cost className="privacy-cost">
                                {isSingle
                                  ? formatPrivateCurrency(single.costPrice)
                                  : group.minCost === group.maxCost
                                    ? formatPrivateCurrency(group.minCost)
                                    : (isPrivacyActive ? '•••••' : `${formatCurrency(group.minCost)} - ${formatCurrency(group.maxCost)}`)}
                              </span>
                            </td>
                          )}
                          <td className={styles.td} style={{ fontWeight: 600 }}>
                            {isSingle
                              ? formatCurrency(single.price)
                              : group.minPrice === group.maxPrice
                                ? formatCurrency(group.minPrice)
                                : `${formatCurrency(group.minPrice)} - ${formatCurrency(group.maxPrice)}`}
                          </td>
                          <td className={styles.td}>
                            <strong>{group.totalStock}</strong> units
                          </td>
                          {canViewCosts && (
                            <td className={styles.td} data-col="margin">
                              {singleMargin !== null ? (
                                <span data-privacy-cost className={[singleMargin >= 20 ? styles.marginGood : singleMargin >= 10 ? styles.marginOk : styles.marginBad, 'privacy-cost'].join(' ')}>
                                  {isPrivacyActive ? '••%' : `${singleMargin.toFixed(1)}%`}
                                </span>
                              ) : '-'}
                            </td>
                          )}
                          <td className={styles.td}><StockBadge status={group.stockStatus} /></td>
                          <td className={styles.td} style={{ textAlign: 'right' }}>
                            {isSingle && (() => {
                              const v = single;
                              return restockingId === v.id ? (
                                <div className={styles.restockInline} style={{ justifyContent: 'flex-end' }}>
                                  <input
                                    autoFocus
                                    type="number"
                                    min="1"
                                    placeholder="Qty *"
                                    value={restockAmt}
                                    onChange={e => setRestockAmt(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Escape') { setRestockingId(null); setRestockAmt(''); } }}
                                    className={styles.restockInput}
                                    style={{ width: '64px' }}
                                  />
                                  {canViewCosts && (
                                    <input
                                      type="number"
                                      placeholder="Unit cost"
                                      value={restockMeta.cost}
                                      onChange={e => setRestockMeta(m => ({ ...m, cost: e.target.value }))}
                                      className={styles.restockInput}
                                      style={{ width: '80px' }}
                                    />
                                  )}
                                  <Button size="sm" onClick={() => handleRestock(v)}>Save</Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setRestockingId(null); setRestockAmt(''); }}>✕</Button>
                                </div>
                              ) : (
                                <div className={styles.actionButtons} style={{ justifyContent: 'flex-end' }}>
                                  <Button variant="ghost" size="sm" onClick={() => setDetailProduct(v)} title="View Details">
                                    <Eye size={15} />
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={() => requirePermission('edit this product', () => setEditingProduct(v))}>
                                    Edit
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={() => requirePermission('restock products', () => { setRestockingId(v.id); setRestockAmt(''); })}>
                                    + Restock
                                  </Button>
                                  <Button variant="danger" size="sm" onClick={() => requirePermission('write off products', () => setWriteOffProduct(v))} disabled={v.stock === 0} title="Write-Off">
                                    <AlertTriangle size={15} />
                                  </Button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                        
                        {/* Variant Sub-Rows */}
                        {isExpanded && group.variants.map(product => {
                          const vMargin = margin(product);
                          return (
                            <tr key={product.id} className={[styles.tr, styles.trVariant].join(' ')}>
                              <td className={styles.td}><CornerDownRight size={14} style={{ marginLeft: 8, opacity: 0.5 }} /></td>
                              <td className={styles.td}><p className={styles.productName} style={{ paddingLeft: '8px' }}>{product.color || product.name}</p></td>
                              <td className={styles.td}><code className={styles.sku}>{product.sku}</code></td>
                              <td className={styles.td}>{product.location || '-'}</td>
                              {canViewCosts && (
                                <td className={styles.td} data-col="cost">
                                  <span data-privacy-cost className="privacy-cost">
                                    {formatPrivateCurrency(product.costPrice)}
                                  </span>
                                </td>
                              )}
                              <td className={styles.td} style={{ fontWeight: 600 }}>{formatCurrency(product.price)}</td>
                              <td className={styles.td}>{product.stock} units</td>
                              {canViewCosts && (
                                <td className={styles.td} data-col="margin">
                                  <span data-privacy-cost className={[vMargin >= 20 ? styles.marginGood : vMargin >= 10 ? styles.marginOk : styles.marginBad, 'privacy-cost'].join(' ')}>
                                    {isPrivacyActive ? '••%' : `${vMargin.toFixed(1)}%`}
                                  </span>
                                </td>
                              )}
                              <td className={styles.td}><StockBadge status={product.stockStatus} /></td>
                              <td className={styles.td} style={{ textAlign: 'right' }}>
                                {restockingId === product.id ? (
                                  <div className={styles.restockInline} style={{ justifyContent: 'flex-end' }}>
                                    <input
                                      autoFocus
                                      type="number"
                                      min="1"
                                      placeholder="Qty *"
                                      value={restockAmt}
                                      onChange={e => setRestockAmt(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Escape') { setRestockingId(null); setRestockAmt(''); } }}
                                      className={styles.restockInput}
                                      style={{ width: '64px' }}
                                    />
                                    {canViewCosts && (
                                      <input
                                        type="number"
                                        placeholder="Unit cost"
                                        value={restockMeta.cost}
                                        onChange={e => setRestockMeta(m => ({ ...m, cost: e.target.value }))}
                                        className={styles.restockInput}
                                        style={{ width: '80px' }}
                                      />
                                    )}
                                    <Button size="sm" onClick={() => handleRestock(product)}>Save</Button>
                                    <Button size="sm" variant="ghost" onClick={() => { setRestockingId(null); setRestockAmt(''); }}>✕</Button>
                                  </div>
                                ) : (
                                  <div className={styles.actionButtons} style={{ justifyContent: 'flex-end' }}>
                                    <Button variant="ghost" size="sm" onClick={() => setDetailProduct(product)} title="View Details">
                                      <Eye size={15} />
                                    </Button>
                                    <Button variant="secondary" size="sm" onClick={() => requirePermission('edit this product', () => setEditingProduct(product))}>
                                      Edit
                                    </Button>
                                    <Button variant="secondary" size="sm" onClick={() => requirePermission('restock products', () => { setRestockingId(product.id); setRestockAmt(''); })}>
                                      + Restock
                                    </Button>
                                    <Button variant="danger" size="sm" onClick={() => requirePermission('write off products', () => setWriteOffProduct(product))} disabled={product.stock === 0} title="Write-Off">
                                      <AlertTriangle size={15} />
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sortedGroups.length > 0 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0' }}>
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  itemsPerPage={itemsPerPage}
                  totalItems={sortedGroups.length}
                />
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'pos' ? (
        // ─── POS TAB ────────────────────────────────────────────────────
        <div className={styles.posContainer}>
          <div className={styles.productsPanel}>
            <div className={styles.catalogCard} style={{ padding: '12px 16px' }}>
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search parts to sell…"
                className={styles.search}
              />
            </div>

            <div className={styles.productsGrid}>
              {groups.map(group => (
                <ProductCard 
                  key={group.id} 
                  group={group} 
                  onAdd={() => {
                    if (group.variants.length === 1) {
                      addToCart(group.variants[0]);
                    } else {
                      setSelectedGroup(group);
                    }
                  }} 
                />
              ))}
            </div>
          </div>
          
          {/* Cart Sidebar */}
          <div className={posStyles.cartPanel}>
            <div className={posStyles.cartHeader}>
              <div className={posStyles.cartTitle}>
                <ShoppingCart size={20} />
                <span>Cart</span>
                {getItemCount() > 0 && (
                  <span className={posStyles.cartCount}>{getItemCount()}</span>
                )}
                {suspendedCarts.length > 0 && (
                  <button 
                    className={posStyles.suspendedBadge} 
                    onClick={() => setShowSuspended(!showSuspended)}
                  >
                    {suspendedCarts.length} on hold
                  </button>
                )}
              </div>
              {(items.length > 0 || customerName) && (
                <button className={posStyles.clearBtn} onClick={clearCart}>
                  Clear
                </button>
              )}
            </div>

            {/* Attached B2B Account or Retail Customer Banner */}
            {selectedB2BCustomer && !showSuspended ? (
              <div className={b2bStyles.accountCard} style={{ margin: '8px 12px 0 12px' }}>
                <div className={b2bStyles.accountCardHeader}>
                  <div className={b2bStyles.accountTitleGroup}>
                    <div className={b2bStyles.shopIconBadge}>
                      <Store size={18} />
                    </div>
                    <div className={b2bStyles.shopInfo}>
                      <span className={b2bStyles.shopName}>
                        {selectedB2BCustomer.shopName || selectedB2BCustomer.name}
                      </span>
                      <span className={b2bStyles.ownerName}>
                        {selectedB2BCustomer.name} · 📞 {selectedB2BCustomer.phone}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={posStyles.detachCustomerBtn}
                    onClick={() => {
                      setSelectedB2BCustomer(null);
                      setCustomerName('');
                      toast.info('B2B Account Detached', 'Sale will proceed as walk-in buyer.');
                    }}
                    title="Detach commercial account"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#64748b' }}>Current Account Debt:</span>
                  <strong style={{ color: (getCustomerDebtTotal(selectedB2BCustomer.id) || selectedB2BCustomer.totalDebt || 0) > 0 ? '#dc2626' : '#16a34a' }}>
                    {formatPrivateCurrency(getCustomerDebtTotal(selectedB2BCustomer.id) || selectedB2BCustomer.totalDebt || 0)}
                  </strong>
                </div>

                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: '2px 0 0 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  onClick={() => setProfilePanelCustomer(selectedB2BCustomer)}
                >
                  <Eye size={12} /> Open 360° Profile & Statement
                </button>
              </div>
            ) : customerName && !showSuspended ? (
              <div className={posStyles.attachedCustomerBanner}>
                <div className={posStyles.attachedCustomerLeft}>
                  <div className={posStyles.attachedCustomerAvatar}>
                    <User size={14} />
                  </div>
                  <div className={posStyles.attachedCustomerInfo}>
                    <span className={posStyles.attachedCustomerLabel}>Customer Attached</span>
                    <span className={posStyles.attachedCustomerName}>{customerName}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={posStyles.detachCustomerBtn}
                  onClick={() => {
                    setCustomerName('');
                    setSelectedB2BCustomer(null);
                    toast.info('Customer Detached', 'Sale will proceed as walk-in customer.');
                  }}
                  title="Detach customer"
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}

            {/* Held Carts Dropdown */}
            {showSuspended && suspendedCarts.length > 0 && (
              <div className={posStyles.suspendedList}>
                <div className={posStyles.suspendedListHeader}>
                  <span>Held Carts</span>
                  <button onClick={() => setShowSuspended(false)}><X size={14} /></button>
                </div>
                {suspendedCarts.map((sc: SuspendedCart) => {
                  const scDisc = typeof sc.discount === 'number'
                    ? sc.discount
                    : (sc.discount && typeof sc.discount === 'object' ? sc.discount.value : 0) || 0;
                  const scItemsTotal = sc.items.reduce((s, i) => s + i.product.price * i.quantity, 0);
                  const scFinalTotal = Math.max(0, scItemsTotal - scDisc);

                  return (
                    <div key={sc.id} className={posStyles.suspendedItem}>
                      <div className={posStyles.suspendedItemInfo}>
                        <span className={posStyles.suspendedCustomer}>{sc.customerName || 'Walk-in Customer'}</span>
                        <span className={posStyles.suspendedMeta}>
                          {sc.items.reduce((s, i) => s + i.quantity, 0)} items · {formatCurrency(scFinalTotal)}
                        </span>
                      </div>
                      <div className={posStyles.suspendedActions}>
                        <Button
                          size="sm"
                          onClick={() => {
                            const res = resumeCart(sc.id);
                            if (res.warnings && res.warnings.length > 0) {
                              res.warnings.forEach(w => toast.warning('Stock Level Alert', w));
                            }
                            setShowSuspended(false);
                          }}
                        >
                          Resume
                        </Button>
                        <button className={posStyles.discardBtn} onClick={() => discardSuspendedCart(sc.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cart Items List */}
            <div className={posStyles.cartItems}>
              {items.length === 0 ? (
                <div className={posStyles.emptyCart}>
                  {selectedB2BCustomer ? (
                    <>
                      <div className={posStyles.customerEmptyIconWrap} style={{ background: '#eff6ff', color: '#2563eb' }}>
                        <Store size={30} />
                      </div>
                      <p className={posStyles.emptyCartTitle}>B2B Account Attached</p>
                      <p className={posStyles.attachedCustomerHighlight}>
                        {selectedB2BCustomer.shopName || selectedB2BCustomer.name}
                      </p>
                      <p className={posStyles.emptyCartSub}>Select repair parts to dispatch or charge to this account.</p>
                    </>
                  ) : customerName ? (
                    <>
                      <div className={posStyles.customerEmptyIconWrap}>
                        <UserCheck size={30} />
                      </div>
                      <p className={posStyles.emptyCartTitle}>Customer Attached</p>
                      <p className={posStyles.attachedCustomerHighlight}>{customerName}</p>
                      <p className={posStyles.emptyCartSub}>Select parts from the catalog to add items to this sale.</p>
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={40} className={posStyles.emptyCartIcon} />
                      <p>Cart is empty</p>
                      <span>Select parts from the grid to add to sale</span>
                    </>
                  )}
                </div>
              ) : (
                items.map(item => (
                  <div key={item.product.id} className={posStyles.cartItem}>
                    <div className={posStyles.cartItemDetails}>
                      <p className={posStyles.cartItemName}>{item.product.name} {item.product.model}</p>
                      <p className={posStyles.cartItemPrice}>{formatCurrency(item.product.price)} each</p>
                    </div>
                    <div className={posStyles.cartItemControls}>
                      <button 
                        className={posStyles.qtyBtn} 
                        onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                      >
                        <Minus size={12} />
                      </button>
                      <span className={posStyles.qtyDisplay}>{item.quantity}</span>
                      <button 
                        className={posStyles.qtyBtn} 
                        onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                        disabled={item.quantity >= item.product.stock}
                      >
                        <Plus size={12} />
                      </button>
                      <button 
                        className={posStyles.deleteBtn} 
                        onClick={() => removeFromCart(item.product.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer */}
            {items.length > 0 && (
              <div className={posStyles.cartFooter}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <CustomerAutocompleteInput
                      accountType="shop_repairer"
                      placeholder="Search phone shop or repairer..."
                      value={customerName}
                      onChange={(name, cust) => {
                        setCustomerName(name);
                        if (cust) {
                          setSelectedB2BCustomer(cust);
                          if (cust.wholesaleDiscountPercent && cust.wholesaleDiscountPercent > 0) {
                            setDiscount({ type: 'percent', value: cust.wholesaleDiscountPercent });
                            toast.success('Wholesale Discount Applied', `${cust.wholesaleDiscountPercent}% discount applied for ${cust.shopName || cust.name}.`);
                          }
                        } else if (!name.trim()) {
                          setSelectedB2BCustomer(null);
                        }
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    style={{ height: '40px', padding: '0 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                    leftIcon={<Store size={14} />}
                    onClick={() => setIsQuickAddShopOpen(true)}
                    title="Register new B2B phone store / repairer account"
                  >
                    + Shop
                  </Button>
                </div>

                <div className={posStyles.summaryRow}>
                  <span>Subtotal</span>
                  <span>{formatCurrency(getSubtotal())}</span>
                </div>

                <div className={posStyles.discountRow}>
                  <span>Discount</span>
                  <div className={posStyles.discountInputWrapper}>
                    <input
                      type="number"
                      min="0"
                      max={getSubtotal()}
                      value={pendingDiscountValue !== null ? pendingDiscountValue.toString() : (discount ? discount.toString() : '')}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setPendingDiscountValue(null);
                          setDiscount(0);
                          return;
                        }
                        const v = Number(raw);
                        if (v > 1000 && !isAdmin) {
                          setPendingDiscountValue(v);
                          setShowDiscountUnlock(true);
                        } else if (v > 0) {
                          setPendingDiscountValue(null);
                          setDiscount(v);
                        } else {
                          setPendingDiscountValue(null);
                          setDiscount(0);
                        }
                      }}
                      placeholder="0"
                      className={posStyles.discountInput}
                    />
                  </div>
                </div>

                <div className={posStyles.totalRow}>
                  <span>Total</span>
                  <span className={posStyles.totalAmount}>{formatCurrency(getTotal())}</span>
                </div>

                {!selectedB2BCustomer ? (
                  <div className={posStyles.paymentMethod}>
                    <label>Walk-in Payment Method</label>
                    <div className={posStyles.methodGrid}>
                      {paymentMethods.map(method => (
                        <button
                          key={method.value}
                          type="button"
                          className={[
                            posStyles.methodBtn,
                            selectedMethod === method.value && posStyles.methodBtnActive
                          ].filter(Boolean).join(' ')}
                          onClick={() => {
                            setSelectedMethod(method.value);
                            setPayments([{ method: method.value, amount: getTotal() }]);
                          }}
                        >
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Store size={14} style={{ color: '#2563eb' }} />
                    <span>B2B Settlement (Pay full, partial, or charge to ledger on checkout)</span>
                  </div>
                )}

                <div className={posStyles.cartButtons}>
                  <Button
                    variant="secondary"
                    onClick={() => suspendCart()}
                    style={{ flex: '1' }}
                  >
                    Hold Cart
                  </Button>
                  
                  {selectedB2BCustomer ? (
                    <Button
                      onClick={() => setIsB2BCheckoutOpen(true)}
                      isLoading={isProcessing}
                      style={{ flex: '2', background: '#1d4ed8' }}
                      leftIcon={<Store size={16} />}
                    >
                      Process B2B Sale ({formatCurrency(getTotal())})
                    </Button>
                  ) : (
                    <Button
                      onClick={handleCheckout}
                      isLoading={isProcessing}
                      disabled={isProcessing || items.length === 0}
                      style={{ flex: '2' }}
                    >
                      Checkout ({formatCurrency(getTotal())})
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ─── INVOICES & ORDERS TAB ──────────────────────────────────────── */
        <PartsInvoicesTab
          customers={customers}
          onOpenCustomerProfile={(cust) => setProfilePanelCustomer(cust)}
        />
      )}
    </div>
  );
};
