import React, { useState } from 'react';
import { X, Package, Printer, CheckCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { errorMessage } from '../../utils/errorUtils';
import type { PurchaseOrder } from '../../types';
import styles from './POViewerModal.module.css';

interface POViewerModalProps {
  po: PurchaseOrder;
  onClose: () => void;
}

export const POViewerModal: React.FC<POViewerModalProps> = ({ po, onClose }) => {
  const { t, i18n } = useTranslation();
  const { receivePO } = usePurchasingStore();
  const toast = useToast();

  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveAmounts, setReceiveAmounts] = useState<Record<string, number>>(
    po.items.reduce((acc, item) => {
      acc[item.productId] = Math.max(0, item.requestedQty - item.receivedQty);
      return acc;
    }, {} as Record<string, number>)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' });

  const handleReceiveToggle = () => {
    setIsReceiving(!isReceiving);
  };

  const handleReceiveSubmit = async () => {
    const receipts = po.items
      .map(item => ({ productId: item.productId, qty: receiveAmounts[item.productId] ?? 0 }))
      .filter(r => r.qty > 0);

    if (receipts.length === 0) {
      toast.warning(t('purchasing.viewer.nothingTitle'), t('purchasing.viewer.nothingBody'));
      return;
    }

    setIsSubmitting(true);
    try {
      // One Firestore transaction covers the PO lines, every product's stock and the restock logs,
      // so a failure leaves nothing half-received.
      const result = await receivePO(po.id, receipts);
      const units = result.received.reduce((sum, line) => sum + line.qty, 0);
      toast.success(
        t('purchasing.viewer.receivedTitle'),
        result.status === 'completed'
          ? t('purchasing.viewer.receivedFullBody', { units, poNumber: result.poNumber })
          : t('purchasing.viewer.receivedPartialBody', { units, poNumber: result.poNumber })
      );
      onClose();
    } catch (err) {
      // Keep the modal open: nothing was written, so the quantities can be corrected and retried.
      toast.error(t('purchasing.viewer.failedTitle'), errorMessage(err) || t('purchasing.viewer.failedBody'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2>{po.poNumber}</h2>
            <span className={styles.statusBadge} data-status={po.status}>
              {t(`purchasing.status.${po.status}`)}
            </span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}><X size={20} /></button>
        </div>

        <div className={styles.body}>
          <div className={styles.metaGrid}>
            <div>
              <div className={styles.metaLabel}>{t('purchasing.supplier')}</div>
              <div className={styles.metaValue}>{po.supplierName}</div>
            </div>
            <div>
              <div className={styles.metaLabel}>{t('purchasing.orderDate')}</div>
              <div className={styles.metaValue}>{formatDate(po.orderDate)}</div>
            </div>
            <div>
              <div className={styles.metaLabel}>{t('purchasing.viewer.expectedDelivery')}</div>
              <div className={styles.metaValue}>{po.expectedDelivery ? formatDate(po.expectedDelivery) : '—'}</div>
            </div>
            <div>
              <div className={styles.metaLabel}>{t('purchasing.viewer.totalAmount')}</div>
              <div className={styles.metaValue}>{formatCurrency(po.totalAmount)}</div>
            </div>
          </div>

          <div className={styles.itemsSection}>
            <h3>{t('purchasing.viewer.orderItems')}</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('purchasing.viewer.product')}</th>
                    <th>{t('purchasing.viewer.unitCost')}</th>
                    <th>{t('purchasing.viewer.ordered')}</th>
                    <th>{t('purchasing.viewer.received')}</th>
                    {isReceiving && <th>{t('purchasing.viewer.receiveNow')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {po.items.map(item => {
                    const isFullyReceived = item.receivedQty >= item.requestedQty;
                    return (
                      <tr key={item.productId} className={isFullyReceived ? styles.fullyReceivedRow : ''}>
                        <td>
                          <div className={styles.itemName}>{item.productName}</div>
                          <code className={styles.itemSku}>{item.productSku}</code>
                        </td>
                        <td>{formatCurrency(item.unitCost)}</td>
                        <td>{item.requestedQty}</td>
                        <td>
                          {isFullyReceived ? (
                            <span className={styles.receivedBadge}><CheckCircle size={14} /> {item.receivedQty}</span>
                          ) : (
                            <span className={styles.pendingBadge}>{item.receivedQty}</span>
                          )}
                        </td>
                        {isReceiving && (
                          <td>
                            {!isFullyReceived ? (
                              <input
                                type="number"
                                min="0"
                                max={item.requestedQty - item.receivedQty}
                                aria-label={t('purchasing.viewer.receiveNow')}
                                className={styles.receiveInput}
                                value={receiveAmounts[item.productId] ?? 0}
                                onChange={e => setReceiveAmounts(prev => ({ ...prev, [item.productId]: parseInt(e.target.value) || 0 }))}
                              />
                            ) : (
                              <span className={styles.doneText}>{t('common.done')}</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {po.notes && (
            <div className={styles.notesSection}>
              <strong>{t('common.notes')}:</strong> {po.notes}
            </div>
          )}

          {isReceiving && (
            <div className={styles.warningBanner}>
              <AlertTriangle size={16} />
              <span>{t('purchasing.viewer.receiveWarning')}</span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {!isReceiving ? (
            <>
              <Button variant="ghost" onClick={() => window.print()} leftIcon={<Printer size={16} />}>{t('purchasing.viewer.printPO')}</Button>
              {po.status !== 'completed' && po.status !== 'cancelled' && (
                <Button leftIcon={<Package size={16} />} onClick={handleReceiveToggle}>
                  {t('purchasing.viewer.receiveStock')}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleReceiveToggle} disabled={isSubmitting}>{t('common.cancel')}</Button>
              <Button leftIcon={<CheckCircle size={16} />} onClick={handleReceiveSubmit} isLoading={isSubmitting}>
                {t('purchasing.viewer.confirmReceipt')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
