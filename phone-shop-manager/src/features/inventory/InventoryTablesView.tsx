import React, { useState, useMemo, useEffect } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, XCircle, ChevronDown, Eye, Edit, Plus, Printer, DollarSign, Smartphone, ShieldCheck, MapPin, Package, Layers, FileSpreadsheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PhoneModel } from '../../types';
import { ACCESSORY_SUB_CATEGORIES, getSubCategoryMeta } from '../../utils/accessorySubCategories';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import type { StockWriteResult } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import styles from './InventoryTables.module.css';

export interface InventoryTablesViewProps {
  products: PhoneModel[];
  canViewCosts: boolean;
  onSelectProduct: (product: PhoneModel) => void;
  onEditProduct: (product: PhoneModel) => void;
  onRestockProduct: (product: PhoneModel, amount: number, meta?: { supplier?: string; note?: string; cost?: number }) => Promise<StockWriteResult>;
  onWriteOffProduct: (product: PhoneModel) => void;
  onPrintLabel?: (product: PhoneModel) => void;
  statusFilter?: string;
  categoryFilter?: string;
  subCategoryFilter?: string;
  onSelectCategory?: (category: string) => void;
  onSelectSubCategory?: (subCategory: string) => void;
  onExportLowStock?: (category?: string, subCategory?: string) => void;
}

const margin = (p: PhoneModel) =>
  p.price > 0 ? (((p.price - (p.costPrice || 0)) / p.price) * 100) : 0;

export const hasValidStorage = (product?: { storage?: string; category?: string } | null) => {
  if (!product || !product.storage) return false;
  if (product.category === 'accessory') return false;
  const s = product.storage.trim().toUpperCase();
  return s !== '' && s !== 'N/A' && s !== 'NONE' && s !== 'NULL' && s !== 'UNDEFINED';
};

export const hasValidColor = (color?: string | null) => {
  if (!color) return false;
  const c = color.trim().toUpperCase();
  return c !== '' && c !== 'N/A' && c !== 'NONE' && c !== 'NULL' && c !== 'UNDEFINED';
};

const getBrandAvatar = (name: string = '', model: string = '') => {
  const full = `${name} ${model}`.toLowerCase();
  if (full.includes('apple') || full.includes('iphone') || full.includes('ipad')) {
    return { char: '🍏', cls: styles.avatarApple };
  }
  if (full.includes('samsung') || full.includes('galaxy')) {
    return { char: '📱', cls: styles.avatarSamsung };
  }
  if (full.includes('xiaomi') || full.includes('redmi') || full.includes('poco')) {
    return { char: '⚡', cls: styles.avatarXiaomi };
  }
  return { char: (name[0] || 'P').toUpperCase(), cls: styles.avatarGeneric };
};

export const InventoryTablesView: React.FC<InventoryTablesViewProps> = ({ products, canViewCosts, onSelectProduct, onEditProduct, onRestockProduct, onWriteOffProduct, onPrintLabel, statusFilter, categoryFilter, subCategoryFilter, onExportLowStock }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);

  // Collapsible state for each section
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    healthy: false,
    vault: false,
    lowStock: false,
    stockouts: false,
  });

  // When low_stock status filter is active, automatically expand low stock and collapse healthy/stockouts
  useEffect(() => {
    if (statusFilter === 'low_stock') {
      setCollapsedSections({
        healthy: true,
        vault: false,
        lowStock: false,
        stockouts: true,
      });
    }
  }, [statusFilter]);

  // Inline custom restock state: { [productId]: { open: boolean, qty: string, cost: string } }
  const [inlineRestock, setInlineRestock] = useState<Record<string, { open: boolean; qty: string; cost: string }>>({});
  const [loadingRestockId, setLoadingRestockId] = useState<string | null>(null);

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 1. Active Healthy Retail Catalog (stock > threshold and not a smartphone/tablet)
  const healthyProducts = useMemo(() => {
    return products.filter(p => {
      const threshold = p.lowStockThreshold || 1;
      return p.stock > threshold && p.category !== 'smartphone' && p.category !== 'tablet';
    });
  }, [products]);

  // 2. High-Value Device Vault (all smartphones & tablets)
  const deviceVaultProducts = useMemo(() => {
    return products.filter(p => p.category === 'smartphone' || p.category === 'tablet');
  }, [products]);

  // 3. Low Stock Buffer (stock > 0 and (low_stock or stock <= threshold))
  const lowStockProducts = useMemo(() => {
    return products.filter(p => {
      const threshold = p.lowStockThreshold || 1;
      return p.stock > 0 && (p.stockStatus === 'low_stock' || p.stock <= threshold);
    });
  }, [products]);

  // Section 3 Category & Sub-Category Filter States
  const [lowStockCategory, setLowStockCategory] = useState<string>('all');
  const [lowStockSubCategory, setLowStockSubCategory] = useState<string>('all');

  // Sync with parent filters when provided
  useEffect(() => {
    if (categoryFilter && categoryFilter !== 'all') {
      setLowStockCategory(categoryFilter);
    }
  }, [categoryFilter]);

  useEffect(() => {
    if (subCategoryFilter && subCategoryFilter !== 'all') {
      setLowStockSubCategory(subCategoryFilter);
    }
  }, [subCategoryFilter]);

  // Counts of low stock items by category
  const lowStockCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: lowStockProducts.length,
      smartphone: 0,
      tablet: 0,
      accessory: 0,
      wearable: 0,
    };
    lowStockProducts.forEach(p => {
      if (p.category && counts[p.category] !== undefined) {
        counts[p.category]++;
      }
    });
    return counts;
  }, [lowStockProducts]);

  // Counts of low stock items by accessory sub-category
  const lowStockSubCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: lowStockProducts.filter(p => p.category === 'accessory').length,
    };
    ACCESSORY_SUB_CATEGORIES.forEach(sub => {
      if (sub.value !== 'all') {
        counts[sub.value] = lowStockProducts.filter(
          p => p.category === 'accessory' && (p.accessorySubCategory || 'other') === sub.value
        ).length;
      }
    });
    return counts;
  }, [lowStockProducts]);

  // Filtered low stock products based on Section 3 category & sub-category selection
  const displayedLowStockProducts = useMemo(() => {
    return lowStockProducts.filter(p => {
      const matchCat = lowStockCategory === 'all' || p.category === lowStockCategory;
      const matchSub =
        lowStockCategory !== 'accessory' ||
        lowStockSubCategory === 'all' ||
        (p.accessorySubCategory || 'other') === lowStockSubCategory;
      return matchCat && matchSub;
    });
  }, [lowStockProducts, lowStockCategory, lowStockSubCategory]);

  // 4. Stockouts & Critical Deficit (stock === 0 or stockStatus === 'out_of_stock')
  const stockoutProducts = useMemo(() => {
    return products.filter(p => p.stock === 0 || p.stockStatus === 'out_of_stock');
  }, [products]);

  // Metrics for Headers
  const lostSalesRisk = useMemo(() => {
    return stockoutProducts.reduce((sum, p) => sum + (p.price || 0), 0);
  }, [stockoutProducts]);

  const replenishmentCostNeeded = useMemo(() => {
    return displayedLowStockProducts.reduce((sum, p) => {
      const deficit = Math.max(1, (p.lowStockThreshold || 1) - p.stock);
      return sum + deficit * (p.costPrice || 0);
    }, 0);
  }, [displayedLowStockProducts]);

  const healthyTotalUnits = useMemo(() => {
    return healthyProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
  }, [healthyProducts]);

  const vaultCapitalTiedUp = useMemo(() => {
    return deviceVaultProducts.reduce((sum, p) => sum + (p.costPrice || 0) * (p.stock || 0), 0);
  }, [deviceVaultProducts]);

  const vaultTotalUnits = useMemo(() => {
    return deviceVaultProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
  }, [deviceVaultProducts]);

  // Fast Restock Handler
  const reportRestock = (product: PhoneModel, result: StockWriteResult): void => {
    if (result.outcome === 'queued') {
      // Only this device moved; the server stock is untouched until the queue drains.
      toast.info(
        t('inventory.restockQueuedTitle'),
        t('inventory.restockQueuedDesc', { amt: result.applied, name: product.name })
      );
    } else if (result.outcome === 'failed') {
      toast.error(t('inventory.restockFailedTitle'), t('inventory.restockFailedDesc', { name: product.name }));
    } else {
      toast.success(
        t('inventory.restockSuccessTitle'),
        t('inventory.restockSuccessDesc', { amt: result.applied, name: product.name })
      );
    }
  };

  const handleQuickPreset = async (e: React.MouseEvent, product: PhoneModel, amount: number) => {
    e.stopPropagation();
    try {
      setLoadingRestockId(product.id);
      reportRestock(product, await onRestockProduct(product, amount));
    } finally {
      setLoadingRestockId(null);
    }
  };

  const handleCustomRestockSubmit = async (e: React.FormEvent, product: PhoneModel) => {
    e.stopPropagation();
    e.preventDefault();
    const current = inlineRestock[product.id];
    const qty = parseInt(current?.qty || '0', 10);
    if (isNaN(qty) || qty <= 0) return;

    try {
      setLoadingRestockId(product.id);
      const result = await onRestockProduct(product, qty, {
        cost: current.cost ? parseFloat(current.cost) : undefined,
      });
      reportRestock(product, result);
      if (result.outcome !== 'failed') {
        setInlineRestock(prev => ({ ...prev, [product.id]: { open: false, qty: '', cost: '' } }));
      }
    } finally {
      setLoadingRestockId(null);
    }
  };

  return (
    <div className={styles.container}>

      {/* ========================================================================= */}
      {/* SECTION 1: 🟢 ACTIVE & HEALTHY RETAIL INVENTORY                            */}
      {/* ========================================================================= */}
      <div className={[styles.section, styles.sectionHealthy].join(' ')}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('healthy')}>
          <div className={styles.headerLeft}>
            <div className={[styles.iconBox, styles.iconHealthy].join(' ')}>
              <CheckCircle2 size={20} />
            </div>
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <h3 className={styles.title}>Active Healthy Retail Catalog</h3>
                <span className={[styles.countBadge, styles.countHealthy].join(' ')}>
                  {healthyProducts.length} SKUs Active
                </span>
              </div>
              <p className={styles.subtitle}>
                Fast-moving accessories, wearables, and audio with optimal stock levels.
              </p>
            </div>
          </div>

          <div className={styles.headerRight} onClick={e => e.stopPropagation()}>
            <div className={[styles.metricPill, styles.metricSuccess].join(' ')}>
              <Layers size={13} />
              <span>Available Units: {healthyTotalUnits}</span>
            </div>
            <button
              type="button"
              className={[styles.collapseBtn, collapsedSections.healthy && styles.collapseBtnRotated].filter(Boolean).join(' ')}
              onClick={() => toggleSection('healthy')}
              title={collapsedSections.healthy ? 'Expand section' : 'Collapse section'}
            >
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        {!collapsedSections.healthy && (
          <div className={styles.tableWrapper}>
            {healthyProducts.length === 0 ? (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon}>
                  <Package size={22} />
                </div>
                <p className={styles.emptyTitle}>No Active Accessories or Wearables</p>
                <p className={styles.emptyDesc}>Add retail accessories, chargers, and protectors to build your active catalog.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Product / Model</th>
                    <th>Category</th>
                    <th>SKU & Shelf</th>
                    <th>In Stock</th>
                    {canViewCosts && <th>Cost Price</th>}
                    <th>Retail Price</th>
                    {canViewCosts && <th>Margin %</th>}
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {healthyProducts.map(product => {
                    const avatar = getBrandAvatar(product.name, product.model);
                    const prodMargin = margin(product);

                    return (
                      <tr
                        key={product.id}
                        className={styles.tr}
                        onClick={() => onSelectProduct(product)}
                      >
                        <td>
                          <div className={styles.productCell}>
                            <div className={[styles.brandAvatar, avatar.cls].join(' ')}>
                              {avatar.char}
                            </div>
                            <div className={styles.productText}>
                              <span className={styles.productName}>
                                {product.name} {product.model}
                              </span>
                              <div className={styles.productSubRow}>
                                {hasValidStorage(product) && <span className={styles.specChip}>{product.storage}</span>}
                                {hasValidColor(product.color) && product.color && (
                                  <span className={styles.colorChip}>
                                    <span className={styles.colorDot} style={{ backgroundColor: product.color.toLowerCase() }} />
                                    {product.color}
                                  </span>
                                )}
                                {product.category === 'accessory' && product.accessorySubCategory && (
                                  <span className={styles.specChip}>
                                    {getSubCategoryMeta(product.accessorySubCategory).icon} {getSubCategoryMeta(product.accessorySubCategory).label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.categoryPill}>{product.category}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <code className={styles.skuBadge}>{product.sku}</code>
                            {product.location ? (
                              <span className={styles.locationBadge}>
                                <MapPin size={10} /> {product.location}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>—</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.stockWarningBox}>
                            <span className={styles.stockCountNumber} style={{ color: '#16a34a' }}>
                              {product.stock} units
                            </span>
                            <div className={styles.stockBarWrapper}>
                              <div className={styles.stockBarFillHealthy} style={{ width: '100%' }} />
                            </div>
                          </div>
                        </td>
                        {canViewCosts && (
                          <td data-col="cost">
                            <span data-privacy-cost className={[styles.costSub, 'privacy-cost'].join(' ')}>
                              {formatPrivateCurrency(product.costPrice || 0)}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className={styles.priceMain}>
                            {formatCurrency(product.price)}
                          </span>
                        </td>
                        {canViewCosts && (
                          <td data-col="margin">
                            <span data-privacy-cost className={[styles.marginPill, prodMargin >= 20 ? styles.marginHigh : prodMargin >= 10 ? styles.marginMid : styles.marginLow, 'privacy-cost'].join(' ')}>
                              {isPrivacyActive ? '••%' : `${prodMargin.toFixed(1)}%`}
                            </span>
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <div className={styles.actionsRow} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() => onSelectProduct(product)}
                              title="View Product Details"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() => onEditProduct(product)}
                              title="Edit Product"
                            >
                              <Edit size={15} />
                            </button>
                            {onPrintLabel && (
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => onPrintLabel(product)}
                                title="Print Barcode Label"
                              >
                                <Printer size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              className={[styles.iconBtn, styles.iconBtnDanger].join(' ')}
                              onClick={() => onWriteOffProduct(product)}
                              title="Write-Off Defective / Damaged"
                            >
                              <AlertTriangle size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>


      {/* ========================================================================= */}
      {/* SECTION 2: 💎 HIGH-VALUE DEVICE VAULT (SMARTPHONES & TABLETS)             */}
      {/* ========================================================================= */}
      <div className={[styles.section, styles.sectionVault].join(' ')}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('vault')}>
          <div className={styles.headerLeft}>
            <div className={[styles.iconBox, styles.iconVault].join(' ')}>
              <Smartphone size={20} />
            </div>
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <h3 className={styles.title}>High-Value Device Vault</h3>
                <span className={[styles.countBadge, styles.countVault].join(' ')}>
                  {vaultTotalUnits} Phones & Tablets
                </span>
              </div>
              <p className={styles.subtitle}>
                Smartphones and tablets requiring safe storage, capital tracking, and IMEI custody.
              </p>
            </div>
          </div>

          <div className={styles.headerRight} onClick={e => e.stopPropagation()}>
            {canViewCosts && (
              <div className={[styles.metricPill, styles.metricPrimary].join(' ')}>
                <ShieldCheck size={13} />
                <span data-privacy-cost className="privacy-cost">Capital Held: {formatPrivateCurrency(vaultCapitalTiedUp)}</span>
              </div>
            )}
            <button
              type="button"
              className={[styles.collapseBtn, collapsedSections.vault && styles.collapseBtnRotated].filter(Boolean).join(' ')}
              onClick={() => toggleSection('vault')}
              title={collapsedSections.vault ? 'Expand section' : 'Collapse section'}
            >
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        {!collapsedSections.vault && (
          <div className={styles.tableWrapper}>
            {deviceVaultProducts.length === 0 ? (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon} style={{ color: '#4f46e5', background: '#e0e7ff' }}>
                  <Smartphone size={22} />
                </div>
                <p className={styles.emptyTitle}>Vault Empty</p>
                <p className={styles.emptyDesc}>No smartphones or tablets registered in current inventory.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Device Model</th>
                    <th>Storage & Color</th>
                    <th>SKU & Safe Location</th>
                    <th>Stock on Hand</th>
                    {canViewCosts && <th>Unit Cost</th>}
                    <th>Retail Price</th>
                    {canViewCosts && <th>Capital Held</th>}
                    {canViewCosts && <th>Margin %</th>}
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceVaultProducts.map(product => {
                    const avatar = getBrandAvatar(product.name, product.model);
                    const prodMargin = margin(product);
                    const capital = (product.costPrice || 0) * (product.stock || 0);

                    return (
                      <tr
                        key={product.id}
                        className={styles.tr}
                        onClick={() => onSelectProduct(product)}
                      >
                        <td>
                          <div className={styles.productCell}>
                            <div className={[styles.brandAvatar, avatar.cls].join(' ')}>
                              {avatar.char}
                            </div>
                            <div className={styles.productText}>
                              <span className={styles.productName}>
                                {product.name} {product.model}
                              </span>
                              <div className={styles.productSubRow}>
                                <span className={styles.categoryPill}>{product.category}</span>
                                {product.supplier && <span>Supplier: {product.supplier}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {hasValidStorage(product) && <span className={styles.specChip}>{product.storage}</span>}
                            {hasValidColor(product.color) && product.color && (
                              <span className={styles.colorChip}>
                                <span className={styles.colorDot} style={{ backgroundColor: product.color.toLowerCase() }} />
                                {product.color}
                              </span>
                            )}
                            {product.category === 'accessory' && product.accessorySubCategory && (
                              <span className={styles.specChip}>
                                {getSubCategoryMeta(product.accessorySubCategory).icon} {getSubCategoryMeta(product.accessorySubCategory).label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <code className={styles.skuBadge}>{product.sku}</code>
                            {product.location ? (
                              <span className={styles.locationBadge} style={{ borderColor: '#6366f1', background: '#eef2ff' }}>
                                <ShieldCheck size={10} style={{ color: '#4f46e5' }} /> {product.location}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>No Safe Set</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.stockWarningBox}>
                            <span
                              className={styles.stockCountNumber}
                              style={{ color: product.stock === 0 ? '#dc2626' : product.stock <= 3 ? '#d97706' : '#16a34a' }}
                            >
                              {product.stock} units
                            </span>
                          </div>
                        </td>
                        {canViewCosts && (
                          <td data-col="cost">
                            <span data-privacy-cost className={[styles.costSub, 'privacy-cost'].join(' ')}>
                              {formatPrivateCurrency(product.costPrice || 0)}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className={styles.priceMain}>
                            {formatCurrency(product.price)}
                          </span>
                        </td>
                        {canViewCosts && (
                          <td data-col="cost">
                            <span data-privacy-cost className="privacy-cost" style={{ fontWeight: 700, color: '#4338ca', fontSize: '13px' }}>
                              {formatPrivateCurrency(capital)}
                            </span>
                          </td>
                        )}
                        {canViewCosts && (
                          <td data-col="margin">
                            <span data-privacy-cost className={[styles.marginPill, prodMargin >= 20 ? styles.marginHigh : prodMargin >= 10 ? styles.marginMid : styles.marginLow, 'privacy-cost'].join(' ')}>
                              {isPrivacyActive ? '••%' : `${prodMargin.toFixed(1)}%`}
                            </span>
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <div className={styles.actionsRow} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() => onSelectProduct(product)}
                              title="View Device Specifications"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() => onEditProduct(product)}
                              title="Edit Device"
                            >
                              <Edit size={15} />
                            </button>
                            {onPrintLabel && (
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => onPrintLabel(product)}
                                title="Print Device Label"
                              >
                                <Printer size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              className={[styles.iconBtn, styles.iconBtnDanger].join(' ')}
                              onClick={() => onWriteOffProduct(product)}
                              disabled={product.stock === 0}
                              title="Write-Off Device"
                            >
                              <AlertTriangle size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>


      {/* ========================================================================= */}
      {/* SECTION 3: 🟡 REPLENISHMENT BUFFER & LOW STOCK                             */}
      {/* ========================================================================= */}
      <div className={[styles.section, styles.sectionLowStock].join(' ')}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('lowStock')}>
          <div className={styles.headerLeft}>
            <div className={[styles.iconBox, styles.iconLowStock].join(' ')}>
              <AlertTriangle size={20} />
            </div>
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <h3 className={styles.title}>Replenishment Buffer & Low Stock</h3>
                <span className={[styles.countBadge, styles.countLowStock].join(' ')}>
                  {displayedLowStockProducts.length !== lowStockProducts.length
                    ? `${displayedLowStockProducts.length} of ${lowStockProducts.length} Items Below Threshold`
                    : `${lowStockProducts.length} Items Below Threshold`}
                </span>
              </div>
              <p className={styles.subtitle}>
                Items near or below their minimum reorder point. Needs replenishment soon.
              </p>
            </div>
          </div>

          <div className={styles.headerRight} onClick={e => e.stopPropagation()}>
            {onExportLowStock && (
              <button
                type="button"
                className={styles.sectionExportBtn}
                onClick={() => onExportLowStock(lowStockCategory, lowStockSubCategory)}
                title="Export filtered low stock products"
              >
                <FileSpreadsheet size={13} />
                <span>Export Report</span>
              </button>
            )}
            <div className={[styles.metricPill, styles.metricWarning].join(' ')}>
              <Package size={13} />
              <span data-privacy-cost className="privacy-cost">Est. Buffer Cost: ~{formatPrivateCurrency(replenishmentCostNeeded)}</span>
            </div>
            <button
              type="button"
              className={[styles.collapseBtn, collapsedSections.lowStock && styles.collapseBtnRotated].filter(Boolean).join(' ')}
              onClick={() => toggleSection('lowStock')}
              title={collapsedSections.lowStock ? 'Expand section' : 'Collapse section'}
            >
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        {!collapsedSections.lowStock && (
          <div className={styles.tableWrapper}>
            {/* Category & Sub-Category Filter Bar for Low Stock */}
            <div className={styles.sectionFilterBar}>
              <div className={styles.sectionFilterGroup}>
                <span className={styles.filterLabel}>Filter Category:</span>
                <div className={styles.pillGroup}>
                  {[
                    { value: 'all', label: 'All Items' },
                    { value: 'smartphone', label: '📱 Smartphones' },
                    { value: 'tablet', label: '📟 Tablets' },
                    { value: 'accessory', label: '🎧 Accessories' },
                    { value: 'wearable', label: '⌚ Wearables' },
                  ].map(cat => {
                    const isActive = lowStockCategory === cat.value;
                    const count = lowStockCategoryCounts[cat.value] || 0;
                    return (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setLowStockCategory(cat.value);
                          setLowStockSubCategory('all');
                        }}
                        className={[
                          styles.filterPill,
                          isActive && styles.filterPillActive,
                          count === 0 && !isActive && styles.filterPillEmpty,
                        ].filter(Boolean).join(' ')}
                      >
                        <span>{cat.label}</span>
                        <span className={styles.filterPillBadge}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accessory Sub-Category Bar if Accessories Selected */}
              {lowStockCategory === 'accessory' && (
                <div className={styles.sectionSubFilterGroup}>
                  <span className={styles.filterLabel}>Accessory Sub-Category:</span>
                  <div className={styles.pillGroup}>
                    {ACCESSORY_SUB_CATEGORIES.map(sub => {
                      const isActive = lowStockSubCategory === sub.value;
                      const count = lowStockSubCategoryCounts[sub.value] || 0;
                      return (
                        <button
                          key={sub.value}
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setLowStockSubCategory(sub.value);
                          }}
                          className={[
                            styles.subFilterPill,
                            isActive && styles.subFilterPillActive,
                            count === 0 && !isActive && styles.filterPillEmpty,
                          ].filter(Boolean).join(' ')}
                        >
                          <span>{sub.icon}</span>
                          <span>{sub.label}</span>
                          <span className={styles.filterPillBadge}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {lowStockProducts.length === 0 ? (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon} style={{ color: '#16a34a', background: '#dcfce7' }}>
                  <CheckCircle2 size={22} />
                </div>
                <p className={styles.emptyTitle}>Healthy Buffers</p>
                <p className={styles.emptyDesc}>No products are currently under their low-stock safety threshold.</p>
              </div>
            ) : displayedLowStockProducts.length === 0 ? (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon} style={{ color: '#d97706', background: '#fef3c7' }}>
                  <AlertTriangle size={22} />
                </div>
                <p className={styles.emptyTitle}>No Low Stock Items in this Selection</p>
                <p className={styles.emptyDesc}>
                  {lowStockCategory === 'accessory' && lowStockSubCategory !== 'all'
                    ? `No low-stock accessories found in sub-category "${lowStockSubCategory}".`
                    : `No low-stock products found in category "${lowStockCategory}".`}
                </p>
                <button
                  type="button"
                  className={styles.resetFilterBtn}
                  onClick={() => {
                    setLowStockCategory('all');
                    setLowStockSubCategory('all');
                  }}
                >
                  Show All Low Stock ({lowStockProducts.length})
                </button>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Product / Model</th>
                    <th>Category</th>
                    <th>SKU & Location</th>
                    <th>Stock vs Min</th>
                    {canViewCosts && <th>Cost Price</th>}
                    <th>Retail Price</th>
                    {canViewCosts && <th>Margin %</th>}
                    <th style={{ textAlign: 'right' }}>Fast Replenish</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedLowStockProducts.map(product => {
                    const avatar = getBrandAvatar(product.name, product.model);
                    const prodMargin = margin(product);
                    const threshold = product.lowStockThreshold || 1;
                    const percentFill = Math.min(100, Math.max(10, (product.stock / threshold) * 100));
                    const isRestocking = loadingRestockId === product.id;
                    const isInlineOpen = inlineRestock[product.id]?.open;

                    return (
                      <tr
                        key={product.id}
                        className={styles.tr}
                        onClick={() => onSelectProduct(product)}
                      >
                        <td>
                          <div className={styles.productCell}>
                            <div className={[styles.brandAvatar, avatar.cls].join(' ')}>
                              {avatar.char}
                            </div>
                            <div className={styles.productText}>
                              <span className={styles.productName}>
                                {product.name} {product.model}
                              </span>
                              <div className={styles.productSubRow}>
                                {hasValidStorage(product) && <span className={styles.specChip}>{product.storage}</span>}
                                {hasValidColor(product.color) && product.color && (
                                  <span className={styles.colorChip}>
                                    <span className={styles.colorDot} style={{ backgroundColor: product.color.toLowerCase() }} />
                                    {product.color}
                                  </span>
                                )}
                                {product.category === 'accessory' && product.accessorySubCategory && (
                                  <span className={styles.specChip}>
                                    {getSubCategoryMeta(product.accessorySubCategory).icon} {getSubCategoryMeta(product.accessorySubCategory).label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.categoryPill}>{product.category}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <code className={styles.skuBadge}>{product.sku}</code>
                            {product.location ? (
                              <span className={styles.locationBadge}>
                                <MapPin size={10} /> {product.location}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>—</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.stockWarningBox}>
                            <span className={styles.stockCountNumber} style={{ color: '#d97706' }}>
                              {product.stock} <span style={{ fontSize: '11px', color: '#64748b' }}>/ min {threshold}</span>
                            </span>
                            <div className={styles.stockBarWrapper}>
                              <div
                                className={styles.stockBarFillWarning}
                                style={{ width: `${percentFill}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        {canViewCosts && (
                          <td data-col="cost">
                            <span data-privacy-cost className={[styles.costSub, 'privacy-cost'].join(' ')}>
                              {formatPrivateCurrency(product.costPrice || 0)}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className={styles.priceMain}>
                            {formatCurrency(product.price)}
                          </span>
                        </td>
                        {canViewCosts && (
                          <td data-col="margin">
                            <span data-privacy-cost className={[styles.marginPill, prodMargin >= 20 ? styles.marginHigh : prodMargin >= 10 ? styles.marginMid : styles.marginLow, 'privacy-cost'].join(' ')}>
                              {isPrivacyActive ? '••%' : `${prodMargin.toFixed(1)}%`}
                            </span>
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <div className={styles.actionsRow} onClick={e => e.stopPropagation()}>
                            {isInlineOpen ? (
                              <form
                                className={styles.inlineRestockContainer}
                                onSubmit={e => handleCustomRestockSubmit(e, product)}
                              >
                                <input
                                  autoFocus
                                  type="number"
                                  min="1"
                                  placeholder="Qty"
                                  className={styles.inlineInput}
                                  value={inlineRestock[product.id]?.qty || ''}
                                  onChange={e =>
                                    setInlineRestock(prev => ({
                                      ...prev,
                                      [product.id]: { ...(prev[product.id] || { open: true, cost: '' }), qty: e.target.value }
                                    }))
                                  }
                                />
                                <button type="submit" className={styles.inlineSaveBtn} disabled={isRestocking}>
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className={styles.inlineCancelBtn}
                                  onClick={() =>
                                    setInlineRestock(prev => ({
                                      ...prev,
                                      [product.id]: { open: false, qty: '', cost: '' }
                                    }))
                                  }
                                >
                                  ✕
                                </button>
                              </form>
                            ) : (
                              <div className={styles.quickRestockGroup}>
                                <button
                                  type="button"
                                  className={styles.presetBtn}
                                  onClick={e => handleQuickPreset(e, product, 2)}
                                  disabled={isRestocking}
                                  title="Add +2 units"
                                >
                                  +2
                                </button>
                                <button
                                  type="button"
                                  className={styles.presetBtn}
                                  onClick={e => handleQuickPreset(e, product, 5)}
                                  disabled={isRestocking}
                                  title="Add +5 units"
                                >
                                  +5
                                </button>
                                <button
                                  type="button"
                                  className={styles.presetBtn}
                                  onClick={e => handleQuickPreset(e, product, 10)}
                                  disabled={isRestocking}
                                  title="Add +10 units"
                                >
                                  +10
                                </button>
                                <button
                                  type="button"
                                  className={styles.restockMainBtn}
                                  onClick={() =>
                                    setInlineRestock(prev => ({
                                      ...prev,
                                      [product.id]: { open: true, qty: '', cost: '' }
                                    }))
                                  }
                                  title="Custom Restock Quantity"
                                >
                                  <Plus size={12} /> Restock
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>


      {/* ========================================================================= */}
      {/* SECTION 4: 🔴 CRITICAL DEFICIT & STOCKOUTS                                 */}
      {/* ========================================================================= */}
      <div className={[styles.section, styles.sectionStockout].join(' ')}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('stockouts')}>
          <div className={styles.headerLeft}>
            <div className={[styles.iconBox, styles.iconStockout].join(' ')}>
              <XCircle size={20} />
            </div>
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <h3 className={styles.title}>Critical Deficit & Stockouts</h3>
                <span className={[styles.countBadge, styles.countStockout].join(' ')}>
                  {stockoutProducts.length} Products
                </span>
              </div>
              <p className={styles.subtitle}>
                Items with 0 units in stock. Immediate lost sales risk.
              </p>
            </div>
          </div>

          <div className={styles.headerRight} onClick={e => e.stopPropagation()}>
            <div className={[styles.metricPill, styles.metricDanger].join(' ')}>
              <DollarSign size={13} />
              <span>Lost Sales Risk: ~{formatCurrency(lostSalesRisk)}</span>
            </div>
            <button
              type="button"
              className={[styles.collapseBtn, collapsedSections.stockouts && styles.collapseBtnRotated].filter(Boolean).join(' ')}
              onClick={() => toggleSection('stockouts')}
              title={collapsedSections.stockouts ? 'Expand section' : 'Collapse section'}
            >
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        {!collapsedSections.stockouts && (
          <div className={styles.tableWrapper}>
            {stockoutProducts.length === 0 ? (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon} style={{ color: '#16a34a', background: '#dcfce7' }}>
                  <CheckCircle2 size={22} />
                </div>
                <p className={styles.emptyTitle}>Zero Stockouts</p>
                <p className={styles.emptyDesc}>All catalog products currently have active stock on hand.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Product / Model</th>
                    <th>Category</th>
                    <th>SKU & Location</th>
                    <th>Supplier</th>
                    {canViewCosts && <th>Cost Price</th>}
                    <th>Retail Sell</th>
                    <th>Deficit Status</th>
                    <th style={{ textAlign: 'right' }}>Fast Restock Presets</th>
                  </tr>
                </thead>
                <tbody>
                  {stockoutProducts.map(product => {
                    const avatar = getBrandAvatar(product.name, product.model);
                    const isRestocking = loadingRestockId === product.id;
                    const isInlineOpen = inlineRestock[product.id]?.open;

                    return (
                      <tr
                        key={product.id}
                        className={styles.tr}
                        onClick={() => onSelectProduct(product)}
                      >
                        <td>
                          <div className={styles.productCell}>
                            <div className={[styles.brandAvatar, avatar.cls].join(' ')}>
                              {avatar.char}
                            </div>
                            <div className={styles.productText}>
                              <span className={styles.productName}>
                                {product.name} {product.model}
                              </span>
                              <div className={styles.productSubRow}>
                                {hasValidStorage(product) && <span className={styles.specChip}>{product.storage}</span>}
                                {hasValidColor(product.color) && product.color && (
                                  <span className={styles.colorChip}>
                                    <span className={styles.colorDot} style={{ backgroundColor: product.color.toLowerCase() }} />
                                    {product.color}
                                  </span>
                                )}
                                {product.category === 'accessory' && product.accessorySubCategory && (
                                  <span className={styles.specChip}>
                                    {getSubCategoryMeta(product.accessorySubCategory).icon} {getSubCategoryMeta(product.accessorySubCategory).label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.categoryPill}>{product.category}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <code className={styles.skuBadge}>{product.sku}</code>
                            {product.location ? (
                              <span className={styles.locationBadge}>
                                <MapPin size={10} /> {product.location}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>No shelf set</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#475569' }}>
                            {product.supplier || '—'}
                          </span>
                        </td>
                        {canViewCosts && (
                          <td data-col="cost">
                            <span data-privacy-cost className={[styles.costSub, 'privacy-cost'].join(' ')}>
                              {formatPrivateCurrency(product.costPrice || 0)}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className={styles.priceMain}>
                            {formatCurrency(product.price)}
                          </span>
                        </td>
                        <td>
                          <span className={styles.stockoutAlert}>
                            <AlertCircle size={13} /> Sold Out (0)
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className={styles.actionsRow} onClick={e => e.stopPropagation()}>
                            {isInlineOpen ? (
                              <form
                                className={styles.inlineRestockContainer}
                                onSubmit={e => handleCustomRestockSubmit(e, product)}
                              >
                                <input
                                  autoFocus
                                  type="number"
                                  min="1"
                                  placeholder="Qty"
                                  className={styles.inlineInput}
                                  value={inlineRestock[product.id]?.qty || ''}
                                  onChange={e =>
                                    setInlineRestock(prev => ({
                                      ...prev,
                                      [product.id]: { ...(prev[product.id] || { open: true, cost: '' }), qty: e.target.value }
                                    }))
                                  }
                                />
                                {canViewCosts && (
                                  <input
                                    type="number"
                                    placeholder="Cost"
                                    className={styles.inlineInput}
                                    value={inlineRestock[product.id]?.cost || ''}
                                    onChange={e =>
                                      setInlineRestock(prev => ({
                                        ...prev,
                                        [product.id]: { ...(prev[product.id] || { open: true, qty: '' }), cost: e.target.value }
                                      }))
                                    }
                                  />
                                )}
                                <button type="submit" className={styles.inlineSaveBtn} disabled={isRestocking}>
                                  {isRestocking ? '…' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  className={styles.inlineCancelBtn}
                                  onClick={() =>
                                    setInlineRestock(prev => ({
                                      ...prev,
                                      [product.id]: { open: false, qty: '', cost: '' }
                                    }))
                                  }
                                >
                                  ✕
                                </button>
                              </form>
                            ) : (
                              <div className={styles.quickRestockGroup}>
                                <button
                                  type="button"
                                  className={styles.presetBtn}
                                  onClick={e => handleQuickPreset(e, product, 1)}
                                  disabled={isRestocking}
                                  title="Add +1 unit"
                                >
                                  +1
                                </button>
                                <button
                                  type="button"
                                  className={styles.presetBtn}
                                  onClick={e => handleQuickPreset(e, product, 5)}
                                  disabled={isRestocking}
                                  title="Add +5 units"
                                >
                                  +5
                                </button>
                                <button
                                  type="button"
                                  className={styles.presetBtn}
                                  onClick={e => handleQuickPreset(e, product, 10)}
                                  disabled={isRestocking}
                                  title="Add +10 units"
                                >
                                  +10
                                </button>
                                <button
                                  type="button"
                                  className={styles.restockMainBtn}
                                  onClick={() =>
                                    setInlineRestock(prev => ({
                                      ...prev,
                                      [product.id]: { open: true, qty: '', cost: '' }
                                    }))
                                  }
                                  title="Custom Restock Quantity"
                                >
                                  <Plus size={12} /> Restock
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

    </div>
  );
};
