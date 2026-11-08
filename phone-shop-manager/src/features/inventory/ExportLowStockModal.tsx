import React, { useState, useMemo, useEffect } from 'react';
import { Download, Printer, Filter, AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { exportToCSV } from '../../utils/exportUtils';
import { printLowStockReportDirect } from '../../utils/printWindow';
import { ACCESSORY_SUB_CATEGORIES, getSubCategoryMeta } from '../../utils/accessorySubCategories';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../../components/ui/Toast';
import type { PhoneModel } from '../../types';
import styles from './ExportLowStockModal.module.css';
import { errorMessage } from '../../utils/errorUtils';
import { normalizeArabic } from '../../utils/normalizeText';

interface ExportLowStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: PhoneModel[];
  initialCategory?: string;
  initialSubCategory?: string;
  canViewCosts?: boolean;
}

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'smartphone', label: '📱 Smartphones' },
  { value: 'tablet', label: '📟 Tablets' },
  { value: 'accessory', label: '🎧 Accessories' },
  { value: 'wearable', label: '⌚ Wearables' },
];

export const ExportLowStockModal: React.FC<ExportLowStockModalProps> = ({
  isOpen,
  onClose,
  products,
  initialCategory = 'all',
  initialSubCategory = 'all',
  canViewCosts = true,
}) => {
  const { storeName, currency } = useSettingsStore();
  const toast = useToast();

  const [category, setCategory] = useState<string>(initialCategory);
  const [subCategory, setSubCategory] = useState<string>(initialSubCategory);
  const [stockScope, setStockScope] = useState<'all_low' | 'low_only' | 'out_only'>('all_low');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  // Sync initial filters when opened
  useEffect(() => {
    if (isOpen) {
      setCategory(initialCategory || 'all');
      setSubCategory(initialSubCategory || 'all');
      setStockScope('all_low');
      setSupplierFilter('all');
      setSearchQuery('');
    }
  }, [isOpen, initialCategory, initialSubCategory]);

  const isLowStock = (p: PhoneModel) => {
    const threshold = p.lowStockThreshold || 1;
    return p.stockStatus === 'low_stock' || (p.stock > 0 && p.stock <= threshold);
  };

  const isOutOfStock = (p: PhoneModel) => {
    return p.stock === 0 || p.stockStatus === 'out_of_stock';
  };

  // Base list of all items needing replenishment
  const baseDeficitProducts = useMemo(() => {
    return products.filter(p => {
      if (stockScope === 'all_low') return isLowStock(p) || isOutOfStock(p);
      if (stockScope === 'low_only') return isLowStock(p);
      if (stockScope === 'out_only') return isOutOfStock(p);
      return false;
    });
  }, [products, stockScope]);

  // Extract unique suppliers for filter dropdown
  const availableSuppliers = useMemo(() => {
    const set = new Set<string>();
    baseDeficitProducts.forEach(p => {
      if (p.supplier && p.supplier.trim()) set.add(p.supplier.trim());
    });
    return Array.from(set).sort();
  }, [baseDeficitProducts]);

  // Category counts for pills based on current stock scope
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: baseDeficitProducts.length,
      smartphone: 0,
      tablet: 0,
      accessory: 0,
      wearable: 0,
    };
    baseDeficitProducts.forEach(p => {
      if (p.category && counts[p.category] !== undefined) {
        counts[p.category]++;
      }
    });
    return counts;
  }, [baseDeficitProducts]);

  // Accessory sub-category counts based on current stock scope
  const subCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: baseDeficitProducts.filter(p => p.category === 'accessory').length,
    };
    ACCESSORY_SUB_CATEGORIES.forEach(sub => {
      if (sub.value !== 'all') {
        counts[sub.value] = baseDeficitProducts.filter(
          p => p.category === 'accessory' && (p.accessorySubCategory || 'other') === sub.value
        ).length;
      }
    });
    return counts;
  }, [baseDeficitProducts]);

  // Filtered products to be exported (cleanly grouped and sorted by category)
  const filteredProducts = useMemo(() => {
    const list = baseDeficitProducts.filter(p => {
      const matchCategory = category === 'all' || p.category === category;
      const matchSubCategory =
        category !== 'accessory' ||
        subCategory === 'all' ||
        (p.accessorySubCategory || 'other') === subCategory;
      const matchSupplier = supplierFilter === 'all' || p.supplier === supplierFilter;

      let matchSearch = true;
      if (searchQuery.trim()) {
        const q = normalizeArabic(searchQuery);
        const full = normalizeArabic([p.name, p.model, p.sku, p.color].filter(Boolean).join(' '));
        matchSearch = full.includes(q);
      }

      return matchCategory && matchSubCategory && matchSupplier && matchSearch;
    });

    const catRank: Record<string, number> = {
      smartphone: 1,
      tablet: 2,
      wearable: 3,
      accessory: 4,
    };

    return list.sort((a, b) => {
      const rankA = catRank[a.category] || 99;
      const rankB = catRank[b.category] || 99;
      if (rankA !== rankB) return rankA - rankB;

      // Group accessories by sub-category
      if (a.category === 'accessory' && b.category === 'accessory') {
        const subA = a.accessorySubCategory || 'other';
        const subB = b.accessorySubCategory || 'other';
        if (subA !== subB) return subA.localeCompare(subB);
      }

      // Sort alphabetically within category
      const nameA = `${a.name || ''} ${a.model || ''}`.toLowerCase();
      const nameB = `${b.name || ''} ${b.model || ''}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [baseDeficitProducts, category, subCategory, supplierFilter, searchQuery]);

  // Metrics for summary bar
  const totalUnitsNeeded = useMemo(() => {
    return filteredProducts.reduce((sum, p) => {
      const threshold = p.lowStockThreshold || 1;
      const deficit = Math.max(1, threshold - (p.stock || 0));
      return sum + deficit;
    }, 0);
  }, [filteredProducts]);

  const totalRestockCost = useMemo(() => {
    return filteredProducts.reduce((sum, p) => {
      const threshold = p.lowStockThreshold || 1;
      const deficit = Math.max(1, threshold - (p.stock || 0));
      return sum + deficit * (p.costPrice || 0);
    }, 0);
  }, [filteredProducts]);

  // CSV Export Handler
  const handleExportCSV = () => {
    if (filteredProducts.length === 0) {
      toast.error('No products match the selected filters to export.');
      return;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const catLabel = category === 'all' ? 'all' : category;
    const subLabel = category === 'accessory' && subCategory !== 'all' ? `_${subCategory}` : '';
    const filename = `low_stock_report_${catLabel}${subLabel}_${dateStr}.csv`;

    const headers = [
      'Product Name',
      'Model',
      'Category',
      'Sub-Category',
      'SKU',
      'Current Stock',
      'Min Threshold',
      'Units Needed (Deficit)',
      ...(canViewCosts ? ['Cost Price', 'Est. Total Cost'] : []),
      'Retail Sell Price',
      'Supplier',
      'Storage',
      'Color',
      'Location',
    ];

    const rows = filteredProducts.map(p => {
      const threshold = p.lowStockThreshold || 1;
      const deficit = Math.max(1, threshold - (p.stock || 0));
      const subMeta = p.category === 'accessory' ? getSubCategoryMeta(p.accessorySubCategory).label : '-';

      return [
        p.name || '',
        p.model || '',
        p.category || '',
        subMeta,
        p.sku || '',
        p.stock ?? 0,
        threshold,
        deficit,
        ...(canViewCosts ? [p.costPrice ?? 0, (p.costPrice || 0) * deficit] : []),
        p.price ?? 0,
        p.supplier || 'Unassigned',
        p.storage || '',
        p.color || '',
        p.location || '',
      ];
    });

    exportToCSV(filename, headers, rows);
    toast.success(`Exported ${filteredProducts.length} low-stock products to CSV!`);
    onClose();
  };

  // Print Reorder Sheet Handler via Thermal Print Server
  const handlePrintSheet = async () => {
    if (filteredProducts.length === 0) {
      toast.error('No products match the selected filters to print.');
      return;
    }

    setIsPrinting(true);
    try {
      const res = await printLowStockReportDirect({
        storeName: storeName || 'PhoneShop Pro',
        currency,
        category,
        subCategory,
        totalUnitsNeeded,
        totalRestockCost,
        canViewCosts,
        products: filteredProducts.map(p => ({
          name: p.name || '',
          model: p.model || '',
          category: p.category || '',
          accessorySubCategory: p.accessorySubCategory,
          sku: p.sku || '',
          stock: p.stock ?? 0,
          lowStockThreshold: p.lowStockThreshold || 1,
          supplier: p.supplier || '',
          costPrice: p.costPrice,
          price: p.price,
        })),
      });

      if (res.method === 'direct') {
        toast.success('Report Sent to Printer', 'Low stock report printed on thermal printer.');
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err) || 'Print server error.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Low Stock Products"
      subtitle="Filter low-stock products by category, accessory sub-category, or scope before generating report."
      size="lg"
      footer={
        <div className={styles.footerActions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Printer size={15} />}
            onClick={handlePrintSheet}
            disabled={isPrinting || filteredProducts.length === 0}
          >
            {isPrinting ? 'Printing...' : 'Print (Thermal Server)'}
          </Button>
          <Button leftIcon={<Download size={15} />} onClick={handleExportCSV}>
            Export CSV ({filteredProducts.length})
          </Button>
        </div>
      }
    >
      <div className={styles.modalContent}>
        {/* Filter Card */}
        <div className={styles.filterCard}>
          {/* Category Filter Row */}
          <div className={styles.filterRow}>
            <div className={styles.filterHeader}>
              <span className={styles.filterLabel}>
                <Filter size={13} /> Select Category:
              </span>
            </div>
            <div className={styles.pillGroup}>
              {CATEGORY_OPTIONS.map(cat => {
                const isActive = category === cat.value;
                const count = categoryCounts[cat.value] || 0;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      setCategory(cat.value);
                      setSubCategory('all');
                    }}
                    className={[styles.categoryPill, isActive && styles.categoryPillActive].filter(Boolean).join(' ')}
                  >
                    <span>{cat.label}</span>
                    <span className={styles.pillBadge}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-Category Filter Row if Accessories Selected */}
          {category === 'accessory' && (
            <div className={styles.subCategoryRow}>
              <span className={styles.filterLabel}>Accessory Sub-Category:</span>
              <div className={styles.pillGroup}>
                {ACCESSORY_SUB_CATEGORIES.map(sub => {
                  const isActive = subCategory === sub.value;
                  const count = subCategoryCounts[sub.value] || 0;
                  return (
                    <button
                      key={sub.value}
                      type="button"
                      onClick={() => setSubCategory(sub.value)}
                      className={[styles.subCategoryPill, isActive && styles.subCategoryPillActive].filter(Boolean).join(' ')}
                    >
                      <span>{sub.icon}</span>
                      <span>{sub.label}</span>
                      <span className={styles.pillBadge}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Options Row (Stock Scope & Supplier Filter) */}
          <div className={styles.optionsRow}>
            <div className={styles.selectWrap}>
              <span className={styles.filterLabel}>Stock Level:</span>
              <select
                className={styles.selectInput}
                value={stockScope}
                onChange={e => setStockScope(e.target.value as 'all_low' | 'low_only' | 'out_only')}
              >
                <option value="all_low">Low Stock & Out of Stock</option>
                <option value="low_only">Low Stock Only (Stock &gt; 0)</option>
                <option value="out_only">Critical Deficit Only (Stock = 0)</option>
              </select>
            </div>

            {availableSuppliers.length > 0 && (
              <div className={styles.selectWrap}>
                <span className={styles.filterLabel}>Supplier:</span>
                <select
                  className={styles.selectInput}
                  value={supplierFilter}
                  onChange={e => setSupplierFilter(e.target.value)}
                >
                  <option value="all">All Suppliers</option>
                  {availableSuppliers.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.selectWrap} style={{ flex: 1, minWidth: 160 }}>
              <input
                type="text"
                placeholder="Search model or SKU..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={styles.selectInput}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>

        {/* Live Metrics Summary */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Products to Export</span>
            <span className={styles.statValue}>{filteredProducts.length} items</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Replenishment Deficit</span>
            <span className={styles.statValue} style={{ color: '#dc2626' }}>
              +{totalUnitsNeeded} units
            </span>
          </div>
          {canViewCosts && (
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Est. Reorder Cost</span>
              <span className={styles.statValue} style={{ color: '#d97706' }}>
                {formatPrivateCurrency(totalRestockCost)}
              </span>
            </div>
          )}
        </div>

        {/* Preview Section */}
        <div className={styles.previewSection}>
          <div className={styles.previewHeader}>
            <span className={styles.previewTitle}>
              Preview Output ({filteredProducts.length} items)
            </span>
            {filteredProducts.length > 0 && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Columns: Name, Category, Sub-Category, SKU, Stock, Deficit, Price, Supplier
              </span>
            )}
          </div>

          <div className={styles.tableWrapper}>
            {filteredProducts.length === 0 ? (
              <div className={styles.emptyBox}>
                <AlertTriangle size={24} style={{ color: '#d97706', marginBottom: 6 }} />
                <p>No products match your active filter criteria.</p>
                <button
                  type="button"
                  style={{
                    marginTop: 8,
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    cursor: 'pointer',
                    fontWeight: 600,
                    textDecoration: 'underline',
                  }}
                  onClick={() => {
                    setCategory('all');
                    setSubCategory('all');
                    setStockScope('all_low');
                    setSupplierFilter('all');
                    setSearchQuery('');
                  }}
                >
                  Reset all filters
                </button>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Product / Model</th>
                    <th>Category</th>
                    <th>SKU</th>
                    <th>Stock vs Min</th>
                    <th>Deficit</th>
                    {canViewCosts && <th>Cost Price</th>}
                    <th>Sell Price</th>
                    <th>Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => {
                    const threshold = p.lowStockThreshold || 1;
                    const deficit = Math.max(1, threshold - (p.stock || 0));
                    const subMeta = p.category === 'accessory' ? getSubCategoryMeta(p.accessorySubCategory) : null;

                    return (
                      <tr key={p.id}>
                        <td>
                          <div className={styles.productCell}>
                            <span className={styles.productName}>
                              {p.name} {p.model}
                            </span>
                            {p.color && <span style={{ fontSize: '10.5px', color: '#64748b' }}>Color: {p.color}</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className={styles.catBadge}>{p.category}</span>
                            {subMeta && (
                              <span style={{ fontSize: '10.5px', color: '#2563eb' }}>
                                {subMeta.icon} {subMeta.label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <code className={styles.productSku}>{p.sku || '—'}</code>
                        </td>
                        <td>
                          <span className={styles.stockBadge}>
                            {p.stock} <span style={{ color: '#94a3b8', fontWeight: 400 }}>/ {threshold}</span>
                          </span>
                        </td>
                        <td>
                          <span className={styles.deficitBadge}>+{deficit}</span>
                        </td>
                        {canViewCosts && <td>{formatCurrency(p.costPrice || 0)}</td>}
                        <td>{formatCurrency(p.price || 0)}</td>
                        <td style={{ color: '#64748b' }}>{p.supplier || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
