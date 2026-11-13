import React from 'react';
import { useTranslation } from 'react-i18next';
import { LabelsPrintModal, type LabelsPrintApi, type LabelsPrintCopy } from '../../components/labels/LabelsPrintModal';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
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

export const PrintPartsLabelsModal: React.FC<PrintPartsLabelsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { parts, fetchParts } = useInventoryStore();
  const toast = useToast();

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
