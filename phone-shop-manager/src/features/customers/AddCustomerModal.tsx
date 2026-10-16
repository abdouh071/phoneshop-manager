import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { BookOpen, AlertCircle, Calendar, Package, Store, User } from 'lucide-react';
import styles from '../inventory/ProductForm.module.css';

interface AddCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerToEdit?: Customer | null;
  defaultAccountType?: 'retail' | 'shop_repairer';
  lockedAccountType?: 'retail' | 'shop_repairer';
}

type FormData = {
  name: string;
  phone: string;
  email: string;
  accountType: 'retail' | 'shop_repairer';
  shopName: string;
  creditLimit: string;
  notes: string;
};

const INITIAL: FormData = {
  name: '',
  phone: '',
  email: '',
  accountType: 'retail',
  shopName: '',
  creditLimit: '',
  notes: '',
};

export const AddCustomerModal: React.FC<AddCustomerModalProps> = ({
  isOpen,
  onClose,
  customerToEdit,
  defaultAccountType,
  lockedAccountType,
}) => {
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Opening Debt State (only when adding a new customer)
  const [hasOpeningDebt, setHasOpeningDebt] = useState(false);
  const [debtProduct, setDebtProduct] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtPaid, setDebtPaid] = useState('');
  const [debtDate, setDebtDate] = useState(new Date().toISOString().slice(0, 10));
  const [debtDueDate, setDebtDueDate] = useState('');
  const [debtNotes, setDebtNotes] = useState('');
  const [debtError, setDebtError] = useState<string | null>(null);

  const { addCustomer, addCustomerWithDebt, updateCustomer, customers } = useCustomerStore();
  const toast = useToast();

  // Problem 9 fix: Duplicate phone detection state
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);

  useEffect(() => {
    if (customerToEdit) {
      setForm({
        name: customerToEdit.name,
        phone: customerToEdit.phone,
        email: customerToEdit.email || '',
        accountType: (customerToEdit.accountType === 'b2b' || customerToEdit.accountType === 'shop_repairer' || customerToEdit.shopName) ? 'shop_repairer' : 'retail',
        shopName: customerToEdit.shopName || '',
        creditLimit: customerToEdit.creditLimit ? String(customerToEdit.creditLimit) : '',
        notes: customerToEdit.notes || '',
      });
      setHasOpeningDebt(false);
    } else {
      const targetAccountType = lockedAccountType || defaultAccountType || 'retail';
      setForm({
        ...INITIAL,
        accountType: targetAccountType,
      });
      setHasOpeningDebt(false);
      setDebtProduct('');
      setDebtAmount('');
      setDebtPaid('');
      setDebtDate(new Date().toISOString().slice(0, 10));
      setDebtDueDate('');
      setDebtNotes('');
      setDebtError(null);
    }
  }, [customerToEdit, isOpen, defaultAccountType, lockedAccountType]);

  const set = (key: keyof FormData, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const validate = (): boolean => {
    const errs: Partial<FormData> = {};
    if (!form.name.trim()) errs.name = 'Required';
    
    if (form.accountType === 'shop_repairer' && !form.shopName.trim()) {
      errs.shopName = 'Please specify the store / business name';
    }

    // Phone: at least 7 digits
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (!form.phone.trim()) {
      errs.phone = 'Required';
    } else if (phoneDigits.length < 7) {
      errs.phone = 'Enter a valid phone number (at least 7 digits)';
    }
    
    // Email: basic format if provided
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errs.email = 'Enter a valid email address';
    }
    setErrors(errs);

    if (hasOpeningDebt && !customerToEdit) {
      const amt = parseFloat(debtAmount);
      if (!debtProduct.trim()) {
        setDebtError('Please specify the product or service taken');
        return false;
      }
      if (isNaN(amt) || amt <= 0) {
        setDebtError('Please enter a valid total amount for the debt');
        return false;
      }
      setDebtError(null);
    }

    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    // Problem 9 fix: Check for duplicate phone on new customer creation
    if (!customerToEdit && !skipDuplicateCheck) {
      const normalizeDigits = (p: string) => p.replace(/\D/g, '');
      const inputDigits = normalizeDigits(form.phone.trim());
      if (inputDigits.length >= 7) {
        const existing = customers.find(c => {
          const cDigits = normalizeDigits(c.phone || '');
          return cDigits.length >= 7 && cDigits === inputDigits;
        });
        if (existing) {
          setDuplicateWarning(
            `A customer with this phone number already exists: "${existing.name}" (${existing.phone}). Click "Register" again to create anyway.`
          );
          setSkipDuplicateCheck(true);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setDuplicateWarning(null);
    setSkipDuplicateCheck(false);
    
    try {
      const limitNum = parseFloat(form.creditLimit);
      const customerPayload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        accountType: form.accountType,
        shopName: form.accountType === 'shop_repairer' ? form.shopName.trim() : undefined,
        creditLimit: !isNaN(limitNum) && limitNum > 0 ? limitNum : undefined,
        notes: form.notes.trim() || undefined,
      };

      if (customerToEdit) {
        await updateCustomer(customerToEdit.id, customerPayload);
        toast.success('Customer Updated', `${form.name}'s details have been saved.`);
      } else if (hasOpeningDebt && parseFloat(debtAmount) > 0) {
        const total = parseFloat(debtAmount);
        const paid = parseFloat(debtPaid) || 0;
        await addCustomerWithDebt(customerPayload, {
          productOrService: debtProduct.trim(),
          totalAmount: total,
          amountPaid: paid,
          date: debtDate,
          dueDate: debtDueDate || undefined,
          notes: debtNotes.trim() || undefined,
        });
        toast.success('Customer Registered with Debt', `${form.name} created with ${formatCurrency(total - paid)} balance.`);
      } else {
        await addCustomer(customerPayload);
        toast.success('Customer Created', `${form.name} registered.`);
      }
      
      handleClose();
    } catch (err: any) {
      toast.error('Operation Failed', err.message || 'Could not save customer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => { 
    setForm(INITIAL); 
    setErrors({});
    setDuplicateWarning(null);
    setSkipDuplicateCheck(false);
    setHasOpeningDebt(false);
    setDebtProduct('');
    setDebtAmount('');
    setDebtPaid('');
    setDebtDate(new Date().toISOString().slice(0, 10));
    setDebtDueDate('');
    setDebtNotes('');
    setDebtError(null);
    onClose(); 
  };

  const totalNum = parseFloat(debtAmount) || 0;
  const paidNum = parseFloat(debtPaid) || 0;
  const remainingNum = Math.max(0, totalNum - paidNum);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        customerToEdit
          ? 'Edit Customer Profile'
          : lockedAccountType === 'shop_repairer'
          ? 'Register B2B Phone Shop / Repairer'
          : lockedAccountType === 'retail'
          ? 'Register Retail Customer'
          : 'Register New Customer'
      }
      subtitle={
        lockedAccountType === 'shop_repairer'
          ? 'Add a commercial phone store or repair workshop account'
          : lockedAccountType === 'retail'
          ? 'Add a standard retail walk-in customer profile'
          : 'Configure contact, business account type, and credit ledger settings'
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting}>
            {customerToEdit ? 'Save Changes' : hasOpeningDebt ? 'Create & Log Debt' : 'Add Customer'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {/* Account Type Selector or Locked Badge */}
        {lockedAccountType ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: lockedAccountType === 'shop_repairer' ? '#eff6ff' : '#f0fdf4',
            border: lockedAccountType === 'shop_repairer' ? '1px solid #bfdbfe' : '1px solid #bbf7d0',
            color: lockedAccountType === 'shop_repairer' ? '#1d4ed8' : '#15803d',
            fontSize: '13px',
            fontWeight: 600,
          }}>
            {lockedAccountType === 'shop_repairer' ? <Store size={18} /> : <User size={18} />}
            <span>Account Category: <strong>{lockedAccountType === 'shop_repairer' ? '🏪 B2B Phone Shop / Repairer' : '👤 Retail Customer'}</strong></span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>Account Category</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: form.accountType === 'retail' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                  background: form.accountType === 'retail' ? '#eff6ff' : '#f8fafc',
                  color: form.accountType === 'retail' ? '#1d4ed8' : '#475569',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => set('accountType', 'retail')}
              >
                <User size={16} />
                <span>👤 Retail Customer</span>
              </button>

              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: form.accountType === 'shop_repairer' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                  background: form.accountType === 'shop_repairer' ? '#eff6ff' : '#f8fafc',
                  color: form.accountType === 'shop_repairer' ? '#1d4ed8' : '#475569',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => set('accountType', 'shop_repairer')}
              >
                <Store size={16} />
                <span>🏪 Shop / Repairer (B2B)</span>
              </button>
            </div>
          </div>
        )}

        {form.accountType === 'shop_repairer' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <Input
              label="Shop / Business Name *"
              placeholder="e.g. AP Phone, QuickFix 31"
              value={form.shopName}
              onChange={e => set('shopName', e.target.value)}
              error={errors.shopName}
            />
            <Input
              label="Credit Limit (DZD)"
              type="number"
              min="0"
              placeholder="e.g. 50000"
              value={form.creditLimit}
              onChange={e => set('creditLimit', e.target.value)}
            />
          </div>
        )}

        <Input 
          label={form.accountType === 'shop_repairer' ? "Contact Person / Owner Name *" : "Full Name *"} 
          placeholder={form.accountType === 'shop_repairer' ? "e.g. Ahmed Benali" : "e.g. Karim Benz"} 
          value={form.name}
          onChange={e => set('name', e.target.value)} 
          error={errors.name} 
        />
        <Input 
          label="Phone Number *" 
          placeholder="e.g. 0550 12 34 56" 
          value={form.phone}
          onChange={e => {
            set('phone', e.target.value);
            if (duplicateWarning) {
              setDuplicateWarning(null);
              setSkipDuplicateCheck(false);
            }
          }} 
          error={errors.phone} 
        />

        {duplicateWarning && (
          <div style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: '12.5px',
            lineHeight: '1.45',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
            marginTop: '-4px',
            marginBottom: '4px',
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#d97706' }} />
            <div>
              <strong>Duplicate Phone Detected:</strong> {duplicateWarning}
            </div>
          </div>
        )}
        <Input 
          label="Email Address (Optional)" 
          placeholder="e.g. contact@example.com" 
          type="email"
          value={form.email}
          onChange={e => set('email', e.target.value)} 
          error={errors.email} 
        />

        {/* Opening Debt Section (Only for new customer registrations) */}
        {!customerToEdit && (
          <div style={{
            marginTop: '12px',
            padding: '14px',
            borderRadius: '12px',
            border: hasOpeningDebt ? '1px solid #fde68a' : '1px solid #e2e8f0',
            background: hasOpeningDebt ? '#fefce8' : '#f8fafc',
            transition: 'all 0.2s ease',
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '13.5px',
              color: hasOpeningDebt ? '#92400e' : '#334155',
            }}>
              <input
                type="checkbox"
                checked={hasOpeningDebt}
                onChange={e => setHasOpeningDebt(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#d97706' }}
              />
              <BookOpen size={16} />
              <span>Record Opening Debt / Unpaid Item ("Dette / Carnet")</span>
            </label>

            {hasOpeningDebt && (
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {debtError && (
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
                    <span>{debtError}</span>
                  </div>
                )}

                <Input
                  label="Product / Item Taken *"
                  placeholder="e.g. iPhone 11 128GB, Screen + Case, Airpods"
                  value={debtProduct}
                  onChange={e => { setDebtProduct(e.target.value); setDebtError(null); }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <Input
                    label="Total Value / Price *"
                    type="number"
                    min="0"
                    placeholder="e.g. 35000"
                    value={debtAmount}
                    onChange={e => { setDebtAmount(e.target.value); setDebtError(null); }}
                  />
                  <Input
                    label="Amount Paid Upfront"
                    type="number"
                    min="0"
                    placeholder="0 if nothing"
                    value={debtPaid}
                    onChange={e => setDebtPaid(e.target.value)}
                  />
                </div>

                {/* Remaining Debt Callout */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#ffffff',
                  border: '1px solid #fde68a',
                  fontSize: '13px',
                  fontWeight: 600,
                }}>
                  <span style={{ color: '#78350f' }}>Remaining Balance Owed:</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>
                    {formatCurrency(remainingNum)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <Input
                    label="Date Taken"
                    type="date"
                    value={debtDate}
                    onChange={e => setDebtDate(e.target.value)}
                  />
                  <Input
                    label="Payment Due Date (Optional)"
                    type="date"
                    value={debtDueDate}
                    onChange={e => setDebtDueDate(e.target.value)}
                  />
                </div>

                <Textarea
                  label="Notes / Terms (Optional)"
                  placeholder="e.g. Agreed to pay remaining balance next week by cash"
                  value={debtNotes}
                  onChange={e => setDebtNotes(e.target.value)}
                  rows={2}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
