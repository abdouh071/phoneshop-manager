import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import styles from '../inventory/ProductForm.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface AddDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
}

export const AddDebtModal: React.FC<AddDebtModalProps> = ({ isOpen, onClose, customer }) => {
  const { t } = useTranslation();
  usePrivacyStore(s => s.isPrivacyActive);
  const [productOrService, setProductOrService] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [allowOverride, setAllowOverride] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { addDebt, getCustomerDebtTotal } = useCustomerStore();
  const user = useAuthStore(state => state.user);
  const toast = useToast();

  useEffect(() => {
    if (isOpen) {
      setProductOrService('');
      setTotalAmount('');
      setAmountPaid('');
      setDate(new Date().toISOString().slice(0, 10));
      setDueDate('');
      setNotes('');
      setError(null);
      setAllowOverride(false);
    }
  }, [isOpen]);

  if (!customer) return null;

  const totalNum = parseFloat(totalAmount) || 0;
  const paidNum = parseFloat(amountPaid) || 0;
  const remainingNum = Math.max(0, totalNum - paidNum);

  const currentDebt = customer ? getCustomerDebtTotal(customer.id) : 0;
  const projectedBalance = currentDebt + remainingNum;
  const isLimitExceeded = Boolean(customer?.creditLimit && projectedBalance > customer.creditLimit);

  const handleSubmit = async () => {
    if (!productOrService.trim()) {
      setError(t('customers.specifyProductError', 'Please specify the product or service taken'));
      return;
    }
    if (isNaN(totalNum) || totalNum <= 0) {
      setError(t('customers.enterValidTotalAmount', 'Please enter a valid total amount'));
      return;
    }
    if (isLimitExceeded && !allowOverride && user?.role !== 'admin') {
      setError(t('customers.creditLimitExceededError', { limit: formatCurrency(customer.creditLimit!), defaultValue: `Cannot exceed customer credit limit of ${formatCurrency(customer.creditLimit!)}. Admin approval required.` }));
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      await addDebt({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        productOrService: productOrService.trim(),
        totalAmount: totalNum,
        amountPaid: paidNum,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
        allowCreditLimitOverride: allowOverride || user?.role === 'admin',
      });

      toast.success(
        t('customers.debtBalance', 'Debt Recorded'),
        t('customers.debtLoggedSuccess', { amount: formatCurrency(remainingNum), name: customer.name, defaultValue: `Logged ${formatCurrency(remainingNum)} debt for ${customer.name}.` })
      );
      onClose();
    } catch (err: unknown) {
      const msg = errorMessage(err) || 'An error occurred while saving.';
      setError(msg);
      toast.error(t('customers.failedToRecordDebt', 'Failed to Record Debt'), msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('customers.addNewDebtItem', 'Add New Debt / Credit Item')}
      subtitle={t('customers.recordUnpaidItemFor', { name: customer.name, defaultValue: `Record unpaid item for ${customer.name}` })}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting}>{t('customers.addDebt', 'Record Debt')}</Button>
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

        <Input
          label={t('customers.productServiceTaken', 'Product / Service Taken *')}
          placeholder={t('customers.productServicePlaceholder', 'e.g. Samsung A54 128GB, Screen replacement, Case')}
          value={productOrService}
          onChange={e => { setProductOrService(e.target.value); setError(null); }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Input
            label={t('customers.totalValuePrice', 'Total Value / Price *')}
            type="number"
            min="0"
            placeholder="e.g. 24000"
            value={totalAmount}
            onChange={e => { setTotalAmount(e.target.value); setError(null); }}
            className="privacy-cost-input"
          />
          <Input
            label={t('customers.amountPaidUpfront', 'Amount Paid Upfront')}
            type="number"
            min="0"
            placeholder={t('customers.zeroIfNothing', '0 if nothing')}
            value={amountPaid}
            onChange={e => setAmountPaid(e.target.value)}
            className="privacy-cost-input"
          />
        </div>

        {/* Balance callout */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderRadius: '10px',
          background: '#fefce8',
          border: '1px solid #fde68a',
          fontSize: '13px',
          fontWeight: 600,
        }}>
          <span style={{ color: '#78350f' }}>{t('customers.remainingBalanceOwed', 'Remaining Balance Owed:')}</span>
          <span style={{ fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>
            {formatPrivateCurrency(remainingNum)}
          </span>
        </div>

        {/* Credit Limit Callout & Warning */}
        {customer.creditLimit ? (
          <div style={{
            padding: '10px 14px',
            borderRadius: '10px',
            background: isLimitExceeded ? '#fef2f2' : '#f0fdf4',
            border: isLimitExceeded ? '1px solid #fecaca' : '1px solid #bbf7d0',
            fontSize: '12.5px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: isLimitExceeded ? '#991b1b' : '#166534', fontWeight: 700 }}>
                {t('customers.creditLimit', { limit: formatPrivateCurrency(customer.creditLimit), defaultValue: `Credit Limit: ${formatPrivateCurrency(customer.creditLimit)}` })}
              </span>
              <span style={{ color: isLimitExceeded ? '#dc2626' : '#15803d', fontWeight: 600 }}>
                {t('customers.projectedBalance', { amount: formatPrivateCurrency(projectedBalance), defaultValue: `Projected: ${formatPrivateCurrency(projectedBalance)}` })}
              </span>
            </div>

            {isLimitExceeded && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', color: '#991b1b', marginTop: '2px' }}>
                <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#dc2626' }} />
                <div style={{ flex: 1, fontSize: '12px', lineHeight: 1.4 }}>
                  {t('customers.limitExceededWarning', { name: customer.name, amount: formatPrivateCurrency(projectedBalance - customer.creditLimit), defaultValue: `This item will cause ${customer.name} to exceed their authorized limit by ${formatPrivateCurrency(projectedBalance - customer.creditLimit)}.` })}
                  {user?.role === 'admin' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', cursor: 'pointer', fontWeight: 700, color: '#b91c1c' }}>
                      <input
                        type="checkbox"
                        checked={allowOverride}
                        onChange={e => setAllowOverride(e.target.checked)}
                      />
                      <span>{t('customers.approveAdminOverride', 'Approve admin override for this transaction')}</span>
                    </label>
                  ) : (
                    <div style={{ color: '#b91c1c', fontWeight: 700, marginTop: '4px' }}>
                      {t('customers.adminOverrideRequired', 'Admin override required to proceed.')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Input
            label={t('customers.dateTaken', 'Date Taken')}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          <Input
            label={t('customers.paymentDueDateOptional', 'Payment Due Date (Optional)')}
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
        </div>

        <Textarea
          label={t('customers.notesTermsOptional', 'Notes / Terms (Optional)')}
          placeholder={t('customers.notesTermsPlaceholder', 'e.g. Promised to bring cash on Saturday')}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
        />
      </div>
    </Modal>
  );
};
