import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Printer, Tag, FileText, Layers } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../../components/ui/Toast';
import {
  printRepairBothDirect,
  printRepairLabelDirect,
  printRepairIntakeTicketDirect,
  buildRepairLabelHTML,
  buildRepairReceiptHTML,
  openPrintWindow,
} from '../../utils/printWindow';
import type { RepairTicket } from '../../types';
import styles from './PrintRepairTicketModal.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface PrintRepairTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: RepairTicket | null;
}

export const PrintRepairTicketModal: React.FC<PrintRepairTicketModalProps> = ({
  isOpen,
  onClose,
  ticket,
}) => {
  const { storeName, currency } = useSettingsStore();
  const toast = useToast();

  const [format, setFormat] = useState<'both' | 'label' | 'receipt'>('both');
  const [isPrinting, setIsPrinting] = useState(false);

  const { i18n } = useTranslation();

  // Generate previews dynamically
  const labelHtml = useMemo(() => {
    if (!ticket) return '';
    return buildRepairLabelHTML(ticket);
  }, [ticket, storeName, i18n.language]);

  const receiptHtml = useMemo(() => {
    if (!ticket) return '';
    return buildRepairReceiptHTML(ticket);
  }, [ticket, storeName, i18n.language]);

  if (!isOpen || !ticket) return null;

  // Print BOTH: 1 Normal Ticket (80mm) + 1 Phone Back Sticker (Label)
  const handlePrintBoth = async () => {
    setIsPrinting(true);
    try {
      const { ticketResult, labelResult } = await printRepairBothDirect(
        ticket,
        storeName,
        currency
      );

      if (ticketResult === 'direct' && labelResult === 'direct') {
        toast.success(
          'Both Copies Printed',
          'Printed customer intake ticket (80mm) and device back sticker on label printer.'
        );
        onClose();
        return;
      }

      if (ticketResult === 'direct' && labelResult === 'browser') {
        openPrintWindow(labelHtml, `Repair Sticker - ${ticket.ticketNumber}`);
        toast.info('Ticket Printed', '80mm ticket printed. Opening browser print for device sticker.');
        onClose();
        return;
      }

      if (ticketResult === 'browser' && labelResult === 'direct') {
        openPrintWindow(receiptHtml, `Repair Ticket - ${ticket.ticketNumber}`);
        toast.info('Sticker Printed', 'Device sticker printed. Opening browser print for customer ticket.');
        onClose();
        return;
      }

      // Both browser fallback
      const combinedHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>Repair Documents - ${ticket.ticketNumber}</title>
          <style>
            @media print {
              .page-break { page-break-after: always; }
            }
          </style>
        </head>
        <body>
          <div class="page-break">${receiptHtml}</div>
          <div>${labelHtml}</div>
        </body>
        </html>
      `;
      openPrintWindow(combinedHtml, `Repair Print - ${ticket.ticketNumber}`);
      toast.info('Browser Print', 'Opening print dialog for both ticket and sticker.');
      onClose();
    } catch (err: unknown) {
      console.error('[Print Both Error]', err);
      toast.error('Print Failed', errorMessage(err) || 'Failed to dispatch print jobs.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Print Sticker Only
  const handlePrintLabelOnly = async () => {
    setIsPrinting(true);
    try {
      const result = await printRepairLabelDirect(ticket, storeName, 1);
      if (result.method === 'direct') {
        toast.success('Label Printed', 'Phone back sticker sent to label printer.');
        onClose();
        return;
      }
      openPrintWindow(labelHtml, `Repair Sticker - ${ticket.ticketNumber}`);
      onClose();
    } catch (err: unknown) {
      toast.error('Print Failed', errorMessage(err) || 'Failed to print label.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Print Normal Ticket Only
  const handlePrintReceiptOnly = async () => {
    setIsPrinting(true);
    try {
      const result = await printRepairIntakeTicketDirect(ticket, storeName, currency);
      if (result.method === 'direct') {
        toast.success('Ticket Printed', 'Customer intake ticket sent to 80mm printer.');
        onClose();
        return;
      }
      openPrintWindow(receiptHtml, `Repair Ticket - ${ticket.ticketNumber}`);
      onClose();
    } catch (err: unknown) {
      toast.error('Print Failed', errorMessage(err) || 'Failed to print ticket.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modalContent}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <h2 className={styles.title}>
              <Printer size={18} style={{ color: '#2563eb' }} />
              Print Preview — Ticket #{ticket.ticketNumber}
            </h2>
            <p className={styles.subtitle}>
              {ticket.deviceBrand} {ticket.deviceModel} · Client: {ticket.customerName} {ticket.customerPhone ? `(${ticket.customerPhone})` : ''}
            </p>
          </div>

          <div className={styles.controls}>
            <Button variant="ghost" onClick={onClose} leftIcon={<X size={16} />}>
              Cancel
            </Button>
            <Button
              onClick={handlePrintBoth}
              leftIcon={<Printer size={16} />}
              isLoading={isPrinting}
            >
              Print 2 Copies (Ticket + Sticker)
            </Button>
          </div>
        </div>

        {/* Toolbar: Preview Tabs & Single-Item Print Actions */}
        <div className={styles.toolbar}>
          {/* View Mode Tabs */}
          <div className={styles.tabGroup}>
            <button
              type="button"
              className={[styles.tabBtn, format === 'both' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setFormat('both')}
            >
              <Layers size={13} />
              <span>👥 Both (2 Copies)</span>
            </button>
            <button
              type="button"
              className={[styles.tabBtn, format === 'label' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setFormat('label')}
            >
              <Tag size={13} />
              <span>🏷️ Phone Back Sticker</span>
            </button>
            <button
              type="button"
              className={[styles.tabBtn, format === 'receipt' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setFormat('receipt')}
            >
              <FileText size={13} />
              <span>🧾 Normal Ticket (80mm)</span>
            </button>
          </div>

          {/* Quick print single item */}
          <div className={styles.secondaryActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePrintLabelOnly}
              leftIcon={<Tag size={13} />}
              disabled={isPrinting}
            >
              Sticker Only
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePrintReceiptOnly}
              leftIcon={<FileText size={13} />}
              disabled={isPrinting}
            >
              Ticket Only
            </Button>
          </div>
        </div>

        {/* Modal Body: Render live preview */}
        <div className={styles.modalBody}>
          {format === 'both' ? (
            <div className={styles.sideBySideContainer}>
              {/* Left: Normal Customer Ticket */}
              <div className={styles.pane}>
                <div className={styles.paneHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FileText size={14} style={{ color: '#2563eb' }} />
                    <span>1. Normal Ticket (Customer Intake Slip · 80mm)</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Printer_POS_80</span>
                </div>
                <iframe
                  srcDoc={receiptHtml}
                  className={styles.paneIframe}
                  title="Customer Ticket Preview"
                />
              </div>

              {/* Right: Phone Back Sticker */}
              <div className={styles.pane}>
                <div className={styles.paneHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Tag size={14} style={{ color: '#059669' }} />
                    <span>2. Phone Back Label (Device Sticker)</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Xprinter_XP_420B</span>
                </div>
                <iframe
                  srcDoc={labelHtml}
                  className={styles.paneIframe}
                  title="Device Back Label Preview"
                />
              </div>
            </div>
          ) : (
            <iframe
              srcDoc={format === 'label' ? labelHtml : receiptHtml}
              className={styles.previewIframe}
              title="Ticket Preview"
            />
          )}
        </div>
      </div>
    </div>
  );
};
