import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { SaleTransaction, CustomerDebtEntry } from '../../types';
import { useSettingsStore } from '../../store/settingsStore';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import styles from './B2BParts.module.css';

interface PartsInvoiceModalProps {
  transaction: SaleTransaction | null;
  debtEntry?: CustomerDebtEntry | null;
  onClose: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const PartsInvoiceModal: React.FC<PartsInvoiceModalProps> = ({ transaction, onClose }) => {
  const settings = useSettingsStore();
  const { customers, getCustomerDebtTotal } = useCustomerStore();
  usePrivacyStore(s => s.isPrivacyActive);
  useToast();
  const [, ] = useState(false);

  if (!transaction) return null;

  const customer = transaction.customerId
    ? customers.find(c => c.id === transaction.customerId)
    : null;

  const currentDebtTotal = customer ? getCustomerDebtTotal(customer.id) : 0;
  const settlement = transaction.accountSettlement;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={!!transaction}
      onClose={onClose}
      title="B2B Commercial Parts Invoice"
      subtitle={`Invoice #${transaction.invoiceNumber || transaction.id.slice(0, 8)}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handlePrint} leftIcon={<Printer size={16} />}>
            Print Invoice
          </Button>
        </>
      }
    >
      <div className={`${styles.invoiceContainer} printable-invoice`}>
        {/* Header */}
        <div className={styles.invoiceHeader}>
          <div className={styles.invoiceLogoGroup}>
            <h2>{settings.storeName || 'PHONE SHOP MANAGER'}</h2>
            <p className={styles.invoiceSub}>Parts Wholesale & Service Hub</p>
            {'phone' in settings && settings.phone && <p className={styles.invoiceSub}>📞 {settings.phone}</p>}
          </div>

          <div className={styles.invoiceMetaCol}>
            <span className={styles.invoiceBadge}>COMMERCIAL INVOICE</span>
            <div className={styles.invoiceNum}>
              #{transaction.invoiceNumber || transaction.id.slice(0, 8)}
            </div>
            <div className={styles.invoiceDate}>{formatDate(transaction.date)}</div>
          </div>
        </div>

        {/* Client Parties Card */}
        <div className={styles.invoiceParties}>
          <div>
            <div className={partyStyle.label}>ISSUED TO (B2B CLIENT):</div>
            <div className={partyStyle.name}>
              {transaction.shopName || transaction.customerName || 'Commercial Client'}
            </div>
            {customer?.name && transaction.shopName && (
              <div className={partyStyle.detail}>Contact: {customer.name}</div>
            )}
            {customer?.phone && <div className={partyStyle.detail}>Phone: {customer.phone}</div>}
            {customer?.address && <div className={partyStyle.detail}>Address: {customer.address}</div>}
            {(customer?.rc || customer?.nif || customer?.nis || customer?.art) && (
              <div style={{ marginTop: '5px', paddingTop: '4px', borderTop: '1px dashed #cbd5e1', fontSize: '11px', color: '#475569', lineHeight: 1.45 }}>
                {customer?.rc && <div>RC: <strong style={{ color: '#0f172a' }}>{customer.rc}</strong></div>}
                {customer?.nif && <div>NIF: <strong style={{ color: '#0f172a' }}>{customer.nif}</strong></div>}
                {customer?.nis && <div>NIS: <strong style={{ color: '#0f172a' }}>{customer.nis}</strong></div>}
                {customer?.art && <div>Art: <strong style={{ color: '#0f172a' }}>{customer.art}</strong></div>}
              </div>
            )}
          </div>

          <div>
            <div className={partyStyle.label}>DISPATCHED BY:</div>
            <div className={partyStyle.name}>{transaction.processedByName || 'Authorized Staff'}</div>
            <div className={partyStyle.detail}>Order Status: Completed</div>
            {settlement?.dueDate && (
              <div className={partyStyle.detail} style={{ color: '#dc2626', fontWeight: 600 }}>
                Payment Due: {new Date(settlement.dueDate).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        {/* Itemized Table */}
        <table className={styles.invoiceTable}>
          <thead>
            <tr>
              <th>Item / Part Description</th>
              <th style={{ textAlign: 'center' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {transaction.items.map(item => (
              <tr key={item.product.id}>
                <td>
                  <strong>{item.product.name} {item.product.model}</strong>
                  {item.product.sku && (
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>
                      SKU: {item.product.sku}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(item.product.price)}</td>
                <td>{formatCurrency(item.product.price * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary Breakdown */}
        <div className={styles.invoiceSummary}>
          <div className={styles.summaryLine}>
            <span>Subtotal:</span>
            <span>{formatCurrency(transaction.subtotal)}</span>
          </div>

          {transaction.discount && (
            <div className={styles.summaryLine}>
              <span>Discount:</span>
              <span style={{ color: '#16a34a' }}>
                - {formatCurrency(
                  transaction.discount.type === 'percent'
                    ? (transaction.subtotal * transaction.discount.value) / 100
                    : transaction.discount.value
                )}
              </span>
            </div>
          )}

          <div className={styles.summaryTotalLine}>
            <span>Invoice Total:</span>
            <span>{formatCurrency(transaction.total)}</span>
          </div>

          {settlement ? (
            <>
              <div className={styles.summaryPaidLine}>
                <span>Paid Now ({transaction.payments[0]?.method?.toUpperCase() || 'CASH'}):</span>
                <span>{formatPrivateCurrency(settlement.paidAmount)}</span>
              </div>

              <div className={styles.summaryChargedLine}>
                <span>Charged to Account:</span>
                <span>+ {formatPrivateCurrency(settlement.chargedAmount)}</span>
              </div>
            </>
          ) : (
            <div className={styles.summaryPaidLine}>
              <span>Paid in Full:</span>
              <span>{formatCurrency(transaction.total)}</span>
            </div>
          )}

          {customer && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '6px',
                borderTop: '1px dashed #cbd5e1',
                fontSize: '12px',
                fontWeight: 700,
                color: currentDebtTotal > 0 ? '#dc2626' : '#16a34a',
              }}
            >
              <span>Total Account Balance:</span>
              <span>{formatPrivateCurrency(currentDebtTotal)}</span>
            </div>
          )}
        </div>

        {/* Footer Notes */}
        <div className={styles.invoiceTerms}>
          <p style={{ margin: 0 }}>
            {settlement?.notes || 'Parts tested upon dispatch. Thank you for your partnership!'}
          </p>
        </div>
      </div>
    </Modal>
  );
};

const partyStyle = {
  label: styles.partyLabel,
  name: styles.partyName,
  detail: styles.partyDetail,
};
