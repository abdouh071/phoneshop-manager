import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidePanel } from '../../components/ui/SlidePanel';
import type { Customer, SaleTransaction, CustomerDebtEntry, RepairTicket, CustomerRegisteredDevice } from '../../types';
import { isShopCustomer } from '../../types';
import {
  Phone, Mail, ShoppingBag, Clock, Smartphone, MessageCircle,
  Wrench, ShoppingCart, Receipt, User, BookOpen, Plus,
  DollarSign, Trash2, Send, AlertTriangle, FileText, Store, FileEdit, RotateCcw,
  GitMerge, ArrowRightLeft, Edit, Edit2, Printer, ChevronDown, ChevronUp, MoreVertical
} from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from 'react-i18next';
import { RepairStatusBadge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ReceiptModal } from '../pos/ReceiptModal';
import { PartsInvoiceModal } from '../parts/PartsInvoiceModal';
import { EditTransactionModal } from '../pos/EditTransactionModal';
import { RefundModal } from '../pos/RefundModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { AddDebtModal } from './AddDebtModal';
import { RecordPaymentModal } from './RecordPaymentModal';
import { AccountStatementModal } from './AccountStatementModal';
import { SwitchAccountTypeModal } from './SwitchAccountTypeModal';
import { MergeCustomersModal } from './MergeCustomersModal';
import { NewTicketModal } from '../repairs/NewTicketModal';
import { PrintRepairTicketModal } from '../repairs/PrintRepairTicketModal';
import styles from './CustomerProfile.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { CustomerActivityLogList } from './CustomerActivityLogList';
import { isDebtOverdue, getDaysOverdue, buildWhatsAppDebtReminderUrl } from '../../utils/debtAlerts';
import { calculateCustomerFinancials, matchesCustomer, normalizeDeviceDetails } from '../../utils/customerFinancials';
import { formatWhatsAppUrl, normalizePhoneDigits } from '../../utils/phoneUtils';
import { isTicketActiveReturnPending } from '../../utils/phoneLifecycle';

interface CustomerProfilePanelProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onNewRepair?: (customer: Customer, lastDevice?: string) => void;
}

type ProfileTab = 'debts' | 'repairs' | 'purchases';

export const CustomerProfilePanel: React.FC<CustomerProfilePanelProps> = ({
  customer: propCustomer,
  isOpen,
  onClose,
  onNewRepair,
}) => {
  const isPrivacyActive = usePrivacyStore((s) => s.isPrivacyActive);
  const { transactions, setCustomerName } = useCartStore();
  const { invoices, fetchInvoices } = usePartsCartStore();
  const { tickets, deleteTicket, deleteDeviceFromCustomer, updateDeviceForCustomer } = useRepairStore();
  const { customers, debts, getCustomerDebts, getCustomerDebtTotal, deleteDebt, updateDebtAmount, deleteCustomer, updateCustomer, getCustomerLogs } = useCustomerStore();
  const { user, isHistoryUnlocked } = useAuthStore();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  // Reactive customer record from customerStore
  const customer = useMemo(() => {
    if (!propCustomer) return null;
    return customers.find(c => c.id === propCustomer.id) || propCustomer;
  }, [propCustomer, customers]);

  useEffect(() => {
    if (invoices.length === 0) {
      fetchInvoices();
    }
  }, [invoices.length, fetchInvoices]);

  const [activeTab, setActiveTab] = useState<ProfileTab>(permissions.customers_debt ? 'debts' : (permissions.repairs ? 'repairs' : 'purchases'));
  const [selectedReceiptTx, setSelectedReceiptTx] = useState<SaleTransaction | null>(null);
  const [selectedInvoiceTx, setSelectedInvoiceTx] = useState<SaleTransaction | null>(null);
  const [txToEdit, setTxToEdit] = useState<SaleTransaction | null>(null);
  const [txToRefund, setTxToRefund] = useState<SaleTransaction | null>(null);
  const [txRequiringUnlock, setTxRequiringUnlock] = useState<{ tx: SaleTransaction; purpose: 'edit' | 'refund' } | null>(null);
  const [debtRequiringUnlock, setDebtRequiringUnlock] = useState<CustomerDebtEntry | null>(null);

  // Management modals state
  const [isSwitchTypeOpen, setIsSwitchTypeOpen] = useState(false);
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [isDeleteCustomerOpen, setIsDeleteCustomerOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const moreMenuRef = React.useRef<HTMLDivElement>(null);

  // Close more menu on click outside
  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreMenuOpen]);

  const [deviceToDelete, setDeviceToDelete] = useState<{ device: string; brand: string; model: string; tickets: any[] } | null>(null);
  const [deleteDeviceRepairsToo, setDeleteDeviceRepairsToo] = useState(false);
  const [deviceToEdit, setDeviceToEdit] = useState<{ id?: string; oldBrand: string; oldModel: string; brand: string; model: string; imei?: string; notes?: string } | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<RepairTicket | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Direct Ticket management in customer profile
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [ticketToEdit, setTicketToEdit] = useState<RepairTicket | null>(null);
  const [ticketPrefillDevice, setTicketPrefillDevice] = useState<string | undefined>(undefined);
  const [printingTicket, setPrintingTicket] = useState<RepairTicket | null>(null);

  // Phone / Device registration state
  const [isAddPhoneOpen, setIsAddPhoneOpen] = useState(false);
  const [newPhoneBrand, setNewPhoneBrand] = useState('');
  const [newPhoneModel, setNewPhoneModel] = useState('');
  const [newPhoneImei, setNewPhoneImei] = useState('');
  const [newPhoneNotes, setNewPhoneNotes] = useState('');
  const [createTicketForNewPhone, setCreateTicketForNewPhone] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isToday = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  };

  const canEditDirectly = (t: SaleTransaction) => {
    if (t.status === 'refunded') return false;
    if (user?.role === 'admin') return true;
    return isToday(t.date);
  };

  const handleDeleteDebt = (debt: CustomerDebtEntry) => {
    if (user?.role === 'admin') {
      if (window.confirm(`Delete debt record for "${debt.productOrService}"?`)) {
        deleteDebt(debt.id);
        toast.info('Debt Deleted', 'Record removed.');
      }
    } else {
      setDebtRequiringUnlock(debt);
    }
  };

  const confirmDeleteCustomer = async () => {
    if (!customer) return;
    setIsActionLoading(true);
    try {
      await deleteCustomer(customer.id, { deleteDebts: true });
      toast.success('Customer Deleted', `${customer.name} has been removed.`);
      setIsDeleteCustomerOpen(false);
      onClose();
    } catch (err) {
      toast.error('Failed to delete customer', 'An error occurred while deleting customer.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmDeleteDevice = async () => {
    if (!customer || !deviceToDelete) return;
    setIsActionLoading(true);
    try {
      const brand = deviceToDelete.brand;
      const model = deviceToDelete.model;

      // Step 1: Optionally delete all linked repair tickets for this device
      let deletedTicketCount = 0;
      if (deleteDeviceRepairsToo && deviceToDelete.tickets.length > 0) {
        deletedTicketCount = await deleteDeviceFromCustomer(
          customer.id,
          customer.phone,
          brand,
          model
        );
      }

      // Step 2: Remove device from registeredDevices array
      if (customer.registeredDevices && customer.registeredDevices.length > 0) {
        const cleanBrand = brand.toLowerCase().trim();
        const cleanModel = model.toLowerCase().trim();
        const updatedDevs = customer.registeredDevices.filter(
          d => (d.brand || '').toLowerCase().trim() !== cleanBrand || (d.model || '').toLowerCase().trim() !== cleanModel
        );
        if (updatedDevs.length !== customer.registeredDevices.length) {
          await updateCustomer(customer.id, { registeredDevices: updatedDevs });
        }
      }

      const ticketMsg = deletedTicketCount > 0
        ? ` ${deletedTicketCount} repair ticket(s) also deleted.`
        : ' Repair history preserved.';
      toast.success(
        'Device Removed',
        `${deviceToDelete.device} removed from ${customer.name}'s profile.${ticketMsg}`
      );
      setDeviceToDelete(null);
      setDeleteDeviceRepairsToo(false);
    } catch (err) {
      toast.error('Failed to remove device', 'An error occurred.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmEditDevice = async () => {
    if (!customer || !deviceToEdit) return;
    const { oldBrand, oldModel, brand, model, imei, notes } = deviceToEdit;
    if (!brand.trim() || !model.trim()) {
      toast.error('Validation error', 'Both Brand and Model are required.');
      return;
    }
    setIsActionLoading(true);
    try {
      const count = await updateDeviceForCustomer(
        customer.id,
        customer.phone,
        oldBrand,
        oldModel,
        brand.trim(),
        model.trim()
      );

      const cleanOldBrand = oldBrand.toLowerCase().trim();
      const cleanOldModel = oldModel.toLowerCase().trim();
      const existingDevices = customer.registeredDevices || [];
      const isAlreadyInRegistered = existingDevices.some(
        d => (d.brand || '').toLowerCase().trim() === cleanOldBrand && (d.model || '').toLowerCase().trim() === cleanOldModel
      );

      let updatedDevs: CustomerRegisteredDevice[];
      if (isAlreadyInRegistered) {
        updatedDevs = existingDevices.map(d => {
          if ((d.brand || '').toLowerCase().trim() === cleanOldBrand && (d.model || '').toLowerCase().trim() === cleanOldModel) {
            return {
              ...d,
              brand: brand.trim(),
              model: model.trim(),
              imei: imei !== undefined ? imei.trim() || undefined : d.imei,
              notes: notes !== undefined ? notes.trim() || undefined : d.notes,
            };
          }
          return d;
        });
      } else {
        const newDev: CustomerRegisteredDevice = {
          id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          brand: brand.trim(),
          model: model.trim(),
          imei: imei?.trim() || undefined,
          notes: notes?.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
        updatedDevs = [...existingDevices, newDev];
      }

      await updateCustomer(customer.id, { registeredDevices: updatedDevs });

      toast.success(
        'Phone Device Updated',
        `Updated to ${brand.trim()} ${model.trim()}${count > 0 ? ` (${count} repair records updated)` : ''}.`
      );
      setDeviceToEdit(null);
    } catch (err) {
      toast.error('Failed to update device', 'An error occurred.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmAddPhone = async () => {
    if (!customer) return;
    if (!newPhoneBrand.trim() || !newPhoneModel.trim()) {
      toast.error('Validation error', 'Please provide both phone brand and model.');
      return;
    }
    setIsActionLoading(true);
    try {
      const brand = newPhoneBrand.trim();
      const model = newPhoneModel.trim();
      const imei = newPhoneImei.trim() || undefined;
      const notes = newPhoneNotes.trim() || undefined;

      const existingDevices = customer.registeredDevices || [];
      const newDev: CustomerRegisteredDevice = {
        id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        brand,
        model,
        imei,
        notes,
        createdAt: new Date().toISOString(),
      };

      await updateCustomer(customer.id, {
        registeredDevices: [...existingDevices, newDev],
      });

      toast.success('Phone Added', `${brand} ${model} registered for ${customer.name}.`);
      setIsAddPhoneOpen(false);
      setNewPhoneBrand('');
      setNewPhoneModel('');
      setNewPhoneImei('');
      setNewPhoneNotes('');

      if (createTicketForNewPhone) {
        setTicketPrefillDevice(`${brand} ${model}`);
        setTicketToEdit(null);
        setIsNewTicketOpen(true);
      }
    } catch (err) {
      toast.error('Failed to add phone', 'An error occurred.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmDeleteSingleTicket = async () => {
    if (!ticketToDelete) return;
    setIsActionLoading(true);
    try {
      await deleteTicket(ticketToDelete.id);
      toast.success('Repair Ticket Deleted', `Ticket #${ticketToDelete.ticketNumber} was deleted.`);
      setTicketToDelete(null);
    } catch (err) {
      toast.error('Failed to delete ticket', 'An error occurred.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleEditTx = (t: SaleTransaction) => {
    if (t.status === 'refunded') return;
    if (canEditDirectly(t)) {
      setTxToEdit(t);
    } else {
      setTxRequiringUnlock({ tx: t, purpose: 'edit' });
    }
  };

  const handleRefundTx = (t: SaleTransaction) => {
    if (t.status === 'refunded') return;
    if (canEditDirectly(t)) {
      setTxToRefund(t);
    } else {
      setTxRequiringUnlock({ tx: t, purpose: 'refund' });
    }
  };

  const handleUnlockSuccess = () => {
    if (!txRequiringUnlock) return;
    const { tx, purpose } = txRequiringUnlock;
    setTxRequiringUnlock(null);
    if (purpose === 'refund') setTxToRefund(tx);
    else setTxToEdit(tx);
  };
  
  // Debt & Statement Modals State
  const [isAddDebtOpen, setIsAddDebtOpen] = useState(false);
  const [selectedDebtForPayment, setSelectedDebtForPayment] = useState<CustomerDebtEntry | null>(null);
  const [isStatementOpen, setIsStatementOpen] = useState(false);

  // Inline Debt Editing State
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [editDebtName, setEditDebtName] = useState('');
  const [editDebtAmount, setEditDebtAmount] = useState('');

  // Problem 2 fix: Admin unlock state for debt operations (add, edit, record payment)
  const [debtAddRequiringUnlock, setDebtAddRequiringUnlock] = useState(false);
  const [debtPaymentRequiringUnlock, setDebtPaymentRequiringUnlock] = useState<CustomerDebtEntry | null>(null);
  const [debtEditRequiringUnlock, setDebtEditRequiringUnlock] = useState<CustomerDebtEntry | null>(null);

  // Problem 2 fix: Gated handlers for debt operations
  const handleAddDebtClick = () => {
    if (user?.role === 'admin') {
      setIsAddDebtOpen(true);
    } else {
      setDebtAddRequiringUnlock(true);
    }
  };

  const handleRecordPaymentClick = (debt: CustomerDebtEntry) => {
    if (user?.role === 'admin') {
      setSelectedDebtForPayment(debt);
    } else {
      setDebtPaymentRequiringUnlock(debt);
    }
  };

  const handleEditDebtClick = (debt: CustomerDebtEntry) => {
    if (user?.role === 'admin') {
      setEditDebtName(debt.productOrService);
      setEditDebtAmount(String(debt.totalAmount));
      setEditingDebtId(debt.id);
    } else {
      setDebtEditRequiringUnlock(debt);
    }
  };

  // Normalized matching (Phone digits + case-insensitive name)
  const normalizePhone = (p: string) => p.replace(/\D/g, '');
  const custPhone = customer ? normalizePhone(customer.phone) : '';
  const custNameLower = customer ? customer.name.toLowerCase().trim() : '';

  const allTxs = useMemo(() => {
    const txMap = new Map<string, SaleTransaction>();
    [...transactions, ...invoices].forEach(tx => {
      if (tx && tx.id) txMap.set(tx.id, tx);
    });
    return Array.from(txMap.values());
  }, [transactions, invoices]);

  const customerTxs = useMemo(() => {
    if (!customer) return [];
    return allTxs
      .filter(tx => matchesCustomer(customer, tx))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allTxs, customer]);

  const customerTickets = useMemo(() => {
    if (!customer) return [];
    return tickets
      .filter(tk => matchesCustomer(customer, tk))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tickets, customer]);

  // Customer debts and logs (robust match by ID, phone, or name)
  const customerDebts = useMemo(() => {
    if (!customer) return [];
    return debts
      .filter(d => matchesCustomer(customer, d) || d.customerId === customer.id)
      .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
  }, [customer, debts]);

  const totalDebtBalance = useMemo(() => {
    return customerDebts
      .filter(d => d.status !== 'paid')
      .reduce((sum, d) => sum + d.remainingBalance, 0);
  }, [customerDebts]);

  const customerLogs = customer ? getCustomerLogs(customer.id) : [];

  // Authoritative real-time customer financials
  const customerFinancials = useMemo(() => {
    if (!customer) return { totalSpent: 0, totalPurchases: 0, totalDebt: 0, ticketsCount: 0 };
    return calculateCustomerFinancials(customer, customerTickets, customerTxs, customerDebts);
  }, [customer, customerTickets, customerTxs, customerDebts]);

  // Device Fleet calculation (smart canonical normalization + IMEI deduplication + repair tickets & registered devices)
  const deviceStats = useMemo(() => {
    if (!customer) return [];
    const map: Record<string, {
      id?: string;
      displayName: string;
      brand: string;
      model: string;
      imei?: string;
      notes?: string;
      count: number;
      totalSpent: number;
      issues: string[];
      tickets: typeof customerTickets;
      isRegisteredOnly?: boolean;
    }> = {};

    // 1. From repair tickets
    customerTickets.forEach(tk => {
      const { brand, model, displayName, canonicalKey } = normalizeDeviceDetails(tk.deviceBrand, tk.deviceModel);
      const imei = (tk.serialNumber || tk.imei || '').trim();

      // Find by IMEI if available, or by canonical key
      let key = canonicalKey;
      if (imei) {
        const existingKey = Object.keys(map).find(k => map[k].imei && map[k].imei === imei);
        if (existingKey) key = existingKey;
      }

      if (!map[key]) {
        map[key] = {
          displayName,
          brand,
          model,
          imei: imei || undefined,
          count: 0,
          totalSpent: 0,
          issues: [],
          tickets: [],
        };
      } else {
        if (displayName.length > map[key].displayName.length) {
          map[key].displayName = displayName;
        }
        if (imei && !map[key].imei) {
          map[key].imei = imei;
        }
      }

      map[key].count++;
      const cost = tk.actualCost != null && tk.actualCost > 0 ? tk.actualCost : (tk.estimatedCost || 0);
      map[key].totalSpent += cost;
      if (tk.issueDescription && !map[key].issues.includes(tk.issueDescription)) {
        map[key].issues.push(tk.issueDescription);
      }
      map[key].tickets.push(tk);
    });

    // 2. From customer.registeredDevices
    (customer.registeredDevices || []).forEach(dev => {
      const { brand, model, displayName, canonicalKey } = normalizeDeviceDetails(dev.brand, dev.model);
      const imei = (dev.imei || '').trim();

      let key = canonicalKey;
      if (imei) {
        const existingKey = Object.keys(map).find(k => map[k].imei && map[k].imei === imei);
        if (existingKey) key = existingKey;
      }

      if (!map[key]) {
        map[key] = {
          id: dev.id,
          displayName,
          brand,
          model,
          imei: imei || undefined,
          notes: dev.notes,
          count: 0,
          totalSpent: 0,
          issues: [],
          tickets: [],
          isRegisteredOnly: true,
        };
      } else {
        map[key].id = dev.id || map[key].id;
        map[key].imei = imei || map[key].imei;
        map[key].notes = dev.notes || map[key].notes;
      }
    });

    // Sort tickets inside each device newest first
    Object.values(map).forEach(d => {
      d.tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });

    return Object.entries(map).map(([_, data]) => [data.displayName, data] as const);
  }, [customerTickets, customer]);

  const mostRecentDevice = deviceStats.length > 0 ? deviceStats[0][0] : undefined;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Early return only AFTER all React hooks have been called
  if (!customer) return null;

  const handleStartSale = () => {
    setCustomerName(customer.name);
    if (customer.wholesaleDiscountPercent && customer.wholesaleDiscountPercent > 0) {
      useCartStore.getState().setDiscount(customer.wholesaleDiscountPercent);
      toast.success('B2B Discount Applied', `${customer.name} attached with ${customer.wholesaleDiscountPercent}% wholesale discount.`);
    } else {
      toast.success('Customer Attached', `${customer.name} attached to the active cart.`);
    }
    onClose();
    navigate('/pos');
  };

  const handleStartPartsOrder = () => {
    usePartsCartStore.getState().setSelectedCustomer(customer);
    if (customer.wholesaleDiscountPercent && customer.wholesaleDiscountPercent > 0) {
      usePartsCartStore.getState().setDiscount(customer.wholesaleDiscountPercent);
      toast.success('B2B Discount Applied', `${customer.shopName || customer.name} attached with ${customer.wholesaleDiscountPercent}% wholesale discount.`);
    } else {
      toast.success('B2B Account Attached', `${customer.shopName || customer.name} attached for parts order.`);
    }
    onClose();
    navigate(`/parts?b2bCustomer=${customer.id}`);
  };

  const handleStartRepair = () => {
    if (onNewRepair) {
      onNewRepair(customer, mostRecentDevice);
    }
  };

  return (
    <>
      <SlidePanel
        isOpen={isOpen}
        onClose={onClose}
        title={t('customers.profile', 'Customer Profile')}
        width="xl"
      >
        <div className={styles.container}>
          {/* Header Card with Quick Actions */}
          <div className={styles.header}>
            <div className={styles.headerTop}>
              <div className={styles.headerLeft}>
                <div className={styles.avatar} style={customer.shopName ? { background: '#eff6ff', color: '#2563eb' } : undefined}>
                  {customer.shopName ? <Store size={22} /> : customer.name[0]}
                </div>
                <div className={styles.headerInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h2 className={styles.name}>{customer.shopName ? customer.shopName : customer.name}</h2>
                    {customer.shopName && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#dbeafe',
                        color: '#1e40af',
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }}>
                        {t('common.b2bShop', 'B2B Shop')}
                      </span>
                    )}
                    {customer.wholesaleDiscountPercent && customer.wholesaleDiscountPercent > 0 && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#dcfce7',
                        color: '#15803d',
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }} title={`Automatic ${customer.wholesaleDiscountPercent}% wholesale discount applied in POS and Parts`}>
                        🏷️ {customer.wholesaleDiscountPercent}% Wholesale
                      </span>
                    )}
                    {customer.id.startsWith('offline_') && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#fef3c7',
                        color: '#b45309',
                        border: '1px solid #fde68a',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }} title="Created offline. Queued to sync to Firestore automatically.">
                        ☁️ Offline
                      </span>
                    )}
                  </div>

                  {customer.shopName && (
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 3px 0' }}>
                      Contact: <strong>{customer.name}</strong>
                    </p>
                  )}

                  <div className={styles.contactRow}>
                    <a href={`tel:${customer.phone}`} className={styles.contactItem} title="Call customer">
                      <Phone size={13} /> {customer.phone}
                    </a>
                    {customer.email && (
                      <a href={`mailto:${customer.email}`} className={styles.contactItem} title="Send email">
                        <Mail size={13} /> {customer.email}
                      </a>
                    )}
                    {customer.creditLimit && customer.creditLimit > 0 && (
                      <span style={{ fontSize: '11px', color: '#475569' }}>
                        Limit: <strong style={{ color: '#2563eb' }}>{formatPrivateCurrency(customer.creditLimit)}</strong>
                      </span>
                    )}
                  </div>

                  {/* B2B Legal IDs — only visible if shop customer has them filled */}
                  {isShopCustomer(customer) && (customer.rc || customer.nif || customer.nis || customer.art) && (
                    <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {customer.rc && <span>RC: <strong style={{ color: '#334155' }}>{customer.rc}</strong></span>}
                      {customer.nif && <span>NIF: <strong style={{ color: '#334155' }}>{customer.nif}</strong></span>}
                      {customer.nis && <span>NIS: <strong style={{ color: '#334155' }}>{customer.nis}</strong></span>}
                      {customer.art && <span>Art: <strong style={{ color: '#334155' }}>{customer.art}</strong></span>}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className={styles.headerActions}>
                {(() => {
                  const waUrl = formatWhatsAppUrl(customer.phone);
                  return waUrl ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={[styles.actionBtn, styles.actionBtnWa].join(' ')}
                      title="Message on WhatsApp"
                    >
                      <MessageCircle size={14} /> WA
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className={[styles.actionBtn, styles.actionBtnWa].join(' ')}
                      style={{ opacity: 0.4, cursor: 'not-allowed' }}
                      title="No valid phone number on file"
                    >
                      <MessageCircle size={14} /> WA
                    </button>
                  );
                })()}

                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setIsStatementOpen(true)}
                  style={{ background: '#f8fafc', color: '#0f172a', borderColor: '#cbd5e1' }}
                  title="Generate Account Statement (Relevé de Compte)"
                >
                  <FileText size={14} /> {t('common.statement', 'Statement')}
                </button>

                {permissions.repairs && (
                  <button
                    type="button"
                    className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                    onClick={handleStartRepair}
                    title="New Repair Ticket"
                  >
                    <Wrench size={14} /> {t('common.repair', 'Repair')}
                  </button>
                )}

                {permissions.inventory_parts && isShopCustomer(customer) && (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={handleStartPartsOrder}
                    style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
                    title="New Parts Order"
                  >
                    <Store size={14} /> {t('common.parts', 'Parts')}
                  </button>
                )}

                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={handleStartSale}
                  title="New POS Sale"
                >
                  <ShoppingCart size={14} /> {t('common.pos', 'POS')}
                </button>

                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    setNewPhoneBrand('');
                    setNewPhoneModel('');
                    setNewPhoneImei('');
                    setNewPhoneNotes('');
                    setCreateTicketForNewPhone(false);
                    setIsAddPhoneOpen(true);
                  }}
                  style={{ background: '#f5f3ff', color: '#6d28d9', borderColor: '#ddd6fe' }}
                  title="Register New Phone to Customer Account"
                >
                  <Smartphone size={14} /> {t('common.addPhone', '+ Phone')}
                </button>

                {/* More Options Dropdown (Administrative Actions) */}
                <div className={styles.moreMenuContainer} ref={moreMenuRef}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => setIsMoreMenuOpen(prev => !prev)}
                    title="Account Actions & Settings"
                    style={{ padding: '6px 8px' }}
                  >
                    <MoreVertical size={15} />
                  </button>

                  {isMoreMenuOpen && (
                    <div className={styles.moreMenuDropdown}>
                      <button
                        type="button"
                        className={styles.moreMenuItem}
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsSwitchTypeOpen(true);
                        }}
                      >
                        {isShopCustomer(customer) ? <User size={14} /> : <Store size={14} />}
                        <span>{isShopCustomer(customer) ? t('customers.switchToRetail', 'Switch to Retail') : t('customers.switchToShop', 'Switch to B2B Shop')}</span>
                      </button>

                      <button
                        type="button"
                        className={styles.moreMenuItem}
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsMergeOpen(true);
                        }}
                      >
                        <GitMerge size={14} />
                        <span>{t('customers.mergeAccount', 'Merge Account')}</span>
                      </button>

                      <button
                        type="button"
                        className={styles.moreMenuItem}
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsActivityModalOpen(true);
                        }}
                      >
                        <Clock size={14} />
                        <span>{t('customers.viewAudit', 'View Audit & Activity Log')}</span>
                      </button>

                      <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />

                      <button
                        type="button"
                        className={[styles.moreMenuItem, styles.moreMenuItemDanger].join(' ')}
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsDeleteCustomerOpen(true);
                        }}
                      >
                        <Trash2 size={14} />
                        <span>{t('customers.deleteClient', 'Delete Client')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* KPI Summary */}
          <div className={styles.stats}>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>{t('common.totalSpent', 'Total Spent')}</span>
              <span className={styles.statValue}>{formatPrivateCurrency(customerFinancials.totalSpent)}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>{t('common.orders', 'Orders')}</span>
              <span className={styles.statValue}>{customerFinancials.totalPurchases}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>{t('common.repairs', 'Repairs')}</span>
              <span className={styles.statValue}>{customerTickets.length}</span>
            </div>
            <div className={styles.statBox} style={{ background: customerFinancials.totalDebt > 0 ? '#fef2f2' : undefined, borderColor: customerFinancials.totalDebt > 0 ? '#fecaca' : undefined }}>
              <span className={styles.statLabel} style={{ color: customerFinancials.totalDebt > 0 ? '#991b1b' : undefined }}>{t('common.debtBalance', 'Debt Balance')}</span>
              <span className={styles.statValue} style={{ color: customerFinancials.totalDebt > 0 ? '#dc2626' : undefined }}>
                {formatPrivateCurrency(customerFinancials.totalDebt)}
              </span>
            </div>
            {(customer.storeCredit || 0) > 0 && (
              <div className={styles.statBox} style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                <span className={styles.statLabel} style={{ color: '#065f46' }}>🎟️ {t('common.storeCredit', 'Store Credit (Avoir)')}</span>
                <span className={styles.statValue} style={{ color: '#059669' }}>
                  {formatPrivateCurrency(customer.storeCredit || 0)}
                </span>
              </div>
            )}
          </div>

          {/* Registered Phones Section — Clean, Compact Fleet */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Smartphone size={15} /> {t('common.registeredPhones', 'Registered Phones')} ({deviceStats.length})
              </h3>
              <button
                type="button"
                onClick={() => {
                  setNewPhoneBrand('');
                  setNewPhoneModel('');
                  setNewPhoneImei('');
                  setNewPhoneNotes('');
                  setCreateTicketForNewPhone(false);
                  setIsAddPhoneOpen(true);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 9px',
                  borderRadius: '6px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#1d4ed8',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Register a new phone for this customer"
              >
                <Plus size={12} /> {t('customers.addPhone', 'Add Phone')}
              </button>
            </div>

            {deviceStats.length === 0 ? (
              <div style={{
                padding: '12px 16px',
                background: 'var(--color-surface-container-low, #f8fafc)',
                border: '1px dashed #cbd5e1',
                borderRadius: '8px',
                textAlign: 'center',
                fontSize: '12px',
                color: '#64748b'
              }}>
                {t('customers.noPhonesRegistered', 'No phones registered yet.')}
              </div>
            ) : (
              <div className={styles.deviceGrid}>
                {deviceStats.map(([device, data]) => (
                  <div key={device} className={styles.deviceCard}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: '#eff6ff',
                          color: '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Smartphone size={16} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p className={styles.deviceName} style={{ fontSize: '13px', margin: 0 }}>
                            {device || 'Unknown Device'}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                              {data.count > 0 ? t('common.broughtTimes', { count: data.count, defaultValue: `${data.count} repairs` }) : t('customers.registeredPhone', 'Registered phone')}
                            </span>
                            {data.imei && (
                              <span style={{ fontSize: '10px', color: '#4f46e5', background: '#eef2ff', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                                IMEI: {data.imei}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Compact Quick Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        {permissions.repairs && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketPrefillDevice(device);
                              setTicketToEdit(null);
                              setIsNewTicketOpen(true);
                            }}
                            title={`New repair ticket for ${device}`}
                            className={styles.compactDeviceBtn}
                          >
                            <Wrench size={11} />
                            <span>{t('common.ticket', 'Ticket')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeviceToEdit({
                              id: data.id,
                              oldBrand: data.brand || device.split(' ')[0] || '',
                              oldModel: data.model || device.split(' ').slice(1).join(' ') || '',
                              brand: data.brand || device.split(' ')[0] || '',
                              model: data.model || device.split(' ').slice(1).join(' ') || '',
                              imei: data.imei || '',
                              notes: data.notes || '',
                            });
                          }}
                          title={`${t('common.edit', 'Edit')} ${device}`}
                          className={styles.compactIconBtn}
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const ticketCount = data.tickets.length;
                            setDeleteDeviceRepairsToo(ticketCount > 0);
                            setDeviceToDelete({
                              device,
                              brand: data.brand || device.split(' ')[0] || '',
                              model: data.model || device.split(' ').slice(1).join(' ') || '',
                              tickets: data.tickets,
                            });
                          }}
                          title={`${t('common.delete', 'Delete')} ${device}`}
                          className={styles.compactIconBtnDanger}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {data.notes && (
                      <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0', fontStyle: 'italic' }}>
                        📝 {data.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tab Segmented Controls — 3 Core Operational Tabs */}
          <div className={styles.tabBar}>
            {permissions.customers_debt && (
              <button
                type="button"
                className={[styles.tabBtn, activeTab === 'debts' && styles.tabBtnActive].filter(Boolean).join(' ')}
                onClick={() => setActiveTab('debts')}
              >
                <BookOpen size={14} />
                <span>{t('customers.creditLedger', 'Credit Ledger')}</span>
                <span className={styles.tabBadge} style={{ background: totalDebtBalance > 0 ? '#fee2e2' : undefined, color: totalDebtBalance > 0 ? '#dc2626' : undefined }}>
                  {customerDebts.length}
                </span>
              </button>
            )}
            {permissions.repairs && (
              <button
                type="button"
                className={[styles.tabBtn, activeTab === 'repairs' && styles.tabBtnActive].filter(Boolean).join(' ')}
                onClick={() => setActiveTab('repairs')}
              >
                <Wrench size={14} />
                <span>{t('common.repairs', 'Repairs')}</span>
                <span className={styles.tabBadge}>{customerTickets.length}</span>
              </button>
            )}
            <button
              type="button"
              className={[styles.tabBtn, activeTab === 'purchases' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('purchases')}
            >
              <ShoppingBag size={14} />
              <span>{t('common.purchases', 'Purchases')}</span>
              <span className={styles.tabBadge}>{customerTxs.length}</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className={styles.historyList}>
            {/* Credit Ledger Tab */}
            {activeTab === 'debts' && (
              <>
                <div className={styles.debtSummaryBanner}>
                  <div className={styles.debtSummaryLeft}>
                    <span className={styles.debtSummaryLabel}>{t('customers.totalOutstandingDebt', 'Total Outstanding Debt')}</span>
                    <p className={styles.debtSummaryValue}>{formatPrivateCurrency(totalDebtBalance)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={styles.addDebtBtn}
                      onClick={() => setIsStatementOpen(true)}
                      style={{ background: '#ffffff', color: '#1e293b', border: '1px solid #cbd5e1' }}
                      title="Generate Full Account Statement & PDF"
                    >
                      <FileText size={13} /> {t('customers.statementPdf', 'Statement / PDF')}
                    </button>
                    <button
                      type="button"
                      className={styles.addDebtBtn}
                      onClick={() => handleAddDebtClick()}
                    >
                      <Plus size={14} /> {t('customers.addDebtRecord', '+ Add Debt Record')}
                    </button>
                  </div>
                </div>

                {customerDebts.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t('customers.noDebtsFound', 'No debt or credit records found for this customer. All settled!')}
                  </div>
                ) : (
                  customerDebts.map(debt => {
                    const pct = debt.totalAmount > 0 ? Math.min(100, (debt.amountPaid / debt.totalAmount) * 100) : 0;
                    const overdue = isDebtOverdue(debt);
                    const daysLate = getDaysOverdue(debt.dueDate);

                    return (
                      <div key={debt.id} className={styles.debtCard} data-privacy-client-financial="true" style={overdue ? { borderColor: '#fca5a5', background: '#fffafa' } : {}}>
                        {editingDebtId === debt.id ? (
                          /* ── Inline Edit Mode ── */
                          <div className={styles.debtEditForm}>
                            <div className={styles.debtEditField}>
                              <label className={styles.debtEditLabel}>Item / Phone Name</label>
                              <input
                                type="text"
                                className={styles.debtEditInput}
                                value={editDebtName}
                                onChange={e => setEditDebtName(e.target.value)}
                                placeholder="e.g. iPhone 14 Pro Max"
                                autoFocus
                              />
                            </div>
                            <div className={styles.debtEditField}>
                              <label className={styles.debtEditLabel}>Total Amount (DH)</label>
                              <input
                                type="number"
                                className={`${styles.debtEditInput} privacy-cost-input`}
                                value={editDebtAmount}
                                onChange={e => setEditDebtAmount(e.target.value)}
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                              />
                            </div>
                            <div className={styles.debtEditActions}>
                              <button
                                type="button"
                                className={styles.debtEditSaveBtn}
                                onClick={async () => {
                                  const newAmount = parseFloat(editDebtAmount);
                                  const newName = editDebtName.trim();
                                  if (!newName) { toast.error('Validation', 'Item name cannot be empty.'); return; }
                                  if (isNaN(newAmount) || newAmount < 0) { toast.error('Validation', 'Amount must be a valid positive number.'); return; }
                                  if (newAmount < debt.amountPaid) { toast.error('Validation', `Amount cannot be less than already paid (${formatPrivateCurrency(debt.amountPaid)}).`); return; }
                                  try {
                                    await updateDebtAmount(debt.id, newAmount, newName);
                                    toast.success('Debt Updated', `Updated to "${newName}" — ${formatPrivateCurrency(newAmount)}`);
                                    setEditingDebtId(null);
                                  } catch {
                                    toast.error('Error', 'Failed to update debt record.');
                                  }
                                }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className={styles.debtEditCancelBtn}
                                onClick={() => setEditingDebtId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Normal View Mode ── */
                          <>
                        <div className={styles.debtCardHeader}>
                          <div>
                            <p className={styles.debtTitle}>{debt.productOrService}</p>
                            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                              Taken on {formatDate(debt.date)}
                              {debt.dueDate ? (
                                <strong style={{ color: overdue ? '#dc2626' : undefined }}>
                                  {` · Due by ${formatDate(debt.dueDate)}`}
                                </strong>
                              ) : ''}
                            </span>
                          </div>
                          <div>
                            {debt.status === 'paid' ? (
                              <span className={styles.debtBadgePaid}>✅ Settled</span>
                            ) : overdue ? (
                              <span className={styles.debtBadgeOverdue}>🔴 OVERDUE ({daysLate}d late)</span>
                            ) : debt.status === 'partially_paid' ? (
                              <span className={styles.debtBadgePartial}>🟡 Partial ({formatPrivateCurrency(debt.remainingBalance)} left)</span>
                            ) : (
                              <span className={styles.debtBadgeUnpaid}>🚨 Unpaid</span>
                            )}
                          </div>
                        </div>

                        {debt.notes && (
                          <p className={styles.debtNotes}>{debt.notes}</p>
                        )}

                        {/* Progress track */}
                        <div>
                          <div className={styles.debtProgressTrack}>
                            <div className={styles.debtProgressBar} style={{ width: `${pct}%`, background: overdue ? '#dc2626' : '#16a34a' }} />
                          </div>
                          <div className={styles.debtNumbersRow} style={{ marginTop: '4px' }}>
                            <span>Paid: {formatPrivateCurrency(debt.amountPaid)} ({Math.round(pct)}%)</span>
                            <span style={{ fontWeight: 700, color: debt.remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                              Balance Owed: {formatPrivateCurrency(debt.remainingBalance)}
                            </span>
                          </div>
                        </div>

                        {/* Payment History Log */}
                        {debt.payments && debt.payments.length > 0 && (
                          <div className={styles.paymentHistoryList}>
                            <p className={styles.paymentHistoryTitle}>Payment History ({debt.payments.length})</p>
                            {debt.payments.map(pay => (
                              <div key={pay.id} className={styles.paymentHistoryRow} data-privacy-client-financial="true">
                                <span>{formatDate(pay.date)} · {pay.method.toUpperCase()} {pay.note ? `(${pay.note})` : ''}</span>
                                <strong style={{ color: '#16a34a' }}>+{formatPrivateCurrency(pay.amount)}</strong>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className={styles.debtActionsRow}>
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                            Total: {formatPrivateCurrency(debt.totalAmount)}
                          </span>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {debt.remainingBalance > 0 && (
                              <a
                                href={buildWhatsAppDebtReminderUrl({
                                  customerName: customer.name,
                                  customerPhone: customer.phone,
                                  productOrService: debt.productOrService,
                                  amountOwed: debt.remainingBalance,
                                  dueDate: debt.dueDate,
                                  daysOverdue: daysLate,
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.payDebtBtn}
                                style={{ background: '#25D366', textDecoration: 'none' }}
                                title={overdue ? `Send WhatsApp Overdue Reminder (${daysLate}d late)` : 'Send WhatsApp Reminder'}
                              >
                                <Send size={12} /> WhatsApp Reminder
                              </a>
                            )}
                            {debt.remainingBalance > 0 && (
                              <button
                                type="button"
                                className={styles.payDebtBtn}
                                onClick={() => handleRecordPaymentClick(debt)}
                              >
                                <DollarSign size={13} /> Record Payment
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleEditDebtClick(debt)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#3b82f6',
                                cursor: 'pointer',
                              }}
                              title="Edit item name & amount"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDebt(debt)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#94a3b8',
                                cursor: 'pointer',
                              }}
                              title={user?.role === 'admin' ? "Delete record" : "Delete record (Requires Admin Password)"}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* Repairs Tab */}
            {permissions.repairs && activeTab === 'repairs' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    {customerTickets.length} {customerTickets.length === 1 ? 'ticket' : 'tickets'} linked to this customer
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTicketPrefillDevice(mostRecentDevice);
                      setTicketToEdit(null);
                      setIsNewTicketOpen(true);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={12} /> New Ticket
                  </button>
                </div>

                {customerTickets.length === 0 ? (
                  <div className={styles.emptyState}>
                    No repair tickets logged for this customer yet.
                  </div>
                ) : (
                  customerTickets.map(tk => {
                    const isActivelyReturned = isTicketActiveReturnPending(tk, tickets);
                    const effectiveStatus = (tk.status === 'returned' && !isActivelyReturned) ? 'completed' : tk.status;
                    const totalCost = tk.actualCost ?? tk.estimatedCost ?? 0;
                    const deposit = tk.depositAmount || 0;
                    const paid = tk.paidAmount ?? deposit;
                    const debt = Math.max(0, totalCost - paid);

                    return (
                    <div
                      key={tk.id}
                      className={styles.ticketCard}
                      onClick={() => {
                        onClose();
                        navigate(`/repairs?focusId=${tk.ticketNumber}`);
                      }}
                      style={{ cursor: 'pointer', transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}
                      title="Click to view full repair ticket details on Workshop Board"
                    >
                      <div className={styles.ticketCardHeader}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className={styles.ticketNumber}>#{tk.ticketNumber}</span>
                          {tk.isReturn && (
                            <span style={{ background: '#fef08a', color: '#854d0e', fontSize: '10px', padding: '2px 5px', borderRadius: '4px', fontWeight: 600 }}>
                              🔁 RETURN
                            </span>
                          )}
                          {tk.status === 'returned' && !isActivelyReturned && (
                            <span style={{ background: '#dcfce7', color: '#166534', fontSize: '10px', padding: '2px 5px', borderRadius: '4px', fontWeight: 600 }}>
                              ✅ RETURN RESOLVED
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <RepairStatusBadge status={effectiveStatus} />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrintingTicket(tk);
                            }}
                            title="Print label / intake receipt"
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              cursor: 'pointer',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                            }}
                          >
                            <Printer size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketToEdit(tk);
                              setIsNewTicketOpen(true);
                            }}
                            title="Edit this repair ticket"
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              cursor: 'pointer',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                            }}
                          >
                            <Edit size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketToDelete(tk);
                            }}
                            title="Delete this repair ticket"
                            style={{
                              background: '#fee2e2',
                              border: '1px solid #fca5a5',
                              color: '#dc2626',
                              cursor: 'pointer',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <p className={styles.ticketDevice}>{tk.deviceBrand} {tk.deviceModel}</p>
                      <p className={styles.ticketIssue}>{tk.issueDescription}</p>

                      {/* Technician Remark / Findings */}
                      {tk.remark && (
                        <div style={{
                          fontSize: '11px',
                          color: '#475569',
                          background: '#f8fafc',
                          border: '1px dashed #cbd5e1',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          margin: '4px 0',
                        }}>
                          <strong>Tech Note / Findings:</strong> "{tk.remark}"
                        </div>
                      )}

                      {/* Spare Parts Installed on this device */}
                      {tk.partsUsed && tk.partsUsed.length > 0 && (
                        <div style={{
                          fontSize: '11px',
                          color: '#0369a1',
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          margin: '4px 0',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '4px',
                          alignItems: 'center',
                        }}>
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Wrench size={10} /> Spare Parts Used:
                          </strong>
                          {tk.partsUsed.map((p: any, i: number) => (
                            <span key={i} style={{ background: '#ffffff', padding: '1px 5px', borderRadius: '3px', border: '1px solid #e0f2fe' }}>
                              {p.quantity}× {p.name} ({formatPrivateCurrency(p.cost)})
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Return reason banner if returned */}
                      {tk.returnReason && (
                        <div style={{
                          fontSize: '11.5px',
                          color: '#9a3412',
                          background: '#fff7ed',
                          border: '1px solid #ffedd5',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          margin: '4px 0',
                          fontStyle: 'italic',
                        }}>
                          <strong>Return Reason:</strong> "{tk.returnReason}"
                        </div>
                      )}

                      <div className={styles.ticketFooter}>
                        <span className={styles.ticketDate}>
                          Brought: {formatDate(tk.createdAt)}
                          {tk.completedAt && (
                            <span style={{ color: '#059669', marginLeft: '5px' }}>
                              · Taken: {formatDate(tk.completedAt)}
                            </span>
                          )}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                          <span className={styles.ticketCost}>
                            {tk.actualCost ? formatPrivateCurrency(tk.actualCost) : `Est. ${formatPrivateCurrency(tk.estimatedCost)}`}
                          </span>
                          {deposit > 0 && (
                            <span style={{ fontSize: '10.5px', color: '#16a34a' }}>
                              Deposit: {formatPrivateCurrency(deposit)}
                            </span>
                          )}
                          {tk.handoverAmountPaid && tk.handoverAmountPaid > 0 ? (
                            <span style={{ fontSize: '10.5px', color: '#059669', fontWeight: 600 }}>
                              Handover Paid: {formatPrivateCurrency(tk.handoverAmountPaid)}
                            </span>
                          ) : null}
                          {debt > 0 ? (
                            <span style={{ fontSize: '10.5px', color: '#dc2626', fontWeight: 600 }}>
                              ⚠️ Dept: {formatPrivateCurrency(debt)}
                            </span>
                          ) : (effectiveStatus === 'completed' || tk.paymentStatus === 'paid') ? (
                            <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 700 }}>
                              ✅ Paid in Full
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div style={{
                        marginTop: '8px',
                        paddingTop: '6px',
                        borderTop: '1px dashed #f1f5f9',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11px',
                        color: '#64748b'
                      }}>
                        <span>{tk.assignedTechnician ? `Tech: ${tk.assignedTechnician}` : 'Unassigned'}</span>
                        <span style={{ color: 'var(--color-primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          View Ticket on Board →
                        </span>
                      </div>
                    </div>
                  );
                })
                )}
              </>
            )}

            {/* Purchases Tab */}
            {activeTab === 'purchases' && (
              customerTxs.length === 0 ? (
                <div className={styles.emptyState}>
                  No POS sales transactions recorded for this customer yet.
                </div>
              ) : (
                customerTxs.map(tx => (
                  <div key={tx.id} className={styles.saleCard}>
                    <div className={styles.saleCardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.saleTitle}>
                          {tx.items.length} {tx.items.length === 1 ? 'Item' : 'Items'} Purchased
                        </span>
                        {tx.saleType === 'parts_b2b' && (
                          <span style={{ fontSize: '10.5px', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px' }}>
                            B2B Parts #{tx.invoiceNumber?.slice(-6) || ''}
                          </span>
                        )}
                      </div>
                      {tx.saleType === 'parts_b2b' ? (
                        <button
                          type="button"
                          className={styles.receiptBtn}
                          onClick={() => setSelectedInvoiceTx(tx)}
                          style={{ background: '#eff6ff', color: '#1e40af', borderColor: '#bfdbfe' }}
                        >
                          <FileText size={13} /> View Invoice
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.receiptBtn}
                          onClick={() => setSelectedReceiptTx(tx)}
                        >
                          <Receipt size={13} /> View Receipt
                        </button>
                      )}
                    </div>
                    <div className={styles.saleItemsList}>
                      {tx.items.map((item, idx) => (
                        <div key={idx} className={styles.saleItemRow}>
                          <span>{item.quantity}x {item.product.name} {item.product.model}</span>
                          <span>{formatPrivateCurrency(item.product.price * item.quantity)}</span>
                        </div>
                      ))}
                      {tx.discount && (typeof tx.discount === 'object' ? tx.discount.value > 0 : (tx.discount as any) > 0) && (
                        <div className={styles.saleItemRow} style={{ color: '#15803d', fontWeight: 600 }}>
                          <span>🏷️ Discount Applied</span>
                          <span>-{formatPrivateCurrency(typeof tx.discount === 'object' ? (tx.discount.type === 'percent' ? ((tx.subtotal || tx.total) * tx.discount.value / 100) : tx.discount.value) : (tx.discount as any))}</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.ticketFooter} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={styles.ticketDate}>{formatDate(tx.date)}</span>
                        {tx.payments && tx.payments.length > 0 && (
                          <span style={{ fontSize: '10.5px', color: '#475569', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                            via {tx.payments.map(p => p.method.toUpperCase()).join('+')}
                          </span>
                        )}
                        {tx.status === 'refunded' && (
                          <span style={{ fontSize: '10.5px', color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            Refunded
                          </span>
                        )}
                        {tx.status === 'partially_refunded' && (
                          <span style={{ fontSize: '10.5px', color: '#d97706', background: '#fef3c7', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            Partial Return
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className={styles.ticketCost} style={{ fontWeight: 800 }}>{formatPrivateCurrency(tx.total)}</span>

                        <button
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            fontSize: '11.5px',
                            color: tx.status === 'refunded' ? '#94a3b8' : '#334155',
                            cursor: tx.status === 'refunded' ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                          }}
                          onClick={() => handleEditTx(tx)}
                          disabled={tx.status === 'refunded'}
                          title={!canEditDirectly(tx) && tx.status !== 'refunded' ? 'Requires Admin Password to Edit' : 'Edit Items & Prices'}
                        >
                          <FileEdit size={12} />
                          <span>Edit</span>
                          {!canEditDirectly(tx) && tx.status !== 'refunded' && <span style={{ fontSize: '9px' }}>🔒</span>}
                        </button>

                        <button
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #fecdd3',
                            background: '#fff1f2',
                            fontSize: '11.5px',
                            color: tx.status === 'refunded' ? '#fda4af' : '#e11d48',
                            cursor: tx.status === 'refunded' ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                          }}
                          onClick={() => handleRefundTx(tx)}
                          disabled={tx.status === 'refunded'}
                          title={tx.status === 'refunded' ? 'Already refunded' : !canEditDirectly(tx) ? 'Requires Admin Password to Refund' : 'Full Refund'}
                        >
                          <RotateCcw size={12} />
                          <span>Refund</span>
                          {!canEditDirectly(tx) && tx.status !== 'refunded' && <span style={{ fontSize: '9px' }}>🔒</span>}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            )}

          </div>
        </div>
      </SlidePanel>

      {/* Add Debt Modal */}
      <AddDebtModal
        isOpen={isAddDebtOpen}
        onClose={() => setIsAddDebtOpen(false)}
        customer={customer}
      />

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={!!selectedDebtForPayment}
        onClose={() => setSelectedDebtForPayment(null)}
        debt={selectedDebtForPayment}
      />

      {/* Receipt Modal for viewing retail transaction receipts */}
      <ReceiptModal
        transaction={selectedReceiptTx}
        onClose={() => setSelectedReceiptTx(null)}
        mode="reprint"
      />

      {/* B2B Parts Invoice Modal */}
      <PartsInvoiceModal
        transaction={selectedInvoiceTx}
        onClose={() => setSelectedInvoiceTx(null)}
      />

      {/* Edit Transaction Modal */}
      <EditTransactionModal
        isOpen={!!txToEdit}
        onClose={() => setTxToEdit(null)}
        transaction={txToEdit}
      />

      {/* Refund Transaction Modal */}
      <RefundModal
        isOpen={!!txToRefund}
        onClose={() => setTxToRefund(null)}
        transaction={txToRefund}
      />

      {/* Admin Unlock Modal for Past Invoice */}
      <AdminUnlockModal
        isOpen={!!txRequiringUnlock}
        onClose={() => setTxRequiringUnlock(null)}
        onSuccess={handleUnlockSuccess}
        actionName={txRequiringUnlock?.purpose === 'edit'
          ? `Edit past receipt #${txRequiringUnlock.tx.invoiceNumber || txRequiringUnlock.tx.id.slice(0, 8)} for ${customer.name}`
          : `Refund past receipt #${txRequiringUnlock?.tx.invoiceNumber || txRequiringUnlock?.tx.id.slice(0, 8)} for ${customer.name}`}
        actionType={txRequiringUnlock?.purpose === 'edit' ? 'pos_edit_receipt' : 'pos_refund_transaction'}
        targetId={txRequiringUnlock?.tx.id}
        actionData={txRequiringUnlock ? {
          itemType: 'transaction',
          customerName: customer.name,
          invoiceNumber: txRequiringUnlock.tx.invoiceNumber || txRequiringUnlock.tx.id.slice(0, 8),
          total: txRequiringUnlock.tx.total,
          itemCount: txRequiringUnlock.tx.items?.length || 0,
        } : undefined}
      />

      {/* Admin Unlock Modal for Debt Deletion */}
      <AdminUnlockModal
        isOpen={!!debtRequiringUnlock}
        onClose={() => setDebtRequiringUnlock(null)}
        onSuccess={() => {
          if (debtRequiringUnlock) {
            deleteDebt(debtRequiringUnlock.id);
            toast.info('Debt Deleted', 'Record removed.');
            setDebtRequiringUnlock(null);
          }
        }}
        actionName={`Delete debt record for ${customer.name} ("${debtRequiringUnlock?.productOrService || 'Debt'}")`}
        actionType="customer_delete_debt"
        targetId={debtRequiringUnlock?.id}
        actionData={debtRequiringUnlock ? {
          customerName: customer.name,
          itemName: debtRequiringUnlock.productOrService,
          price: debtRequiringUnlock.remainingBalance,
          totalAmount: debtRequiringUnlock.totalAmount,
        } : undefined}
      />

      {/* Problem 2 fix: Admin Unlock Modal for Adding Debt */}
      <AdminUnlockModal
        isOpen={debtAddRequiringUnlock}
        onClose={() => setDebtAddRequiringUnlock(false)}
        onSuccess={() => {
          setDebtAddRequiringUnlock(false);
          setIsAddDebtOpen(true);
        }}
        actionName={`Add debt record to ${customer.name}'s account`}
        actionType="customer_add_debt"
        targetId={customer.id}
        actionData={{
          customerName: customer.name,
          currentDebt: customer.debt,
          creditLimit: customer.creditLimit,
        }}
      />

      {/* Problem 2 fix: Admin Unlock Modal for Recording Payment */}
      <AdminUnlockModal
        isOpen={!!debtPaymentRequiringUnlock}
        onClose={() => setDebtPaymentRequiringUnlock(null)}
        onSuccess={() => {
          if (debtPaymentRequiringUnlock) {
            setSelectedDebtForPayment(debtPaymentRequiringUnlock);
          }
          setDebtPaymentRequiringUnlock(null);
        }}
        actionName={`Record payment on ${customer.name}'s debt ("${debtPaymentRequiringUnlock?.productOrService || 'Debt'}")`}
        actionType="customer_record_payment"
        targetId={debtPaymentRequiringUnlock?.id}
        actionData={debtPaymentRequiringUnlock ? {
          customerName: customer.name,
          itemName: debtPaymentRequiringUnlock.productOrService,
          price: debtPaymentRequiringUnlock.remainingBalance,
          totalAmount: debtPaymentRequiringUnlock.totalAmount,
        } : undefined}
      />

      {/* Problem 2 fix: Admin Unlock Modal for Editing Debt */}
      <AdminUnlockModal
        isOpen={!!debtEditRequiringUnlock}
        onClose={() => setDebtEditRequiringUnlock(null)}
        onSuccess={() => {
          if (debtEditRequiringUnlock) {
            setEditDebtName(debtEditRequiringUnlock.productOrService);
            setEditDebtAmount(String(debtEditRequiringUnlock.totalAmount));
            setEditingDebtId(debtEditRequiringUnlock.id);
          }
          setDebtEditRequiringUnlock(null);
        }}
        actionName={`Edit debt record for ${customer.name} ("${debtEditRequiringUnlock?.productOrService || 'Debt'}")`}
        actionType="customer_edit_debt"
        targetId={debtEditRequiringUnlock?.id}
        actionData={debtEditRequiringUnlock ? {
          customerName: customer.name,
          itemName: debtEditRequiringUnlock.productOrService,
          price: debtEditRequiringUnlock.totalAmount,
          remainingBalance: debtEditRequiringUnlock.remainingBalance,
        } : undefined}
      />

      {/* B2B Account Statement & Ledger Modal */}
      <AccountStatementModal
        customer={customer}
        isOpen={isStatementOpen}
        onClose={() => setIsStatementOpen(false)}
      />

      {/* Switch Account Type Modal */}
      <SwitchAccountTypeModal
        isOpen={isSwitchTypeOpen}
        onClose={() => setIsSwitchTypeOpen(false)}
        customer={customer}
      />

      {/* Merge Customers Modal */}
      <MergeCustomersModal
        isOpen={isMergeOpen}
        onClose={() => setIsMergeOpen(false)}
        initialAccountA={customer}
      />

      {/* Delete Customer Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteCustomerOpen}
        onClose={() => setIsDeleteCustomerOpen(false)}
        onConfirm={confirmDeleteCustomer}
        title="Delete Customer Account"
        message={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>
              Are you sure you want to permanently delete <strong>{customer?.name}</strong>?
            </p>
            {totalDebtBalance > 0 && (
              <p style={{ margin: 0, color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
                ⚠️ Warning: This customer currently has an unpaid debt of {formatPrivateCurrency(totalDebtBalance)}. Deleting the account will also remove all associated debt records.
              </p>
            )}
          </div>
        }
        confirmLabel="Delete Customer"
        variant="danger"
        isLoading={isActionLoading}
      />

      {/* Delete Phone Device Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deviceToDelete}
        onClose={() => { setDeviceToDelete(null); setDeleteDeviceRepairsToo(false); }}
        onConfirm={confirmDeleteDevice}
        title={t('customers.removePhoneTitle', 'Remove Phone / Device from Customer')}
        message={
          <div>
            <p style={{ margin: '0 0 10px 0' }}>
              Remove <strong>{deviceToDelete?.device}</strong> from <strong>{customer?.name}</strong>'s profile?
            </p>
            {deviceToDelete && deviceToDelete.tickets.length > 0 && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                }}
                onClick={() => setDeleteDeviceRepairsToo(v => !v)}
              >
                <input
                  type="checkbox"
                  id="deleteRepairsCheck"
                  checked={deleteDeviceRepairsToo}
                  onChange={e => setDeleteDeviceRepairsToo(e.target.checked)}
                  style={{ marginTop: '2px', cursor: 'pointer' }}
                  onClick={e => e.stopPropagation()}
                />
                <label htmlFor="deleteRepairsCheck" style={{ fontSize: '12.5px', color: '#991b1b', fontWeight: 600, cursor: 'pointer' }}>
                  Also delete the {deviceToDelete.tickets.length} linked repair ticket(s)
                  <span style={{ display: 'block', fontWeight: 400, color: '#b91c1c', fontSize: '11.5px', marginTop: '2px' }}>
                    ⚠️ Required to fully remove the device — if unchecked, it will reappear because repair history still references it.
                  </span>
                </label>
              </div>
            )}
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
              {deleteDeviceRepairsToo
                ? `This will remove the device and delete all ${deviceToDelete?.tickets.length} repair record(s) permanently.`
                : '⚠️ The device will still appear in the list because it has linked repair tickets. To fully remove it, check the box above.'}
            </p>
          </div>
        }
        confirmLabel={deleteDeviceRepairsToo ? t('customers.deleteDeviceAndRepairs', 'Delete Device + Repairs') : t('customers.removeDevice', 'Remove Device')}
        variant="danger"
        isLoading={isActionLoading}
      />

      {/* Delete Single Repair Ticket Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!ticketToDelete}
        onClose={() => setTicketToDelete(null)}
        onConfirm={confirmDeleteSingleTicket}
        title="Delete Repair Ticket"
        message={
          <p style={{ margin: 0 }}>
            Are you sure you want to delete repair ticket <strong>#{ticketToDelete?.ticketNumber}</strong> ({ticketToDelete?.deviceBrand} {ticketToDelete?.deviceModel})?
          </p>
        }
        confirmLabel="Delete Ticket"
        variant="danger"
        isLoading={isActionLoading}
      />

      {/* Add Phone Modal */}
      <Modal
        isOpen={isAddPhoneOpen}
        onClose={() => setIsAddPhoneOpen(false)}
        title={`Register Phone for ${customer?.name}`}
        subtitle="Add a customer device to their registered fleet"
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <Button variant="ghost" onClick={() => setIsAddPhoneOpen(false)} disabled={isActionLoading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmAddPhone} isLoading={isActionLoading} leftIcon={<Smartphone size={15} />}>
              Save Phone
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              Phone Brand <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <Input
              placeholder="e.g. Apple, Samsung, Xiaomi..."
              value={newPhoneBrand}
              onChange={(e) => setNewPhoneBrand(e.target.value)}
              autoFocus
            />
            {/* Quick Brand Selector Chips */}
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
              {['Apple', 'Samsung', 'Xiaomi', 'Oppo', 'Realme', 'Huawei', 'Infinix', 'Tecno'].map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setNewPhoneBrand(b)}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    background: newPhoneBrand.toLowerCase() === b.toLowerCase() ? 'var(--color-primary, #4f46e5)' : '#f8fafc',
                    color: newPhoneBrand.toLowerCase() === b.toLowerCase() ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              Phone Model <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <Input
              placeholder="e.g. Galaxy A54 5G, iPhone 13 Pro Max..."
              value={newPhoneModel}
              onChange={(e) => setNewPhoneModel(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              IMEI / Serial Number (Optional)
            </label>
            <Input
              placeholder="e.g. 356789123456789"
              value={newPhoneImei}
              onChange={(e) => setNewPhoneImei(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              Device Notes / Condition / Color (Optional)
            </label>
            <Input
              placeholder="e.g. Midnight Black, cracked back glass"
              value={newPhoneNotes}
              onChange={(e) => setNewPhoneNotes(e.target.value)}
            />
          </div>

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer'
            }}
            onClick={() => setCreateTicketForNewPhone(!createTicketForNewPhone)}
          >
            <input
              type="checkbox"
              id="createTicketCheck"
              checked={createTicketForNewPhone}
              onChange={(e) => setCreateTicketForNewPhone(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="createTicketCheck" style={{ fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: '#1e293b' }}>
              Immediately open a new repair ticket for this phone
            </label>
          </div>
        </div>
      </Modal>

      {/* Edit Phone Modal */}
      <Modal
        isOpen={!!deviceToEdit}
        onClose={() => setDeviceToEdit(null)}
        title={`Edit Phone: ${deviceToEdit?.oldBrand} ${deviceToEdit?.oldModel}`}
        subtitle={`Updates this phone and its records for ${customer?.name}`}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <Button variant="ghost" onClick={() => setDeviceToEdit(null)} disabled={isActionLoading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmEditDevice} isLoading={isActionLoading}>
              Update Phone
            </Button>
          </div>
        }
      >
        {deviceToEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                Brand <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <Input
                value={deviceToEdit.brand}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, brand: e.target.value })}
              />
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                {['Apple', 'Samsung', 'Xiaomi', 'Oppo', 'Realme', 'Huawei', 'Infinix', 'Tecno'].map(b => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setDeviceToEdit({ ...deviceToEdit, brand: b })}
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      background: deviceToEdit.brand.toLowerCase() === b.toLowerCase() ? 'var(--color-primary, #4f46e5)' : '#f8fafc',
                      color: deviceToEdit.brand.toLowerCase() === b.toLowerCase() ? '#ffffff' : '#475569',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                Model <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <Input
                value={deviceToEdit.model}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, model: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                IMEI / Serial Number (Optional)
              </label>
              <Input
                placeholder="e.g. 356789123456789"
                value={deviceToEdit.imei || ''}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, imei: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                Device Notes / Condition / Color (Optional)
              </label>
              <Input
                placeholder="e.g. Midnight Black, cracked back glass"
                value={deviceToEdit.notes || ''}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, notes: e.target.value })}
              />
            </div>
            <p style={{ fontSize: '11.5px', color: '#64748b' }}>
              Note: Changing the brand/model here updates all repair records and registered fleet info linked to this device for this customer.
            </p>
          </div>
        )}
      </Modal>

      {/* New or Edit Ticket Modal inside Customer Profile */}
      <NewTicketModal
        isOpen={isNewTicketOpen}
        onClose={() => {
          setIsNewTicketOpen(false);
          setTicketToEdit(null);
          setTicketPrefillDevice(undefined);
        }}
        prefillCustomer={{
          name: customer?.name || '',
          phone: customer?.phone || '',
          lastDevice: ticketPrefillDevice,
        }}
        ticketToEdit={ticketToEdit}
        onPrintTicket={(tk) => setPrintingTicket(tk)}
      />

      {/* Print Repair Ticket & Sticker Modal */}
      <PrintRepairTicketModal
        isOpen={!!printingTicket}
        onClose={() => setPrintingTicket(null)}
        ticket={printingTicket}
      />

      {/* Customer Activity & Audit Log Modal (Clean Secondary Access) */}
      <Modal
        isOpen={isActivityModalOpen}
        onClose={() => setIsActivityModalOpen(false)}
        title={`Audit & Activity Log`}
        subtitle={`${customer.name} · Chronological record of account events`}
        size="lg"
      >
        <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: '4px' }}>
          <CustomerActivityLogList
            customer={customer}
            logs={customerLogs}
          />
        </div>
      </Modal>
    </>
  );
};
