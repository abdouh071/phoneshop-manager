import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { User, Store, X, Check, Phone, UserPlus, UserCheck } from 'lucide-react';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import { isShopCustomer, isRetailCustomer } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { isPhoneMatch, formatStandardPhone, normalizePhoneDigits } from '../../utils/phoneUtils';
import { CustomerDuplicatePromptCard } from '../../components/customers/CustomerDuplicatePromptCard';
import { normalizeArabic } from '../../utils/normalizeText';
import styles from './CustomerAutocomplete.module.css';

interface CustomerAutocompleteInputProps {
  value: string;
  onChange: (name: string, customer?: Customer | null) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  accountType?: 'retail' | 'shop_repairer';
}

/* ─── Quick Create Customer Modal ───────────────────────────────── */
interface QuickCreateModalProps {
  isOpen: boolean;
  initialName: string;
  accountType?: 'retail' | 'shop_repairer';
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}

const QuickCreateCustomerModal: React.FC<QuickCreateModalProps> = ({
  isOpen,
  initialName,
  accountType,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [shopName, setShopName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingExisting, setIsUpdatingExisting] = useState(false);
  const [allowSeparateContact, setAllowSeparateContact] = useState(false);
  const [error, setError] = useState('');
  const phoneRef = useRef<HTMLInputElement>(null);
  const { findOrCreateCustomer, addCustomer, updateCustomer, customers } = useCustomerStore();
  const toast = useToast();

  // Reset form when modal opens with new name
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setPhone('');
      setShopName('');
      setError('');
      setIsSaving(false);
      setIsUpdatingExisting(false);
      setAllowSeparateContact(false);
      // Focus phone input after a short delay
      setTimeout(() => phoneRef.current?.focus(), 100);
    }
  }, [isOpen, initialName]);

  // Real-time match: exact name AND matching phone
  const existingMatch = useMemo(() => {
    const cleanName = name.trim().toLowerCase();
    if (!phone.trim() || !cleanName) return null;
    return customers.find(c => {
      const cName = c.name.trim().toLowerCase();
      const phoneMatches = isPhoneMatch(c.phone, phone) || (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, phone));
      return phoneMatches && cName === cleanName;
    }) || null;
  }, [name, phone, customers]);

  // Secondary notice: phone belongs to an existing customer (even if name spelling is different)
  const phoneOnlyMatch = useMemo(() => {
    if (existingMatch || allowSeparateContact) return null;
    if (!phone.trim()) return null;
    return customers.find(c =>
      isPhoneMatch(c.phone, phone) ||
      (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, phone))
    ) || null;
  }, [phone, customers, existingMatch, allowSeparateContact]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Customer name is required');
      return;
    }
    if (!phone.trim()) {
      setError('Phone number is required');
      return;
    }

    // If BOTH name and number match an existing customer, auto-select them
    if (existingMatch) {
      toast.info('Account Selected', `This account already exists: ${existingMatch.name} (${existingMatch.phone}) has been selected.`);
      onCreated(existingMatch);
      return;
    }

    // If phone matches existing customer under different name and staff hasn't chosen an action
    if (phoneOnlyMatch && !allowSeparateContact) {
      setError('An existing customer was found with this phone number. Please choose an option above.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const formattedPhone = formatStandardPhone(phone.trim()) || phone.trim();
      let created: Customer;

      if (allowSeparateContact) {
        // Staff explicitly chose to create a separate contact with the same phone
        created = await addCustomer({
          name: name.trim(),
          phone: formattedPhone,
          accountType: accountType || 'retail',
          shopName: accountType === 'shop_repairer' ? (shopName.trim() || name.trim()) : undefined,
        });
        toast.success('Separate Contact Created', `${created.name} registered.`);
      } else {
        const found = await findOrCreateCustomer({
          name: name.trim(),
          phone: formattedPhone,
          accountType: accountType || 'retail',
          shopName: accountType === 'shop_repairer' ? (shopName.trim() || name.trim()) : undefined,
        });
        if (!found) throw new Error('Customer account requires a valid phone number.');
        created = found;
      }

      onCreated(created);
    } catch (err) {
      console.error('Failed to create customer:', err);
      setError('Failed to create account. Please try again.');
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSaving) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const isShop = accountType === 'shop_repairer';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '28px',
          width: '100%',
          maxWidth: '420px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          animation: 'slideUp 0.2s ease-out',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: isShop ? '#eff6ff' : '#f0fdf4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {isShop
              ? <Store size={22} style={{ color: '#2563eb' }} />
              : <UserPlus size={22} style={{ color: '#16a34a' }} />}
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              {isShop ? 'Register New Shop' : 'Register New Customer'}
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
              {isShop
                ? 'Add a new B2B shop / repairer account'
                : 'Create a retail customer account'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: '#f1f5f9',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
              {isShop ? 'Contact Name' : 'Full Name'}
            </label>
            <div style={{ position: 'relative' }}>
              <User size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 34px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  fontSize: '14px',
                  color: '#0f172a',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                placeholder="Customer name"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
              Phone Number <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <Phone size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                ref={phoneRef}
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 34px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  fontSize: '14px',
                  color: '#0f172a',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                onBlur={e => {
                  e.target.style.borderColor = '#e2e8f0';
                  if (phone.trim()) {
                    setPhone(formatStandardPhone(phone));
                  }
                }}
                placeholder="e.g. 0550 12 34 56"
              />
            </div>
          </div>

          {/* Shop Name (only for B2B) */}
          {isShop && (
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                Shop / Business Name
              </label>
              <div style={{ position: 'relative' }}>
                <Store size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  value={shopName}
                  onChange={e => setShopName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 34px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    fontSize: '14px',
                    color: '#0f172a',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  placeholder="e.g. TechFix Repairs"
                />
              </div>
            </div>
          )}

          {/* Existing Account Match Banner */}
          {existingMatch && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              marginTop: '2px',
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#fef3c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {existingMatch.shopName ? '🏪' : '👤'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#92400e' }}>
                  This account already exists
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#a16207', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {existingMatch.shopName ? `${existingMatch.shopName} — ` : ''}{existingMatch.name} · {existingMatch.phone}
                </p>
              </div>
            </div>
          )}

          {/* Intelligent Deduplication & Use Existing / Merge Prompt */}
          {phoneOnlyMatch && !allowSeparateContact && (
            <CustomerDuplicatePromptCard
              existingCustomer={phoneOnlyMatch}
              enteredName={name}
              isUpdating={isUpdatingExisting || isSaving}
              onUseExisting={async () => {
                let targetCustomer = phoneOnlyMatch;
                if (isShop && shopName.trim() && !phoneOnlyMatch.shopName) {
                  try {
                    await updateCustomer(phoneOnlyMatch.id, {
                      shopName: shopName.trim(),
                      accountType: 'shop_repairer',
                    });
                    targetCustomer = useCustomerStore.getState().customers.find(c => c.id === phoneOnlyMatch.id) ?? phoneOnlyMatch;
                    toast.success('Profile Enriched', `Saved shop name "${shopName.trim()}" to ${targetCustomer.name}'s profile.`);
                  } catch (e) {
                    console.warn('Could not auto-enrich shop name:', e);
                  }
                }
                toast.info('Account Selected', `Existing customer ${targetCustomer.name} (${targetCustomer.phone}) selected.`);
                onCreated(targetCustomer);
              }}
              onUpdateToNewName={async () => {
                if (!name.trim()) {
                  setError('Customer name is required');
                  return;
                }
                setIsUpdatingExisting(true);
                try {
                  const formattedPhone = formatStandardPhone(phone.trim()) || phoneOnlyMatch.phone;
                  await updateCustomer(phoneOnlyMatch.id, {
                    name: name.trim(),
                    phone: formattedPhone,
                    shopName: isShop ? (shopName.trim() || name.trim()) : phoneOnlyMatch.shopName,
                  });
                  toast.success('Customer Profile Updated', `Renamed profile to "${name.trim()}".`);
                  onCreated({
                    ...phoneOnlyMatch,
                    name: name.trim(),
                    phone: formattedPhone,
                    shopName: isShop ? (shopName.trim() || name.trim()) : phoneOnlyMatch.shopName,
                  });
                } catch (err) {
                  setError('Failed to update customer account.');
                } finally {
                  setIsUpdatingExisting(false);
                }
              }}
              onSaveAsSeparate={() => {
                setAllowSeparateContact(true);
                toast.info('Separate Contact Allowed', `You can now save "${name.trim() || 'this contact'}" as a separate customer sharing this phone number.`);
              }}
            />
          )}

          {/* Error */}
          {error && (
            <p style={{ margin: 0, fontSize: '12px', color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: '8px' }}>
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              background: '#ffffff',
              color: '#475569',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: '10px',
              background: isSaving
                ? '#94a3b8'
                : existingMatch
                ? '#d97706'
                : isShop ? '#2563eb' : '#16a34a',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {isSaving ? (
              <>Saving...</>
            ) : existingMatch ? (
              <>
                <Check size={14} />
                Select Existing
              </>
            ) : (
              <>
                <Check size={14} />
                Create & Select
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Main Autocomplete Component ───────────────────────────────── */

export const CustomerAutocompleteInput: React.FC<CustomerAutocompleteInputProps> = ({
  value,
  onChange,
  placeholder = 'Walk-in or search registered customer...',
  label = 'Customer Name (optional)',
  className = '',
  accountType,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { customers, fetchCustomers } = useCustomerStore();

  useEffect(() => {
    if (customers.length === 0) {
      fetchCustomers();
    }
  }, [customers.length, fetchCustomers]);

  // Filtered customer list strictly respecting accountType isolation
  const filteredCustomers = useMemo(() => {
    let pool = customers;
    if (accountType === 'retail') {
      pool = pool.filter(isRetailCustomer);
    } else if (accountType === 'shop_repairer') {
      pool = pool.filter(isShopCustomer);
    }

    if (!value || !value.trim()) {
      // Return top 8 recent customers from isolated pool
      return [...pool]
        .sort((a, b) => new Date(b.lastVisitDate).getTime() - new Date(a.lastVisitDate).getTime())
        .slice(0, 8);
    }
    const q = normalizeArabic(value).trim();
    const cleanDigits = normalizePhoneDigits(value);
    const rawDigits = value.replace(/\D/g, '');

    return pool.filter(c =>
      normalizeArabic(c.name ?? '').includes(q) ||
      (c.shopName && normalizeArabic(c.shopName).includes(q)) ||
      (c.email && normalizeArabic(c.email).includes(q)) ||
      c.phone.toLowerCase().includes(q) ||
      (c.normalizedPhone && c.normalizedPhone.includes(q)) ||
      (cleanDigits.length >= 2 && (
        (c.normalizedPhone && c.normalizedPhone.includes(cleanDigits)) ||
        normalizePhoneDigits(c.phone).includes(cleanDigits) ||
        isPhoneMatch(c.phone, value)
      )) ||
      (rawDigits.length >= 2 && c.phone.replace(/\D/g, '').includes(rawDigits))
    ).slice(0, 10);
  }, [customers, value, accountType]);

  const hasValue = value.trim().length > 0;
  // Total selectable items:
  // When hasValue:
  // Index 0: "Use '{name}' (Name only)"
  // Index 1 .. filteredCustomers.length: matching registered customers
  // Index 1 + filteredCustomers.length: "Register '{name}' as new customer"
  // When !hasValue:
  // Index 0 .. filteredCustomers.length - 1: recent registered customers
  const totalItemsCount = hasValue ? (filteredCustomers.length + 2) : filteredCustomers.length;

  // Reset highlight index when filter results change
  useEffect(() => {
    setHighlightIndex(0);
  }, [filteredCustomers.length, value]);

  // Auto-scroll highlighted item into view
  useEffect(() => {
    if (isOpen && itemRefs.current[highlightIndex]) {
      itemRefs.current[highlightIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [highlightIndex, isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectCustomer = useCallback((customer: Customer) => {
    onChange(customer.name, customer);
    setIsOpen(false);
  }, [onChange]);

  const handleUseNameOnly = useCallback((name: string) => {
    onChange(name, null);
    setIsOpen(false);
  }, [onChange]);

  const handleOpenQuickCreate = useCallback(() => {
    setQuickCreateName(value.trim());
    setQuickCreateOpen(true);
    setIsOpen(false);
  }, [value]);

  const handleQuickCreateDone = useCallback((customer: Customer) => {
    setQuickCreateOpen(false);
    onChange(customer.name, customer);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItemsCount > 0) {
        setHighlightIndex(prev => (prev + 1) % totalItemsCount);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalItemsCount > 0) {
        setHighlightIndex(prev => (prev - 1 + totalItemsCount) % totalItemsCount);
      }
    } else if (e.key === 'Enter') {
      if (isOpen && totalItemsCount > 0) {
        e.preventDefault();
        if (hasValue) {
          if (highlightIndex === 0) {
            handleUseNameOnly(value.trim());
          } else if (highlightIndex <= filteredCustomers.length) {
            handleSelectCustomer(filteredCustomers[highlightIndex - 1]);
          } else {
            handleOpenQuickCreate();
          }
        } else {
          if (highlightIndex < filteredCustomers.length) {
            handleSelectCustomer(filteredCustomers[highlightIndex]);
          }
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('', null);
    inputRef.current?.focus();
  };

  return (
    <div className={[styles.container, className].join(' ')} ref={containerRef}>
      {label && <label className={styles.label}>{label}</label>}

      <div className={styles.inputWrapper}>
        {accountType === 'shop_repairer' ? (
          <Store size={15} className={styles.inputIcon} style={{ color: '#2563eb' }} />
        ) : (
          <User size={15} className={styles.inputIcon} />
        )}
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder={placeholder}
          value={value}
          onChange={e => {
            onChange(e.target.value, null);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />

        {value && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={handleClear}
            title="Clear customer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Floating Suggestions Dropdown */}
      {isOpen && (
        <div className={styles.dropdown} ref={listRef}>
          <div className={styles.dropdownHeader}>
            <span>
              {value.trim()
                ? `Customer Options`
                : accountType === 'shop_repairer'
                ? 'Registered Shops & Repairers'
                : accountType === 'retail'
                ? 'Registered Retail Customers'
                : 'Registered Customers'}
            </span>
            <span className={styles.keyboardHint}>↑ ↓ navigate • ↵ select</span>
          </div>

          {/* 1. Name-Only Option (Allows typing any name without creating or choosing an account) */}
          {hasValue && (
            <button
              ref={el => { itemRefs.current[0] = el; }}
              type="button"
              className={[
                styles.nameOnlyOption,
                highlightIndex === 0 && styles.nameOnlyOptionActive,
              ].filter(Boolean).join(' ')}
              onClick={() => handleUseNameOnly(value.trim())}
              onMouseEnter={() => setHighlightIndex(0)}
            >
              <div className={styles.nameOnlyLeft}>
                <div className={styles.nameOnlyIcon}>
                  <UserCheck size={14} />
                </div>
                <div className={styles.nameCol}>
                  <p className={styles.nameOnlyTitle}>
                    Use <strong>"{value.trim()}"</strong> (Name only)
                  </p>
                  <span className={styles.nameOnlySubtext}>
                    Plain receipt name • No account linked or created
                  </span>
                </div>
              </div>
              <span className={styles.nameOnlyBadge}>↵ Enter</span>
            </button>
          )}

          {/* Divider if matching registered accounts exist */}
          {hasValue && filteredCustomers.length > 0 && (
            <div className={styles.sectionDivider}>
              <span>Registered Accounts ({filteredCustomers.length})</span>
            </div>
          )}

          {/* 2. Registered Matching Accounts */}
          {filteredCustomers.length === 0 && !hasValue ? (
            <div className={styles.emptyState}>
              No matching customers found.
            </div>
          ) : (
            filteredCustomers.map((cust, idx) => {
              const itemIdx = hasValue ? idx + 1 : idx;
              const isSelected = highlightIndex === itemIdx;
              const debt = cust.totalDebt || 0;

              return (
                <button
                  key={cust.id}
                  ref={el => { itemRefs.current[itemIdx] = el; }}
                  type="button"
                  className={[styles.item, isSelected && styles.itemActive].filter(Boolean).join(' ')}
                  onClick={() => handleSelectCustomer(cust)}
                  onMouseEnter={() => setHighlightIndex(itemIdx)}
                >
                  <div className={styles.itemLeft}>
                    <div className={styles.avatar} style={cust.shopName ? { background: '#eff6ff', color: '#2563eb' } : undefined}>
                      {cust.shopName ? '🏪' : cust.name.charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.nameCol}>
                      <p className={styles.customerName}>
                        {cust.shopName ? `${cust.shopName} (${cust.name})` : cust.name}
                      </p>
                      <span className={styles.customerPhone}>{cust.phone}</span>
                    </div>
                  </div>

                  <div className={styles.itemRight}>
                    {debt > 0 ? (
                      <span className={styles.debtBadge}>
                        🚨 Debt: {formatCurrency(debt)}
                      </span>
                    ) : (
                      <span className={styles.ordersCount}>
                        {cust.totalPurchases} {cust.totalPurchases === 1 ? 'order' : 'orders'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}

          {/* 3. Register New Account Option */}
          {hasValue && (
            <button
              ref={el => { itemRefs.current[filteredCustomers.length + 1] = el; }}
              type="button"
              className={[
                styles.customOption,
                highlightIndex === (filteredCustomers.length + 1) && styles.customOptionActive,
              ].filter(Boolean).join(' ')}
              onClick={handleOpenQuickCreate}
              onMouseEnter={() => setHighlightIndex(filteredCustomers.length + 1)}
            >
              <UserPlus size={14} />
              <span>Register <strong>"{value.trim()}"</strong> as new {accountType === 'shop_repairer' ? 'shop' : 'customer'}</span>
            </button>
          )}
        </div>
      )}

      {/* Subtle indicator when dropdown is closed and name-only is active */}
      {!isOpen && value.trim() && (
        <div className={styles.nameOnlyIndicator}>
          <span>📝 Receipt Name: <strong>{value.trim()}</strong> (Name only • Walk-in)</span>
        </div>
      )}

      {/* Quick Create Customer Modal */}
      <QuickCreateCustomerModal
        isOpen={quickCreateOpen}
        initialName={quickCreateName}
        accountType={accountType}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={handleQuickCreateDone}
      />
    </div>
  );
};
