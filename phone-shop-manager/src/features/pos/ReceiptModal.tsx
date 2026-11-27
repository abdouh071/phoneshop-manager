import React, { useMemo, useState } from 'react';
import { Printer, Share2, MessageCircle } from 'lucide-react';
import { normalizePhoneDigits, formatWhatsAppUrl } from '../../utils/phoneUtils';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { SaleTransaction } from '../../types';
import { useSettingsStore } from '../../store/settingsStore';
import { useCustomerStore } from '../../store/customerStore';
import { printReceiptDirect } from '../../utils/printWindow';
import { useToast } from '../../components/ui/Toast';
import { FrenchThermalReceipt } from '../../components/receipts/FrenchThermalReceipt';
import {
  buildUnifiedReceiptFromSale,
  formatReceiptAmount,
} from '../../utils/frenchReceiptFormat';
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
  const customers = useCustomerStore(s => s.customers);
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  const customerLookup = useMemo(() => {
    if (!transaction?.customerId) return null;
    return customers.find(c => c.id === transaction.customerId) ?? null;
  }, [customers, transaction?.customerId]);

  const unifiedReceipt = useMemo(() => {
    if (!transaction) return null;
    return buildUnifiedReceiptFromSale(
      transaction,
      { storeName: settings.storeName, storePhone: settings.storePhone },
      customerLookup
    );
  }, [transaction, settings.storeName, settings.storePhone, customerLookup]);

  if (!transaction || !unifiedReceipt) return null;

  const buildReceiptText = () => {
    const store = settings.storeName || 'PhoneShop Pro';
    const curr = settings.currency || 'USD';
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
      `Ticket : ${unifiedReceipt.ticketCode}`,
      `Date: ${formatDate(transaction.date)}`,
      `Client :${unifiedReceipt.clientName}`,
      `────────────────`,
      itemsText,
      `────────────────`,
      `TTC A PAYER: *${formatReceiptAmount(unifiedReceipt.netPayable)}*`,
      `Anc. solde: ${formatReceiptAmount(unifiedReceipt.previousBalance)}`,
      `Versement : ${formatReceiptAmount(unifiedReceipt.paymentAmount)}`,
      `Nouv. solde: *${formatReceiptAmount(unifiedReceipt.newBalance)}*`,
      transaction.paymentMethod ? `Payment: ${methodLabel(transaction.paymentMethod)}` : null,
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
      const result = await printReceiptDirect(
        transaction,
        settings.storeName,
        settings.currency,
        {
          storePhone: settings.storePhone,
          receiptData: unifiedReceipt,
        }
      );
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
      <FrenchThermalReceipt data={unifiedReceipt} />
    </Modal>
  );
};
