import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { isPhoneMatch, formatStandardPhone, normalizePhoneDigits } from '../../utils/phoneUtils';
import { CustomerDuplicatePromptCard } from '../../components/customers/CustomerDuplicatePromptCard';
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
  wholesaleDiscountPercent: string;
  address: string;
  rc: string;
  nif: string;
  nis: string;
  art: string;
  notes: string;
};

const INITIAL: FormData = {
  name: '',
  phone: '',
  email: '',
  accountType: 'retail',
  shopName: '',
  creditLimit: '',
  wholesaleDiscountPercent: '',
  address: '',
  rc: '',
  nif: '',
  nis: '',
  art: '',
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
  const [showCommercialDetails, setShowCommercialDetails] = useState(false);

  // Opening Debt State (only when adding a new customer)
  const [hasOpeningDebt, setHasOpeningDebt] = useState(false);
  const [debtProduct, setDebtProduct] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtPaid, setDebtPaid] = useState('');
  const [debtDate, setDebtDate] = useState(new Date().toISOString().slice(0, 10));
  const [debtDueDate, setDebtDueDate] = useState('');
  const [debtNotes, setDebtNotes] = useState('');
  const [debtError, setDebtError] = useState<string | null>(null);

  const { t } = useTranslation();
 const { addCustomer, addCustomerWithDebt, updateCustomer, customers } = useCustomerStore();
  const toast = useToast();

  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);
  const [isUpdatingExisting, setIsUpdatingExisting] = useState(false);

  // Real-time matched duplicate customer by canonical phone
  const matchedDuplicateCustomer = useMemo(() => {
    if (customerToEdit || skipDuplicateCheck) return null;
    const cleanPhone = form.phone.trim();
    if (normalizePhoneDigits(cleanPhone).length < 7) return null;
    return customers.find(c => 
      isPhoneMatch(c.phone, cleanPhone) || 
      (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, cleanPhone))
    ) || null;
  }, [form.phone, customers, customerToEdit, skipDuplicateCheck]);

  useEffect(() => {
    if (customerToEdit) {
      const hasLegal = Boolean(customerToEdit.rc || customerToEdit.nif || customerToEdit.nis || customerToEdit.art);
      setShowCommercialDetails(hasLegal);
      setForm({
        name: customerToEdit.name,
        phone: customerToEdit.phone,
        email: customerToEdit.email || '',
        accountType: (customerToEdit.accountType === 'b2b' || customerToEdit.accountType === 'shop_repairer' || customerToEdit.shopName) ? 'shop_repairer' : 'retail',
        shopName: customerToEdit.shopName || '',
        creditLimit: customerToEdit.creditLimit ? String(customerToEdit.creditLimit) : '',
        wholesaleDiscountPercent: customerToEdit.wholesaleDiscountPercent ? String(customerToEdit.wholesaleDiscountPercent) : '',
        address: customerToEdit.address || '',
        rc: customerToEdit.rc || '',
        nif: customerToEdit.nif || '',
        nis: customerToEdit.nis || '',
        art: customerToEdit.art || '',
        notes: customerToEdit.notes || '',
      });
      setHasOpeningDebt(false);
    } else {
      const targetAccountType = lockedAccountType || defaultAccountType || 'retail';
      setShowCommercialDetails(false);
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

    // Check for duplicate phone on new customer creation using robust phone line matching
    if (!customerToEdit && !skipDuplicateCheck && matchedDuplicateCustomer) {
      toast.warning(
        t('customers.existingCustomerFound', 'Existing Customer Found'),
        t('customers.existingCustomerFoundDesc', 'Please use one of the actions on the card above, or click "Save as Separate Contact".')
      );
      return;
    }

    setIsSubmitting(true);
    setSkipDuplicateCheck(false);
    
    try {
      const limitNum = parseFloat(form.creditLimit);
      const discountNum = parseFloat(form.wholesaleDiscountPercent);
      const customerPayload = {
        name: form.name.trim(),
        phone: formatStandardPhone(form.phone.trim()) || form.phone.trim(),
        email: form.email.trim() || undefined,
        accountType: form.accountType,
        shopName: form.accountType === 'shop_repairer' ? form.shopName.trim() : undefined,
        creditLimit: !isNaN(limitNum) && limitNum > 0 ? limitNum : undefined,
        wholesaleDiscountPercent: !isNaN(discountNum) && discountNum > 0 ? discountNum : undefined,
        address: form.address.trim() || undefined,
        rc: form.rc.trim() || undefined,
        nif: form.nif.trim() || undefined,
        nis: form.nis.trim() || undefined,
        art: form.art.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (customerToEdit) {
        await updateCustomer(customerToEdit.id, customerPayload);
        toast.success(
          t('customers.customerUpdated', 'Customer Updated'),
          t('customers.customerUpdatedDesc', { name: form.name, defaultValue: `${form.name}'s details have been saved.` })
        );
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
        toast.success(
          t('customers.customerRegisteredWithDebt', 'Customer Registered with Debt'),
          t('customers.customerRegisteredWithDebtDesc', { name: form.name, amount: formatCurrency(total - paid), defaultValue: `${form.name} created with ${formatCurrency(total - paid)} balance.` })
        );
      } else {
        await addCustomer(customerPayload);
        toast.success(
          t('customers.customerCreated', 'Customer Created'),
          t('customers.customerCreatedDesc', { name: form.name, defaultValue: `${form.name} registered.` })
        );
      }
      
      handleClose();
    } catch (err: any) {
      toast.error(
        t('customers.operationFailed', 'Operation Failed'),
        err.message || t('customers.saveCustomerError', 'Could not save customer.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => { 
    setForm(INITIAL); 
    setErrors({});
    setSkipDuplicateCheck(false);
    setIsUpdatingExisting(false);
    setShowCommercialDetails(false);
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
          ? t('customers.editCustomerTitle', 'Edit Customer Profile')
          : lockedAccountType === 'shop_repairer'
          ? t('customers.newB2BShopTitle', 'New B2B Partner Shop / Repairer')
          : lockedAccountType === 'retail'
          ? t('customers.newRetailClientTitle', 'New Retail Client')
          : t('customers.addCustomer', 'Register New Customer')
      }
      subtitle={
        customerToEdit
          ? t('customers.editProfileSubtitle', { id: customerToEdit.id, defaultValue: `Updating account #${customerToEdit.id}` })
          : lockedAccountType === 'shop_repairer'
          ? t('customers.newB2BSubtitle', 'Add a commercial phone store or repair workshop account')
          : lockedAccountType === 'retail'
          ? t('customers.newRetailSubtitle', 'Add a standard retail walk-in customer profile')
          : t('customers.newRetailSubtitle', 'Configure contact, business account type, and credit ledger settings')
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting}>
            {customerToEdit ? t('common.save', 'Save Changes') : hasOpeningDebt ? t('customers.addDebtRecord', 'Create & Log Debt') : t('customers.addCustomer', 'Add Customer')}
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
            <span>{t('customers.tier', 'Account Category')}: <strong>{lockedAccountType === 'shop_repairer' ? `🏪 ${t('common.b2bShop', 'B2B Phone Shop / Repairer')}` : `👤 ${t('common.retailCustomer', 'Retail Customer')}`}</strong></span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>{t('customers.tier', 'Account Category')}</label>
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
                <span>👤 {t('common.retailCustomer', 'Retail Customer')}</span>
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
                <span>🏪 {t('common.b2bShop', 'Shop / Repairer (B2B)')}</span>
              </button>
            </div>
          </div>
        )}

        {form.accountType === 'shop_repairer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <Input
              label={t('customers.shopBusinessName', 'Shop / Business Name *')}
              placeholder={t('customers.shopBusinessPlaceholder', 'e.g. AP Phone, QuickFix 31')}
              value={form.shopName}
              onChange={e => set('shopName', e.target.value)}
              error={errors.shopName}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Input
                label={t('customers.creditLimitOptional', 'Credit Limit (DZD, Optional)')}
                type="number"
                min="0"
                placeholder={t('customers.creditLimitPlaceholder', 'e.g. 50000')}
                value={form.creditLimit}
                onChange={e => set('creditLimit', e.target.value)}
              />
              <Input
                label={t('customers.wholesaleDiscountOptional', 'Wholesale Discount (% Optional)')}
                type="number"
                min="0"
                max="100"
                placeholder={t('customers.wholesaleDiscountPlaceholder', 'e.g. 10 (auto-applied in POS)')}
                value={form.wholesaleDiscountPercent}
                onChange={e => set('wholesaleDiscountPercent', e.target.value)}
              />
            </div>

            {/* Optional Collapsible Legal & Commercial Invoicing Details */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
              <button
                type="button"
                onClick={() => setShowCommercialDetails(prev => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '2px 0',
                }}
              >
                <span>{showCommercialDetails ? '▼' : '▶'} {t('customers.tradeRegistryRC', 'Registre de Commerce (RC)')}, NIF, NIS — {t('common.optional', 'Optional')}</span>
              </button>

              {showCommercialDetails && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                  <Input
                    label={t('customers.tradeRegistryRC', 'Registre de Commerce (RC)')}
                    placeholder={t('customers.tradeRegistryPlaceholder', 'e.g. 16/00-1234567B19')}
                    value={form.rc}
                    onChange={e => set('rc', e.target.value)}
                  />
                  <Input
                    label={t('customers.taxIdNIF', 'NIF (Identifiant Fiscal)')}
                    placeholder={t('customers.taxIdPlaceholder', 'e.g. 000123456789012')}
                    value={form.nif}
                    onChange={e => set('nif', e.target.value)}
                  />
                  <Input
                    label={t('customers.statIdNIS', 'NIS (Identifiant Statistique)')}
                    placeholder={t('customers.statIdPlaceholder', 'e.g. 099123456789012')}
                    value={form.nis}
                    onChange={e => set('nis', e.target.value)}
                  />
                  <Input
                    label={t('customers.taxArticleAI', "Article d'Imposition (AI)")}
                    placeholder={t('customers.taxArticlePlaceholder', 'e.g. 16012345678')}
                    value={form.art}
                    onChange={e => set('art', e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <Input 
          label={form.accountType === 'shop_repairer' ? t('customers.contactPersonOwnerName', "Contact Person / Owner Name *") : t('customers.fullName', "Full Name *")} 
          placeholder={form.accountType === 'shop_repairer' ? t('customers.contactPersonPlaceholder', "e.g. Ahmed Benali") : t('customers.fullNamePlaceholder', "e.g. Karim Benz")} 
          value={form.name}
          onChange={e => set('name', e.target.value)} 
          error={errors.name} 
        />
        <Input 
          label={t('customers.phoneNumber', "Phone Number *")} 
          placeholder={t('customers.phonePlaceholder', "e.g. 0550 12 34 56")} 
          value={form.phone}
          onChange={e => {
            set('phone', e.target.value);
            setSkipDuplicateCheck(false);
          }} 
          onBlur={() => {
            if (form.phone.trim()) {
              set('phone', formatStandardPhone(form.phone));
            }
          }}
          error={errors.phone} 
        />

        {/* Intelligent Deduplication & Use Existing / Merge Prompt */}
        {matchedDuplicateCustomer && (
          <CustomerDuplicatePromptCard
            existingCustomer={matchedDuplicateCustomer}
            enteredName={form.name}
            isUpdating={isUpdatingExisting}
            onUseExisting={async () => {
              const cleanEmail = form.email.trim();
              const cleanShop = form.shopName.trim();
              const cleanAddress = form.address.trim();
              const cleanRc = form.rc.trim();
              const cleanNif = form.nif.trim();
              const cleanNis = form.nis.trim();
              const cleanArt = form.art.trim();
              const discountNum = parseFloat(form.wholesaleDiscountPercent);
              const cleanNotes = form.notes.trim();

              const updates: Partial<Customer> = {};
              if (!matchedDuplicateCustomer.email && cleanEmail) updates.email = cleanEmail;
              if (!matchedDuplicateCustomer.shopName && cleanShop) updates.shopName = cleanShop;
              if (!matchedDuplicateCustomer.address && cleanAddress) updates.address = cleanAddress;
              if (!matchedDuplicateCustomer.rc && cleanRc) updates.rc = cleanRc;
              if (!matchedDuplicateCustomer.nif && cleanNif) updates.nif = cleanNif;
              if (!matchedDuplicateCustomer.nis && cleanNis) updates.nis = cleanNis;
              if (!matchedDuplicateCustomer.art && cleanArt) updates.art = cleanArt;
              if ((!matchedDuplicateCustomer.wholesaleDiscountPercent || matchedDuplicateCustomer.wholesaleDiscountPercent <= 0) && !isNaN(discountNum) && discountNum > 0) {
                updates.wholesaleDiscountPercent = discountNum;
              }
              if (cleanNotes) {
                if (!matchedDuplicateCustomer.notes || !matchedDuplicateCustomer.notes.trim()) {
                  updates.notes = cleanNotes;
                } else if (!matchedDuplicateCustomer.notes.includes(cleanNotes)) {
                  const today = new Date().toLocaleDateString('fr-DZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  updates.notes = `${matchedDuplicateCustomer.notes.trim()}\n[${today}]: ${cleanNotes}`;
                }
              }

              let currentCust = matchedDuplicateCustomer;
              if (Object.keys(updates).length > 0) {
                try {
                  currentCust = await updateCustomer(matchedDuplicateCustomer.id, updates);
                  toast.success('Profile Auto-Enriched', `Enriched ${matchedDuplicateCustomer.name}'s profile with new details.`);
                } catch (e) {
                  console.warn('Failed to auto-enrich on use existing:', e);
                }
              }

              setForm({
                name: currentCust.name,
                phone: formatStandardPhone(currentCust.phone),
                email: currentCust.email || '',
                accountType: (currentCust.accountType === 'b2b' || currentCust.accountType === 'shop_repairer' || currentCust.shopName) ? 'shop_repairer' : 'retail',
                shopName: currentCust.shopName || '',
                creditLimit: currentCust.creditLimit ? String(currentCust.creditLimit) : '',
                wholesaleDiscountPercent: currentCust.wholesaleDiscountPercent ? String(currentCust.wholesaleDiscountPercent) : '',
                address: currentCust.address || '',
                rc: currentCust.rc || '',
                nif: currentCust.nif || '',
                nis: currentCust.nis || '',
                art: currentCust.art || '',
                notes: currentCust.notes || '',
              });
              if (currentCust.rc || currentCust.nif || currentCust.nis || currentCust.art) {
                setShowCommercialDetails(true);
              }
              toast.info('Existing Profile Loaded', `Loaded ${currentCust.name}'s profile.`);
            }}
            onUpdateToNewName={async () => {
              if (!form.name.trim()) {
                setErrors(e => ({ ...e, name: 'Please enter a valid customer name' }));
                return;
              }
              setIsUpdatingExisting(true);
              try {
                const limitNum = parseFloat(form.creditLimit);
                const discountNum = parseFloat(form.wholesaleDiscountPercent);
                await updateCustomer(matchedDuplicateCustomer.id, {
                  name: form.name.trim(),
                  phone: formatStandardPhone(form.phone.trim()) || matchedDuplicateCustomer.phone,
                  email: form.email.trim() || matchedDuplicateCustomer.email,
                  accountType: form.accountType,
                  shopName: form.accountType === 'shop_repairer' ? (form.shopName.trim() || matchedDuplicateCustomer.shopName) : matchedDuplicateCustomer.shopName,
                  creditLimit: !isNaN(limitNum) && limitNum > 0 ? limitNum : matchedDuplicateCustomer.creditLimit,
                  wholesaleDiscountPercent: !isNaN(discountNum) && discountNum > 0 ? discountNum : matchedDuplicateCustomer.wholesaleDiscountPercent,
                  address: form.address.trim() || matchedDuplicateCustomer.address,
                  rc: form.rc.trim() || matchedDuplicateCustomer.rc,
                  nif: form.nif.trim() || matchedDuplicateCustomer.nif,
                  nis: form.nis.trim() || matchedDuplicateCustomer.nis,
                  art: form.art.trim() || matchedDuplicateCustomer.art,
                  notes: form.notes.trim() || matchedDuplicateCustomer.notes,
                });
                toast.success('Customer Profile Updated', `Updated ${form.name.trim()}'s profile.`);
                handleClose();
              } catch (err: any) {
                toast.error('Update Failed', err.message || 'Could not update customer');
              } finally {
                setIsUpdatingExisting(false);
              }
            }}
            onSaveAsSeparate={() => {
              setSkipDuplicateCheck(true);
              toast.info('Separate Contact Allowed', `You can now save "${form.name.trim() || 'this contact'}" as a separate customer sharing this phone number.`);
            }}
          />
        )}
        <Input 
          label={t('customers.emailOptional', 'Email Address (Optional)')} 
          placeholder={t('customers.emailPlaceholder', 'e.g. contact@example.com')} 
          type="email"
          value={form.email}
          onChange={e => set('email', e.target.value)} 
          error={errors.email} 
        />
        <Input 
          label={t('customers.addressWilayaOptional', 'Address / Wilaya (Optional)')} 
          placeholder={t('customers.addressWilayaPlaceholder', 'e.g. Alger Centre, Oran, etc.')} 
          value={form.address}
          onChange={e => set('address', e.target.value)} 
        />
        <Textarea
          label={t('customers.customerNotesOptional', 'Customer Notes / Remarks (Optional)')}
          placeholder={t('customers.customerNotesPlaceholder', 'e.g. VIP client, preferred payment method, special discounts...')}
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={2}
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
              <span>{t('statementModal.debtLedgerLabel', 'Debt / Credit Tab')}</span>
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
                  label={t('customers.productItemTaken', 'Product / Item Taken *')}
                  placeholder={t('customers.productItemPlaceholder', 'e.g. iPhone 11 128GB, Screen + Case, Airpods')}
                  value={debtProduct}
                  onChange={e => { setDebtProduct(e.target.value); setDebtError(null); }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <Input
                    label={t('customers.totalValuePrice', 'Total Value / Price *')}
                    type="number"
                    min="0"
                    placeholder={t('customers.pricePlaceholder', 'e.g. 35000')}
                    value={debtAmount}
                    onChange={e => { setDebtAmount(e.target.value); setDebtError(null); }}
                  />
                  <Input
                    label={t('customers.amountPaidUpfront', 'Amount Paid Upfront')}
                    type="number"
                    min="0"
                    placeholder={t('customers.zeroIfNothing', '0 if nothing')}
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
                  <span style={{ color: '#78350f' }}>{t('customers.remainingBalanceOwed', 'Remaining Balance Owed:')}</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>
                    {formatCurrency(remainingNum)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <Input
                    label={t('customers.dateTaken', 'Date Taken')}
                    type="date"
                    value={debtDate}
                    onChange={e => setDebtDate(e.target.value)}
                  />
                  <Input
                    label={t('customers.paymentDueDateOptional', 'Payment Due Date (Optional)')}
                    type="date"
                    value={debtDueDate}
                    onChange={e => setDebtDueDate(e.target.value)}
                  />
                </div>

                <Textarea
                  label={t('customers.notesTermsOptional', 'Notes / Terms (Optional)')}
                  placeholder={t('customers.notesTermsPlaceholder', 'e.g. Agreed to pay remaining balance next week by cash')}
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
