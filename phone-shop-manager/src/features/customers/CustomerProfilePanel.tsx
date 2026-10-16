import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidePanel } from '../../components/ui/SlidePanel';
import type { Customer, SaleTransaction, CustomerDebtEntry, RepairTicket, CustomerRegisteredDevice } from '../../types';
import { isShopCustomer } from '../../types';
import {
  Phone, Mail, ShoppingBag, Clock, Smartphone, MessageCircle,
  Wrench, ShoppingCart, Receipt, User, BookOpen, Plus,
  DollarSign, Trash2, Send, AlertTriangle, FileText, Store, FileEdit, RotateCcw,
  GitMerge, ArrowRightLeft, Edit, Edit2, Printer
} from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/ui/Toast';
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
import { formatCurrency } from '../../utils/formatCurrency';
import { Customer360Timeline } from './Customer360Timeline';
import { CustomerActivityLogList } from './CustomerActivityLogList';
import { isDebtOverdue, getDaysOverdue, buildWhatsAppDebtReminderUrl } from '../../utils/debtAlerts';

interface CustomerProfilePanelProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onNewRepair?: (customer: Customer, lastDevice?: string) => void;
}

type ProfileTab = 'debts' | 'repairs' | 'purchases' | 'timeline' | 'activity';

export const CustomerProfilePanel: React.FC<CustomerProfilePanelProps> = ({
  customer: propCustomer,
  isOpen,
  onClose,
  onNewRepair,
}) => {
  const { transactions, setCustomerName } = useCartStore();
  const { invoices, fetchInvoices } = usePartsCartStore();
  const { tickets, deleteTicket, deleteDeviceFromCustomer, updateDeviceForCustomer } = useRepairStore();
  const { customers, debts, getCustomerDebts, getCustomerDebtTotal, deleteDebt, updateDebtAmount, deleteCustomer, updateCustomer, getCustomerLogs } = useCustomerStore();
  const { user, isHistoryUnlocked } = useAuthStore();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const toast = useToast();

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
  const [deviceToDelete, setDeviceToDelete] = useState<{ device: string; brand: string; model: string; tickets: any[] } | null>(null);
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

  // Problem 8 fix: Only unregister device, do NOT cascade-delete repair tickets
  const confirmDeleteDevice = async () => {
    if (!customer || !deviceToDelete) return;
    setIsActionLoading(true);
    try {
      const brand = deviceToDelete.brand;
      const model = deviceToDelete.model;

      // Only remove from registeredDevices array — preserve repair ticket history
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

      toast.success(
        'Device Unregistered',
        `${deviceToDelete.device} has been removed from ${customer.name}'s registered devices. Repair history is preserved.`
      );
      setDeviceToDelete(null);
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
    return [...transactions, ...invoices];
  }, [transactions, invoices]);

  const customerTxs = useMemo(() => {
    if (!customer) return [];
    return allTxs
      .filter(tx => {
        if (tx.customerId && tx.customerId === customer.id) return true;
        if (!tx.customerName) return false;
        return tx.customerName.toLowerCase().trim() === custNameLower;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allTxs, customer, custNameLower]);

  const customerTickets = useMemo(() => {
    if (!customer) return [];
    return tickets
      .filter(tk => {
        if (tk.customerId && tk.customerId === customer.id) return true;
        if (tk.customerPhone && normalizePhone(tk.customerPhone) === custPhone) return true;
        return tk.customerName.toLowerCase().trim() === custNameLower;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tickets, customer, custPhone, custNameLower]);

  // Customer debts and logs
  const customerDebts = customer ? getCustomerDebts(customer.id) : [];
  const totalDebtBalance = customer ? getCustomerDebtTotal(customer.id) : 0;
  const customerLogs = customer ? getCustomerLogs(customer.id) : [];

  // Device Fleet calculation (combines repair tickets + registered devices)
  const deviceStats = useMemo(() => {
    if (!customer) return [];
    const map: Record<string, {
      id?: string;
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
      const brand = (tk.deviceBrand || '').trim();
      const model = (tk.deviceModel || '').trim();
      const key = `${brand} ${model}`.trim() || 'Unknown Device';
      if (!map[key]) {
        map[key] = { brand, model, count: 0, totalSpent: 0, issues: [], tickets: [] };
      }
      map[key].count++;
      map[key].totalSpent += tk.actualCost || tk.estimatedCost || 0;
      if (tk.issueDescription && !map[key].issues.includes(tk.issueDescription)) {
        map[key].issues.push(tk.issueDescription);
      }
      map[key].tickets.push(tk);
    });

    // 2. From customer.registeredDevices
    (customer.registeredDevices || []).forEach(dev => {
      const brand = (dev.brand || '').trim();
      const model = (dev.model || '').trim();
      const key = `${brand} ${model}`.trim() || 'Unknown Device';
      if (!map[key]) {
        map[key] = { id: dev.id, brand, model, imei: dev.imei, notes: dev.notes, count: 0, totalSpent: 0, issues: [], tickets: [], isRegisteredOnly: true };
      } else {
        map[key].id = dev.id || map[key].id;
        map[key].imei = dev.imei || map[key].imei;
        map[key].notes = dev.notes || map[key].notes;
      }
    });

    return Object.entries(map);
  }, [customerTickets, customer]);

  const mostRecentDevice = deviceStats.length > 0 ? deviceStats[0][0] : undefined;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Early return only AFTER all React hooks have been called
  if (!customer) return null;

  const handleStartSale = () => {
    setCustomerName(customer.name);
    toast.success('Customer Attached', `${customer.name} attached to the active cart.`);
    onClose();
    navigate('/pos');
  };

  const handleStartPartsOrder = () => {
    usePartsCartStore.getState().setSelectedCustomer(customer);
    toast.success('B2B Account Attached', `${customer.shopName || customer.name} attached for parts order.`);
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
        title="Customer Profile"
        width="md"
      >
        <div className={styles.container}>
          {/* Header Card with Quick Actions */}
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <div className={styles.avatar} style={customer.shopName ? { background: '#eff6ff', color: '#2563eb' } : undefined}>
                {customer.shopName ? <Store size={22} /> : customer.name[0]}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                      B2B Shop
                    </span>
                  )}
                </div>
                {customer.shopName && (
                  <p style={{ fontSize: '12.5px', color: '#64748b', margin: '2px 0 4px 0' }}>
                    Contact: <strong>{customer.name}</strong>
                  </p>
                )}
                <div className={styles.contactRow}>
                  <a href={`tel:${customer.phone}`} className={styles.contactItem}>
                    <Phone size={13} /> {customer.phone}
                  </a>
                  {customer.email && (
                    <a href={`mailto:${customer.email}`} className={styles.contactItem}>
                      <Mail size={13} /> {customer.email}
                    </a>
                  )}
                </div>
                {customer.creditLimit && customer.creditLimit > 0 && (
                  <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '3px' }}>
                    Credit Limit: <strong>{formatCurrency(customer.creditLimit)}</strong>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.headerActions}>
              <a
                href={`https://wa.me/${custPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className={[styles.actionBtn, styles.actionBtnWa].join(' ')}
                title="Message on WhatsApp"
              >
                <MessageCircle size={14} /> WA
              </a>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => setIsStatementOpen(true)}
                style={{ background: '#f8fafc', color: '#0f172a', borderColor: '#cbd5e1' }}
                title="Generate Account Statement (Relevé de Compte / Ledger)"
              >
                <FileText size={14} /> Statement
              </button>
              {permissions.repairs && (
                <button
                  type="button"
                  className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                  onClick={handleStartRepair}
                  title="New Repair Ticket"
                >
                  <Wrench size={14} /> Repair
                </button>
              )}
              {permissions.inventory_parts && (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={handleStartPartsOrder}
                  style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
                  title="New Parts Order"
                >
                  <Store size={14} /> Parts
                </button>
              )}
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleStartSale}
                title="New POS Sale"
              >
                <ShoppingCart size={14} /> POS
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
                <Smartphone size={14} /> + Phone
              </button>
            </div>

            {/* Account Operations Toolbar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              paddingTop: '10px',
              marginTop: '10px',
              borderTop: '1px dashed #e2e8f0',
              width: '100%',
            }}>
              <button
                type="button"
                onClick={() => setIsSwitchTypeOpen(true)}
                title={isShopCustomer(customer) ? 'Convert to Retail Client' : 'Convert to B2B Shop'}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${isShopCustomer(customer) ? '#bfdbfe' : '#fde68a'}`,
                  background: isShopCustomer(customer) ? '#eff6ff' : '#fef3c7',
                  color: isShopCustomer(customer) ? '#1e40af' : '#92400e',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'opacity 0.15s ease',
                }}
              >
                {isShopCustomer(customer) ? <User size={13} /> : <Store size={13} />}
                <span>{isShopCustomer(customer) ? 'Switch to Retail' : 'Switch to Shop'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMergeOpen(true)}
                title="Merge this account with another duplicate account"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'background 0.15s ease',
                }}
              >
                <GitMerge size={13} />
                <span>Merge Account</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDeleteCustomerOpen(true)}
                title="Delete this customer profile"
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: '1px solid #fecaca',
                  background: '#fff5f5',
                  color: '#dc2626',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  marginLeft: 'auto',
                  transition: 'background 0.15s ease',
                }}
              >
                <Trash2 size={13} />
                <span>Delete Client</span>
              </button>
            </div>
          </div>

          {/* KPI Summary (with Store Credit if available) */}
          <div
            className={styles.stats}
            style={{
              gridTemplateColumns: (customer.storeCredit || 0) > 0 ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)',
            }}
          >
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Total Spent</span>
              <span className={styles.statValue}>{formatCurrency(customer.totalSpent)}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Orders</span>
              <span className={styles.statValue}>{customer.totalPurchases}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Repairs</span>
              <span className={styles.statValue}>{customerTickets.length}</span>
            </div>
            <div className={styles.statBox} style={{ background: totalDebtBalance > 0 ? '#fef2f2' : undefined, borderColor: totalDebtBalance > 0 ? '#fecaca' : undefined }}>
              <span className={styles.statLabel} style={{ color: totalDebtBalance > 0 ? '#991b1b' : undefined }}>Debt Balance</span>
              <span className={styles.statValue} style={{ color: totalDebtBalance > 0 ? '#dc2626' : undefined }}>
                {formatCurrency(totalDebtBalance)}
              </span>
            </div>
            {(customer.storeCredit || 0) > 0 && (
              <div className={styles.statBox} style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                <span className={styles.statLabel} style={{ color: '#065f46' }}>🎟️ Store Credit (Avoir)</span>
                <span className={styles.statValue} style={{ color: '#059669' }}>
                  {formatCurrency(customer.storeCredit || 0)}
                </span>
              </div>
            )}
          </div>

          {/* Device Fleet Section */}
          <div className={styles.section}>
            <div className={styles.sectionHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className={styles.sectionTitle}>
                <Smartphone size={15} /> Registered Phones ({deviceStats.length})
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
                <Plus size={12} /> Add Phone
              </button>
            </div>

            {deviceStats.length === 0 ? (
              <div style={{
                padding: '16px',
                background: 'var(--color-surface-container-low, #f8fafc)',
                border: '1px dashed #cbd5e1',
                borderRadius: '10px',
                textAlign: 'center',
                fontSize: '12px',
                color: '#64748b'
              }}>
                <p style={{ margin: '0 0 8px 0' }}>No phones registered for this customer yet.</p>
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
                    padding: '5px 12px',
                    borderRadius: '6px',
                    background: 'var(--color-primary, #4f46e5)',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={12} /> Register First Phone
                </button>
              </div>
            ) : (
              <div className={styles.deviceGrid}>
                {deviceStats.map(([device, data]) => (
                  <div key={device} className={styles.deviceCard}>
                    <div className={device ? styles.deviceCardTop : ''}>
                      <p className={styles.deviceName}>{device || 'Unknown Device'}</p>
                      <span className={styles.deviceRepairsCount}>
                        {data.count} {data.count === 1 ? 'repair' : 'repairs'}
                      </span>
                    </div>
                    {data.imei && (
                      <p style={{ fontSize: '11px', color: '#6366f1', margin: '2px 0', fontWeight: 600 }}>
                        IMEI: {data.imei}
                      </p>
                    )}
                    {data.notes && (
                      <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0' }}>
                        📝 {data.notes}
                      </p>
                    )}
                    {data.issues.length > 0 ? (
                      <p className={styles.deviceIssuesList}>
                        {data.issues.slice(0, 2).join(' · ')}
                        {data.issues.length > 2 ? ` +${data.issues.length - 2} more` : ''}
                      </p>
                    ) : (
                      <p className={styles.deviceIssuesList} style={{ fontStyle: 'italic', opacity: 0.7 }}>
                        Registered Device (No active repairs)
                      </p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #e2e8f0', flexWrap: 'wrap', gap: '6px' }}>
                      <span className={styles.deviceSpent}>
                        {data.totalSpent > 0 ? `Total: ${formatCurrency(data.totalSpent)}` : 'No Repair Cost'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {permissions.repairs && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketPrefillDevice(device);
                              setTicketToEdit(null);
                              setIsNewTicketOpen(true);
                            }}
                            title={`Create new repair ticket for ${device}`}
                            style={{
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              color: '#1d4ed8',
                              cursor: 'pointer',
                              padding: '3px 7px',
                              borderRadius: '5px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            <Wrench size={11} />
                            <span>New Ticket</span>
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
                          title={`Edit phone "${device}"`}
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            color: '#334155',
                            cursor: 'pointer',
                            padding: '3px 7px',
                            borderRadius: '5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          <Edit2 size={11} />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeviceToDelete({
                              device,
                              brand: data.brand || device.split(' ')[0] || '',
                              model: data.model || device.split(' ').slice(1).join(' ') || '',
                              tickets: data.tickets,
                            });
                          }}
                          title={`Delete phone "${device}" from customer`}
                          style={{
                            background: '#fee2e2',
                            border: '1px solid #fca5a5',
                            color: '#b91c1c',
                            cursor: 'pointer',
                            padding: '3px 7px',
                            borderRadius: '5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          <Trash2 size={11} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tab Segmented Controls */}
          <div className={styles.tabBar}>
            {permissions.customers_debt && (
              <button
                type="button"
                className={[styles.tabBtn, activeTab === 'debts' && styles.tabBtnActive].filter(Boolean).join(' ')}
                onClick={() => setActiveTab('debts')}
              >
                <BookOpen size={14} />
                <span>Credit Ledger</span>
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
                <span>Repairs</span>
                <span className={styles.tabBadge}>{customerTickets.length}</span>
              </button>
            )}
            <button
              type="button"
              className={[styles.tabBtn, activeTab === 'purchases' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('purchases')}
            >
              <ShoppingBag size={14} />
              <span>Purchases</span>
              <span className={styles.tabBadge}>{customerTxs.length}</span>
            </button>
            <button
              type="button"
              className={[styles.tabBtn, activeTab === 'timeline' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('timeline')}
            >
              <Clock size={14} />
              <span>Timeline</span>
              <span className={styles.tabBadge}>{customerTxs.length + customerTickets.length + customerDebts.length}</span>
            </button>
            <button
              type="button"
              className={[styles.tabBtn, activeTab === 'activity' && styles.tabBtnActive].filter(Boolean).join(' ')}
              onClick={() => setActiveTab('activity')}
            >
              <FileText size={14} />
              <span>Audit Log</span>
              <span className={styles.tabBadge}>{customerLogs.length}</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className={styles.historyList}>
            {/* Credit Ledger Tab */}
            {activeTab === 'debts' && (
              <>
                <div className={styles.debtSummaryBanner}>
                  <div className={styles.debtSummaryLeft}>
                    <span className={styles.debtSummaryLabel}>Total Outstanding Debt</span>
                    <p className={styles.debtSummaryValue}>{formatCurrency(totalDebtBalance)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={styles.addDebtBtn}
                      onClick={() => setIsStatementOpen(true)}
                      style={{ background: '#ffffff', color: '#1e293b', border: '1px solid #cbd5e1' }}
                      title="Generate Full Account Statement & PDF"
                    >
                      <FileText size={13} /> Statement / PDF
                    </button>
                    <button
                      type="button"
                      className={styles.addDebtBtn}
                      onClick={() => handleAddDebtClick()}
                    >
                      <Plus size={14} /> Add Debt Record
                    </button>
                  </div>
                </div>

                {customerDebts.length === 0 ? (
                  <div className={styles.emptyState}>
                    No debt or credit records found for this customer. All settled!
                  </div>
                ) : (
                  customerDebts.map(debt => {
                    const pct = debt.totalAmount > 0 ? Math.min(100, (debt.amountPaid / debt.totalAmount) * 100) : 0;
                    const overdue = isDebtOverdue(debt);
                    const daysLate = getDaysOverdue(debt.dueDate);

                    return (
                      <div key={debt.id} className={styles.debtCard} style={overdue ? { borderColor: '#fca5a5', background: '#fffafa' } : {}}>
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
                                className={styles.debtEditInput}
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
                                  if (newAmount < debt.amountPaid) { toast.error('Validation', `Amount cannot be less than already paid (${formatCurrency(debt.amountPaid)}).`); return; }
                                  try {
                                    await updateDebtAmount(debt.id, newAmount, newName);
                                    toast.success('Debt Updated', `Updated to "${newName}" — ${formatCurrency(newAmount)}`);
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
                              <span className={styles.debtBadgePartial}>🟡 Partial ({formatCurrency(debt.remainingBalance)} left)</span>
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
                            <span>Paid: {formatCurrency(debt.amountPaid)} ({Math.round(pct)}%)</span>
                            <span style={{ fontWeight: 700, color: debt.remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                              Balance Owed: {formatCurrency(debt.remainingBalance)}
                            </span>
                          </div>
                        </div>

                        {/* Payment History Log */}
                        {debt.payments && debt.payments.length > 0 && (
                          <div className={styles.paymentHistoryList}>
                            <p className={styles.paymentHistoryTitle}>Payment History ({debt.payments.length})</p>
                            {debt.payments.map(pay => (
                              <div key={pay.id} className={styles.paymentHistoryRow}>
                                <span>{formatDate(pay.date)} · {pay.method.toUpperCase()} {pay.note ? `(${pay.note})` : ''}</span>
                                <strong style={{ color: '#16a34a' }}>+{formatCurrency(pay.amount)}</strong>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className={styles.debtActionsRow}>
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                            Total: {formatCurrency(debt.totalAmount)}
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
                  customerTickets.map(tk => (
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
                        <span className={styles.ticketNumber}>#{tk.ticketNumber}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <RepairStatusBadge status={tk.status} />
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
                      <div className={styles.ticketFooter}>
                        <span className={styles.ticketDate}>{formatDate(tk.createdAt)}</span>
                        <span className={styles.ticketCost}>
                          {tk.actualCost ? formatCurrency(tk.actualCost) : `Est. ${formatCurrency(tk.estimatedCost)}`}
                        </span>
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
                  ))
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
                          <span>{formatCurrency(item.product.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.ticketFooter} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span className={styles.ticketDate}>{formatDate(tx.date)}</span>
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
                        <span className={styles.ticketCost} style={{ fontWeight: 800 }}>{formatCurrency(tx.total)}</span>

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

            {/* Timeline Tab */}
            {activeTab === 'timeline' && (
              <Customer360Timeline
                transactions={customerTxs}
                tickets={customerTickets}
                debts={customerDebts}
                onViewReceipt={(tx) => setSelectedReceiptTx(tx)}
              />
            )}

            {/* Append-only Customer Activity & Audit Log Tab */}
            {activeTab === 'activity' && (
              <CustomerActivityLogList
                customer={customer}
                logs={customerLogs}
              />
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
        actionName={txRequiringUnlock?.purpose === 'edit' ? 'edit a past invoice/receipt' : 'refund a past invoice/receipt'}
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
        actionName="delete customer debt record"
      />

      {/* Problem 2 fix: Admin Unlock Modal for Adding Debt */}
      <AdminUnlockModal
        isOpen={debtAddRequiringUnlock}
        onClose={() => setDebtAddRequiringUnlock(false)}
        onSuccess={() => {
          setDebtAddRequiringUnlock(false);
          setIsAddDebtOpen(true);
        }}
        actionName="add a debt record to customer account"
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
        actionName="record a payment on customer debt"
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
        actionName="edit a debt record amount"
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
                ⚠️ Warning: This customer currently has an unpaid debt of {formatCurrency(totalDebtBalance)}. Deleting the account will also remove all associated debt records.
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
        onClose={() => setDeviceToDelete(null)}
        onConfirm={confirmDeleteDevice}
        title="Delete Phone / Device from Customer"
        message={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>
              Are you sure you want to remove <strong>{deviceToDelete?.device}</strong> ({deviceToDelete?.tickets.length} repair ticket(s)) from <strong>{customer?.name}</strong>?
            </p>
            <p style={{ margin: 0, color: '#475569', fontSize: '12.5px' }}>
              This will remove this phone device and its associated repair records from this customer. <strong>{customer?.name}'s customer account will NOT be deleted.</strong>
            </p>
          </div>
        }
        confirmLabel="Delete Phone"
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
    </>
  );
};
