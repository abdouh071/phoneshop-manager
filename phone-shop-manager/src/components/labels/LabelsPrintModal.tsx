import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Printer, Search, X } from 'lucide-react';
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
    }).slice(0, 20);
  }, [searchQuery, items, config, searchFields]);

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
          <h2 className={classes.title}>{copy.modalTitle}</h2>
          <div className={classes.controls}>
            <Button variant="ghost" onClick={onClose} leftIcon={<X size={18} />}>
              Cancel
            </Button>
            <Button onClick={handlePreview} leftIcon={<Printer size={18} />} disabled={totalLabels === 0} isLoading={isPrinting}>
              Preview {totalLabels} Labels
            </Button>
          </div>
        </div>

        <div className={classes.modalBody}>
          {renderAboveSearch?.(api)}

          <div className={classes.searchSection}>
            <Input
              leftIcon={<Search size={16} />}
              placeholder={copy.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {renderBelowSearch?.(api)}

            {searchResults.length > 0 && (
              <div className={classes.searchResults}>
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
            )}
          </div>

          {selected.length === 0 ? (
            <p style={{ color: 'var(--color-on-surface-variant)', marginTop: '20px' }}>
              {copy.emptySelection}
            </p>
          ) : (
            <div className={classes.configList} style={{ marginTop: '20px' }}>
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
          )}

          {/* Hidden print area for browser fallback */}
          <div id="print-area" style={{ display: 'none' }}></div>
        </div>
      </div>
    </div>
  );
};
