import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Printer, Search, X, CheckSquare, Package, Eye } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { useSettingsStore } from '../../store/settingsStore';
import { buildLabelsHTML, openPrintWindow, printBarcodeDirect } from '../../utils/printWindow';
import type { PhoneModel } from '../../types';
import { normalizeArabic } from '../../utils/normalizeText';

export interface LabelQtyConfig {
  totalQty: number;
  withPrice: number;
}

export interface LabelsPrintApi {
  selected: PhoneModel[];
  setQueue: (items: PhoneModel[], qtyFor: (item: PhoneModel) => number) => void;
  clearQueue: () => void;
  clearSearch: () => void;
}

export interface LabelsPrintCopy {
  modalTitle: string;
  /** Rendered as `${previewTitle} (${totalLabels})` */
  previewTitle: string;
  previewIframeTitle: string;
  searchPlaceholder: string;
  emptySelection: string;
  /** Warning shown when every quantity is 0 */
  noLabelsWarning: string;
  totalQtyLabel: string;
  withPriceLabel?: string;
  withoutPriceLabel?: string;
  printWindowTitle: string;
}

export interface LabelsPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Searchable source list, already scoped to the items this modal may print */
  items: PhoneModel[];
  /** Pre-selected on open; defaults to none */
  initialItems?: PhoneModel[];
  /** Products split the run between priced and unpriced labels; parts always hide the price */
  withPriceColumn: boolean;
  clearSearchAfterAdd: boolean;
  searchFields: (item: PhoneModel) => (string | undefined)[];
  copy: LabelsPrintCopy;
  classes: Readonly<Record<string, string>>;
  onOpen?: () => void;
  renderAboveSearch?: (api: LabelsPrintApi) => React.ReactNode;
  renderBelowSearch?: (api: LabelsPrintApi) => React.ReactNode;
}

export const LabelsPrintModal: React.FC<LabelsPrintModalProps> = ({
  isOpen,
  onClose,
  items,
  initialItems,
  withPriceColumn,
  clearSearchAfterAdd,
  searchFields,
  copy,
  classes,
  onOpen,
  renderAboveSearch,
  renderBelowSearch,
}) => {
  const { storeName, currency } = useSettingsStore();
  const toast = useToast();

  const [isPrinting, setIsPrinting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [labelsToPrint, setLabelsToPrint] = useState<(PhoneModel & { hidePrice?: boolean })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [config, setConfig] = useState<Record<string, LabelQtyConfig>>({});
  const [selected, setSelected] = useState<PhoneModel[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const initial = initialItems ?? [];
    const initialConfig: Record<string, LabelQtyConfig> = {};
    initial.forEach(p => {
      initialConfig[p.id] = { totalQty: 1, withPrice: withPriceColumn ? 1 : 0 };
    });
    setConfig(initialConfig);
    setSelected([...initial]);
    setSearchQuery('');
    setPreviewMode(false);
    onOpen?.();
    // Open transition only: a parent re-render must not wipe a queue the user is building.
  }, [isOpen]);

  const searchResults = useMemo(() => {
    const query = normalizeArabic(searchQuery);
    return items.filter(p => {
      if (config[p.id]) return false;
      if (!query) return true;
      return searchFields(p).some(field => normalizeArabic(field).includes(query));
    });
  }, [searchQuery, items, config, searchFields]);

  const handleSelectAll = (useStockQty = false) => {
    const query = normalizeArabic(searchQuery);
    const targetItems = query
      ? items.filter(p => searchFields(p).some(field => normalizeArabic(field).includes(query)))
      : items;

    if (targetItems.length === 0) return;

    const nextConfig: Record<string, LabelQtyConfig> = { ...config };
    const nextSelectedMap = new Map<string, PhoneModel>(selected.map(p => [p.id, p]));

    targetItems.forEach(p => {
      nextSelectedMap.set(p.id, p);
      const qty = useStockQty ? Math.max(1, p.stock || 1) : 1;
      nextConfig[p.id] = { totalQty: qty, withPrice: withPriceColumn ? qty : 0 };
    });

    setSelected(Array.from(nextSelectedMap.values()));
    setConfig(nextConfig);
    toast.success('Selected All', `${targetItems.length} item(s) added to print list.`);
  };

  const handleClearAll = () => {
    setSelected([]);
    setConfig({});
  };

  const handleSelectInStockOnly = () => {
    const query = normalizeArabic(searchQuery);
    const targetItems = (query
      ? items.filter(p => searchFields(p).some(field => normalizeArabic(field).includes(query)))
      : items).filter(p => (p.stock || 0) > 0);

    if (targetItems.length === 0) {
      toast.info('No Items', 'No in-stock items found.');
      return;
    }

    const nextConfig: Record<string, LabelQtyConfig> = { ...config };
    const nextSelectedMap = new Map<string, PhoneModel>(selected.map(p => [p.id, p]));

    targetItems.forEach(p => {
      nextSelectedMap.set(p.id, p);
      const qty = Math.max(1, p.stock || 1);
      nextConfig[p.id] = { totalQty: qty, withPrice: withPriceColumn ? qty : 0 };
    });

    setSelected(Array.from(nextSelectedMap.values()));
    setConfig(nextConfig);
    toast.success('Selected In-Stock', `${targetItems.length} in-stock item(s) added to print list.`);
  };

  const handleAddProduct = (product: PhoneModel) => {
    setSelected(prev => [...prev, product]);
    setConfig(prev => ({
      ...prev,
      [product.id]: { totalQty: 1, withPrice: withPriceColumn ? 1 : 0 }
    }));
    if (clearSearchAfterAdd) setSearchQuery('');
  };

  const handleRemoveProduct = (id: string) => {
    setSelected(prev => prev.filter(p => p.id !== id));
    setConfig(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleUpdateConfig = (id: string, field: keyof LabelQtyConfig, value: string) => {
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

    selected.forEach(p => {
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
      toast.warning('No labels', copy.noLabelsWarning);
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

      // A refusal is not paper: keep the modal open so the printer can be fixed
      // and the labels retried, instead of sending the counter away thinking the
      // shelf is labelled.
      if (result.method === 'direct' && result.error) {
        toast.error('Labels not printed', result.error);
        return;
      }

      if (result.method === 'browser') {
        openPrintWindow(previewHtml, copy.printWindowTitle);
      }

      toast.success('Labels sent!', `${labelsToPrint.length} barcode labels sent to printer.`);
      onClose();
    } catch (err) {
      toast.error('Print failed', 'Could not send labels to the printer.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleDirectPrintAll = async () => {
    const labels: (PhoneModel & { hidePrice?: boolean })[] = [];

    selected.forEach(p => {
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
      toast.warning('No labels', copy.noLabelsWarning);
      return;
    }

    setIsPrinting(true);
    try {
      const result = await printBarcodeDirect(labels, storeName, currency);

      if (result.method === 'direct' && result.error) {
        toast.error('Labels not printed', result.error);
        return;
      }

      if (result.method === 'browser') {
        const html = buildLabelsHTML(labels, storeName);
        openPrintWindow(html, copy.printWindowTitle);
      }

      toast.success('Labels sent!', `${labels.length} barcode labels sent to printer.`);
      onClose();
    } catch (err) {
      toast.error('Print failed', 'Could not send labels to the printer.');
    } finally {
      setIsPrinting(false);
    }
  };

  if (!isOpen) return null;

  const totalLabels = Object.values(config).reduce((sum, c) => sum + c.totalQty, 0);

  const api: LabelsPrintApi = {
    selected,
    setQueue: (list, qtyFor) => {
      const nextConfig: Record<string, LabelQtyConfig> = {};
      list.forEach(p => {
        nextConfig[p.id] = { totalQty: qtyFor(p), withPrice: 0 };
      });
      setSelected(list);
      setConfig(nextConfig);
    },
    clearQueue: () => {
      setSelected([]);
      setConfig({});
    },
    clearSearch: () => setSearchQuery(''),
  };

  if (previewMode) {
    return (
      <div className={classes.modalOverlay}>
        <div className={classes.modalContent} style={{ maxWidth: '800px' }}>
          <div className={classes.modalHeader}>
            <h2 className={classes.title}>{copy.previewTitle} ({totalLabels})</h2>
            <div className={classes.controls}>
              <Button variant="ghost" onClick={() => setPreviewMode(false)} disabled={isPrinting}>
                Back
              </Button>
              <Button onClick={handlePrint} leftIcon={<Printer size={18} />} isLoading={isPrinting}>
                Print Now
              </Button>
            </div>
          </div>
          <div className={classes.modalBody} style={{ padding: 0, backgroundColor: '#f0f0f0' }}>
            <iframe
              srcDoc={previewHtml}
              style={{ width: '100%', height: '100%', border: 'none', minHeight: '500px' }}
              title={copy.previewIframeTitle}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.modalOverlay}>
      <div className={classes.modalContent}>
        <div className={classes.modalHeader}>
          <div>
            <h2 className={classes.title}>{copy.modalTitle}</h2>
            <div style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
              {items.length} item{items.length === 1 ? '' : 's'} available • {selected.length} selected ({totalLabels} label{totalLabels === 1 ? '' : 's'})
            </div>
          </div>
          <div className={classes.controls}>
            <Button variant="ghost" onClick={onClose} leftIcon={<X size={18} />}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handlePreview}
              leftIcon={<Eye size={18} />}
              disabled={totalLabels === 0}
              isLoading={isPrinting}
            >
              Preview ({totalLabels})
            </Button>
            <Button
              onClick={handleDirectPrintAll}
              leftIcon={<Printer size={18} />}
              disabled={totalLabels === 0}
              isLoading={isPrinting}
            >
              Print All ({totalLabels})
            </Button>
          </div>
        </div>

        <div className={classes.modalBody}>
          {renderAboveSearch?.(api)}

          {/* Batch Quick-Actions Toolbar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '12px',
            padding: '10px 14px',
            backgroundColor: 'var(--color-surface-container, #f8fafc)',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid var(--color-outline-variant, #e2e8f0)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>
                Batch Actions:
              </span>
              <button
                type="button"
                onClick={() => handleSelectAll(false)}
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid #c7d2fe',
                  background: '#eef2ff',
                  color: '#4338ca',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <CheckSquare size={14} />
                Select All ({items.length})
              </button>
              <button
                type="button"
                onClick={() => handleSelectAll(true)}
                title="Select all items using their current in-stock quantity"
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid #bfdbfe',
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Package size={14} />
                Select All (Stock Qty)
              </button>
              <button
                type="button"
                onClick={handleSelectInStockOnly}
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid #bbf7d0',
                  background: '#f0fdf4',
                  color: '#15803d',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                In-Stock Only ({items.filter(p => (p.stock || 0) > 0).length})
              </button>
            </div>

            {selected.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid #fecaca',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <X size={14} />
                Clear Selection ({selected.length})
              </button>
            )}
          </div>

          <div className={classes.searchSection}>
            <Input
              leftIcon={<Search size={16} />}
              placeholder={copy.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {renderBelowSearch?.(api)}

            {searchResults.length > 0 && (
              <div style={{ marginTop: '10px', marginBottom: '16px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 12px',
                  backgroundColor: 'var(--color-surface-container-high, #f1f5f9)',
                  borderTopLeftRadius: 'var(--radius-md, 8px)',
                  borderTopRightRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--color-outline-variant, #e2e8f0)',
                  borderBottom: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--color-on-surface-variant)'
                }}>
                  <span>Available to add ({searchResults.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextConfig: Record<string, LabelQtyConfig> = { ...config };
                      const nextSelectedMap = new Map<string, PhoneModel>(selected.map(p => [p.id, p]));
                      searchResults.forEach(p => {
                        nextSelectedMap.set(p.id, p);
                        nextConfig[p.id] = { totalQty: 1, withPrice: withPriceColumn ? 1 : 0 };
                      });
                      setSelected(Array.from(nextSelectedMap.values()));
                      setConfig(nextConfig);
                      toast.success('Added All', `${searchResults.length} item(s) added.`);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary, #3b82f6)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    + Add all {searchResults.length} shown
                  </button>
                </div>
                <div className={classes.searchResults} style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                  {searchResults.map(p => (
                    <div key={p.id} className={classes.searchResultItem} onClick={() => handleAddProduct(p)}>
                      <div>
                        <strong>{p.name} {p.model}</strong>
                        <div className={classes.productMeta}>SKU: {p.sku} | Stock: {p.stock}</div>
                      </div>
                      <Button variant="ghost" size="sm" leftIcon={<Plus size={16} />}>Add</Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selected.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '32px 16px',
              backgroundColor: 'var(--color-surface-container, #f8fafc)',
              borderRadius: 'var(--radius-lg, 12px)',
              marginTop: '16px',
              border: '1px dashed var(--color-outline-variant, #cbd5e1)'
            }}>
              <p style={{ color: 'var(--color-on-surface-variant)', margin: 0, fontSize: '14px' }}>
                {copy.emptySelection}
              </p>
              <button
                type="button"
                onClick={() => handleSelectAll(false)}
                style={{
                  marginTop: '12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid var(--color-primary, #3b82f6)',
                  background: 'var(--color-primary, #3b82f6)',
                  color: '#ffffff',
                }}
              >
                Select All {items.length} Items Now
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '20px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px'
              }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  Selected for Printing ({selected.length} items • {totalLabels} total labels)
                </span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-danger, #ef4444)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Clear all ({selected.length})
                </button>
              </div>

              <div className={classes.configList}>
                {selected.map(product => {
                  const pConfig = config[product.id] || { totalQty: 0, withPrice: 0 };
                  const withoutPrice = Math.max(0, pConfig.totalQty - pConfig.withPrice);

                  return (
                    <div key={product.id} className={classes.configRow}>
                      <div className={classes.productInfo}>
                        <span className={classes.productName}>{product.name} {product.model}</span>
                        <span className={classes.productMeta}>SKU: {product.sku}</span>
                        <span className={classes.stockBadge}>In Stock: {product.stock}</span>
                      </div>

                      <Input
                        label={copy.totalQtyLabel}
                        type="number"
                        min="0"
                        value={pConfig.totalQty.toString()}
                        onChange={(e) => handleUpdateConfig(product.id, 'totalQty', e.target.value)}
                      />

                      {withPriceColumn && (
                        <>
                          <Input
                            label={copy.withPriceLabel}
                            type="number"
                            min="0"
                            value={pConfig.withPrice.toString()}
                            onChange={(e) => handleUpdateConfig(product.id, 'withPrice', e.target.value)}
                          />

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-on-surface-variant)' }}>{copy.withoutPriceLabel}</span>
                            <div style={{ height: '40px', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                              {withoutPrice}
                            </div>
                          </div>
                        </>
                      )}

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
            </div>
          )}

          {/* Hidden print area for browser fallback */}
          <div id="print-area" style={{ display: 'none' }}></div>
        </div>
      </div>
    </div>
  );
};
