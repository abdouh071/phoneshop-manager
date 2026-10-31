import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { activityLogService } from '../../services/activityLogService';
import { useToast } from '../../components/ui/Toast';
import type { RepairTicket, HeldRepairDraft, Customer } from '../../types';
import dropStyles from './CustomerDropdown.module.css';
import styles from './NewTicketModal.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { formatStandardPhone, normalizePhoneDigits, isPhoneMatch } from '../../utils/phoneUtils';
import { CustomerDuplicatePromptCard } from '../../components/customers/CustomerDuplicatePromptCard';
import { LockCodeInput } from './LockCodeWidget';
import { CustomerHistoryWidget } from './CustomerHistoryWidget';
import { Smartphone, User, Wrench, Calculator, ShieldCheck, Calendar, Sparkles, PauseCircle, Printer } from 'lucide-react';
import { printRepairLabelDirect, buildRepairLabelHTML, openPrintWindow } from '../../utils/printWindow';
import { useSettingsStore } from '../../store/settingsStore';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketToEdit?: RepairTicket | null;
  /** Pre-fill customer data (name, phone, optional device details) */
  prefillCustomer?: { name: string; phone: string; lastDevice?: string; deviceBrand?: string; deviceModel?: string; parentTicketId?: string } | null;
  onTicketCreated?: (ticket?: RepairTicket) => void;
  onPrintTicket?: (ticket: RepairTicket) => void;
}

type FormData = {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  deviceBrand: string;
  deviceModel: string;
  issueDescription: string;
  remark: string;
  estimatedCost: string;
  depositAmount: string;
  estimatedCompletionDate: string;
  assignedTechnician: string;
};

const INITIAL: FormData = {
  customerId: '',
  customerName: '',
  customerPhone: '',
  deviceBrand: '',
  deviceModel: '',
  issueDescription: '',
  remark: '',
  estimatedCost: '',
  depositAmount: '',
  estimatedCompletionDate: '',
  assignedTechnician: '',
};

const BRAND_PRESETS = [
  { name: 'Apple', icon: '🍏' },
  { name: 'Samsung', icon: '📱' },
  { name: 'Xiaomi', icon: '⚡' },
  { name: 'Huawei', icon: '🔴' },
  { name: 'Oppo', icon: '🟢' },
  { name: 'Realme', icon: '🟡' },
  { name: 'Google', icon: '🌐' },
  { name: 'Other', icon: '🤖' },
];

const ISSUE_PRESETS = [
  { id: 'display', label: 'Display', icon: '📱' },
  { id: 'glass', label: 'Glass', icon: '🔨' },
  { id: 'battery', label: 'Battery', icon: '🔋' },
  { id: 'charging', label: 'Charging Port', icon: '⚡' },
  { id: 'camera', label: 'Camera', icon: '📷' },
  { id: 'lens', label: 'Camera Lens', icon: '🔍' },
  { id: 'speaker', label: 'Speaker', icon: '🔊' },
  { id: 'microphone', label: 'Microphone', icon: '🎙️' },
  { id: 'backglass', label: 'Back Glass', icon: '🔘' },
  { id: 'water', label: 'Water Damage', icon: '💧' },
  { id: 'software', label: 'Software', icon: '💻' },
  { id: 'unlock', label: 'Unlock', icon: '🔓' },
];

export const NewTicketModal: React.FC<NewTicketModalProps> = ({ isOpen, onClose, ticketToEdit, prefillCustomer, onTicketCreated, onPrintTicket }) => {
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lockType, setLockType] = useState<'none' | 'pin' | 'pattern'>('none');
  const [lockValue, setLockValue] = useState<string>('');
  const [autoStart, setAutoStart] = useState(true);
  const [showLockCode, setShowLockCode] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const { createTicket, updateTicket, tickets, activeDraft, saveActiveDraft: storeSaveDraft, clearActiveDraft, holdDraft, isCreatingTicket } = useRepairStore();
  const { storeName } = useSettingsStore();
  const isBusy = isSubmitting || isCreatingTicket || isPrinting;
  const { findOrCreateCustomer, addCustomer, updateCustomer, enrichCustomer, customers, fetchCustomers } = useCustomerStore();
  const toast = useToast();
  const [ignoreDuplicatePhone, setIgnoreDuplicatePhone] = useState(false);
  const [isUpdatingCustomer, setIsUpdatingCustomer] = useState(false);

  // Real-time matched customer by canonical phone
  const matchedCustomerByPhone = useMemo(() => {
    if (ignoreDuplicatePhone) return null;
    const cleanPhone = form.customerPhone.trim();
    if (normalizePhoneDigits(cleanPhone).length < 7) return null;
    const match = customers.find(c =>
      isPhoneMatch(c.phone, cleanPhone) ||
      (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, cleanPhone))
    );
    if (!match) return null;
    if (form.customerId && match.id === form.customerId) return null;
    return match;
  }, [form.customerPhone, form.customerId, customers, ignoreDuplicatePhone]);

  // Active customer's registered devices vault
  const activeCustomerDevices = useMemo(() => {
    let cust: Customer | undefined;
    if (form.customerId) {
      cust = customers.find(c => c.id === form.customerId);
    } else {
      const cleanPhone = normalizePhoneDigits(form.customerPhone);
      if (cleanPhone.length >= 7) {
        cust = customers.find(c =>
          isPhoneMatch(c.phone, form.customerPhone) ||
          (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, form.customerPhone))
        );
      }
    }
    return cust?.registeredDevices || [];
  }, [form.customerId, form.customerPhone, customers]);

  // Load customers when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchCustomers();
      setIgnoreDuplicatePhone(false);
    }
  }, [isOpen, fetchCustomers]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter customers by search
  const suggestions = customerQuery.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(customerQuery.toLowerCase()) ||
        c.phone.includes(customerQuery)
      ).slice(0, 6)
    : customers.slice(0, 6);

  const handleSelectCustomer = (c: { id?: string; name: string; phone: string }) => {
    setForm(prev => ({ ...prev, customerId: c.id, customerName: c.name, customerPhone: c.phone }));
    setCustomerQuery(c.name);
    setShowSuggestions(false);
  };

  // Populate data when editing OR restore active draft
  useEffect(() => {
    if (isOpen && ticketToEdit) {
      const activeCost = ticketToEdit.actualCost !== undefined 
        ? ticketToEdit.actualCost.toString() 
        : (ticketToEdit.estimatedCost ? ticketToEdit.estimatedCost.toString() : '');

      setForm({
        customerId: ticketToEdit.customerId || '',
        customerName: ticketToEdit.customerName || '',
        customerPhone: ticketToEdit.customerPhone || '',
        deviceBrand: ticketToEdit.deviceBrand || '',
        deviceModel: ticketToEdit.deviceModel || '',
        issueDescription: ticketToEdit.issueDescription || '',
        remark: ticketToEdit.remark || '',
        estimatedCost: activeCost,
        depositAmount: ticketToEdit.depositAmount ? ticketToEdit.depositAmount.toString() : '',
        estimatedCompletionDate: ticketToEdit.estimatedCompletionDate ? ticketToEdit.estimatedCompletionDate.split('T')[0] : '',
        assignedTechnician: ticketToEdit.assignedTechnician || '',
      });
      setCustomerQuery(ticketToEdit.customerName || '');
      setLockType((ticketToEdit.lockType as 'none' | 'pin' | 'pattern') || (ticketToEdit.lockValue ? 'pin' : 'none'));
      setLockValue(ticketToEdit.lockValue || '');
      setShowLockCode(!!(ticketToEdit.lockType && ticketToEdit.lockType !== 'none'));
    } else if (isOpen && prefillCustomer) {
      // Pre-fill from Customers page quick action — takes priority over draft
      const deviceParts = prefillCustomer.lastDevice?.split(' ') || [];
      const derivedBrand = prefillCustomer.deviceBrand || deviceParts[0] || '';
      const derivedModel = prefillCustomer.deviceModel || deviceParts.slice(1).join(' ') || '';
      setForm({
        ...INITIAL,
        customerName: prefillCustomer.name,
        customerPhone: prefillCustomer.phone,
        deviceBrand: derivedBrand,
        deviceModel: derivedModel,
      });
      setCustomerQuery(prefillCustomer.name);
      setLockType('none');
      setLockValue('');
      setShowLockCode(false);
    } else if (isOpen && activeDraft) {
      // Restore from persisted active draft (survives reload & logout)
      setForm({
        customerName: activeDraft.customerName || '',
        customerPhone: activeDraft.customerPhone || '',
        deviceBrand: activeDraft.deviceBrand || '',
        deviceModel: activeDraft.deviceModel || '',
        issueDescription: activeDraft.issueDescription || '',
        remark: activeDraft.remark || '',
        estimatedCost: activeDraft.estimatedCost || '',
        depositAmount: activeDraft.depositAmount || '',
        estimatedCompletionDate: activeDraft.estimatedCompletionDate || '',
        assignedTechnician: activeDraft.assignedTechnician || '',
      });
      setCustomerQuery(activeDraft.customerName || '');
      setLockType(activeDraft.lockType || 'none');
      setLockValue(activeDraft.lockValue || '');
    } else if (isOpen) {
      setForm(INITIAL);
      setCustomerQuery('');
      setLockType('none');
      setLockValue('');
      setShowLockCode(false);
    }
    setErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ticketToEdit, prefillCustomer]);

  // Auto-save draft to localStorage on every form change (only for new tickets, not edits)
  useEffect(() => {
    if (!isOpen || ticketToEdit) return;
    const hasContent = form.customerName || form.customerPhone || form.deviceBrand || form.deviceModel || form.issueDescription;
    if (!hasContent) {
      clearActiveDraft();
      return;
    }
    const draft: HeldRepairDraft = {
      id: activeDraft?.id || Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      deviceBrand: form.deviceBrand,
      deviceModel: form.deviceModel,
      issueDescription: form.issueDescription,
      remark: form.remark,
      estimatedCost: form.estimatedCost,
      depositAmount: form.depositAmount,
      estimatedCompletionDate: form.estimatedCompletionDate,
      assignedTechnician: form.assignedTechnician,
      lockType,
      lockValue,
    };
    storeSaveDraft(draft);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, lockType, lockValue, isOpen, ticketToEdit]);

  const set = (key: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const handleSelectBrand = (brandName: string) => {
    if (form.deviceBrand.toLowerCase() === brandName.toLowerCase()) {
      set('deviceBrand', '');
    } else {
      set('deviceBrand', brandName);
      // Automatically jump focus to the Model input immediately
      setTimeout(() => {
        modelInputRef.current?.focus();
        modelInputRef.current?.select();
      }, 50);
    }
  };

  const handleToggleIssuePreset = (preset: typeof ISSUE_PRESETS[0]) => {
    const textToToggle = preset.label;
    const current = form.issueDescription.trim();
    if (!current) {
      set('issueDescription', textToToggle);
      return;
    }

    // Check if preset name is already present (case-insensitive)
    const escaped = textToToggle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|,\\s*|/\\s*|•\\s*)${escaped}(,\\s*|/\\s*|$)`, 'i');

    if (regex.test(current)) {
      // Remove it cleanly
      let updated = current.replace(regex, (match, p1, p2) => {
        if (p1 && p2 && p1.includes(',') && p2.includes(',')) return ', ';
        return '';
      }).trim();
      // Clean up any dangling commas, slashes, or bullets
      updated = updated.replace(/^[,/•\s]+|[,/•\s]+$/g, '').trim();
      set('issueDescription', updated);
    } else {
      // Append concise problem name cleanly
      set('issueDescription', `${current}, ${textToToggle}`);
    }
  };

  const validate = (): boolean => {
    const errs: Partial<FormData> = {};
    if (!form.customerName.trim()) errs.customerName = 'Customer name is required';
    const phoneDigits = form.customerPhone.replace(/\D/g, '');
    if (form.customerPhone.trim() && phoneDigits.length < 7) {
      errs.customerPhone = 'Enter a valid phone number';
    }
    if (!form.deviceBrand.trim()) errs.deviceBrand = 'Brand is required';
    if (!form.deviceModel.trim()) errs.deviceModel = 'Model is required';
    if (!form.issueDescription.trim()) errs.issueDescription = 'Describe the problem';
    const cost = Number(form.estimatedCost);
    if (!form.estimatedCost || isNaN(cost) || cost < 0) {
      errs.estimatedCost = 'Enter estimated cost';
    }
    const deposit = Number(form.depositAmount);
    if (form.depositAmount && (isNaN(deposit) || deposit < 0 || deposit > cost)) {
      errs.depositAmount = 'Deposit cannot exceed total cost';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (shouldPrint: boolean = false) => {
    if (isSubmitting || isSubmittingRef.current || isCreatingTicket || isPrinting) return;

    if (!validate()) {
      toast.error('Required fields missing', 'Please complete all required fields marked with * (including Estimated Cost).');
      setTimeout(() => {
        const firstErrorEl = document.querySelector('[class*="hasError"], [class*="error"]');
        if (firstErrorEl) {
          firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (firstErrorEl instanceof HTMLInputElement || firstErrorEl instanceof HTMLTextAreaElement) {
            firstErrorEl.focus();
          }
        }
      }, 50);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    if (shouldPrint) setIsPrinting(true);

    try {
      let cust: any = undefined;
      const cleanPhone = normalizePhoneDigits(form.customerPhone.trim());
      const hasValidPhone = cleanPhone.length >= 7;
      const formattedCustPhone = hasValidPhone
        ? (formatStandardPhone(form.customerPhone.trim()) || form.customerPhone.trim())
        : (form.customerPhone.trim() || undefined);

      try {
        const deviceData = form.deviceBrand.trim() && form.deviceModel.trim()
          ? {
              brand: form.deviceBrand.trim(),
              model: form.deviceModel.trim(),
              notes: form.issueDescription.trim() || undefined,
            }
          : undefined;

        if (form.customerId) {
          // Existing customer selected: auto-enrich their device vault and notes non-destructively
          cust = await enrichCustomer(form.customerId, {
            name: form.customerName.trim(),
            phone: formattedCustPhone,
            notes: form.remark?.trim() || undefined,
            device: deviceData,
          });

          // When editing a ticket, force-override the customer name if it actually changed
          // (enrichCustomer only updates "more descriptive" names, but an explicit edit should always win)
          if (ticketToEdit && cust) {
            const existingCust = customers.find(c => c.id === form.customerId);
            const newNameTrimmed = form.customerName.trim();
            if (existingCust && existingCust.name.trim().toLowerCase() !== newNameTrimmed.toLowerCase() && newNameTrimmed) {
              await updateCustomer(form.customerId, { name: newNameTrimmed });
              cust = { ...cust, name: newNameTrimmed };
            }
          }
        } else if (ignoreDuplicatePhone && hasValidPhone && formattedCustPhone) {
          cust = await addCustomer({
            name: form.customerName.trim(),
            phone: formattedCustPhone,
            accountType: 'retail',
            notes: form.remark?.trim() || undefined,
            registeredDevices: deviceData ? [{
              id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              brand: deviceData.brand,
              model: deviceData.model,
              notes: deviceData.notes,
              createdAt: new Date().toISOString(),
            }] : undefined,
          });
        } else if (ticketToEdit && ticketToEdit.customerId && !form.customerId) {
          // Editing a ticket but user cleared customerId by typing a new name:
          // Update the original customer's name instead of creating a duplicate
          const newNameTrimmed = form.customerName.trim();
          const originalCust = customers.find(c => c.id === ticketToEdit.customerId);
          if (originalCust && newNameTrimmed) {
            await updateCustomer(ticketToEdit.customerId, {
              name: newNameTrimmed,
              ...(formattedCustPhone ? { phone: formattedCustPhone } : {}),
            });
            cust = { ...originalCust, name: newNameTrimmed };
            // Restore the customerId link so the ticket stays connected
            form.customerId = ticketToEdit.customerId;
          } else if (hasValidPhone && formattedCustPhone) {
            cust = await findOrCreateCustomer({
              name: newNameTrimmed,
              phone: formattedCustPhone,
              notes: form.remark?.trim() || undefined,
              device: deviceData,
            });
          }
        } else if (hasValidPhone && formattedCustPhone) {
          // Customer account requires a phone number besides the name
          cust = await findOrCreateCustomer({
            name: form.customerName.trim(),
            phone: formattedCustPhone,
            notes: form.remark?.trim() || undefined,
            device: deviceData,
          });
        } else {
          // Phone number is missing: do NOT create customer profile
          // Repair record will still be registered as a walk-in without a customer account
          cust = undefined;
        }
      } catch (err) {
        console.warn('Customer auto-create / auto-enrich warning:', err);
      }

      const assignedTechnician = form.assignedTechnician.trim() || ticketToEdit?.assignedTechnician || undefined;
      const newCost = Number(form.estimatedCost) || 0;
      const newDeposit = form.depositAmount ? Number(form.depositAmount) : 0;
      const isCompleted = ticketToEdit?.status === 'completed' || ticketToEdit?.actualCost !== undefined;

      const ticketPayload: Partial<RepairTicket> = {
        customerId: cust?.id || form.customerId || undefined,
        customerName: form.customerName.trim(),
        customerPhone: formattedCustPhone,
        deviceBrand: form.deviceBrand.trim(),
        deviceModel: form.deviceModel.trim(),
        issueDescription: form.issueDescription.trim(),
        remark: form.remark.trim() || undefined,
        estimatedCost: newCost,
        depositAmount: newDeposit,
        estimatedCompletionDate: form.estimatedCompletionDate
          ? (() => {
              const d = new Date(form.estimatedCompletionDate);
              d.setHours(23, 59, 59, 999);
              return d.toISOString();
            })()
          : undefined,
        assignedTechnician,
        lockType: lockType !== 'none' && lockValue.trim() ? lockType : undefined,
        lockValue: lockType !== 'none' && lockValue.trim() ? lockValue.trim() : undefined,
        status: ticketToEdit?.status || (autoStart ? 'in_progress' : 'pending'),
        ...( (!ticketToEdit && prefillCustomer?.parentTicketId) ? { parentTicketId: prefillCustomer.parentTicketId } : {} )
      };

      if (ticketToEdit && isCompleted) {
        const oldPrice = ticketToEdit.actualCost ?? ticketToEdit.estimatedCost ?? 0;
        ticketPayload.actualCost = newCost;

        const totalPaid = ticketToEdit.paidAmount !== undefined ? ticketToEdit.paidAmount : newDeposit;
        if (newCost <= totalPaid) {
          ticketPayload.paymentStatus = 'paid';
        } else if (totalPaid > 0) {
          ticketPayload.paymentStatus = 'partial';
        } else {
          ticketPayload.paymentStatus = 'debt';
        }

        if (ticketToEdit.debtEntryId) {
          try {
            await useCustomerStore.getState().updateDebtAmount(
              ticketToEdit.debtEntryId,
              newCost,
              `Repair #${ticketToEdit.ticketNumber} total adjusted to ${formatCurrency(newCost)}`
            );
          } catch (debtErr) {
            console.error('Failed to update debt entry:', debtErr);
          }
        } else if (newCost > totalPaid && ticketToEdit.customerId) {
          // Gap 3B fix: If price was increased on a fully paid ticket, create a new debt entry for the unpaid remainder
          try {
            const unpaidRemainder = newCost - totalPaid;
            const newDebt = await useCustomerStore.getState().addDebt({
              customerId: ticketToEdit.customerId,
              customerName: ticketToEdit.customerName,
              customerPhone: ticketToEdit.customerPhone,
              productOrService: `Repair #${ticketToEdit.ticketNumber} - ${ticketToEdit.deviceBrand} ${ticketToEdit.deviceModel}`,
              totalAmount: newCost,
              amountPaid: totalPaid,
              date: new Date().toISOString(),
              type: 'repair',
              linkedTicketId: ticketToEdit.id,
              linkedTicketNumber: ticketToEdit.ticketNumber,
              notes: `Repair #${ticketToEdit.ticketNumber} price adjusted to ${formatCurrency(newCost)} (${formatCurrency(unpaidRemainder)} balance due)`,
              payments: totalPaid > 0 ? [{
                id: `pay_${Date.now()}`,
                date: ticketToEdit.createdAt || new Date().toISOString(),
                amount: totalPaid,
                method: 'cash',
                note: 'Prior payment before price edit',
              }] : []
            });
            ticketPayload.debtEntryId = newDebt.id;
          } catch (createDebtErr) {
            console.error('Failed to create debt entry on repair price increase:', createDebtErr);
          }
        }

        // Authoritative recalculation of customer financials on completed price edit
        if (ticketToEdit.customerId) {
          useCustomerStore.getState().recalculateCustomer(ticketToEdit.customerId).catch(console.error);
        }

        if (oldPrice !== newCost) {
          activityLogService.log(
            'repairs',
            `Repair ticket #${ticketToEdit.ticketNumber} price edited on completed ticket`,
            {
              detail: `Price changed from ${formatCurrency(oldPrice)} to ${formatCurrency(newCost)}.`,
              entityId: ticketToEdit.id,
              userName: useAuthStore.getState().user?.name || 'Staff',
              userId: useAuthStore.getState().user?.id,
            }
          ).catch(console.error);
        }
      }

      let resultingTicket: RepairTicket | undefined;

      if (ticketToEdit) {
        await updateTicket(ticketToEdit.id, ticketPayload);
        resultingTicket = { ...ticketToEdit, ...ticketPayload, updatedAt: new Date().toISOString() };
        toast.success('Ticket updated!', `Repair #${ticketToEdit.ticketNumber} details saved.`);
      } else {
        resultingTicket = await createTicket(ticketPayload as any);
        toast.success('Ticket created!', `New repair ticket generated for ${form.customerName}.`);
        onTicketCreated?.(resultingTicket);
      }

      // Handle Direct Thermal Printing if requested
      if (shouldPrint && resultingTicket) {
        try {
          const printRes = await printRepairLabelDirect(resultingTicket, storeName, 1);
          if (printRes.method === 'direct') {
            toast.success(
              'Sticker Printed! 🖨️',
              `Phone label for ${resultingTicket.ticketNumber} (${resultingTicket.deviceBrand} ${resultingTicket.deviceModel}) printed on thermal label printer.`
            );
          } else {
            // Browser print fallback
            if (onPrintTicket) {
              onPrintTicket(resultingTicket);
            } else {
              openPrintWindow(
                buildRepairLabelHTML(resultingTicket, storeName),
                `Repair Sticker - ${resultingTicket.ticketNumber}`
              );
            }
          }
        } catch (printErr: any) {
          console.error('Failed to auto-print label:', printErr);
          toast.error('Print Error', printErr?.message || 'Could not print label automatically.');
        }
      }

      setForm(INITIAL);
      setErrors({});
      clearActiveDraft();
      onClose();
    } catch (err: any) {
      console.error('Failed to submit repair ticket:', err);
      toast.error('Submission failed', err?.message || 'Please try again.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setIsPrinting(false);
    }
  };

  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  // Keyboard shortcut: Ctrl+Enter or Cmd+Enter anywhere in modal to Save & Print Sticker
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleSubmitRef.current(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);

  const handleClose = () => {
    // Don't clear draft on close — it persists for next open!
    // Only reset local UI state
    setErrors({});
    setCustomerQuery('');
    onClose();
  };

  const handleHoldDraft = () => {
    holdDraft();
    setForm(INITIAL);
    setLockType('none');
    setLockValue('');
    setCustomerQuery('');
    setErrors({});
    toast.info('Ticket held', 'Draft saved — you can resume it later from the held tickets strip.');
    onClose();
  };

  // Live balance calculations
  const costNum = Number(form.estimatedCost) || 0;
  const depositNum = Number(form.depositAmount) || 0;
  const balanceNum = Math.max(0, costNum - depositNum);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={ticketToEdit ? "Edit Repair Ticket" : "Check-In New Device"}
      subtitle={ticketToEdit ? `Updating ticket ${ticketToEdit.ticketNumber}` : "Record customer, device diagnosis & security lock code"}
      size="xl"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button variant="ghost" onClick={handleClose} disabled={isBusy}>
              Cancel
            </Button>
            {!ticketToEdit && (
              <Button
                variant="ghost"
                onClick={handleHoldDraft}
                disabled={isBusy || (!form.customerName && !form.deviceBrand && !form.issueDescription)}
                leftIcon={<PauseCircle size={15} />}
              >
                Hold Ticket
              </Button>
            )}
            {!ticketToEdit && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: autoStart ? '#059669' : 'var(--color-on-surface-variant)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: autoStart ? 'rgba(5, 150, 105, 0.08)' : 'transparent',
                  transition: 'all 0.15s ease',
                }}
                title="If checked, ticket starts as 'In Progress' immediately instead of 'Pending'"
              >
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  style={{ accentColor: '#059669' }}
                />
                Start repair immediately
              </label>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Button
              variant="secondary"
              onClick={() => handleSubmit(false)}
              disabled={isBusy}
            >
              {ticketToEdit ? (isBusy && !isPrinting ? "Saving..." : "Save Only") : (isBusy && !isPrinting ? "Creating..." : "Create Only")}
            </Button>

            <Button
              variant="primary"
              onClick={() => handleSubmit(true)}
              isLoading={isBusy && isPrinting}
              disabled={isBusy}
              leftIcon={<Printer size={15} />}
              title="Save ticket and directly print device back sticker (Ctrl+Enter / Cmd+Enter)"
            >
              <span>{ticketToEdit ? "Save & Print Sticker" : "Create & Print Sticker"}</span>
              <kbd style={{
                marginLeft: '6px',
                fontSize: '10px',
                padding: '1px 5px',
                borderRadius: '3px',
                background: 'rgba(255, 255, 255, 0.25)',
                fontWeight: 600,
                letterSpacing: '0.3px',
              }}>
                {typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().indexOf('MAC') >= 0 ? '⌘↵' : 'Ctrl+↵'}
              </kbd>
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.twoColumnLayout}>
        {/* ============================================================
            LEFT COLUMN: Customer, Device & Security Lock
            ============================================================ */}
        <div className={styles.column}>
          {/* Customer Info Card */}
          <div className={styles.cardSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <User size={14} color="var(--color-primary)" />
                <span>Customer Information</span>
              </h3>
              <span className={styles.sectionSub}>Required</span>
            </div>

            {/* Searchable Customer Dropdown */}
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <Input
                label="Customer Name *"
                placeholder="Search returning customer or type new..."
                value={customerQuery}
                onChange={e => {
                  setCustomerQuery(e.target.value);
                  setForm(prev => ({ ...prev, customerName: e.target.value, customerId: '' }));
                  setErrors(err => ({ ...err, customerName: undefined }));
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                error={errors.customerName}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className={dropStyles.dropdown}>
                  {suggestions.map(c => (
                    <div
                      key={c.id}
                      className={dropStyles.option}
                      onMouseDown={() => handleSelectCustomer(c)}
                    >
                      <span className={dropStyles.optionName}>{c.name}</span>
                      <div className={dropStyles.optionRight}>
                        <span className={dropStyles.optionPhone}>{c.phone}</span>
                        {Boolean(c.totalDebt && c.totalDebt > 0) ? (
                          <span className={dropStyles.optionDebt}>
                            ⚠️ Dept: {formatPrivateCurrency(c.totalDebt)}
                          </span>
                        ) : Boolean(c.totalSpent && c.totalSpent > 0) ? (
                          <span className={dropStyles.optionSpent}>
                            Spent: {formatPrivateCurrency(c.totalSpent)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Input
                label="Phone Number (Required for Customer Account)"
                placeholder="e.g. 0550 12 34 56 (Leave empty for walk-in)"
                value={form.customerPhone}
                onChange={e => {
                  set('customerPhone', e.target.value);
                  setIgnoreDuplicatePhone(false);
                }}
                onBlur={() => {
                  if (form.customerPhone.trim()) {
                    set('customerPhone', formatStandardPhone(form.customerPhone));
                  }
                }}
                error={errors.customerPhone}
              />
              <p style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '4px', opacity: 0.8 }}>
                💡 Customer account requires a phone number. Without it, the repair is registered as a walk-in record (accessible in Completed Repairs & views).
              </p>
            </div>

            {/* Intelligent Deduplication & Use Existing / Merge Prompt */}
            {matchedCustomerByPhone && (
              <CustomerDuplicatePromptCard
                existingCustomer={matchedCustomerByPhone}
                enteredName={form.customerName}
                isUpdating={isUpdatingCustomer}
                onUseExisting={() => {
                  setForm(prev => ({
                    ...prev,
                    customerId: matchedCustomerByPhone.id,
                    customerName: matchedCustomerByPhone.name,
                    customerPhone: formatStandardPhone(matchedCustomerByPhone.phone),
                  }));
                  setCustomerQuery(matchedCustomerByPhone.name);
                  setShowSuggestions(false);
                  toast.info('Existing Customer Selected', `Loaded profile for ${matchedCustomerByPhone.name}.`);
                }}
                onUpdateToNewName={async () => {
                  if (!form.customerName.trim()) {
                    setErrors(e => ({ ...e, customerName: 'Customer name is required' }));
                    return;
                  }
                  setIsUpdatingCustomer(true);
                  try {
                    const formattedPhone = formatStandardPhone(form.customerPhone.trim()) || matchedCustomerByPhone.phone;
                    await updateCustomer(matchedCustomerByPhone.id, {
                      name: form.customerName.trim(),
                      phone: formattedPhone,
                    });
                    setForm(prev => ({
                      ...prev,
                      customerId: matchedCustomerByPhone.id,
                      customerPhone: formattedPhone,
                    }));
                    setCustomerQuery(form.customerName.trim());
                    setShowSuggestions(false);
                    toast.success('Customer Profile Updated', `Renamed profile to "${form.customerName.trim()}".`);
                  } catch (err: any) {
                    toast.error('Update Failed', err.message || 'Could not update customer');
                  } finally {
                    setIsUpdatingCustomer(false);
                  }
                }}
                onSaveAsSeparate={() => {
                  setIgnoreDuplicatePhone(true);
                  toast.info('Separate Contact Allowed', `Ticket will be registered under "${form.customerName.trim() || 'this contact'}" without modifying the existing profile.`);
                }}
              />
            )}

            {/* Returning Customer Past History & Loyalty Widget */}
            {form.customerId && (
              <CustomerHistoryWidget
                customerId={form.customerId}
                customerName={form.customerName}
                customerPhone={form.customerPhone}
                currentTicketId={ticketToEdit?.id}
                onSelectDevice={(brand, model) => {
                  set('deviceBrand', brand);
                  set('deviceModel', model);
                  toast.info('Device filled', `Selected ${brand} ${model}`);
                }}
                defaultOpen={true}
              />
            )}
          </div>

          {/* Device Details Card */}
          <div className={styles.cardSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Smartphone size={14} color="var(--color-primary)" />
                <span>Device Details</span>
              </h3>
              <span className={styles.sectionSub}>Select or type brand</span>
            </div>

            {/* Returning Customer Device Vault Selector */}
            {activeCustomerDevices.length > 0 && (
              <div className={styles.vaultSection}>
                <div className={styles.vaultHeader}>
                  <Sparkles size={13} color="#4f46e5" />
                  <span className={styles.vaultTitle}>
                    Customer's Device Vault ({activeCustomerDevices.length})
                  </span>
                  <span className={styles.vaultHint}>Click to 1-click auto-fill</span>
                </div>
                <div className={styles.vaultChips}>
                  {activeCustomerDevices.map(d => {
                    const isActive = form.deviceBrand.toLowerCase() === d.brand.toLowerCase() &&
                      form.deviceModel.toLowerCase() === d.model.toLowerCase();
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={[styles.vaultChip, isActive && styles.vaultChipActive].filter(Boolean).join(' ')}
                        onClick={() => {
                          set('deviceBrand', d.brand);
                          set('deviceModel', d.model);
                          toast.info('Device loaded from vault', `${d.brand} ${d.model}`);
                        }}
                      >
                        <Smartphone size={12} />
                        <span>{d.brand} {d.model}</span>
                        {d.imei && <span className={styles.vaultImeiChip}>· IMEI {d.imei.slice(-4)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick Brand Selector Pills */}
            <div className={styles.brandChips}>
              {BRAND_PRESETS.map(b => {
                const isActive = form.deviceBrand.toLowerCase() === b.name.toLowerCase();
                return (
                  <button
                    key={b.name}
                    type="button"
                    className={[styles.brandChip, isActive && styles.brandChipActive].filter(Boolean).join(' ')}
                    onClick={() => handleSelectBrand(b.name)}
                  >
                    <span>{b.icon}</span>
                    <span>{b.name}</span>
                  </button>
                );
              })}
            </div>

            <div className={styles.grid2}>
              <Input
                label="Brand *"
                placeholder="e.g. Apple, Samsung"
                value={form.deviceBrand}
                onChange={e => set('deviceBrand', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    modelInputRef.current?.focus();
                  }
                }}
                error={errors.deviceBrand}
              />
              <Input
                ref={modelInputRef}
                label="Model *"
                placeholder="e.g. iPhone 15 Pro Max, S24 Ultra"
                value={form.deviceModel}
                onChange={e => set('deviceModel', e.target.value)}
                error={errors.deviceModel}
              />
            </div>
          </div>

          {/* Device Security & Passcode Card — Collapsible */}
          <div className={styles.cardSection}>
            {showLockCode ? (
              <>
                <div className={styles.sectionHeader}>
                  <h3 className={styles.sectionTitle}>
                    <ShieldCheck size={14} color="var(--color-primary)" />
                    <span>Device Passcode / Lock</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => { setShowLockCode(false); setLockType('none'); setLockValue(''); }}
                    style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}
                  >
                    Remove
                  </button>
                </div>
                <LockCodeInput
                  type={lockType}
                  value={lockValue}
                  onTypeChange={setLockType}
                  onValueChange={setLockValue}
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowLockCode(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 14px',
                  background: 'var(--color-surface-variant, #f8fafc)',
                  border: '1px dashed var(--color-border, #e2e8f0)',
                  borderRadius: '8px',
                  color: 'var(--color-on-surface-variant)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <ShieldCheck size={14} style={{ opacity: 0.6 }} />
                🔒 Add Lock Code (optional)
              </button>
            )}
          </div>
        </div>

        {/* ============================================================
            RIGHT COLUMN: Issue Presets, Diagnosis, Timing & Pricing
            ============================================================ */}
        <div className={styles.column}>
          {/* Issue Diagnosis & Quick Presets Card */}
          <div className={styles.cardSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Wrench size={14} color="var(--color-primary)" />
                <span>Issue & Fault Diagnosis</span>
              </h3>
              <span className={styles.sectionSub}>Click presets to add</span>
            </div>

            {/* Quick Issue Preset Buttons Grid */}
            <div className={styles.presetGrid}>
              {ISSUE_PRESETS.map(preset => {
                const escaped = preset.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const isSelected = new RegExp(`(^|,\\s*|/\\s*|•\\s*)${escaped}(,\\s*|/\\s*|$)`, 'i').test(form.issueDescription);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={[styles.presetBtn, isSelected && styles.presetBtnActive].filter(Boolean).join(' ')}
                    onClick={() => handleToggleIssuePreset(preset)}
                    title={preset.label}
                  >
                    <span>{preset.icon}</span>
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>

            <Textarea
              label="Issue Description & Notes *"
              placeholder="Describe faults, physical condition (scratches, cracks), accessories left..."
              value={form.issueDescription}
              onChange={e => set('issueDescription', e.target.value)}
              error={errors.issueDescription}
              rows={3}
            />

          </div>

          {/* Pricing & Live Balance Calculator */}
          <div className={styles.cardSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Calculator size={14} color="var(--color-primary)" />
                <span>Cost & Deposit Calculator</span>
              </h3>
            </div>

            <div className={styles.grid2}>
              <Input
                label={ticketToEdit && (ticketToEdit.status === 'completed' || ticketToEdit.actualCost !== undefined) ? "Repair Final Price *" : "Estimated Total Cost *"}
                type="number"
                placeholder="0.00"
                value={form.estimatedCost}
                onChange={e => set('estimatedCost', e.target.value)}
                error={errors.estimatedCost}
              />
              <Input
                label="Upfront Deposit Paid"
                type="number"
                placeholder="0.00"
                value={form.depositAmount}
                onChange={e => set('depositAmount', e.target.value)}
                error={errors.depositAmount}
              />
            </div>

            {/* Visual Balance Summary */}
            <div className={styles.calculatorCard}>
              <div className={styles.calcRow}>
                <span>{ticketToEdit && (ticketToEdit.status === 'completed' || ticketToEdit.actualCost !== undefined) ? "Repair Final Price:" : "Estimated Service Total:"}</span>
                <span className={styles.calcVal}>{formatCurrency(costNum)}</span>
              </div>
              <div className={styles.calcRow}>
                <span>Upfront Deposit Paid:</span>
                <span className={styles.calcVal} style={{ color: depositNum > 0 ? '#059669' : undefined }}>
                  {depositNum > 0 ? `-${formatCurrency(depositNum)}` : '0.00 DA'}
                </span>
              </div>

              <div className={styles.calcDivider} />

              <div className={styles.calcTotalRow}>
                <span>Remaining Balance Due on Pickup:</span>
                <span className={[styles.balanceHighlight, balanceNum <= 0 && costNum > 0 ? styles.balancePaid : styles.balanceDue].join(' ')}>
                  {balanceNum <= 0 && costNum > 0 ? '✅ Fully Paid' : formatCurrency(balanceNum)}
                </span>
              </div>
            </div>
          </div>

          {/* Timing & Schedule */}
          <div className={styles.cardSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Calendar size={14} color="var(--color-primary)" />
                <span>Schedule & Due Date</span>
              </h3>
            </div>

            <Input
              label="Due / Completion Date"
              type="date"
              value={form.estimatedCompletionDate}
              onChange={e => set('estimatedCompletionDate', e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
