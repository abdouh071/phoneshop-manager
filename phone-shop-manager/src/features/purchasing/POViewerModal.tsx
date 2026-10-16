import React, { useState } from 'react';
import { X, Package, Printer, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import type { PurchaseOrder } from '../../types';
import styles from './POViewerModal.module.css';

interface POViewerModalProps {
  po: PurchaseOrder;
  onClose: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const POViewerModal: React.FC<POViewerModalProps> = ({ po, onClose }) => {
  const { updatePO } = usePurchasingStore();
  const { restockProduct } = useInventoryStore();
  const toast = useToast();

  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveAmounts, setReceiveAmounts] = useState<Record<string, number>>(
    po.items.reduce((acc, item) => {
      acc[item.productId] = Math.max(0, item.requestedQty - item.receivedQty);
      return acc;
    }, {} as Record<string, number>)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReceiveToggle = () => {
    setIsReceiving(!isReceiving);
  };

  const handleReceiveSubmit = async () => {
    setIsSubmitting(true);
    try {
      // 1. Calculate new received quantities
      const newItems = po.items.map(item => {
        const toReceive = receiveAmounts[item.productId] || 0;
        return {
          ...item,
          receivedQty: item.receivedQty + toReceive
        };
      });

      // 2. Determine new status
      const allFullyReceived = newItems.every(i => i.receivedQty >= i.requestedQty);
      const someReceived = newItems.some(i => i.receivedQty > 0);
      const newStatus = allFullyReceived ? 'completed' : (someReceived ? 'partially_received' : po.status);

      // 3. Update PO in Firestore
      await updatePO(po.id, {
        items: newItems,
        status: newStatus
      });

      // 4. Update Inventory & Log Restocks
      // We iterate over the items and if we are receiving > 0, we restock it.
      for (const item of po.items) {
        const toReceive = receiveAmounts[item.productId] || 0;
        if (toReceive > 0) {
          // Note: restockProduct logs to the restock history automatically.
          await restockProduct(item.productId, toReceive, {
            supplier: po.supplierName,
            note: `Received from ${po.poNumber}`,
            cost: item.unitCost
          });
        }
      }

      toast.success('Stock Received', `Inventory has been updated successfully.`);
      onClose();
    } catch (err) {
      toast.error('Error', 'Failed to receive stock.');
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
            <span className={styles.statusBadge} data-status={po.status}>{po.status.replace('_', ' ')}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div className={styles.body}>
          <div className={styles.metaGrid}>
            <div>
              <div className={styles.metaLabel}>Supplier</div>
              <div className={styles.metaValue}>{po.supplierName}</div>
            </div>
            <div>
              <div className={styles.metaLabel}>Order Date</div>
              <div className={styles.metaValue}>{formatDate(po.orderDate)}</div>
            </div>
            <div>
              <div className={styles.metaLabel}>Expected Delivery</div>
              <div className={styles.metaValue}>{po.expectedDelivery ? formatDate(po.expectedDelivery) : '—'}</div>
            </div>
            <div>
              <div className={styles.metaLabel}>Total Amount</div>
              <div className={styles.metaValue}>{formatCurrency(po.totalAmount)}</div>
            </div>
          </div>

          <div className={styles.itemsSection}>
            <h3>Order Items</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Unit Cost</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    {isReceiving && <th>Receive Now</th>}
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
                                className={styles.receiveInput}
                                value={receiveAmounts[item.productId] ?? 0}
                                onChange={e => setReceiveAmounts(prev => ({ ...prev, [item.productId]: parseInt(e.target.value) || 0 }))}
                              />
                            ) : (
                              <span className={styles.doneText}>Done</span>
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
              <strong>Notes:</strong> {po.notes}
            </div>
          )}

          {isReceiving && (
            <div className={styles.warningBanner}>
              <AlertTriangle size={16} />
              <span>Receiving these items will immediately update your active inventory stock and record a restock log for each product.</span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {!isReceiving ? (
            <>
              <Button variant="ghost" onClick={() => window.print()} leftIcon={<Printer size={16} />}>Print PO</Button>
              {po.status !== 'completed' && po.status !== 'cancelled' && (
                <Button leftIcon={<Package size={16} />} onClick={handleReceiveToggle}>
                  Receive Stock
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleReceiveToggle} disabled={isSubmitting}>Cancel</Button>
              <Button leftIcon={<CheckCircle size={16} />} onClick={handleReceiveSubmit} isLoading={isSubmitting}>
                Confirm Receipt
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
