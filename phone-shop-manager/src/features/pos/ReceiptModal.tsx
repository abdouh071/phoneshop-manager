import React, { useState } from 'react';
import { Printer, CheckCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { SaleTransaction } from '../../types';
import { useSettingsStore } from '../../store/settingsStore';
import { printReceiptDirect } from '../../utils/printWindow';
import { useToast } from '../../components/ui/Toast';
import styles from './ReceiptModal.module.css';
import { formatCurrency } from '../../utils/formatCurrency';

interface ReceiptModalProps {
  transaction: SaleTransaction | null;
  onClose: () => void;
  mode?: 'checkout' | 'reprint';
}


const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ transaction, onClose, mode = 'checkout' }) => {
  const settings = useSettingsStore();
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  if (!transaction) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const result = await printReceiptDirect(transaction, settings.storeName, settings.currency);
      if (result.method === 'direct') {
        toast.success('Receipt Printed', 'Receipt sent to thermal printer.');
      } else {
        toast.info('Browser Print', 'Print server unavailable — opened browser print dialog.');
      }
    } catch (err) {
      toast.error('Print Failed', 'Could not print the receipt.');
      console.error('Print error:', err);
    } finally {
      setIsPrinting(false);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={!!transaction}
      onClose={onClose}
      title={mode === 'checkout' ? "Sale Complete" : "Receipt Details"}
      size="sm"
      footer={
        <>
          {mode === 'checkout' ? (
            <Button variant="ghost" onClick={onClose}>New Sale</Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>Close</Button>
          )}
          <Button onClick={handlePrint} leftIcon={<Printer size={16} />} isLoading={isPrinting} disabled={isPrinting}>Print Receipt</Button>
        </>
      }
    >
      <div className={`${styles.receipt} printable-receipt`}>
        <div className={styles.header}>
          {mode === 'checkout' && <CheckCircle size={48} className={styles.successIcon} />}
          {settings.logoUrl && (
            <div className={styles.receiptLogoContainer}>
              <img src={settings.logoUrl} alt="Store Logo" className={styles.receiptLogo} />
            </div>
          )}
          <h2>{settings.storeName || 'PhoneShop'}</h2>
          {settings.receiptHeader && <p style={{ fontSize: '12px', color: '#666', margin: '2px 0' }}>{settings.receiptHeader}</p>}
          <p className={styles.date}>{formatDate(transaction.date)}</p>
          <p className={styles.orderId}>Order: {transaction.id}</p>
        </div>
        
        <div className={styles.divider} />
        
        <div className={styles.meta}>
          {transaction.customerName && (
            <div><span>Customer:</span> <span>{transaction.customerName}</span></div>
          )}
          <div><span>Cashier:</span> <span>{transaction.processedByName || 'System'}</span></div>
        </div>

        <div className={styles.divider} />

        <div className={styles.items}>
          <div className={styles.itemRow}>
            <strong>Item</strong>
            <strong>Price</strong>
          </div>
          {transaction.items.map((item, idx) => {
            const isReturn = Boolean(item.isReturn);
            const unitPrice = item.customReturnPrice ?? item.product.price;
            const lineTotal = unitPrice * item.quantity;
            return (
              <div key={`${item.product.id}-${idx}`} className={styles.itemRow}>
                <div className={styles.itemName}>
                  {isReturn && <span style={{ color: '#b45309', fontWeight: 800 }}>[RETURN] </span>}
                  {item.quantity}x {item.product.name} {item.product.model}
                </div>
                <div style={{ color: isReturn ? '#dc2626' : undefined, fontWeight: isReturn ? 700 : undefined }}>
                  {isReturn ? `-${formatCurrency(lineTotal)}` : formatCurrency(lineTotal)}
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.divider} />

        <div className={styles.totals}>
          {transaction.status === 'refunded' && (
            <div style={{ color: 'var(--color-danger)', fontWeight: 'bold', marginBottom: '8px', textAlign: 'right' }}>
              FULLY REFUNDED
            </div>
          )}
          {transaction.status === 'partially_refunded' && (
            <div style={{ color: 'var(--color-warning)', fontWeight: 'bold', marginBottom: '8px', textAlign: 'right' }}>
              PARTIALLY REFUNDED
            </div>
          )}
          {transaction.exchangeSummary && (
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '6px' }}>
              Exchange: +{formatCurrency(transaction.exchangeSummary.purchasedTotal)} bought · -{formatCurrency(transaction.exchangeSummary.returnedTotal)} returned
            </div>
          )}
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span>{formatCurrency(transaction.subtotal)}</span>
          </div>
          <div className={[styles.totalRow, styles.grandTotal].join(' ')}>
            <span>{transaction.total < 0 ? 'Refund Due' : 'Total'}</span>
            <span>{transaction.total < 0 ? `-${formatCurrency(Math.abs(transaction.total))}` : formatCurrency(transaction.total)}</span>
          </div>
        </div>

        <div className={styles.divider} />
        
        <div className={styles.footer}>
          <p>
            Payment: {transaction.payments.map(p => {
              // Negative cash amount = cash refund returned to customer
              if (p.method === 'cash' && p.amount < 0) {
                return `CASH REFUND: ${formatCurrency(Math.abs(p.amount))}`;
              }
              const mName = p.method === 'store_credit' ? 'STORE CREDIT (AVOIR)' : (p.method === 'debt' ? 'CREDIT TAB (DETTE)' : p.method.toUpperCase());
              return `${mName}: ${formatCurrency(p.amount)}`;
            }).join(' + ')}
          </p>
          <p className={styles.thanks}>{settings.receiptFooter || 'Thank you for your purchase!'}</p>
        </div>
      </div>
    </Modal>
  );
};
