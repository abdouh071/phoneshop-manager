import React, { useState, useMemo, useRef } from 'react';
import { Store, CreditCard, CheckCircle2, AlertTriangle, Clock, Percent } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import type { Customer, PaymentMethod, SaleTransaction, CustomerDebtEntry } from '../../types';
import styles from './B2BParts.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface B2BPartsCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer;
  onSuccess: (result: { transaction: SaleTransaction; debtEntry?: CustomerDebtEntry; invoiceNumber: string }) => void;
}

type SettlementMode = 'paid_full' | 'charged_to_account' | 'partial_payment';

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: '💵 Cash' },
  { value: 'card', label: '💳 Card' },
  { value: 'mobile', label: '📱 Mobile Pay' },
];

export const B2BPartsCheckoutModal: React.FC<B2BPartsCheckoutModalProps> = ({
  isOpen,
  onClose,
  customer,
  onSuccess,
}) => {
  usePrivacyStore(s => s.isPrivacyActive);
  const { getTotal, getSubtotal, getDiscountAmount, items, checkoutB2B } = usePartsCartStore();
  const { getCustomerDebtTotal } = useCustomerStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const total = getTotal();
  getSubtotal();
  getDiscountAmount();

  // Current balance of the customer
  const currentDebt = getCustomerDebtTotal(customer.id) || customer.totalDebt || 0;
  const creditLimit = customer.creditLimit || 0;

  // Form State
  const [mode, setMode] = useState<SettlementMode>('charged_to_account');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('cash');
  const [partialPaidInput, setPartialPaidInput] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Problem 1 fix: Admin unlock and override state for exceeding credit limit
  const [creditLimitOverrideApproved, setCreditLimitOverrideApproved] = useState(false);
  const [showCreditLimitUnlock, setShowCreditLimitUnlock] = useState(false);
  // Synchronous ref guard prevents duplicate B2B submissions on rapid clicks
  const isSubmittingRef = useRef(false);

  // Compute actual paid & charged amounts based on selected mode
  const { paidAmount, chargedAmount } = useMemo(() => {
    if (mode === 'paid_full') {
      return { paidAmount: total, chargedAmount: 0 };
    }
    if (mode === 'charged_to_account') {
      return { paidAmount: 0, chargedAmount: total };
    }
    // Partial payment mode
    const rawPaid = parseFloat(partialPaidInput) || 0;
    const clampedPaid = Math.max(0, Math.min(rawPaid, total));
    const rem = Math.max(0, total - clampedPaid);
    return { paidAmount: clampedPaid, chargedAmount: rem };
  }, [mode, partialPaidInput, total]);

  const newProjectedDebt = currentDebt + chargedAmount;
  const isOverLimit = creditLimit > 0 && newProjectedDebt > creditLimit;

  // Quick Due Date Helpers
  const setQuickDueDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setDueDate(d.toISOString().slice(0, 10));
  };

  const setEndOfMonthDueDate = () => {
    const d = new Date();
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setDueDate(lastDay.toISOString().slice(0, 10));
  };

  const executeCheckout = async () => {
    if (items.length === 0 || isSubmitting || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const result = await checkoutB2B({
        customer,
        settlementType: mode,
        paidAmount,
        paymentMethod: selectedMethod,
        chargedAmount,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
        allowCreditLimitOverride: creditLimitOverrideApproved || isAdmin,
      });

      if (result) {
        toast.success(
          'B2B Sale Processed',
          `Invoice #${result.invoiceNumber} recorded for ${customer.shopName || customer.name}.`
        );
        onSuccess(result);
        onClose();
      }
    } catch (err: unknown) {
      toast.error('Checkout Failed', errorMessage(err) || 'Could not complete B2B checkout');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCheckout = () => {
    // Problem 1 fix: Credit limit check before checkout
    if (isOverLimit && !creditLimitOverrideApproved && !isAdmin) {
      setShowCreditLimitUnlock(true);
      return;
    }
    executeCheckout();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="B2B Account Settlement & Dispatch"
      subtitle={`Issue commercial parts order to ${customer.shopName || customer.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleCheckout}
            isLoading={isSubmitting}
            disabled={isSubmitting || items.length === 0}
            leftIcon={<CheckCircle2 size={16} />}
          >
            Confirm Dispatch & Invoice ({formatCurrency(total)})
          </Button>
        </>
      }
    >
      <div className={styles.container}>
        {/* Account Header Banner */}
        <div className={styles.accountCard}>
          <div className={styles.accountCardHeader}>
            <div className={styles.accountTitleGroup}>
              <div className={styles.shopIconBadge}>
                <Store size={20} />
              </div>
              <div className={styles.shopInfo}>
                <span className={styles.shopName}>
                  {customer.shopName || customer.name}
                </span>
                <span className={styles.ownerName}>
                  Contact: {customer.name} · 📞 {customer.phone}
                </span>
              </div>
            </div>

            <div className={styles.balancePill}>
              <span className={styles.balanceLabel}>Current Debt</span>
              <span className={currentDebt > 0 ? styles.balanceValue : styles.balanceValueZero}>
                {formatPrivateCurrency(currentDebt)}
              </span>
            </div>
          </div>

          {creditLimit > 0 && (
            <div className={styles.creditLimitRow}>
              <span>
                Authorized Credit Limit: <strong>{formatPrivateCurrency(creditLimit)}</strong>
              </span>
              <span>
                Available Credit: <strong>{formatPrivateCurrency(Math.max(0, creditLimit - currentDebt))}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Settlement Mode Segmented Selector */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '8px', display: 'block' }}>
            Payment & Account Terms
          </label>
          <div className={styles.settlementModes}>
            <button
              type="button"
              className={[
                styles.settlementBtn,
                mode === 'charged_to_account' && styles.settlementBtnActiveAmber,
              ].filter(Boolean).join(' ')}
              onClick={() => setMode('charged_to_account')}
            >
              <Clock size={16} />
              <span>Charge to Account</span>
              <small style={{ fontSize: '10.5px', opacity: 0.8 }}>Pay Later (100% Tab)</small>
            </button>

            <button
              type="button"
              className={[
                styles.settlementBtn,
                mode === 'partial_payment' && styles.settlementBtnActiveBlue,
              ].filter(Boolean).join(' ')}
              onClick={() => {
                setMode('partial_payment');
                if (!partialPaidInput) setPartialPaidInput(String(Math.round(total / 2)));
              }}
            >
              <Percent size={16} />
              <span>Partial / Split</span>
              <small style={{ fontSize: '10.5px', opacity: 0.8 }}>Pay Part Now + Tab</small>
            </button>

            <button
              type="button"
              className={[
                styles.settlementBtn,
                mode === 'paid_full' && styles.settlementBtnActiveGreen,
              ].filter(Boolean).join(' ')}
              onClick={() => setMode('paid_full')}
            >
              <CreditCard size={16} />
              <span>Pay Full Now</span>
              <small style={{ fontSize: '10.5px', opacity: 0.8 }}>Immediate 100% Cash/Card</small>
            </button>
          </div>
        </div>

        {/* Dynamic Mode Fields */}
        {mode === 'paid_full' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
              Full Payment Method ({formatCurrency(total)})
            </label>
            <div className={styles.methodGrid}>
              {paymentMethods.map(pm => (
                <button
                  key={pm.value}
                  type="button"
                  className={[
                    styles.methodBtn,
                    selectedMethod === pm.value && styles.methodBtnActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedMethod(pm.value)}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'partial_payment' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' }}>
              <div>
                <Input
                  label="Upfront Cash/Card Amount"
                  type="number"
                  min="0"
                  max={total}
                  placeholder="e.g. 5000"
                  value={partialPaidInput}
                  onChange={e => setPartialPaidInput(e.target.value)}
                />
                <div className={styles.quickChips}>
                  <button type="button" className={styles.chip} onClick={() => setPartialPaidInput(String(Math.round(total * 0.25)))}>
                    25% ({formatCurrency(total * 0.25)})
                  </button>
                  <button type="button" className={styles.chip} onClick={() => setPartialPaidInput(String(Math.round(total * 0.5)))}>
                    50% ({formatCurrency(total * 0.5)})
                  </button>
                  <button type="button" className={styles.chip} onClick={() => setPartialPaidInput(String(Math.round(total * 0.75)))}>
                    75% ({formatCurrency(total * 0.75)})
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
                  Upfront Method
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {paymentMethods.map(pm => (
                    <button
                      key={pm.value}
                      type="button"
                      className={[
                        styles.methodBtn,
                        selectedMethod === pm.value && styles.methodBtnActive,
                      ].filter(Boolean).join(' ')}
                      onClick={() => setSelectedMethod(pm.value)}
                      style={{ padding: '6px 8px', fontSize: '12px' }}
                    >
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: 600 }}>
              <span>Remaining Added to Credit Ledger:</span>
              <span style={{ color: '#dc2626', fontWeight: 800 }}>{formatCurrency(chargedAmount)}</span>
            </div>
          </div>
        )}

        {/* Due Date & Terms (Only when chargedAmount > 0) */}
        {chargedAmount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                Payment Due Date (Optional)
              </label>
              <div className={styles.quickChips}>
                <button type="button" className={styles.chip} onClick={() => setQuickDueDate(7)}>
                  Net 7 (+7d)
                </button>
                <button type="button" className={styles.chip} onClick={() => setQuickDueDate(15)}>
                  Net 15 (+15d)
                </button>
                <button type="button" className={styles.chip} onClick={() => setQuickDueDate(30)}>
                  Net 30 (+30d)
                </button>
                <button type="button" className={styles.chip} onClick={setEndOfMonthDueDate}>
                  End of Month
                </button>
              </div>
            </div>

            <Input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>
        )}

        {/* Notes */}
        <Textarea
          label="Internal Invoice Note / Terms (Optional)"
          placeholder="e.g. Paid part in shop, remaining agreed to be settled after screens tested"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
        />

        {/* Balance Impact Preview */}
        <div className={styles.impactBox}>
          <div className={styles.impactRow}>
            <span>Order Total ({items.length} items):</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <div className={styles.impactRow}>
            <span>Paid Immediately ({selectedMethod.toUpperCase()}):</span>
            <strong style={{ color: '#16a34a' }}>- {formatPrivateCurrency(paidAmount)}</strong>
          </div>
          <div className={styles.impactRow}>
            <span>Amount Posted to Account Ledger:</span>
            <strong style={{ color: chargedAmount > 0 ? '#dc2626' : '#16a34a' }}>
              + {formatPrivateCurrency(chargedAmount)}
            </strong>
          </div>
          <div className={styles.impactRowTotal}>
            <span>Shop's New Total Debt Balance:</span>
            <span style={{ fontSize: '15px', color: newProjectedDebt > 0 ? '#dc2626' : '#16a34a' }}>
              {formatPrivateCurrency(newProjectedDebt)}
            </span>
          </div>
        </div>

        {/* Limit Warning */}
        {isOverLimit && (
          <div className={styles.limitWarning} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} />
              <span>
                <strong>Credit Warning:</strong> This transaction increases {customer.shopName || customer.name}'s balance to {formatPrivateCurrency(newProjectedDebt)}, exceeding their authorized credit limit of {formatPrivateCurrency(creditLimit)}.
              </span>
            </div>
            {creditLimitOverrideApproved ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
                <CheckCircle2 size={16} />
                <span>Admin override authorized for this transaction.</span>
              </div>
            ) : !isAdmin && (
              <div style={{ marginTop: '4px' }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowCreditLimitUnlock(true)}
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                >
                  Authorize Admin Override
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <AdminUnlockModal
        isOpen={showCreditLimitUnlock}
        onClose={() => setShowCreditLimitUnlock(false)}
        onSuccess={() => {
          setCreditLimitOverrideApproved(true);
          setShowCreditLimitUnlock(false);
        }}
        actionName={`Credit Limit Override for ${customer.shopName || customer.name} (${formatCurrency(newProjectedDebt)} / limit ${formatCurrency(creditLimit)})`}
      />
    </Modal>
  );
};
