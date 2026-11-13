import React, { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, ShoppingCart, Printer, Send, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { useInventoryStore } from '../../store/inventoryStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { exportToCSV } from '../../utils/exportUtils';
import { formatWhatsAppUrl } from '../../utils/phoneUtils';
import type { PhoneModel, POItem } from '../../types';
import styles from './RestockAssistant.module.css';
import { errorMessage } from '../../utils/errorUtils';
import { normalizeArabic } from '../../utils/normalizeText';

interface RestockAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ReorderRow {
  product: PhoneModel;
  selected: boolean;
  currentStock: number;
  threshold: number;
  orderQty: number;
  unitCost: number;
}

export const RestockAssistantModal: React.FC<RestockAssistantModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { parts, restockProduct, fetchParts } = useInventoryStore();
  const { suppliers, addPO, fetchData: fetchPurchasingData } = usePurchasingStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const settings = useSettingsStore();
  const toast = useToast();
  usePrivacyStore(s => s.isPrivacyActive);

  const [filterType, setFilterType] = useState<'all_needed' | 'out_only' | 'low_only' | 'all'>('all_needed');
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupplierName, setSelectedSupplierName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);

  // Server only sends repair parts from the beginning (no client category filter needed)
  const partsOnly = parts;

  // Unique Brands
  const uniqueBrands = useMemo(() => {
    const brands = new Set(partsOnly.map(p => p.brand).filter(Boolean));
    return Array.from(brands).sort();
  }, [partsOnly]);

  // Fetch purchasing suppliers on mount
  useEffect(() => {
    if (isOpen) {
      fetchPurchasingData().catch(console.error);
    }
  }, [isOpen, fetchPurchasingData]);

  // Local state for reorder items
  const [rows, setRows] = useState<Record<string, ReorderRow>>({});

  // Initialize or update rows when parts change or modal opens
  useEffect(() => {
    if (!isOpen) return;

    setRows(prev => {
      const next: Record<string, ReorderRow> = {};
      partsOnly.forEach(p => {
        const threshold = p.lowStockThreshold || 1;
        const currentStock = p.stock;
        const isLow = currentStock <= threshold;
        // Suggested target is max(10, threshold * 2.5)
        const targetPar = Math.max(10, threshold * 2);
        const suggestedQty = Math.max(1, targetPar - currentStock);

        if (prev[p.id]) {
          next[p.id] = {
            ...prev[p.id],
            product: p,
            currentStock,
            threshold,
          };
        } else {
          next[p.id] = {
            product: p,
            selected: isLow, // Auto-select low & out of stock parts
            currentStock,
            threshold,
            orderQty: suggestedQty,
            unitCost: p.costPrice || (p.price * 0.6) || 10,
          };
        }
      });
      return next;
    });
  }, [partsOnly, isOpen]);

  // Metrics
  const metrics = useMemo(() => {
    const outCount = partsOnly.filter(p => p.stock === 0).length;
    const lowCount = partsOnly.filter(p => p.stock > 0 && p.stock <= (p.lowStockThreshold || 1)).length;
    const totalParts = partsOnly.length;

    let selectedCount = 0;
    let totalUnitsToOrder = 0;
    let totalEstimatedCost = 0;

    Object.values(rows).forEach(r => {
      if (r.selected && r.orderQty > 0) {
        selectedCount++;
        totalUnitsToOrder += r.orderQty;
        totalEstimatedCost += r.orderQty * r.unitCost;
      }
    });

    return {
      outCount,
      lowCount,
      totalParts,
      selectedCount,
      totalUnitsToOrder,
      totalEstimatedCost,
    };
  }, [partsOnly, rows]);

  // Filtered rows for display
  const displayedRows = useMemo(() => {
    return Object.values(rows).filter(r => {
      const p = r.product;

      // Criticality filter
      if (filterType === 'out_only' && r.currentStock > 0) return false;
      if (filterType === 'low_only' && (r.currentStock === 0 || r.currentStock > r.threshold)) return false;
      if (filterType === 'all_needed' && r.currentStock > r.threshold) return false;

      // Brand filter
      if (selectedBrand !== 'all' && p.brand !== selectedBrand) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = normalizeArabic(searchQuery);
        const matchName = normalizeArabic([p.name, p.model, p.sku].filter(Boolean).join(' ')).includes(q);
        if (!matchName) return false;
      }

      return true;
    }).sort((a, b) => {
      // Prioritize out of stock first, then low stock
      if (a.currentStock === 0 && b.currentStock > 0) return -1;
      if (b.currentStock === 0 && a.currentStock > 0) return 1;
      return a.currentStock - b.currentStock;
    });
  }, [rows, filterType, selectedBrand, searchQuery]);

  const handleToggleSelectAll = (checked: boolean) => {
    setRows(prev => {
      const next = { ...prev };
      displayedRows.forEach(r => {
        next[r.product.id] = { ...next[r.product.id], selected: checked };
      });
      return next;
    });
  };

  const handleUpdateQty = (productId: string, qty: number) => {
    const validQty = Math.max(0, qty);
    setRows(prev => ({
      ...prev,
      [productId]: { ...prev[productId], orderQty: validQty },
    }));
  };

  const handleUpdateCost = (productId: string, cost: number) => {
    const validCost = Math.max(0, cost);
    setRows(prev => ({
      ...prev,
      [productId]: { ...prev[productId], unitCost: validCost },
    }));
  };

  const handleToggleRow = (productId: string) => {
    setRows(prev => ({
      ...prev,
      [productId]: { ...prev[productId], selected: !prev[productId].selected },
    }));
  };

  // 1-Click Official Supplier PO Creation in Database
  const handleCreateOfficialPO = async () => {
    const selectedItems = Object.values(rows).filter(r => r.selected && r.orderQty > 0);
    if (selectedItems.length === 0) {
      toast.error(t('parts.restockModal.noItemsSelected'), t('parts.restockModal.selectItemsToOrder'));
      return;
    }

    setIsProcessing(true);
    try {
      const supplierDisplayName = selectedSupplierName.trim() || 'General Parts Supplier';
      const supplierObj = suppliers.find(s => (s.name ?? '').toLowerCase() === supplierDisplayName.toLowerCase());

      const poItems: POItem[] = selectedItems.map(r => ({
        productId: r.product.id,
        productName: `${r.product.name} ${r.product.model}`,
        productSku: r.product.sku || 'N/A',
        requestedQty: r.orderQty,
        receivedQty: 0,
        unitCost: r.unitCost,
      }));

      await addPO({
        supplierId: supplierObj?.id || `sup_${Date.now()}`,
        supplierName: supplierDisplayName,
        status: 'draft',
        orderDate: new Date().toISOString(),
        items: poItems,
        totalAmount: metrics.totalEstimatedCost,
        notes: `Automated Reorder Requisition created via Restock Assistant (${selectedItems.length} parts).`,
      });

      toast.success(
        t('parts.restockModal.poCreated'),
        t('parts.restockModal.poCreatedDesc', { count: selectedItems.length, units: metrics.totalUnitsToOrder })
      );
      onClose();
    } catch (err: unknown) {
      toast.error(t('parts.restockModal.noItemsSelected'), errorMessage(err) || t('parts.restockModal.createPoFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  // 1-Click WhatsApp Order List
  const handleSendWhatsApp = () => {
    const selectedItems = Object.values(rows).filter(r => r.selected && r.orderQty > 0);
    if (selectedItems.length === 0) {
      toast.error(t('parts.restockModal.noItemsSelected'), t('parts.restockModal.selectItemsWhatsapp'));
      return;
    }

    const itemsText = selectedItems
      .map((r, idx) => `${idx + 1}. *${r.orderQty}x* ${r.product.name} ${r.product.model} (${r.product.sku || 'SKU N/A'})`)
      .join('\n');

    const text = `📦 *PARTS RESTOCK ORDER / COMMANDE PIÈCES*
${settings.storeName ? `*From:* ${settings.storeName}\n` : ''}*Date:* ${new Date().toLocaleDateString()}
━━━━━━━━━━━━━━━━━━━━
${itemsText}
━━━━━━━━━━━━━━━━━━━━
📊 *Total Parts:* ${selectedItems.length} items (${metrics.totalUnitsToOrder} units)
💰 *Estimated Total:* ${formatCurrency(metrics.totalEstimatedCost)}
━━━━━━━━━━━━━━━━━━━━
Please check stock availability and confirm estimated dispatch time. Thank you!`;

    const supplierPhone = suppliers.find(s => s.name === selectedSupplierName)?.phone;
    const url = formatWhatsAppUrl(supplierPhone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;

    window.open(url, '_blank');
  };

  // 1-Click Print Requisition Sheet
  const handlePrint = () => {
    window.print();
  };

  // 1-Click Export CSV
  const handleExportCSV = () => {
    const selectedItems = Object.values(rows).filter(r => r.selected && r.orderQty > 0);
    if (selectedItems.length === 0) {
      toast.error(t('parts.restockModal.noItemsSelected'), t('parts.restockModal.selectItemsExport'));
      return;
    }

    const filename = `Parts_Reorder_Requisition_${new Date().toISOString().slice(0, 10)}`;
    const headers = ['SKU', 'Brand', 'Part Name & Model', 'Current Stock', 'Threshold', 'Reorder Qty', 'Unit Cost', 'Line Total'];
    const dataRows = selectedItems.map(r => [
      r.product.sku || '',
      r.product.brand || '',
      `${r.product.name} ${r.product.model}`,
      r.currentStock,
      r.threshold,
      r.orderQty,
      r.unitCost.toFixed(2),
      (r.orderQty * r.unitCost).toFixed(2),
    ]);

    exportToCSV(filename, headers, dataRows);
  };

  // 1-Click Bulk Quick Restock to Inventory
  const executeBulkRestock = async () => {
    const selectedItems = Object.values(rows).filter(r => r.selected && r.orderQty > 0);
    if (selectedItems.length === 0) return;

    setIsProcessing(true);
    try {
      let queuedUnits = 0;
      let committedUnits = 0;
      for (const item of selectedItems) {
        const result = await restockProduct(item.product.id, item.orderQty, {
          supplier: selectedSupplierName || 'Direct Reorder',
          note: `Bulk restock via Smart Restock Assistant`,
          cost: item.unitCost,
        });
        // 'queued' is not a server write: the units only moved in this device's offline queue.
        if (result.outcome === 'queued') queuedUnits += result.applied;
        if (result.outcome === 'committed') committedUnits += result.applied;
      }

      await fetchParts();
      if (queuedUnits > 0) {
        toast.warning(
          t('inventory.bulkRestockQueuedTitle'),
          t('inventory.bulkRestockQueuedBody', {
            queued: queuedUnits,
            committed: committedUnits,
            total: metrics.totalUnitsToOrder,
          })
        );
      } else {
        toast.success(
          t('inventory.bulkRestockTitle'),
          t('inventory.bulkRestockBody', { units: committedUnits, items: selectedItems.length })
        );
      }
      onClose();
    } catch (err: unknown) {
      toast.error(t('inventory.restockFailedTitle'), errorMessage(err) || t('inventory.bulkRestockFailedBody'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkQuickRestock = async () => {
    const selectedItems = Object.values(rows).filter(r => r.selected && r.orderQty > 0);
    if (selectedItems.length === 0) return;

    if (!isAdmin) {
      setShowAdminUnlock(true);
      return;
    }

    const confirmMsg = `Quick restock ${selectedItems.length} parts (${metrics.totalUnitsToOrder} units total) directly into inventory stock?`;
    if (!window.confirm(confirmMsg)) return;

    executeBulkRestock();
  };

  const isAllDisplayedSelected = displayedRows.length > 0 && displayedRows.every(r => r.selected);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="🔔 Smart Restock Assistant & Reorder Hub"
      subtitle="Automated low-stock detection, replenishment planner & supplier purchase order generator"
      size="lg"
      footer={
        <div className={styles.footerBar} style={{ width: '100%' }}>
          <div className={styles.selectionSummary}>
            <span>Selected: <strong>{metrics.selectedCount}</strong> parts ({metrics.totalUnitsToOrder} units)</span>
            <span>Estimated Cost: <strong data-privacy-cost className={[styles.summaryTotalVal, 'privacy-cost'].join(' ')}>{formatPrivateCurrency(metrics.totalEstimatedCost)}</strong></span>
          </div>

          <div className={styles.actionButtonsGroup}>
            <Button
              variant="secondary"
              onClick={handleExportCSV}
              disabled={metrics.selectedCount === 0 || isProcessing}
              leftIcon={<Download size={15} />}
            >
              CSV
            </Button>
            <Button
              variant="secondary"
              onClick={handleSendWhatsApp}
              disabled={metrics.selectedCount === 0 || isProcessing}
              leftIcon={<Send size={15} />}
              style={{ background: '#25D366', color: '#ffffff', borderColor: '#22c55e' }}
            >
              WhatsApp
            </Button>
            <Button
              variant="secondary"
              onClick={handlePrint}
              disabled={metrics.selectedCount === 0 || isProcessing}
              leftIcon={<Printer size={15} />}
            >
              Print Sheet
            </Button>
            <Button
              variant="secondary"
              onClick={handleBulkQuickRestock}
              disabled={metrics.selectedCount === 0 || isProcessing}
              isLoading={isProcessing}
              leftIcon={<CheckCircle2 size={15} />}
              style={{ background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}
            >
              Instant Restock
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateOfficialPO}
              disabled={metrics.selectedCount === 0 || isProcessing}
              isLoading={isProcessing}
              leftIcon={<ShoppingCart size={15} />}
            >
              Create Official PO
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        {/* KPI Strip */}
        <div className={styles.kpiStrip}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Critical (Out of Stock)</div>
            <p className={[styles.kpiValue, styles.kpiValueRed].join(' ')}>{metrics.outCount}</p>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Running Low (≤ Threshold)</div>
            <p className={[styles.kpiValue, styles.kpiValueAmber].join(' ')}>{metrics.lowCount}</p>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Total Parts Catalog</div>
            <p className={styles.kpiValue}>{metrics.totalParts}</p>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Selected for Reorder</div>
            <p className={[styles.kpiValue, styles.kpiValueBlue].join(' ')}>{metrics.selectedCount} parts</p>
          </div>
        </div>

        {/* Toolbar: Filters, Brands, Supplier */}
        <div className={styles.toolbar}>
          <div className={styles.filtersGroup}>
            <button
              type="button"
              className={[styles.filterPill, filterType === 'all_needed' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setFilterType('all_needed')}
            >
              ⚠️ All Needing Restock ({metrics.outCount + metrics.lowCount})
            </button>
            <button
              type="button"
              className={[styles.filterPill, filterType === 'out_only' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setFilterType('out_only')}
            >
              🔴 Out of Stock ({metrics.outCount})
            </button>
            <button
              type="button"
              className={[styles.filterPill, filterType === 'low_only' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setFilterType('low_only')}
            >
              🟡 Low Stock ({metrics.lowCount})
            </button>
            <button
              type="button"
              className={[styles.filterPill, filterType === 'all' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setFilterType('all')}
            >
              All Catalog
            </button>

            {uniqueBrands.length > 0 && (
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                className={styles.selectInput}
              >
                <option value="all">All Brands</option>
                {uniqueBrands.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.supplierSelectGroup}>
            <span>Supplier:</span>
            <input
              type="text"
              list="supplier-list"
              value={selectedSupplierName}
              onChange={e => setSelectedSupplierName(e.target.value)}
              placeholder="Select or enter supplier…"
              className={styles.selectInput}
              style={{ width: '180px' }}
            />
            <datalist id="supplier-list">
              {suppliers.map(s => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Quick Search */}
        <div>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search parts by name, model, screen, battery, port, SKU…"
          />
        </div>

        {/* Reorder Table */}
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isAllDisplayedSelected}
                    onChange={e => handleToggleSelectAll(e.target.checked)}
                  />
                </th>
                <th>Part Description & Model</th>
                <th style={{ width: '110px' }}>Brand / SKU</th>
                <th style={{ width: '110px', textAlign: 'center' }}>Stock / Min</th>
                <th style={{ width: '100px', textAlign: 'center' }}>Reorder Qty</th>
                <th style={{ width: '100px', textAlign: 'center' }}>Unit Cost</th>
                <th style={{ width: '110px', textAlign: 'right' }}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                    🎉 No parts match this filter. All parts in stock!
                  </td>
                </tr>
              ) : (
                displayedRows.map(r => {
                  const p = r.product;
                  const isOut = r.currentStock === 0;
                  const lineTotal = r.orderQty * r.unitCost;

                  return (
                    <tr key={p.id} className={r.selected ? styles.trSelected : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={() => handleToggleRow(p.id)}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {p.name} {p.model}
                        </div>
                        {p.location && (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>Bin: {p.location}</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: '11.5px', color: '#334155', fontWeight: 600 }}>{p.brand}</span>
                        <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{p.sku || '-'}</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isOut ? (
                          <span className={styles.stockBadgeOut}>0 Out</span>
                        ) : r.currentStock <= r.threshold ? (
                          <span className={styles.stockBadgeLow}>{r.currentStock} Low</span>
                        ) : (
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#16a34a' }}>{r.currentStock} in stock</span>
                        )}
                        <span style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginTop: '1px' }}>
                          Min: {r.threshold}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="number"
                          min="1"
                          value={r.orderQty}
                          onChange={e => handleUpdateQty(p.id, parseInt(e.target.value, 10) || 0)}
                          className={styles.numInput}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }} data-col="cost">
                        <input
                          data-privacy-cost
                          type="number"
                          min="0"
                          step="0.5"
                          value={r.unitCost}
                          onChange={e => handleUpdateCost(p.id, parseFloat(e.target.value) || 0)}
                          className={[styles.numInput, 'privacy-cost-input'].join(' ')}
                        />
                      </td>
                      <td data-col="cost" style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                        <span data-privacy-cost className="privacy-cost">{formatPrivateCurrency(lineTotal)}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Printable Purchase Order View */}
        <div className={styles.printablePO}>
          <div className={styles.poHeader}>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px' }}>{settings.storeName || 'PHONE SHOP MANAGER PRO'}</h2>
              <p style={{ margin: '2px 0', fontSize: '12px' }}>Parts Wholesale & Repair Division</p>
              {'phone' in settings && settings.phone && <p style={{ margin: '2px 0', fontSize: '12px' }}>Tel: {settings.phone}</p>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>REORDER REQUISITION / BON DE COMMANDE</h3>
              <p style={{ margin: '2px 0', fontSize: '12px' }}>Date: {new Date().toLocaleDateString()}</p>
              <p style={{ margin: '2px 0', fontSize: '12px' }}>Supplier: <strong>{selectedSupplierName || 'General Supplier'}</strong></p>
            </div>
          </div>

          <table className={styles.poTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th>Part Name & Model</th>
                <th>Brand</th>
                <th style={{ textAlign: 'center' }}>Qty Req.</th>
                <th style={{ textAlign: 'right' }}>Est. Cost</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(rows).filter(r => r.selected && r.orderQty > 0).map((r, idx) => (
                <tr key={r.product.id}>
                  <td>{idx + 1}</td>
                  <td>{r.product.sku || '-'}</td>
                  <td>{r.product.name} {r.product.model}</td>
                  <td>{r.product.brand}</td>
                  <td style={{ textAlign: 'center' }}><strong>{r.orderQty}</strong></td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.unitCost)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.orderQty * r.unitCost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 'bold', textAlign: 'right' }}>Grand Total:</td>
                <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{metrics.totalUnitsToOrder} units</td>
                <td></td>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(metrics.totalEstimatedCost)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px' }}>
            <div style={{ borderTop: '1px solid #000', width: '180px', textAlign: 'center', paddingTop: '4px', fontSize: '11px' }}>
              Store Manager Signature
            </div>
            <div style={{ borderTop: '1px solid #000', width: '180px', textAlign: 'center', paddingTop: '4px', fontSize: '11px' }}>
              Supplier Acceptance
            </div>
          </div>
        </div>
      </div>

      <AdminUnlockModal
        isOpen={showAdminUnlock}
        onClose={() => setShowAdminUnlock(false)}
        onSuccess={() => {
          setShowAdminUnlock(false);
          executeBulkRestock();
        }}
        actionName={`authorize instant bulk stock replenishment of ${metrics.totalUnitsToOrder} units`}
      />
    </Modal>
  );
};
