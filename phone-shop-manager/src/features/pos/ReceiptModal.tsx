import React, { useState } from 'react';
import { Printer, CheckCircle2, Share2, MessageCircle } from 'lucide-react';
import { normalizePhoneDigits, formatWhatsAppUrl } from '../../utils/phoneUtils';
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
    hour: '2-digit', minute: '2-digit',
  });

const methodLabel = (m: string) => {
  switch (m) {
    case 'cash': return 'Cash';
    case 'card': return 'Card';
    case 'mobile': return 'Mobile';
    case 'transfer': return 'Transfer';
    case 'debt': return 'Credit Tab';
    case 'store_credit': return 'Store Credit';
    default: return m.charAt(0).toUpperCase() + m.slice(1);
  }
};

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ transaction, onClose, mode = 'checkout' }) => {
  const settings = useSettingsStore();
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  if (!transaction) return null;

  const discount = transaction.discount;
  let discountAmount = 0;
  if (discount && Number(discount.value) > 0) {
    const base = transaction.exchangeSummary?.purchasedTotal ?? transaction.subtotal;
    discountAmount =
      discount.type === 'percent'
        ? (base * Number(discount.value)) / 100
        : Number(discount.value);
  } else if (!transaction.exchangeSummary && transaction.subtotal > transaction.total && transaction.total >= 0) {
    discountAmount = transaction.subtotal - transaction.total;
  }

  const buildReceiptText = () => {
    const store = settings.storeName || 'PhoneShop Pro';
    const curr = settings.currency || 'USD';
    /**
     * One line of the share text. A line the shop took back is written with its minus
     * and its money off, because this text is what the customer receives when there is
     * no printer at the counter — and a corrected invoice that lists only what was sold
     * would hand him a receipt that does not foot to its own total.
     */
    const itemLine = (i: (typeof transaction.items)[number]) => {
      const units = Math.trunc(Number(i.quantity) || 0);
      const unit = i.isReturn
        ? (i.customReturnPrice ?? i.unitPrice ?? i.price ?? i.product?.price ?? 0)
        : (i.unitPrice ?? i.price ?? i.product?.price ?? 0);
      const name = i.product?.name
        ? `${i.product.name} ${i.product.model || ''}`.trim()
        : i.productName || 'Item';
      const money = formatCurrency(Math.abs(unit * units), !!curr);
      return `• ${i.isReturn ? '−' : ''}${units}× ${name} — ${i.isReturn ? '−' : ''}${money}`;
    };
    const itemsText = transaction.items.map(itemLine).join('\n');
    return [
      `🧾 *${store}*`,
      `Receipt #${transaction.id.slice(-6)}`,
      `Date: ${formatDate(transaction.date)}`,
      `Customer: ${transaction.customerName || 'Walk-in'}`,
      `────────────────`,
      itemsText,
      `────────────────`,
      `Total: *${formatCurrency(transaction.total, !!curr)}*`,
      `Payment: ${methodLabel(transaction.paymentMethod ?? '')}`,
      transaction.remainingBalance ? `Balance Due: ${formatCurrency(transaction.remainingBalance, !!curr)}` : null,
      settings.receiptFooter ? `\n${settings.receiptFooter}` : '\nThank you for choosing us!',
    ].filter(Boolean).join('\n');
  };

  const handleWhatsApp = () => {
    const text = buildReceiptText();
    const url = formatWhatsAppUrl(transaction.customerPhone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleShare = async () => {
    const text = buildReceiptText();
    const title = `${settings.storeName || 'PhoneShop'} Receipt #${transaction.id.slice(-6)}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text });
      } catch (err: unknown) {
        if (!(err !== null && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'AbortError')) {
          console.warn('Share error:', err);
        }
      }
    } else {
      const phone = transaction.customerPhone ? normalizePhoneDigits(transaction.customerPhone) : '';
      window.location.href = `sms:${phone}?body=${encodeURIComponent(text)}`;
    }
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const result = await printReceiptDirect(transaction, settings.storeName, settings.currency);
      if (result.method === 'direct') {
        // A direct path carrying an error was refused by the server (for example,
        // the printer is offline). The receipt never printed — keep the modal
        // open for a retry instead of sending the customer away with nothing.
        if (result.error) {
          toast.error('Print Failed', result.error);
          return;
        }
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
      title={mode === 'checkout' ? 'Sale Complete' : 'Receipt Details'}
      size="sm"
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
          {mode === 'checkout' ? (
            <Button variant="ghost" onClick={onClose}>New Sale</Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>Close</Button>
          )}
          <Button
            variant="outline"
            onClick={handleWhatsApp}
            leftIcon={<MessageCircle size={15} style={{ color: '#25D366' }} />}
            title="Share receipt via WhatsApp"
          >
            WhatsApp
          </Button>
          <Button
            variant="outline"
            onClick={handleShare}
            leftIcon={<Share2 size={15} />}
            title="Share receipt via SMS or apps"
          >
            Share
          </Button>
          <Button onClick={handlePrint} leftIcon={<Printer size={16} />} isLoading={isPrinting} disabled={isPrinting}>
            Print Receipt
          </Button>
        </div>
      }
    >
      <div className={`${styles.receipt} printable-receipt`}>

        {/* ── Header ── */}
        <div className={styles.header}>
          {mode === 'checkout' && <CheckCircle2 size={40} className={styles.successIcon} />}
          {settings.logoUrl && (
            <img src={settings.logoUrl} alt="Store Logo" className={styles.logo} />
          )}
          <h2 className={styles.storeName}>{settings.storeName || 'PhoneShop'}</h2>
          {settings.receiptHeader && (
            <p className={styles.headerMsg}>{settings.receiptHeader}</p>
          )}
          <p className={styles.date}>{formatDate(transaction.date)}</p>
          <p className={styles.orderId}>#{transaction.id}</p>
        </div>

        <div className={styles.rule} />

        {/* ── Meta ── */}
        {(transaction.customerName || transaction.processedByName) && (
          <>
            <div className={styles.meta}>
              {transaction.customerName && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Customer</span>
                  <span className={styles.metaValue}>{transaction.customerName}</span>
                </div>
              )}
              {transaction.processedByName && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Cashier</span>
                  <span className={styles.metaValue}>{transaction.processedByName}</span>
                </div>
              )}
            </div>
            <div className={styles.rule} />
          </>
        )}

        {/* ── Status badges ── */}
        {transaction.status === 'refunded' && (
          <div className={styles.statusBadge} data-variant="danger">
            FULLY REFUNDED
          </div>
        )}
        {transaction.status === 'partially_refunded' && (
          <div className={styles.statusBadge} data-variant="warning">
            PARTIALLY REFUNDED
          </div>
        )}

        {/* ── Items ── */}
        <div className={styles.items}>
          <div className={styles.itemHeader}>
            <span>Item</span>
            <span>Total</span>
          </div>
          {transaction.items.map((item, idx) => {
            const isReturn = Boolean(item.isReturn);
            const unitPrice = item.customReturnPrice ?? item.product.price;
            const lineTotal = unitPrice * item.quantity;
            return (
              <div key={`${item.product.id}-${idx}`} className={styles.itemRow}>
                <div className={styles.itemLeft}>
                  <span className={styles.itemName}>
                    {isReturn && <span className={styles.returnTag}>RETURN</span>}
                    {item.product.name} {item.product.model}
                  </span>
                  <span className={styles.itemMeta}>
                    <span className={styles.itemQty}>{item.quantity}</span>
                    {' × '}
                    {formatCurrency(unitPrice)}
                  </span>
                </div>
                <span className={isReturn ? styles.negativeAmt : undefined}>
                  {isReturn ? '−' : ''}{formatCurrency(Math.abs(lineTotal))}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.rule} />

        {/* ── Totals ── */}
        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span>{formatCurrency(transaction.subtotal)}</span>
          </div>

          {/* Discount row — always show when discount exists */}
          {discountAmount > 0 && (
            <div className={`${styles.totalRow} ${styles.discountRow}`}>
              <span>
                Discount
                {discount?.type === 'percent' && (
                  <span className={styles.discountBadge}>{discount.value}%</span>
                )}
              </span>
              <span>−{formatCurrency(discountAmount)}</span>
            </div>
          )}

          {/* Exchange summary */}
          {transaction.exchangeSummary && (
            <div className={`${styles.totalRow} ${styles.exchangeRow}`}>
              <span>Exchange adj.</span>
              <span>
                {formatCurrency(
                  transaction.exchangeSummary.purchasedTotal -
                    transaction.exchangeSummary.returnedTotal,
                )}
              </span>
            </div>
          )}

          <div className={styles.grandTotalRow}>
            <span>{transaction.total < 0 ? 'Refund Due' : 'Total'}</span>
            <span>
              {transaction.total < 0
                ? `−${formatCurrency(Math.abs(transaction.total))}`
                : formatCurrency(transaction.total)}
            </span>
          </div>
        </div>

        <div className={styles.rule} />

        {/* ── Payment methods ── */}
        <div className={styles.paymentSection}>
          <p className={styles.paymentLabel}>Payment</p>
          <div className={styles.payment}>
            {transaction.payments.map((p, idx) => (
              <div key={idx} className={styles.paymentRow}>
                <div className={styles.paymentMethod}>
                  <span className={styles.paymentDot} />
                  <span>{p.method === 'cash' && p.amount < 0 ? 'Cash Refund' : methodLabel(p.method)}</span>
                </div>
                <span className={p.amount < 0 ? styles.negativeAmt : undefined}>
                  {p.amount < 0
                    ? `−${formatCurrency(Math.abs(p.amount))}`
                    : formatCurrency(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className={styles.ruleDashed} />
        <p className={styles.footerMsg}>
          {settings.receiptFooter || 'Thank you for your purchase!'}
        </p>
      </div>
    </Modal>
  );
};
