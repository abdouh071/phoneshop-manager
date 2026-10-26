import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { useToast } from '../../components/ui/Toast';
import type { CustomerDebtEntry, PaymentMethod } from '../../types';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { DollarSign, CheckCircle2, AlertCircle } from 'lucide-react';
import styles from '../inventory/ProductForm.module.css';

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  debt: CustomerDebtEntry | null;
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({ isOpen, onClose, debt }) => {
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { recordDebtPayment } = useCustomerStore();
  const toast = useToast();

  useEffect(() => {
    if (isOpen && debt) {
      setAmount(debt.remainingBalance.toString());
      setMethod('cash');
      setDate(new Date().toISOString().slice(0, 10));
      setNote('');
      setError(null);
    }
  }, [isOpen, debt]);

  if (!debt) return null;

  const payAmount = parseFloat(amount) || 0;
  const newRemaining = Math.max(0, debt.remainingBalance - payAmount);
  const isFullPayment = payAmount >= debt.remainingBalance;

  const handleSubmit = async () => {
    if (isNaN(payAmount) || payAmount <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    if (payAmount > debt.remainingBalance) {
      setError(`Payment cannot exceed remaining debt of ${formatCurrency(debt.remainingBalance)}`);
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      await recordDebtPayment(debt.id, {
        amount: payAmount,
        method,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        note: note.trim() || undefined,
      });

      toast.success(
        isFullPayment ? 'Debt Fully Settled! 🎉' : 'Payment Recorded',
        `${formatCurrency(payAmount)} paid against ${debt.productOrService}.`
      );
      onClose();
    } catch (err) {
      toast.error('Payment Failed', 'An error occurred while saving payment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Debt Repayment"
      subtitle={`Payment for ${debt.productOrService} (${debt.customerName})`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting}>
            {isFullPayment ? 'Settle Debt Fully' : 'Record Payment'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            fontSize: '12px',
            fontWeight: 600,
          }}>
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* Current Debt Card */}
        <div style={{
          padding: '12px',
          borderRadius: '10px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
        }}>
          <div>
            <span style={{ color: '#64748b', fontSize: '11.5px', textTransform: 'uppercase', fontWeight: 700 }}>Current Balance Owed</span>
            <p style={{ margin: '2px 0 0', fontWeight: 800, fontSize: '18px', color: '#dc2626' }}>
              {formatPrivateCurrency(debt.remainingBalance)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAmount(debt.remainingBalance.toString())}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              color: '#0f172a',
            }}
          >
            Pay in Full
          </button>
        </div>

        <Input
          label="Payment Amount (DA) *"
          type="number"
          min="1"
          max={debt.remainingBalance}
          value={amount}
          onChange={e => { setAmount(e.target.value); setError(null); }}
          className="privacy-cost-input"
        />

        {/* New remaining balance preview */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderRadius: '8px',
          background: isFullPayment ? '#f0fdf4' : '#fefce8',
          border: isFullPayment ? '1px solid #bbf7d0' : '1px solid #fde68a',
          fontSize: '12.5px',
          fontWeight: 600,
          color: isFullPayment ? '#15803d' : '#854d0e',
        }}>
          <span>Remaining after this payment:</span>
          <span>{isFullPayment ? '✅ 0 DA (Fully Paid)' : formatPrivateCurrency(newRemaining)}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
              Payment Method
            </label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value as PaymentMethod)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                background: '#ffffff',
              }}
            >
              <option value="cash">💵 Cash</option>
              <option value="card">💳 Card</option>
              <option value="other">📱 Mobile / Transfer</option>
            </select>
          </div>

          <Input
            label="Payment Date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <Input
          label="Note (Optional)"
          placeholder="e.g. Paid in cash at shop counter"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
};
