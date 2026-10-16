import React, { useState, useEffect, useMemo } from 'react';
import { X, Printer, Search, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { openPrintWindow, buildLabelsHTML, printBarcodeDirect } from '../../utils/printWindow';
import type { PhoneModel } from '../../types';
import { useSettingsStore } from '../../store/settingsStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import styles from './PrintPartsLabels.module.css';

interface PrintPartsLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LabelConfig {
  totalQty: number;
}

export const PrintPartsLabelsModal: React.FC<PrintPartsLabelsModalProps> = ({ isOpen, onClose }) => {
  const { storeName, currency } = useSettingsStore();
  const { parts, fetchParts } = useInventoryStore();
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [labelsToPrint, setLabelsToPrint] = useState<(PhoneModel & { hidePrice?: boolean })[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [config, setConfig] = useState<Record<string, LabelConfig>>({});
  const [selectedProducts, setSelectedProducts] = useState<PhoneModel[]>([]);

  // Server only sent repair parts from the beginning
  const partsOnly = parts;

  useEffect(() => {
    if (isOpen) {
      if (parts.length === 0) fetchParts();
      setConfig({});
      setSelectedProducts([]);
      setSearchQuery('');
      setPreviewMode(false);
    }
  }, [isOpen, parts.length, fetchParts]);

  const searchResults = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return partsOnly.filter(p => {
      if (config[p.id]) return false;
      if (!query) return true;
      return (
        p.name.toLowerCase().includes(query) ||
        p.model.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query)
      );
    }).slice(0, 20);
  }, [searchQuery, partsOnly, config]);

  const handleAddProduct = (product: PhoneModel) => {
    setSelectedProducts(prev => [...prev, product]);
    setConfig(prev => ({
      ...prev,
      [product.id]: { totalQty: 1 }
    }));
    setSearchQuery('');
  };

  const handleAddAllInStock = () => {
    const inStockParts = partsOnly.filter(p => p.stock > 0);
    setSelectedProducts(inStockParts);
    const newConfig: Record<string, LabelConfig> = {};
    inStockParts.forEach(p => {
      newConfig[p.id] = { totalQty: Math.max(1, p.stock) };
    });
    setConfig(newConfig);
    toast.info('Added all in-stock parts', `${inStockParts.length} parts added to print queue.`);
  };

  const handleAddLowStock = () => {
    const lowStockParts = partsOnly.filter(p => p.stockStatus === 'low_stock' || (p.stock > 0 && p.stock <= (p.lowStockThreshold || 1)));
    setSelectedProducts(lowStockParts);
    const newConfig: Record<string, LabelConfig> = {};
    lowStockParts.forEach(p => {
      newConfig[p.id] = { totalQty: 2 };
    });
    setConfig(newConfig);
    toast.info('Added low-stock parts', `${lowStockParts.length} low-stock parts added to print queue.`);
  };

  const handleClearAll = () => {
    setSelectedProducts([]);
    setConfig({});
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

  const handleUpdateConfig = (id: string, value: string) => {
    const num = Math.max(0, parseInt(value) || 0);
    setConfig(prev => ({
      ...prev,
      [id]: { totalQty: num }
    }));
  };

  const handlePreview = () => {
    const labels: (PhoneModel & { hidePrice?: boolean })[] = [];

    selectedProducts.forEach(p => {
      const pConfig = config[p.id];
      if (!pConfig) return;

      for (let i = 0; i < pConfig.totalQty; i++) {
        labels.push({ ...p, hidePrice: true }); // ALWAYS hide price for parts
      }
    });

    if (labels.length === 0) {
      toast.warning('No labels', 'Set a quantity for at least one part.');
      return;
    }

    setLabelsToPrint(labels);
    setPreviewHtml(buildLabelsHTML(labels, storeName));
    setPreviewMode(true);
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const result = await printBarcodeDirect(labelsToPrint, storeName, currency);
      
      if (result.method === 'browser') {
        openPrintWindow(previewHtml, 'Part Labels');
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
            <h2 className={styles.title}>Preview Part Labels ({totalLabels})</h2>
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
              title="Part Label Preview" 
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
          <h2 className={styles.title}>Print Part Labels</h2>
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
          <div className={styles.searchSection}>
            <Input 
              leftIcon={<Search size={16} />}
              placeholder="Search parts by name, model, or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {/* Quick Batch Select Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleAddAllInStock}
                style={{
                  fontSize: '11.5px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #c7d2fe',
                  background: '#eef2ff',
                  color: '#4338ca',
                  cursor: 'pointer',
                }}
              >
                ⚡ Add All In-Stock ({partsOnly.filter(p => p.stock > 0).length})
              </button>
              <button
                type="button"
                onClick={handleAddLowStock}
                style={{
                  fontSize: '11.5px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #fed7aa',
                  background: '#fff7ed',
                  color: '#c2410c',
                  cursor: 'pointer',
                }}
              >
                ⚠️ Add Low-Stock ({partsOnly.filter(p => p.stockStatus === 'low_stock').length})
              </button>
              {selectedProducts.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#64748b',
                    cursor: 'pointer',
                    marginLeft: 'auto',
                  }}
                >
                  Clear Selected
                </button>
              )}
            </div>

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
              No parts selected. Search above to add parts to your print queue.
            </p>
          ) : (
            <div className={styles.configList} style={{ marginTop: '20px' }}>
              {selectedProducts.map(product => {
                const pConfig = config[product.id] || { totalQty: 0 };
                
                return (
                  <div key={product.id} className={styles.configRow}>
                    <div className={styles.productInfo}>
                      <span className={styles.productName}>{product.name} {product.model}</span>
                      <span className={styles.productMeta}>SKU: {product.sku}</span>
                      <span className={styles.stockBadge}>In Stock: {product.stock}</span>
                    </div>
                    
                    <Input 
                      label="Quantity" 
                      type="number" 
                      min="0"
                      value={pConfig.totalQty.toString()} 
                      onChange={(e) => handleUpdateConfig(product.id, e.target.value)}
                    />

                    
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

          <div id="print-area" style={{ display: 'none' }}></div>
        </div>
      </div>
    </div>
  );
};
