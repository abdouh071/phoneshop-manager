import React, { useState, useEffect, useMemo } from 'react';
import { X, Printer, Search, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { openPrintWindow, buildLabelsHTML } from '../../utils/printWindow';
import type { PhoneModel } from '../../types';
import styles from './PrintLabels.module.css';
import { useSettingsStore } from '../../store/settingsStore';
import { printBarcodeDirect } from '../../utils/printWindow';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { ACCESSORY_SUB_CATEGORIES } from '../../utils/accessorySubCategories';

const LABEL_CATEGORIES: { value: string; label: string }[] = [
  { value: 'all', label: '🗂 All' },
  { value: 'smartphone', label: '📱 Phones' },
  { value: 'tablet', label: '📟 Tablets' },
  { value: 'accessory', label: '🎧 Accessories' },
  { value: 'wearable', label: '⌚ Wearables' },
];

interface PrintLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: PhoneModel[]; // initially selected products
  categoryFilter?: string; // optional: only show products of this category
}

interface LabelConfig {
  totalQty: number;
  withPrice: number;
}

export const PrintLabelsModal: React.FC<PrintLabelsModalProps> = ({ isOpen, onClose, products: initialProducts, categoryFilter }) => {
  const { storeName, currency } = useSettingsStore();
  const { products: allProducts } = useInventoryStore();
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [labelsToPrint, setLabelsToPrint] = useState<(PhoneModel & { hidePrice?: boolean })[]>([]);
  
  // Search & category filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>(categoryFilter || 'all');
  const [activeSubCategoryFilter, setActiveSubCategoryFilter] = useState<string>('all');

  // Config state: how many of each to print
  // Key is product.id
  const [config, setConfig] = useState<Record<string, LabelConfig>>({});

  // The products that are currently in our configuration list
  const [selectedProducts, setSelectedProducts] = useState<PhoneModel[]>([]);

  // Initialize config when modal opens
  useEffect(() => {
    if (isOpen) {
      const initialConfig: Record<string, LabelConfig> = {};
      initialProducts.forEach(p => {
        initialConfig[p.id] = {
          totalQty: 1,
          withPrice: 1
        };
      });
      setConfig(initialConfig);
      setSelectedProducts([...initialProducts]);
      setSearchQuery('');
      setActiveCategoryFilter(categoryFilter || 'all');
      setActiveSubCategoryFilter('all');
    }
  }, [isOpen, initialProducts, categoryFilter]);

  const searchResults = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return allProducts.filter(p => {
      if (p.category === 'repair_part' || p.sku?.toUpperCase().startsWith('PRT-')) return false;
      if (config[p.id]) return false;
      if (activeCategoryFilter && activeCategoryFilter !== 'all' && p.category !== activeCategoryFilter) return false;
      if (activeCategoryFilter === 'accessory' && activeSubCategoryFilter !== 'all') {
        if ((p.accessorySubCategory || 'other') !== activeSubCategoryFilter) return false;
      }
      if (!query) return true;
      return (
        p.name.toLowerCase().includes(query) ||
        p.model.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query) ||
        (p.accessorySubCategory && p.accessorySubCategory.toLowerCase().includes(query))
      );
    }).slice(0, 20); // Limit to 20 results
  }, [searchQuery, allProducts, config, activeCategoryFilter, activeSubCategoryFilter]);

  const handleAddProduct = (product: PhoneModel) => {
    setSelectedProducts(prev => [...prev, product]);
    setConfig(prev => ({
      ...prev,
      [product.id]: {
        totalQty: 1,
        withPrice: 1
      }
    }));
  };

  const handleRemoveProduct = (id: string) => {
    setSelectedProducts(prev => prev.filter(p => p.id !== id));
    setConfig(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  if (!isOpen) return null;

  const handleUpdateConfig = (id: string, field: keyof LabelConfig, value: string) => {
    const num = Math.max(0, parseInt(value) || 0);
    setConfig(prev => {
      const current = prev[id];
      let newTotal = current.totalQty;
      let newWithPrice = current.withPrice;

      if (field === 'totalQty') {
        newTotal = num;
        // If total is less than withPrice, adjust withPrice down
        if (newTotal < newWithPrice) newWithPrice = newTotal;
      } else if (field === 'withPrice') {
        newWithPrice = num;
        // If withPrice is greater than total, adjust total up
        if (newWithPrice > newTotal) newTotal = newWithPrice;
      }

      return {
        ...prev,
        [id]: { totalQty: newTotal, withPrice: newWithPrice }
      };
    });
  };

  const handlePreview = () => {
    const labels: (PhoneModel & { hidePrice?: boolean })[] = [];

    selectedProducts.forEach(p => {
      const pConfig = config[p.id];
      if (!pConfig) return;

      const withoutPrice = Math.max(0, pConfig.totalQty - pConfig.withPrice);

      for (let i = 0; i < pConfig.withPrice; i++) {
        labels.push({ ...p, hidePrice: false });
      }

      for (let i = 0; i < withoutPrice; i++) {
        labels.push({ ...p, hidePrice: true });
      }
    });

    if (labels.length === 0) {
      toast.warning('No labels', 'Set a quantity for at least one product.');
      return;
    }

    setLabelsToPrint(labels);
    setPreviewHtml(buildLabelsHTML(labels, storeName));
    setPreviewMode(true);
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      // Try to print directly to the thermal printer
      const result = await printBarcodeDirect(labelsToPrint, storeName, currency);
      
      if (result.method === 'browser') {
        openPrintWindow(previewHtml, 'Product Labels');
      }
      
      toast.success('Labels sent!', `${labelsToPrint.length} barcode labels sent to printer.`);
      onClose();
    } catch (err) {
      toast.error('Print failed', 'Could not send labels to the printer.');
    } finally {
      setIsPrinting(false);
    }
  };
  
  const totalLabels = Object.values(config).reduce((sum, c) => sum + c.totalQty, 0);

  if (previewMode) {
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalContent} style={{ maxWidth: '800px' }}>
          <div className={styles.modalHeader}>
            <h2 className={styles.title}>Preview Labels ({totalLabels})</h2>
            <div className={styles.controls}>
              <Button variant="ghost" onClick={() => setPreviewMode(false)} disabled={isPrinting}>
                Back
              </Button>
              <Button onClick={handlePrint} leftIcon={<Printer size={18} />} isLoading={isPrinting}>
                Print Now
              </Button>
            </div>
          </div>
          <div className={styles.modalBody} style={{ padding: 0, backgroundColor: '#f0f0f0' }}>
            <iframe 
              srcDoc={previewHtml} 
              style={{ width: '100%', height: '100%', border: 'none', minHeight: '500px' }} 
              title="Label Preview" 
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h2 className={styles.title}>Configure Barcode Labels</h2>
          <div className={styles.controls}>
            <Button variant="ghost" onClick={onClose} leftIcon={<X size={18} />}>
              Cancel
            </Button>
            <Button onClick={handlePreview} leftIcon={<Printer size={18} />} disabled={totalLabels === 0} isLoading={isPrinting}>
              Preview {totalLabels} Labels
            </Button>
          </div>
        </div>
        
        <div className={styles.modalBody}>
          {/* Category filter pills */}
          <div className={styles.categoryFilterBar}>
            {LABEL_CATEGORIES.map(cat => (
              <button
                key={cat.value}
                type="button"
                className={[
                  styles.categoryFilterPill,
                  activeCategoryFilter === cat.value && styles.categoryFilterPillActive,
                ].filter(Boolean).join(' ')}
                onClick={() => { setActiveCategoryFilter(cat.value); setActiveSubCategoryFilter('all'); setSearchQuery(''); }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Accessory sub-category pills */}
          {activeCategoryFilter === 'accessory' && (
            <div className={styles.categoryFilterBar} style={{ marginTop: '-8px', marginBottom: '14px', gap: '6px' }}>
              {ACCESSORY_SUB_CATEGORIES.map(sub => (
                <button
                  key={sub.value}
                  type="button"
                  style={{ fontSize: '12px', padding: '4px 10px' }}
                  className={[
                    styles.categoryFilterPill,
                    activeSubCategoryFilter === sub.value && styles.categoryFilterPillActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => { setActiveSubCategoryFilter(sub.value); setSearchQuery(''); }}
                >
                  <span>{sub.icon}</span> {sub.label}
                </button>
              ))}
            </div>
          )}

          <div className={styles.searchSection}>
            <Input 
              leftIcon={<Search size={16} />}
              placeholder={`Search ${activeCategoryFilter === 'all' ? 'all products' : LABEL_CATEGORIES.find(c => c.value === activeCategoryFilter)?.label ?? 'products'}…`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className={styles.searchResults}>
                {searchResults.map(p => (
                  <div key={p.id} className={styles.searchResultItem} onClick={() => handleAddProduct(p)}>
                    <div>
                      <strong>{p.name} {p.model}</strong>
                      <div className={styles.productMeta}>SKU: {p.sku} | Stock: {p.stock}</div>
                    </div>
                    <Button variant="ghost" size="sm" leftIcon={<Plus size={16} />}>Add</Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedProducts.length === 0 ? (
            <p style={{ color: 'var(--color-on-surface-variant)', marginTop: '20px' }}>
              No products selected. Search above to add products to your print queue.
            </p>
          ) : (
            <div className={styles.configList} style={{ marginTop: '20px' }}>
              {selectedProducts.map(product => {
                const pConfig = config[product.id] || { totalQty: 0, withPrice: 0 };
                const withoutPrice = Math.max(0, pConfig.totalQty - pConfig.withPrice);
                
                return (
                  <div key={product.id} className={styles.configRow}>
                    <div className={styles.productInfo}>
                      <span className={styles.productName}>{product.name} {product.model}</span>
                      <span className={styles.productMeta}>SKU: {product.sku}</span>
                      <span className={styles.stockBadge}>In Stock: {product.stock}</span>
                    </div>
                    
                    <Input 
                      label="Total Quantity" 
                      type="number" 
                      min="0"
                      value={pConfig.totalQty.toString()} 
                      onChange={(e) => handleUpdateConfig(product.id, 'totalQty', e.target.value)}
                    />
                    
                    <Input 
                      label="Qty w/ Price" 
                      type="number" 
                      min="0"
                      value={pConfig.withPrice.toString()} 
                      onChange={(e) => handleUpdateConfig(product.id, 'withPrice', e.target.value)}
                    />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-on-surface-variant)' }}>Qty w/o Price</span>
                      <div style={{ height: '40px', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                        {withoutPrice}
                      </div>
                    </div>
                    
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleRemoveProduct(product.id)}
                      style={{ marginBottom: '4px', color: 'var(--color-danger)' }}
                      title="Remove from print list"
                    >
                      <X size={18} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Hidden print area for browser fallback */}
          <div id="print-area" style={{ display: 'none' }}></div>
        </div>
      </div>
    </div>
  );
};
