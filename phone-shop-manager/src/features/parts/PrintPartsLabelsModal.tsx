import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { LabelsPrintModal, type LabelsPrintApi, type LabelsPrintCopy } from '../../components/labels/LabelsPrintModal';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { printBigBoxLabelDirect } from '../../utils/printWindow';
import type { PhoneModel } from '../../types';
import styles from './PrintPartsLabels.module.css';

interface PrintPartsLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const searchFields = (p: PhoneModel) => [p.name, p.model, p.sku];

const BATCH_BUTTON_BASE: React.CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: '6px',
  cursor: 'pointer',
};

function getBigBoxFontSize(text: string): number {
  const len = text.length || 1;
  if (len === 1) return 40;
  if (len === 2) return 34;
  if (len === 3) return 28;
  if (len === 4) return 22;
  if (len <= 6) return 18;
  if (len <= 10) return 14;
  return 11;
}

export const PrintPartsLabelsModal: React.FC<PrintPartsLabelsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { parts, fetchParts } = useInventoryStore();
  const toast = useToast();

  const [bigBoxText, setBigBoxText] = useState('');
  const [bigBoxCopies, setBigBoxCopies] = useState(1);
  const [isPrintingBigBox, setIsPrintingBigBox] = useState(false);
  const [isBigBoxExpanded, setIsBigBoxExpanded] = useState(true);

  const handlePrintBigBox = async () => {
    const trimmed = bigBoxText.trim();
    if (!trimmed || isPrintingBigBox) return;
    setIsPrintingBigBox(true);
    try {
      const res = await printBigBoxLabelDirect({
        text: trimmed,
        copies: Math.max(1, Math.min(50, Number(bigBoxCopies) || 1)),
      });
      if (res?.error) {
        toast.error(t('parts.printLabelsModal.bigBoxError', 'Failed to print Big Box Label'), res.error);
      } else {
        toast.success(t('parts.printLabelsModal.bigBoxSuccess', 'Big Box Label sent to printer!'));
      }
    } catch (err) {
      toast.error(
        t('parts.printLabelsModal.bigBoxError', 'Failed to print Big Box Label'),
        err instanceof Error ? err.message : 'Print failed'
      );
    } finally {
      setIsPrintingBigBox(false);
    }
  };

  const copy: LabelsPrintCopy = {
    modalTitle: t('parts.printLabelsModal.modalTitle'),
    previewTitle: t('parts.printLabelsModal.previewTitle'),
    previewIframeTitle: t('parts.printLabelsModal.previewIframeTitle'),
    searchPlaceholder: t('parts.printLabelsModal.searchPlaceholder'),
    emptySelection: t('parts.printLabelsModal.emptySelection'),
    noLabelsWarning: t('parts.printLabelsModal.noLabelsWarning'),
    totalQtyLabel: t('common.quantity'),
    printWindowTitle: t('parts.printLabelsModal.printWindowTitle'),
  };

  return (
    <LabelsPrintModal
      isOpen={isOpen}
      onClose={onClose}
      items={parts}
      withPriceColumn={false}
      clearSearchAfterAdd
      searchFields={searchFields}
      copy={copy}
      classes={styles}
      onOpen={() => { if (parts.length === 0) fetchParts(); }}
      renderAboveSearch={() => (
        <div style={{
          backgroundColor: 'var(--color-surface-container, #f8fafc)',
          border: '1.5px solid var(--color-outline-variant, #cbd5e1)',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: '12px 16px',
          marginBottom: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div
            onClick={() => setIsBigBoxExpanded(prev => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Package size={18} style={{ color: 'var(--color-primary, #3b82f6)' }} />
              <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--color-on-surface, #1e293b)' }}>
                {t('parts.printLabelsModal.bigBoxTitle', 'Big Box Label (Write & Print)')}
              </span>
              <span style={{
                fontSize: '10.5px',
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#e2e8f0',
                padding: '2px 7px',
                borderRadius: '9999px',
              }}>
                50×20mm
              </span>
            </div>
            <button
              type="button"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-on-surface-variant, #64748b)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {isBigBoxExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {isBigBoxExpanded && (
            <div style={{ marginTop: '10px' }}>
              <p style={{
                fontSize: '11.5px',
                color: 'var(--color-on-surface-variant, #64748b)',
                margin: '0 0 10px 0',
              }}>
                {t('parts.printLabelsModal.bigBoxDesc', 'Giant text filling the 50×20mm sticker from top to bottom')}
              </p>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}>
                {/* Text Input */}
                <div style={{ flex: '1 1 200px', minWidth: '160px' }}>
                  <input
                    type="text"
                    placeholder={t('parts.printLabelsModal.bigBoxPlaceholder', 'Enter text (e.g. A, BOX 1, B2)...')}
                    value={bigBoxText}
                    onChange={e => setBigBoxText(e.target.value.slice(0, 20))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handlePrintBigBox();
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      border: '1px solid var(--color-outline-variant, #cbd5e1)',
                      backgroundColor: 'var(--color-surface, #ffffff)',
                      color: 'var(--color-on-surface, #1e293b)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Copies Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>
                    {t('common.quantity', 'Qty')}:
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={bigBoxCopies}
                    onChange={e => setBigBoxCopies(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
                    style={{
                      width: '54px',
                      padding: '7px 8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      textAlign: 'center',
                      borderRadius: '6px',
                      border: '1px solid var(--color-outline-variant, #cbd5e1)',
                      backgroundColor: 'var(--color-surface, #ffffff)',
                      color: 'var(--color-on-surface, #1e293b)',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Mini Sticker Visual Preview */}
                <div style={{
                  width: '120px',
                  height: '48px',
                  backgroundColor: '#ffffff',
                  border: '1.5px dashed #94a3b8',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  flexShrink: 0,
                  padding: '2px',
                  boxSizing: 'border-box',
                }}>
                  <span style={{
                    fontFamily: 'monospace, sans-serif',
                    fontWeight: 900,
                    color: bigBoxText.trim() ? '#0f172a' : '#cbd5e1',
                    fontSize: `${getBigBoxFontSize(bigBoxText.trim() || 'A')}px`,
                    lineHeight: 1,
                    letterSpacing: '-0.5px',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'clip',
                    display: 'block',
                  }}>
                    {bigBoxText.trim() || 'A'}
                  </span>
                </div>

                {/* Print Button */}
                <button
                  type="button"
                  onClick={() => { void handlePrintBigBox(); }}
                  disabled={!bigBoxText.trim() || isPrintingBigBox}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: !bigBoxText.trim() || isPrintingBigBox ? '#94a3b8' : '#2563eb',
                    color: '#ffffff',
                    cursor: !bigBoxText.trim() || isPrintingBigBox ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'background-color 0.15s ease',
                    flexShrink: 0,
                  }}
                >
                  <Printer size={15} />
                  {isPrintingBigBox
                    ? t('common.printing', 'Printing...')
                    : `${t('parts.printLabelsModal.bigBoxPrintBtn', 'Print Big Label')}${bigBoxCopies > 1 ? ` (${bigBoxCopies})` : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      renderBelowSearch={({ selected, setQueue, clearQueue }: LabelsPrintApi) => {
        const inStockParts = parts.filter(p => p.stock > 0);
        const lowStockParts = parts.filter(p => p.stockStatus === 'low_stock' || (p.stock > 0 && p.stock <= (p.lowStockThreshold || 1)));

        return (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setQueue(inStockParts, p => Math.max(1, p.stock));
                toast.info(
                  t('parts.printLabelsModal.allInStockToastTitle'),
                  t('parts.printLabelsModal.allInStockToastBody', { count: inStockParts.length })
                );
              }}
              style={{ ...BATCH_BUTTON_BASE, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca' }}
            >
              {t('parts.printLabelsModal.addAllInStock', { count: inStockParts.length })}
            </button>
            <button
              type="button"
              onClick={() => {
                setQueue(lowStockParts, () => 2);
                toast.info(
                  t('parts.printLabelsModal.lowStockToastTitle'),
                  t('parts.printLabelsModal.lowStockToastBody', { count: lowStockParts.length })
                );
              }}
              style={{ ...BATCH_BUTTON_BASE, border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c' }}
            >
              {t('parts.printLabelsModal.addLowStock', { count: parts.filter(p => p.stockStatus === 'low_stock').length })}
            </button>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={clearQueue}
                style={{ ...BATCH_BUTTON_BASE, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', marginLeft: 'auto' }}
              >
                {t('parts.printLabelsModal.clearSelected')}
              </button>
            )}
          </div>
        );
      }}
    />
  );
};
