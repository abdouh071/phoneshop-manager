import React, { useEffect, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Eye, Edit, Trash2, TrendingUp, AlertTriangle, Package, Plus,
  ChevronDown, ChevronUp, ChevronRight, CornerDownRight, DollarSign,
  ScanLine, ClipboardList, Upload, CheckCircle2, AlertCircle, XCircle,
  LayoutList, Table, Printer, FileSpreadsheet
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { Select } from '../../components/ui/Select';
import { StockBadge } from '../../components/ui/Badge';
import { SkeletonTableRows } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { AddProductModal } from './AddProductModal';
import { EditProductPanel } from './EditProductPanel';
import { ProductDetailPanel } from './ProductDetailPanel';
import { PrintLabelsModal } from './PrintLabelsModal';
import { ExportLowStockModal } from './ExportLowStockModal';
import { RestockHistoryPanel } from './RestockHistoryPanel';
import { WriteOffLogPanel } from './WriteOffLogPanel';
import { WriteOffModal } from './WriteOffModal';
import { BulkImportModal } from './BulkImportModal';
import { InventoryTablesView } from './InventoryTablesView';
import type { PhoneModel } from '../../types';
import { groupProductsByBaseModel } from '../../utils/productGrouping';
import type { ProductGroup } from '../../utils/productGrouping';
import { StockAudit } from './StockAudit';
import styles from './Inventory.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { ACCESSORY_SUB_CATEGORIES } from '../../utils/accessorySubCategories';

const margin = (p: PhoneModel) =>
  p.price > 0 ? (((p.price - p.costPrice) / p.price) * 100) : 0;

const StockStatusDot: React.FC<{ status: PhoneModel['stockStatus'] }> = ({ status }) => {
  const cls = { in_stock: styles.dotGreen, low_stock: styles.dotYellow, out_of_stock: styles.dotRed }[status];
  return <span className={[styles.dot, cls].join(' ')} />;
};

export const InventoryPage = () => {
  const { fetchProducts, searchQuery, setSearchQuery, isLoading, products, restockProduct } = useInventoryStore();
  const { user } = useAuthStore();
  const permissions = usePermissions();
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PhoneModel | null>(null);
  const [detailProduct, setDetailProduct] = useState<PhoneModel | null>(null);
  const [sortKey, setSortKey] = useState<keyof PhoneModel>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [subCategoryFilter, setSubCategoryFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'tables' | 'catalog'>('tables');

  // restockingId -> the product being restocked; restockAmt -> input value
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [restockAmt, setRestockAmt] = useState('');
  const [restockMeta, setRestockMeta] = useState({ supplier: '', note: '', cost: '' });
  const [isRestockLogOpen, setIsRestockLogOpen] = useState(false);
  const [isWriteOffLogOpen, setIsWriteOffLogOpen] = useState(false);
  const [writeOffProduct, setWriteOffProduct] = useState<PhoneModel | null>(null);
  const [actionRequiringUnlock, setActionRequiringUnlock] = useState<{
    name: string;
    callback: () => void;
    actionType?: string;
    actionData?: Record<string, any>;
    targetId?: string;
  } | null>(null);
  const [isExportLowStockOpen, setIsExportLowStockOpen] = useState(false);
  const [exportInitialCategory, setExportInitialCategory] = useState<string>('all');
  const [exportInitialSubCategory, setExportInitialSubCategory] = useState<string>('all');

  const handleOpenExportLowStock = (cat?: string, sub?: string) => {
    setExportInitialCategory(cat || categoryFilter || 'all');
    setExportInitialSubCategory(sub || subCategoryFilter || 'all');
    setIsExportLowStockOpen(true);
  };

  const itemsPerPage = 10;

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Handle deep links from Activity Log (e.g. /inventory?focusId=...)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focusId = params.get('focusId');
    const search = params.get('search');
    const target = focusId || search;

    if (search && !focusId) {
      setSearchQuery(search);
    }

    if (!target || products.length === 0) return;

    const q = target.toLowerCase().trim();
    const match = products.find(p => {
      if (p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-')) return false;
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
      setCategoryFilter('all');
      setStatusFilter('all');

      const timer = setTimeout(() => {
        setDetailProduct(match);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [location.search, products, setSearchQuery]);

  // Exclude all repair parts — only retail inventory products are shown
  const roleFilteredProducts = useMemo(() => {
    return products.filter(p => {
      if (p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-')) return false;
      return permissions.inventory_products !== false;
    });
  }, [products, permissions.inventory_products]);

  const isLowStock = (p: PhoneModel) => {
    const threshold = p.lowStockThreshold || 1;
    return p.stockStatus === 'low_stock' || (p.stock > 0 && p.stock <= threshold);
  };

  const filtered = useMemo(() => {
    return roleFilteredProducts.filter(p => {
      let matchesSearch = true;
      if (searchQuery.trim()) {
        const words = searchQuery.toLowerCase().trim().split(/\s+/);
        const full = [p.name, p.model, p.sku, p.color, p.storage, p.location, p.supplier, p.accessorySubCategory].filter(Boolean).join(' ').toLowerCase();
        matchesSearch = words.every(w => full.includes(w));
      }
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'low_stock'
          ? isLowStock(p)
          : statusFilter === 'out_of_stock'
          ? (p.stock === 0 || p.stockStatus === 'out_of_stock')
          : (p.stockStatus === statusFilter && !isLowStock(p));

      const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
      const matchesSubCategory = categoryFilter !== 'accessory' || subCategoryFilter === 'all' || (p.accessorySubCategory || 'other') === subCategoryFilter;
      return matchesSearch && matchesStatus && matchesCategory && matchesSubCategory;
    });
  }, [roleFilteredProducts, searchQuery, statusFilter, categoryFilter, subCategoryFilter]);

  const lowStockCount = useMemo(() => {
    return roleFilteredProducts.filter(p => isLowStock(p)).length;
  }, [roleFilteredProducts]);

  const sortedGroups = useMemo(() => {
    const groups = groupProductsByBaseModel(filtered);
    return groups.sort((a, b) => {
      let valA: any = a[sortKey as keyof ProductGroup] ?? '';
      let valB: any = b[sortKey as keyof ProductGroup] ?? '';
      if (sortKey === 'price') { valA = a.minPrice; valB = b.minPrice; }
      if (sortKey === 'costPrice') { valA = a.minCost; valB = b.minCost; }
      if (sortKey === 'stock') { valA = a.totalStock; valB = b.totalStock; }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sortedGroups.length / itemsPerPage);
  const paginatedGroups = sortedGroups.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalInventoryValue = useMemo(() => {
    return roleFilteredProducts.reduce((sum, p) => sum + (p.costPrice || 0) * (p.stock || 0), 0);
  }, [roleFilteredProducts]);

  const potentialRevenue = useMemo(() => {
    return roleFilteredProducts.reduce((sum, p) => sum + (p.price || 0) * (p.stock || 0), 0);
  }, [roleFilteredProducts]);

  const handleSort = (key: keyof PhoneModel) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleExpand = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedGroups.flatMap(g => g.variants).length) setSelectedIds(new Set());
    else setSelectedIds(new Set(paginatedGroups.flatMap(g => g.variants.map(v => v.id))));
  };

  const SortIcon = ({ col }: { col: keyof PhoneModel }) => {
    if (sortKey !== col) return <span className={styles.sortNeutral}><ChevronUp size={12} /><ChevronDown size={12} /></span>;
    return <span>{sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>;
  };

  // Restock handler
  const handleRestock = async (product: PhoneModel) => {
    const amt = parseInt(restockAmt, 10);
    if (isNaN(amt) || amt <= 0) return;
    await restockProduct(product.id, amt, {
      supplier: restockMeta.supplier || undefined,
      note: restockMeta.note || undefined,
      cost: restockMeta.cost ? parseFloat(restockMeta.cost) : undefined,
    });
    setRestockingId(null);
    setRestockAmt('');
    setRestockMeta({ supplier: '', note: '', cost: '' });
  };

  const requirePermission = (
    actionName: string,
    callback: () => void,
    meta?: { actionType?: string; actionData?: Record<string, any>; targetId?: string }
  ) => {
    if (permissions.inventory_edit || user?.role === 'admin') {
      callback();
    } else {
      setActionRequiringUnlock({
        name: actionName,
        callback,
        actionType: meta?.actionType,
        actionData: meta?.actionData,
        targetId: meta?.targetId,
      });
    }
  };

  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);

  // Category counts for pills (dynamically reflects low stock when low_stock status filter is active)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      smartphone: 0,
      tablet: 0,
      accessory: 0,
      wearable: 0,
    };
    roleFilteredProducts.forEach(p => {
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'low_stock'
          ? isLowStock(p)
          : statusFilter === 'out_of_stock'
          ? (p.stock === 0 || p.stockStatus === 'out_of_stock')
          : (p.stockStatus === statusFilter && !isLowStock(p));

      if (matchesStatus) {
        counts.all++;
        if (p.category && counts[p.category] !== undefined) {
          counts[p.category]++;
        }
      }
    });
    return counts;
  }, [roleFilteredProducts, statusFilter]);

  // Audit Mode overlay
  if (isAuditOpen) {
    return <StockAudit products={roleFilteredProducts} onClose={() => setIsAuditOpen(false)} />;
  }

  return (
    <div className={styles.page}>
      <AddProductModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
      <EditProductPanel product={editingProduct} onClose={() => setEditingProduct(null)} />
      <ProductDetailPanel
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        onEdit={(p) => {
          setDetailProduct(null);
          requirePermission(`Edit product: ${p.name}`, () => setEditingProduct(p), {
            actionType: 'inventory_edit_product',
            targetId: p.id,
            actionData: {
              itemType: 'product',
              productName: p.name,
              model: p.model,
              sku: p.sku,
              category: p.category,
              price: p.price,
              costPrice: p.costPrice,
              currentStock: p.stock,
            },
          });
        }}
      />
      <PrintLabelsModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} products={[]} categoryFilter={categoryFilter !== 'all' ? categoryFilter : undefined} />
      <ExportLowStockModal
        isOpen={isExportLowStockOpen}
        onClose={() => setIsExportLowStockOpen(false)}
        products={roleFilteredProducts}
        initialCategory={exportInitialCategory}
        initialSubCategory={exportInitialSubCategory}
        canViewCosts={canViewCosts}
      />
      <AdminUnlockModal
        isOpen={actionRequiringUnlock !== null}
        onClose={() => setActionRequiringUnlock(null)}
        onSuccess={() => { actionRequiringUnlock?.callback(); setActionRequiringUnlock(null); }}
        actionName={actionRequiringUnlock?.name}
        actionType={actionRequiringUnlock?.actionType}
        actionData={actionRequiringUnlock?.actionData}
        targetId={actionRequiringUnlock?.targetId}
      />

      <RestockHistoryPanel isOpen={isRestockLogOpen} onClose={() => setIsRestockLogOpen(false)} />
      <WriteOffLogPanel isOpen={isWriteOffLogOpen} onClose={() => setIsWriteOffLogOpen(false)} />
      <WriteOffModal product={writeOffProduct} onClose={() => setWriteOffProduct(null)} />
      <BulkImportModal isOpen={isBulkImportOpen} onClose={() => setIsBulkImportOpen(false)} />

      {/* Warning Banner with 1-Click Action */}
      {lowStockCount > 0 && (
        <div className={styles.warningBanner}>
          <div className={styles.warningLeft}>
            <AlertTriangle size={18} />
            <span><strong>Attention Needed:</strong> {lowStockCount} products are running low on stock or sold out.</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className={styles.warningActionBtn}
              onClick={() => {
                setStatusFilter(statusFilter === 'low_stock' ? 'all' : 'low_stock');
                setCurrentPage(1);
              }}
            >
              {statusFilter === 'low_stock' ? 'Show All Products' : 'Filter Low Stock'}
            </button>
            <button
              type="button"
              className={styles.warningActionBtn}
              onClick={() => handleOpenExportLowStock()}
              style={{ background: '#d97706', borderColor: '#d97706', color: '#ffffff' }}
              title="Export low stock products with category filters"
            >
              <FileSpreadsheet size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Export Low Stock
            </button>
          </div>
        </div>
      )}

      {/* Modern Page Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Inventory Management</h1>
          <p className={styles.subtitle}>{filtered.length} products available · {roleFilteredProducts.reduce((sum, p) => sum + p.stock, 0)} units in stock</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" leftIcon={<FileSpreadsheet size={16} />} onClick={() => handleOpenExportLowStock()}>
            Export Low Stock
          </Button>
          <Button variant="secondary" leftIcon={<ScanLine size={16} />} onClick={() => requirePermission('perform stock audit', () => setIsAuditOpen(true))}>
            Stock Audit
          </Button>
          <Button variant="secondary" leftIcon={<ClipboardList size={16} />} onClick={() => requirePermission('view restock log', () => setIsRestockLogOpen(true))}>
            Restock Log
          </Button>
          <Button variant="secondary" leftIcon={<AlertTriangle size={16} />} onClick={() => requirePermission('view write-off log', () => setIsWriteOffLogOpen(true))}>
            Write-Off Log
          </Button>
          <Button variant="secondary" leftIcon={<Package size={16} />} onClick={() => setIsPrintOpen(true)}>
            Print Labels
          </Button>
          <Button variant="secondary" leftIcon={<Printer size={16} />} onClick={() => navigate('/custom-ticket')}>
            Custom Ticket
          </Button>
          <Button variant="secondary" leftIcon={<Upload size={16} />} onClick={() => requirePermission('add a new product', () => setIsBulkImportOpen(true))}>
            Import CSV
          </Button>
          <Button leftIcon={<Plus size={16} />} onClick={() => requirePermission('add a new product', () => setIsAddOpen(true))}>
            Add Product
          </Button>
        </div>
      </div>

      {/* Category Tabs (Segmented Pill Style) */}
      <div className={styles.categoryTabs}>
        {[
          { value: 'all', label: 'All Items' },
          { value: 'smartphone', label: '📱 Smartphones' },
          { value: 'tablet', label: '📟 Tablets' },
          { value: 'accessory', label: '🎧 Accessories' },
          { value: 'wearable', label: '⌚ Wearables' },
        ].map(cat => {
          const isActive = categoryFilter === cat.value;
          const count = categoryCounts[cat.value] || 0;
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => { setCategoryFilter(cat.value); setSubCategoryFilter('all'); setCurrentPage(1); }}
              className={[styles.categoryTab, isActive && styles.categoryTabActive].filter(Boolean).join(' ')}
            >
              <span>{cat.label}</span>
              <span className={styles.tabCount}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Accessory Sub-Category Tabs */}
      {categoryFilter === 'accessory' && (
        <div className={styles.subCategoryTabs}>
          {ACCESSORY_SUB_CATEGORIES.map(sub => {
            const isActive = subCategoryFilter === sub.value;
            const count = sub.value === 'all'
              ? roleFilteredProducts.filter(p => {
                  const matchStatus =
                    statusFilter === 'all'
                      ? true
                      : statusFilter === 'low_stock'
                      ? isLowStock(p)
                      : statusFilter === 'out_of_stock'
                      ? (p.stock === 0 || p.stockStatus === 'out_of_stock')
                      : (p.stockStatus === statusFilter && !isLowStock(p));
                  return p.category === 'accessory' && matchStatus;
                }).length
              : roleFilteredProducts.filter(p => {
                  const matchStatus =
                    statusFilter === 'all'
                      ? true
                      : statusFilter === 'low_stock'
                      ? isLowStock(p)
                      : statusFilter === 'out_of_stock'
                      ? (p.stock === 0 || p.stockStatus === 'out_of_stock')
                      : (p.stockStatus === statusFilter && !isLowStock(p));
                  return p.category === 'accessory' && (p.accessorySubCategory || 'other') === sub.value && matchStatus;
                }).length;
            return (
              <button
                key={sub.value}
                type="button"
                onClick={() => { setSubCategoryFilter(sub.value); setCurrentPage(1); }}
                className={[styles.subCategoryTab, isActive && styles.subCategoryTabActive].filter(Boolean).join(' ')}
              >
                <span>{sub.icon}</span>
                <span>{sub.label}</span>
                <span className={styles.subTabCount}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Interactive 6-KPI Summary Grid */}
      <div className={styles.summaryGrid}>
        <div
          className={[styles.summaryCard, statusFilter === 'all' && styles.summaryCardActive].filter(Boolean).join(' ')}
          onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
          title="Click to view all products"
        >
          <div className={styles.summaryCardTop}>
            <span className={styles.summaryLabel}>Total Products</span>
            <div className={[styles.summaryIconWrap, styles.iconTotal].join(' ')}><Package size={16} /></div>
          </div>
          <p className={styles.summaryValue}>{roleFilteredProducts.length}</p>
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
            {roleFilteredProducts.filter(p => p.stockStatus === 'in_stock').length}
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
            {roleFilteredProducts.filter(p => isLowStock(p)).length}
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
            {roleFilteredProducts.filter(p => p.stockStatus === 'out_of_stock').length}
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

      {/* Unified View Mode & Filter Control Bar */}
      <div className={styles.controlBar}>
        <div className={styles.controlBarLeft}>
          <div className={styles.viewSwitcher}>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'tables' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('tables')}
              title="4 Dedicated Operational Tables"
            >
              <LayoutList size={15} />
              <span>Smart Tables</span>
            </button>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'catalog' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('catalog')}
              title="Full Master Table with Grouped Variants"
            >
              <Table size={15} />
              <span>Master Catalog</span>
            </button>
          </div>

          {viewMode === 'catalog' && selectedIds.size > 0 && (
            <Button variant="danger" size="sm" leftIcon={<Trash2 size={15} />} onClick={() => requirePermission('delete products', () => { /* delete action */ })}>
              Selected ({selectedIds.size})
            </Button>
          )}
        </div>

        <div className={styles.controlBarRight}>
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
            placeholder="Search model, SKU, storage, supplier..."
            className={styles.search}
          />
        </div>
      </div>

      {/* VIEW 1: SMART TABLES (SYSTEM 1) */}
      {viewMode === 'tables' && (
        <InventoryTablesView
          products={filtered}
          canViewCosts={canViewCosts}
          onSelectProduct={p => setDetailProduct(p)}
          onEditProduct={p => requirePermission(`Edit product: ${p.name}`, () => setEditingProduct(p), {
            actionType: 'inventory_edit_product',
            targetId: p.id,
            actionData: {
              itemType: 'product',
              productName: p.name,
              model: p.model,
              sku: p.sku,
              category: p.category,
              price: p.price,
              costPrice: p.costPrice,
              currentStock: p.stock,
            },
          })}
          onRestockProduct={async (p, amount, meta) => {
            await restockProduct(p.id, amount, meta);
          }}
          onWriteOffProduct={p => requirePermission(`Write off product: ${p.name}`, () => setWriteOffProduct(p), {
            actionType: 'inventory_write_off',
            targetId: p.id,
            actionData: {
              itemType: 'product',
              productName: p.name,
              model: p.model,
              sku: p.sku,
              category: p.category,
              price: p.price,
              currentStock: p.stock,
            },
          })}
          onPrintLabel={() => setIsPrintOpen(true)}
          statusFilter={statusFilter}
          categoryFilter={categoryFilter}
          subCategoryFilter={subCategoryFilter}
          onSelectCategory={cat => {
            setCategoryFilter(cat);
            setSubCategoryFilter('all');
            setCurrentPage(1);
          }}
          onSelectSubCategory={sub => {
            setSubCategoryFilter(sub);
            setCurrentPage(1);
          }}
          onExportLowStock={(cat, sub) => handleOpenExportLowStock(cat, sub)}
        />
      )}

      {/* VIEW 2: MASTER CATALOG (ORIGINAL GROUPED TABLE) */}
      {viewMode === 'catalog' && (
        <div className={styles.catalogCard}>
          <div className={styles.tableHeader}>
            <div className={styles.headerLeft}>
              <h2 className={styles.tableTitle}>Product Catalog</h2>
              <span className={styles.itemCountBadge}>{sortedGroups.length} models</span>
            </div>
          </div>

        <div className={styles.tableWrapper}>
          {isLoading ? (
            <table className={styles.table}>
              <tbody><SkeletonTableRows cols={canViewCosts ? 11 : 9} /></tbody>
            </table>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 20px' }}>
              <EmptyState
                title="No products found"
                description="Try adjusting your search query, status, or category filters."
              />
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 36, padding: '12px 10px', textAlign: 'center' }}>
                    <input type="checkbox" checked={selectedIds.size > 0} onChange={toggleSelectAll} />
                  </th>
                  <th style={{ width: 36 }}></th>
                  <th className={styles.th} onClick={() => handleSort('name')}>
                    Product / Model <SortIcon col="name" />
                  </th>
                  <th className={styles.th} onClick={() => handleSort('category')}>
                    Category <SortIcon col="category" />
                  </th>
                  <th className={styles.th} onClick={() => handleSort('sku')}>
                    SKU <SortIcon col="sku" />
                  </th>
                  <th className={styles.th} onClick={() => handleSort('location')}>
                    Location <SortIcon col="location" />
                  </th>
                  {canViewCosts && (
                    <th className={styles.th} onClick={() => handleSort('costPrice')}>
                      Cost Price <SortIcon col="costPrice" />
                    </th>
                  )}
                  <th className={styles.th} onClick={() => handleSort('price')}>
                    Retail Sell Price <SortIcon col="price" />
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
                {paginatedGroups.map(group => {
                  const isExpanded = expandedGroups.has(group.id);
                  const isSingle = group.variants.length === 1;
                  const single = group.variants[0];
                  const isAllSelected = group.variants.every(v => selectedIds.has(v.id));
                  const isSomeSelected = group.variants.some(v => selectedIds.has(v.id));
                  const singleMargin = isSingle ? margin(single) : null;

                  return (
                    <React.Fragment key={group.id}>
                      <tr className={[styles.tr, styles.trGroup, isSomeSelected && styles.trSelected].filter(Boolean).join(' ')}>
                        <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={() => {
                              const next = new Set(selectedIds);
                              if (isAllSelected) group.variants.forEach(v => next.delete(v.id));
                              else group.variants.forEach(v => next.add(v.id));
                              setSelectedIds(next);
                            }}
                          />
                        </td>
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
                                  <>
                                    {single.category !== 'accessory' && single.storage && single.storage.trim().toUpperCase() !== 'N/A' && single.storage.trim().toLowerCase() !== 'none' && <span className={styles.tagPill}>{single.storage}</span>}
                                    {single.color && single.color.trim().toUpperCase() !== 'N/A' && single.color.trim().toLowerCase() !== 'none' && <span>{single.color}</span>}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={styles.td}>
                          <span className={styles.tagPill} style={{ textTransform: 'capitalize' }}>
                            {group.category}
                          </span>
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
                              <div className={styles.restockInline}>
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
                                <Button variant="ghost" size="sm" onClick={() => setDetailProduct(v)} title="View Product Details">
                                  <Eye size={15} />
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => requirePermission(`Edit product: ${v.name}`, () => setEditingProduct(v), {
                                  actionType: 'inventory_edit_product',
                                  targetId: v.id,
                                  actionData: {
                                    itemType: 'product',
                                    productName: v.name,
                                    model: v.model,
                                    sku: v.sku,
                                    category: v.category,
                                    price: v.price,
                                    costPrice: v.costPrice,
                                    currentStock: v.stock,
                                  },
                                })}>
                                  Edit
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => requirePermission(`Restock product: ${v.name}`, () => { setRestockingId(v.id); setRestockAmt(''); }, {
                                  actionType: 'inventory_restock',
                                  targetId: v.id,
                                  actionData: {
                                    itemType: 'product',
                                    productName: v.name,
                                    model: v.model,
                                    sku: v.sku,
                                    category: v.category,
                                    price: v.price,
                                    currentStock: v.stock,
                                  },
                                })}>
                                  + Restock
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => requirePermission(`Write off product: ${v.name}`, () => setWriteOffProduct(v), {
                                  actionType: 'inventory_write_off',
                                  targetId: v.id,
                                  actionData: {
                                    itemType: 'product',
                                    productName: v.name,
                                    model: v.model,
                                    sku: v.sku,
                                    category: v.category,
                                    price: v.price,
                                    currentStock: v.stock,
                                  },
                                })} disabled={v.stock === 0} title="Write-Off">
                                  <AlertTriangle size={15} />
                                </Button>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>

                      {/* Expandable Variants Sub-rows */}
                      {isExpanded && group.variants.map(product => {
                        const vMargin = margin(product);
                        return (
                          <tr key={product.id} className={[styles.tr, styles.trVariant].join(' ')}>
                            <td></td>
                            <td className={styles.td}><CornerDownRight size={14} style={{ marginLeft: 8, opacity: 0.5 }} /></td>
                            <td className={styles.td}>
                              <div style={{ paddingLeft: '8px' }}>
                                <p className={styles.productName}>{product.name} {product.model}</p>
                                <div className={styles.productMeta}>
                                  {product.category !== 'accessory' && product.storage && product.storage.trim().toUpperCase() !== 'N/A' && product.storage.trim().toLowerCase() !== 'none' && <span className={styles.tagPill}>{product.storage}</span>}
                                  {product.color && product.color.trim().toUpperCase() !== 'N/A' && product.color.trim().toLowerCase() !== 'none' && <span>{product.color}</span>}
                                </div>
                              </div>
                            </td>
                            <td className={styles.td}><span className={styles.tagPill}>{product.category}</span></td>
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
                                  <Button variant="secondary" size="sm" onClick={() => requirePermission(`Edit product: ${product.name}`, () => setEditingProduct(product), {
                                    actionType: 'inventory_edit_product',
                                    targetId: product.id,
                                    actionData: {
                                      itemType: 'product',
                                      productName: product.name,
                                      model: product.model,
                                      sku: product.sku,
                                      category: product.category,
                                      price: product.price,
                                      costPrice: product.costPrice,
                                      currentStock: product.stock,
                                    },
                                  })}>
                                    Edit
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={() => requirePermission(`Restock product: ${product.name}`, () => { setRestockingId(product.id); setRestockAmt(''); }, {
                                    actionType: 'inventory_restock',
                                    targetId: product.id,
                                    actionData: {
                                      itemType: 'product',
                                      productName: product.name,
                                      model: product.model,
                                      sku: product.sku,
                                      category: product.category,
                                      price: product.price,
                                      currentStock: product.stock,
                                    },
                                  })}>
                                    + Restock
                                  </Button>
                                  <Button variant="danger" size="sm" onClick={() => requirePermission(`Write off product: ${product.name}`, () => setWriteOffProduct(product), {
                                    actionType: 'inventory_write_off',
                                    targetId: product.id,
                                    actionData: {
                                      itemType: 'product',
                                      productName: product.name,
                                      model: product.model,
                                      sku: product.sku,
                                      category: product.category,
                                      price: product.price,
                                      currentStock: product.stock,
                                    },
                                  })} disabled={product.stock === 0} title="Write-Off">
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
          )}
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
      )}
    </div>
  );
};
