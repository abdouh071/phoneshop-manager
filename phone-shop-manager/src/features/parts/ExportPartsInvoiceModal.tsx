import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Download, Search, Info, FileText } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { exportToCSV } from '../../utils/exportUtils';
import { escapeHtml } from '../../utils/escapeHtml';
import { normalizeArabic } from '../../utils/normalizeText';
import { printPartsInvoiceDirect } from '../../utils/printWindow';
import type { PhoneModel } from '../../types';
import styles from './ExportPartsInvoiceModal.module.css';

interface ExportPartsInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  parts: PhoneModel[];
  canViewCosts?: boolean;
}

export const ExportPartsInvoiceModal: React.FC<ExportPartsInvoiceModalProps> = ({
  isOpen,
  onClose,
  parts,
  canViewCosts = false,
}) => {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore();
  const user = useAuthStore(s => s.user);
  const customers = useCustomerStore(s => s.customers);
  const toast = useToast();

  const [recipient, setRecipient] = useState('Commercial Client / Wholesale');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('custom');
  const [priceMode, setPriceMode] = useState<'sell' | 'cost'>('sell');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'low_stock'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);

  // Generate static reference once per modal opening
  const invoiceRef = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-PRT-${today}-${rand}`;
  }, [isOpen]);

  const invoiceDate = useMemo(() => {
    return new Date().toLocaleDateString(i18n.language || 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [i18n.language, isOpen]);

  // Handle customer selection change
  const handleCustomerChange = (val: string) => {
    setSelectedCustomerId(val);
    if (val === 'custom') {
      setRecipient('Commercial Client / Wholesale');
    } else {
      const c = customers.find(cust => cust.id === val);
      if (c) {
        setRecipient(c.shopName ? `${c.shopName} (${c.name})` : c.name);
      }
    }
  };

  // Filtered parts
  const filteredParts = useMemo(() => {
    const query = normalizeArabic(searchQuery).trim().toLowerCase();
    const words = query ? query.split(/\s+/) : [];

    return parts.filter(p => {
      // Stock status filter
      if (statusFilter === 'in_stock' && p.stock <= 0) return false;
      if (statusFilter === 'low_stock') {
        const threshold = p.lowStockThreshold ?? 1;
        if (p.stock > threshold) return false;
      }

      // Search query filter
      if (words.length > 0) {
        const full = normalizeArabic([p.name, p.model, p.sku, p.location, p.supplier].filter(Boolean).join(' ')).toLowerCase();
        if (!words.every(w => full.includes(w))) return false;
      }

      return true;
    });
  }, [parts, statusFilter, searchQuery]);

  // Calculation totals
  const totals = useMemo(() => {
    let units = 0;
    let amount = 0;

    for (const p of filteredParts) {
      const qty = Math.max(0, p.stock || 0);
      const unitPrice = priceMode === 'cost' ? (p.costPrice || 0) : (p.price || 0);
      units += qty;
      amount += qty * unitPrice;
    }

    return {
      lineCount: filteredParts.length,
      units,
      amount,
    };
  }, [filteredParts, priceMode]);

  // Handle CSV export
  const handleExportCSV = () => {
    if (filteredParts.length === 0) {
      toast.warning(t('common.noData', 'No parts to export'));
      return;
    }

    const headers = [
      '#',
      t('parts.partName', 'Part Name'),
      t('parts.model', 'Model'),
      t('parts.sku', 'SKU'),
      t('parts.location', 'Location'),
      t('parts.stock', 'Stock Qty'),
      priceMode === 'cost' ? t('parts.costPrice', 'Cost Price') : t('parts.sellPrice', 'Unit Price'),
      t('common.total', 'Total'),
      t('parts.statusCol', 'Status'),
    ];

    const rows = filteredParts.map((p, idx) => {
      const qty = Math.max(0, p.stock || 0);
      const unit = priceMode === 'cost' ? (p.costPrice || 0) : (p.price || 0);
      return [
        idx + 1,
        p.name || '',
        p.model || '',
        p.sku || '',
        p.location || '',
        qty,
        unit,
        qty * unit,
        p.stockStatus || '',
      ];
    });

    const filename = `parts-invoice-${new Date().toISOString().slice(0, 10)}.csv`;
    exportToCSV(filename, headers, rows);
    toast.success(t('parts.exportedSuccess', 'Invoice exported as CSV!'));
  };

  // Handle Direct Thermal Print Server (strictly no browser dialog)
  const handlePrintViaServer = async () => {
    if (filteredParts.length === 0) {
      toast.warning(t('common.noData', 'No parts to print'));
      return;
    }

    setIsPrinting(true);
    try {
      await printPartsInvoiceDirect({
        storeName: settings.storeName || 'PhoneShop Pro',
        currency: settings.currency || 'DZD',
        recipient,
        invoiceRef,
        priceMode,
        parts: filteredParts.map(p => ({
          name: p.name || '',
          model: p.model || '',
          sku: p.sku || '',
          location: p.location || '',
          quantity: Math.max(0, p.stock || 0),
          unitPrice: priceMode === 'cost' ? (p.costPrice || 0) : (p.price || 0),
        })),
        totalUnits: totals.units,
        totalAmount: totals.amount,
      });

      toast.success(
        t('parts.invoiceSentToPrinter', 'Invoice Sent to Printer'),
        t('parts.invoicePrintSuccess', 'Parts commercial invoice printed directly on thermal printer.')
      );
    } catch (err: unknown) {
      console.error('Print server error:', err);
      toast.error(
        t('parts.printFailed', 'Print Failed'),
        err instanceof Error ? err.message : 'Could not reach the print server.'
      );
    } finally {
      setIsPrinting(false);
    }
  };

  // Handle Full Document Print (PDF / Browser sheet)
  const handlePrintDocument = () => {
    if (filteredParts.length === 0) {
      toast.warning(t('common.noData', 'No parts to print'));
      return;
    }

    const printWin = window.open('', '_blank', 'width=950,height=750');
    if (!printWin) {
      toast.error('Popups Blocked', 'Please allow popups to print invoices.');
      return;
    }

    const storeTitle = settings.storeName || 'PHONE SHOP MANAGER PRO';
    const storePhone = 'phone' in settings && settings.phone ? `Tel: ${settings.phone}` : '';
    const storeAddress = 'address' in settings && settings.address ? `${settings.address}` : '';
    const priceHeader = priceMode === 'cost' ? 'Cost Price' : 'Unit Price';

    const tableRowsHtml = filteredParts.map((p, idx) => {
      const qty = Math.max(0, p.stock || 0);
      const unit = priceMode === 'cost' ? (p.costPrice || 0) : (p.price || 0);
      const total = qty * unit;

      return `
        <tr>
          <td style="text-align: center; color: #64748b;">${idx + 1}</td>
          <td>
            <strong>${escapeHtml(p.name)}</strong> ${escapeHtml(p.model || '')}
            ${p.location ? `<div style="font-size: 10px; color: #64748b;">Loc: ${escapeHtml(p.location)}</div>` : ''}
          </td>
          <td><code style="font-family: monospace; font-size: 11px;">${escapeHtml(p.sku || '—')}</code></td>
          <td style="text-align: center; font-weight: 700;">${qty}</td>
          <td style="text-align: right;">${formatCurrency(unit)}</td>
          <td style="text-align: right; font-weight: 700;">${formatCurrency(total)}</td>
        </tr>
      `;
    }).join('');

    printWin.document.open();
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Invoice - ${escapeHtml(invoiceRef)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
            padding: 30px;
            font-size: 12px;
            line-height: 1.4;
          }
          .invoice-box {
            max-width: 900px;
            margin: 0 auto;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 16px;
            margin-bottom: 20px;
          }
          .store-name {
            font-size: 22px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.02em;
          }
          .store-sub {
            font-size: 11px;
            color: #64748b;
            margin-top: 3px;
          }
          .meta-col {
            text-align: right;
          }
          .badge {
            display: inline-block;
            background: #0f172a;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            padding: 4px 10px;
            border-radius: 4px;
            margin-bottom: 6px;
          }
          .invoice-num {
            font-family: monospace;
            font-size: 13px;
            font-weight: 700;
          }
          .invoice-date {
            font-size: 11px;
            color: #64748b;
            margin-top: 2px;
          }
          .parties {
            display: flex;
            justify-content: space-between;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px 16px;
            margin-bottom: 20px;
          }
          .party-box {
            width: 48%;
          }
          .party-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
            letter-spacing: 0.05em;
          }
          .party-name {
            font-size: 14px;
            font-weight: 700;
            margin-top: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 12px;
          }
          th {
            background: #f1f5f9;
            color: #334155;
            font-weight: 700;
            padding: 8px 10px;
            border-bottom: 2px solid #cbd5e1;
            text-align: left;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.03em;
          }
          td {
            padding: 7px 10px;
            border-bottom: 1px solid #e2e8f0;
          }
          tr:nth-child(even) td {
            background: #fafafa;
          }
          .summary-container {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-top: 2px solid #0f172a;
            padding-top: 14px;
            margin-top: 8px;
          }
          .notice-box {
            width: 55%;
            font-size: 11px;
            color: #64748b;
            line-height: 1.45;
          }
          .totals-table {
            width: 38%;
            border-collapse: collapse;
          }
          .totals-table td {
            padding: 5px 0;
            border: none;
            background: transparent !important;
          }
          .grand-total {
            font-size: 16px;
            font-weight: 800;
            color: #0f172a;
            border-top: 1px solid #cbd5e1 !important;
            padding-top: 8px !important;
          }
          .footer-sign {
            margin-top: 50px;
            display: flex;
            justify-content: space-between;
            padding-top: 16px;
            border-top: 1px dashed #cbd5e1;
            font-size: 11px;
            color: #94a3b8;
          }
          .signature-line {
            width: 180px;
            border-top: 1px solid #334155;
            text-align: center;
            padding-top: 4px;
            font-size: 10px;
            color: #64748b;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
            @page { margin: 12mm; }
          }
        </style>
      </head>
      <body>
        <div class="invoice-box">
          <div class="header">
            <div>
              <div class="store-name">${escapeHtml(storeTitle)}</div>
              <div class="store-sub">Parts Wholesale & Repair Inventory Division</div>
              ${storePhone ? `<div class="store-sub">${escapeHtml(storePhone)}</div>` : ''}
              ${storeAddress ? `<div class="store-sub">${escapeHtml(storeAddress)}</div>` : ''}
            </div>
            <div class="meta-col">
              <span class="badge">COMMERCIAL PARTS INVOICE</span>
              <div class="invoice-num">#${escapeHtml(invoiceRef)}</div>
              <div class="invoice-date">${escapeHtml(invoiceDate)}</div>
            </div>
          </div>

          <div class="parties">
            <div class="party-box">
              <div class="party-label">ISSUED TO / CLIENT:</div>
              <div class="party-name">${escapeHtml(recipient)}</div>
              <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Type: Wholesale Inventory Export / Manifest</div>
            </div>
            <div class="party-box">
              <div class="party-label">DISPATCHED / PREPARED BY:</div>
              <div class="party-name">${escapeHtml(user?.name || 'Authorized Staff')}</div>
              <div style="font-size: 11px; color: #16a34a; font-weight: 600; margin-top: 2px;">✓ Verified Inventory Manifest</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">#</th>
                <th>Part Description</th>
                <th>SKU</th>
                <th style="text-align: center;">Qty</th>
                <th style="text-align: right;">${escapeHtml(priceHeader)}</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>

          <div class="summary-container">
            <div class="notice-box">
              <strong>Notice:</strong> This document represents an active inventory export & commercial quotation sheet. 
              <strong>No deductions have been made to existing store inventory stock.</strong> 
              All items listed reflect verified parts available in inventory at time of export.
            </div>

            <table class="totals-table">
              <tr>
                <td style="color: #64748b;">Unique Models:</td>
                <td style="text-align: right; font-weight: 600;">${totals.lineCount}</td>
              </tr>
              <tr>
                <td style="color: #64748b;">Total Units in Stock:</td>
                <td style="text-align: right; font-weight: 600;">${totals.units}</td>
              </tr>
              <tr>
                <td class="grand-total">Invoice Total:</td>
                <td class="grand-total" style="text-align: right;">${formatCurrency(totals.amount)}</td>
              </tr>
            </table>
          </div>

          <div class="footer-sign">
            <div>Generated by ${escapeHtml(storeTitle)} · Confidential & Official Quotation</div>
            <div class="signature-line">Authorized Signature & Stamp</div>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('parts.exportInvoiceTitle', 'Export Parts Commercial Invoice')}
      subtitle={t('parts.exportInvoiceSubtitle', 'Export all parts as a formal commercial invoice / quotation. No quantities are deducted from inventory.')}
      size="lg"
      footer={
        <div className={styles.footerActions}>
          <div className={styles.footerLeft}>
            <strong>{totals.lineCount}</strong> {t('parts.modelsCount', { count: totals.lineCount })} · <strong>{totals.units}</strong> {t('parts.units', { count: totals.units })} · Total: <strong>{formatCurrency(totals.amount)}</strong>
          </div>
          <div className={styles.footerRight}>
            <Button variant="ghost" onClick={onClose} disabled={isPrinting}>
              {t('common.close', 'Close')}
            </Button>
            <Button variant="secondary" leftIcon={<Download size={15} />} onClick={handleExportCSV} disabled={isPrinting}>
              {t('common.exportCSV', 'Export CSV')}
            </Button>
            <Button variant="secondary" leftIcon={<FileText size={15} />} onClick={handlePrintDocument} disabled={isPrinting} title="A4 Document / Save as PDF">
              PDF / A4
            </Button>
            <Button
              leftIcon={<Printer size={15} />}
              onClick={handlePrintViaServer}
              isLoading={isPrinting}
              disabled={isPrinting || filteredParts.length === 0}
            >
              {isPrinting ? t('common.printing', 'Printing...') : t('parts.printThermalInvoice', 'Print Invoice (Thermal)')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.modalContent}>
        {/* Notice of no-stock-deduction */}
        <div className={styles.noticeBanner}>
          <Info size={16} />
          <span>
            {t('parts.exportNoDeductNotice', 'Stock Export Only: This invoice does not deduct any parts from stock or record a sale.')}
          </span>
        </div>

        {/* Controls Toolbar */}
        <div className={styles.controlsBar}>
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>{t('parts.issuedToClient', 'Issued To (Client / Shop):')}</span>
            <Select
              options={[
                { value: 'custom', label: t('parts.customClient', 'Custom / Wholesale Client') },
                ...customers.map(c => ({
                  value: c.id,
                  label: c.shopName ? `${c.shopName} (${c.name})` : c.name,
                })),
              ]}
              value={selectedCustomerId}
              onChange={handleCustomerChange}
            />
          </div>

          {selectedCustomerId === 'custom' && (
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>{t('parts.clientName', 'Client / Store Name:')}</span>
              <input
                type="text"
                className={styles.recipientInput}
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                placeholder="e.g. AP Wholesale, Tech Service Hub"
              />
            </div>
          )}

          <div className={styles.controlGroup} style={{ maxWidth: '140px' }}>
            <span className={styles.controlLabel}>{t('parts.stockScope', 'Parts Scope:')}</span>
            <Select
              options={[
                { value: 'all', label: t('parts.allParts', 'All Parts') },
                { value: 'in_stock', label: t('inventory.inStock', 'In Stock Only') },
                { value: 'low_stock', label: t('inventory.lowStock', 'Low Stock') },
              ]}
              value={statusFilter}
              onChange={v => setStatusFilter(v as 'all' | 'in_stock' | 'low_stock')}
            />
          </div>

          {canViewCosts && (
            <div className={styles.controlGroup} style={{ maxWidth: '140px' }}>
              <span className={styles.controlLabel}>{t('parts.priceBasis', 'Price Basis:')}</span>
              <Select
                options={[
                  { value: 'sell', label: t('parts.sellPrice', 'Selling Price') },
                  { value: 'cost', label: t('parts.costPrice', 'Cost Price') },
                ]}
                value={priceMode}
                onChange={v => setPriceMode(v as 'sell' | 'cost')}
              />
            </div>
          )}

          <div className={`${styles.controlGroup} ${styles.searchInput}`}>
            <span className={styles.controlLabel}>{t('common.search', 'Search / Filter:')}</span>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className={styles.recipientInput}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('parts.searchPlaceholder', 'Search parts...')}
                style={{ paddingLeft: '30px' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '11px', color: '#94a3b8' }} />
            </div>
          </div>
        </div>

        {/* Invoice Visual Sheet Preview */}
        <div className={styles.invoiceSheet}>
          <div className={styles.sheetHeader}>
            <div className={styles.storeInfo}>
              <h2>{settings.storeName || 'PHONE SHOP MANAGER PRO'}</h2>
              <p className={styles.storeSub}>Parts Wholesale & Repair Inventory Division</p>
              {'phone' in settings && settings.phone && <p className={styles.storeSub}>📞 {settings.phone}</p>}
            </div>

            <div className={styles.invoiceMeta}>
              <span className={styles.badgeInvoice}>COMMERCIAL INVOICE</span>
              <div className={styles.invoiceNumber}>#{invoiceRef}</div>
              <div className={styles.invoiceDate}>{invoiceDate}</div>
            </div>
          </div>

          <div className={styles.partiesRow}>
            <div className={styles.partyCol}>
              <span className={styles.partyLabel}>ISSUED TO (CLIENT / STORE):</span>
              <span className={styles.partyName}>{recipient || 'Commercial Wholesale Client'}</span>
              <span className={styles.partyDetail}>Status: Parts Stock Export / Quotation</span>
            </div>
            <div className={styles.partyCol}>
              <span className={styles.partyLabel}>PREPARED BY:</span>
              <span className={styles.partyName}>{user?.name || 'Authorized Staff'}</span>
              <span className={styles.partyDetail}>Order Status: Non-Deductive Stock Manifest</span>
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                  <th>{t('parts.partName', 'Item / Part Description')}</th>
                  <th>{t('parts.sku', 'SKU')}</th>
                  <th style={{ textAlign: 'center' }}>{t('parts.stock', 'Stock')}</th>
                  <th style={{ textAlign: 'right' }}>{priceMode === 'cost' ? t('parts.costPrice', 'Cost') : t('parts.sellPrice', 'Price')}</th>
                  <th style={{ textAlign: 'right' }}>{t('common.total', 'Total')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredParts.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      {t('parts.noParts', 'No parts found matching filters')}
                    </td>
                  </tr>
                ) : (
                  filteredParts.map((p, idx) => {
                    const qty = Math.max(0, p.stock || 0);
                    const unit = priceMode === 'cost' ? (p.costPrice || 0) : (p.price || 0);
                    const total = qty * unit;

                    return (
                      <tr key={p.id}>
                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>{idx + 1}</td>
                        <td>
                          <div className={styles.partName}>{p.name} {p.model}</div>
                          {p.location && <span style={{ fontSize: '11px', color: '#64748b' }}>Loc: {p.location}</span>}
                        </td>
                        <td>
                          <code className={styles.partSku}>{p.sku || '—'}</code>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>
                          {qty}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {formatCurrency(unit)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {formatCurrency(total)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.summarySection}>
            <div className={styles.summaryNotes}>
              <p>
                <strong>Export Notice:</strong> This invoice reflects current shop inventory of repair parts. 
                <strong> No quantities were deducted.</strong> Usable for commercial wholesale quotes, insurance declarations, and supplier audits.
              </p>
            </div>

            <div className={styles.summaryCards}>
              <div className={styles.summaryRow}>
                <span>{t('parts.totalParts', 'Unique Models')}:</span>
                <strong>{totals.lineCount}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>{t('parts.totalUnits', 'Total Units in Stock')}:</span>
                <strong>{totals.units}</strong>
              </div>
              <div className={styles.summaryRowTotal}>
                <span>{t('common.total', 'Invoice Total')}:</span>
                <span>{formatCurrency(totals.amount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

