import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidePanel } from '../../components/ui/SlidePanel';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Modal } from '../../components/ui/Modal';
import { Printer, Plus, Trash2, Package, Edit, CheckCircle, Wrench, CheckCircle2, BadgeCheck, ArrowRight, Activity, UserCheck, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { RepairStatusBadge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useRepairStore } from '../../store/repairStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import type { RepairTicket, PhoneModel, Customer } from '../../types';
import { useCustomerStore } from '../../store/customerStore';
import { activityLogService } from '../../services/activityLogService';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { nextStatusMap } from './repairConstants';
import styles from './TicketDetail.module.css';
import { LockCodeViewer } from './LockCodeWidget';
import { CustomerHistoryWidget } from './CustomerHistoryWidget';
import { PrintRepairTicketModal } from './PrintRepairTicketModal';

interface TicketDetailPanelProps {
  ticket: RepairTicket | null;
  onClose: () => void;
  onEdit: () => void;
  onViewCustomerProfile?: (customer: Customer) => void;
  onRequestSettlement?: (ticket: RepairTicket) => void;
  onRepairAgain?: (ticket: RepairTicket) => void;
  onSelectTicket?: (ticket: RepairTicket) => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const TicketDetailPanel: React.FC<TicketDetailPanelProps> = ({ 
  ticket, 
  onClose, 
  onEdit, 
  onViewCustomerProfile, 
  onRequestSettlement, 
  onRepairAgain,
  onSelectTicket
}) => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [partSearch, setPartSearch] = useState('');
  const [parts, setParts] = useState<{ product: PhoneModel; quantity: number }[]>([]);
  const [isEditingCost, setIsEditingCost] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);
  const [showReturnPrompt, setShowReturnPrompt] = useState(false);
  const [returnForm, setReturnForm] = useState({
    reason: '',
    estimatedCost: '',
    pickupDate: '',
    chargeCustomer: false,
  });
  const [costForm, setCostForm] = useState({
    estimatedCost: '',
    actualCost: '',
    depositAmount: ''
  });
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isEditingRemark, setIsEditingRemark] = useState(false);
  const [remarkInput, setRemarkInput] = useState('');
  const [showCustomPartForm, setShowCustomPartForm] = useState(false);
  const [customPartName, setCustomPartName] = useState('');
  const [customPartCost, setCustomPartCost] = useState('');
  const { updateStatus, updateTicket, createTicket, tickets } = useRepairStore();
  const { parts: inventoryParts, fetchParts, adjustStockBy } = useInventoryStore();

  const linkedTickets = React.useMemo(() => {
    if (!ticket) return [];
    const familyId = ticket.parentTicketId || ticket.id;
    return tickets
      .filter(t => t.id === familyId || t.parentTicketId === familyId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [ticket, tickets]);

  // Identify parent ticket if this is a return ticket
  const parentTicket = React.useMemo(() => {
    if (!ticket?.parentTicketId) return null;
    return tickets.find(t => t.id === ticket.parentTicketId) || null;
  }, [ticket?.parentTicketId, tickets]);

  // Identify active child return ticket if this ticket was returned
  const childReturnTicket = React.useMemo(() => {
    if (!ticket) return null;
    if (ticket.activeReturnTicketId) {
      return tickets.find(t => t.id === ticket.activeReturnTicketId) || null;
    }
    return tickets.find(t => t.parentTicketId === ticket.id && t.isReturn) || null;
  }, [ticket, tickets]);

  const { customers } = useCustomerStore();
  const { user, staff, fetchStaff } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const settings = useSettingsStore();
  const toast = useToast();
  const [isAssigningTech, setIsAssigningTech] = useState(false);

  React.useEffect(() => {
    if (ticket) {
      setRemarkInput(ticket.remark || '');
      setIsEditingRemark(false);
    }
  }, [ticket?.id, ticket?.remark]);

  React.useEffect(() => {
    if (staff.length === 0) {
      fetchStaff();
    }
  }, [staff.length, fetchStaff]);

  const technicians = React.useMemo(() => {
    return staff.filter(s => s.role === 'repair_agent' && s.status !== 'revoked');
  }, [staff]);

  const handleAssignTechnician = async (techName: string) => {
    if (!ticket) return;
    try {
      await updateTicket(ticket.id, { assignedTechnician: techName });
      toast.success(t('ticket.technicianAssigned'), t('ticket.technicianAssignedDesc', { name: techName }));
      setIsAssigningTech(false);
    } catch {
      toast.error(t('error.failedToAssign'));
    }
  };

  const handleSaveRemark = async () => {
    if (!ticket) return;
    setIsSubmitting(true);
    try {
      await updateTicket(ticket.id, { remark: remarkInput.trim() || undefined });
      toast.success(t('ticket.remarkSaved'), t('ticket.remarkSavedDesc'));
      setIsEditingRemark(false);
    } catch {
      toast.error(t('error.failedToSaveRemark'), t('error.failedToSaveRemarkDesc'));
    } finally {
      setIsSubmitting(false);
    }
  };

  React.useEffect(() => {
    if (inventoryParts.length === 0) {
      fetchParts();
    }
  }, [inventoryParts.length, fetchParts]);

  const matchedCustomer = React.useMemo(() => {
    if (!ticket) return null;
    if (ticket.customerId) {
      const found = customers.find(c => c.id === ticket.customerId);
      if (found) return found;
    }
    const cleanTicketPhone = ticket.customerPhone?.replace(/\D/g, '');
    return customers.find(c =>
      (cleanTicketPhone && c.phone.replace(/\D/g, '') === cleanTicketPhone) ||
      (c.name.toLowerCase().trim() === ticket.customerName.toLowerCase().trim())
    ) || null;
  }, [ticket, customers]);

  const filteredParts = partSearch.trim().length > 1
    ? inventoryParts.filter(p =>
        (p.name + ' ' + p.model).toLowerCase().includes(partSearch.toLowerCase()) &&
        p.stock > 0 &&
        !parts.find(pt => pt.product.id === p.id)
      ).slice(0, 5)
    : [];

  const addPart = (product: PhoneModel) => {
    setParts(prev => [...prev, { product, quantity: 1 }]);
    setPartSearch('');
  };

  const removePart = (productId: string) => {
    setParts(prev => prev.filter(p => p.product.id !== productId));
  };

  const handleAddCustomPart = () => {
    if (!customPartName.trim()) return;
    const dummyProduct: PhoneModel = {
      id: `custom-${Date.now()}`,
      brand: 'Custom',
      model: '',
      name: customPartName.trim(),
      costPrice: Number(customPartCost) || 0,
      sellPrice: Number(customPartCost) || 0,
      stock: 1,
      minStock: 0,
      sku: 'CUSTOM',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    addPart(dummyProduct);
    setCustomPartName('');
    setCustomPartCost('');
    setShowCustomPartForm(false);
  };

  if (!ticket) return null;

  const handleEditCostsClick = () => {
    // If ticket is already completed and user is not admin, require admin authorization
    if (ticket.status === 'completed' && !isAdmin) {
      setShowAdminUnlock(true);
      return;
    }
    startEditingCost();
  };

  const startEditingCost = () => {
    setCostForm({
      estimatedCost: ticket.estimatedCost.toString(),
      actualCost: ticket.actualCost ? ticket.actualCost.toString() : '',
      depositAmount: ticket.depositAmount ? ticket.depositAmount.toString() : ''
    });
    setIsEditingCost(true);
  };

  const saveCost = async () => {
    const est = Number(costForm.estimatedCost);
    const act = costForm.actualCost ? Number(costForm.actualCost) : undefined;
    const dep = costForm.depositAmount ? Number(costForm.depositAmount) : 0;
    if (isNaN(est) || (costForm.actualCost && isNaN(act!)) || (costForm.depositAmount && isNaN(dep))) {
      toast.error(t('error.invalidInput'), t('error.invalidNumbers'));
      return;
    }

    const updates: Partial<RepairTicket> = {
      estimatedCost: est,
      actualCost: act,
      depositAmount: dep
    };

    // If editing a completed ticket, keep paymentStatus and debt entry in sync
    if (ticket.status === 'completed') {
      const finalCost = act !== undefined ? act : est;
      const totalPaid = ticket.paidAmount !== undefined ? ticket.paidAmount : dep;

      if (finalCost <= totalPaid) {
        updates.paymentStatus = 'paid';
      } else if (totalPaid > 0) {
        updates.paymentStatus = 'partial';
      } else {
        updates.paymentStatus = 'debt';
      }

      // Sync customer debt entry if one was linked
      if (ticket.debtEntryId) {
        try {
          await useCustomerStore.getState().updateDebtAmount(
            ticket.debtEntryId,
            finalCost,
            `Repair #${ticket.ticketNumber} total adjusted to ${formatCurrency(finalCost)}`
          );
        } catch (debtErr) {
          console.error('Failed to update debt entry:', debtErr);
        }
      }

      // Log the price edit audit trail
      const oldPrice = ticket.actualCost ?? ticket.estimatedCost;
      activityLogService.log(
        'repairs',
        `Repair ticket #${ticket.ticketNumber} price edited on completed ticket`,
        {
          detail: `Price changed from ${formatCurrency(oldPrice)} to ${formatCurrency(finalCost)}. Edited by ${user?.name || 'Staff'}.`,
          entityId: ticket.id,
          userName: user?.name,
          userId: user?.id,
        }
      ).catch(console.error);
    }

    await updateTicket(ticket.id, updates);
    toast.success(t('ticket.costsUpdated'), t('ticket.costsUpdatedDesc'));
    setIsEditingCost(false);
  };

  const handleSavePartsOnly = async () => {
    if (parts.length === 0) return;
    setIsSubmitting(true);
    try {
      parts.forEach(p => adjustStockBy(p.product.id, -p.quantity));
      const existingParts = ticket.partsUsed || [];
      const updatedParts = [
        ...existingParts,
        ...parts.map(p => ({
          productId: p.product.id,
          name: `${p.product.name} ${p.product.model}`,
          cost: p.product.costPrice,
          quantity: p.quantity
        }))
      ];
      await updateTicket(ticket.id, { partsUsed: updatedParts });
      setParts([]);
      toast.success(t('ticket.partsRecorded'), t('ticket.partsRecordedDesc', { count: parts.length }));
    } catch {
      toast.error(t('error.failedToSaveParts'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const persistPartsIfAny = async () => {
    if (parts.length > 0) {
      parts.forEach(p => adjustStockBy(p.product.id, -p.quantity));
      const existingParts = ticket.partsUsed || [];
      const updatedParts = [
        ...existingParts,
        ...parts.map(p => ({
          productId: p.product.id,
          name: `${p.product.name} ${p.product.model}`,
          cost: p.product.costPrice,
          quantity: p.quantity
        }))
      ];
      await updateTicket(ticket.id, { partsUsed: updatedParts });
      setParts([]);
    }
  };

  const handleSetStatus = async (targetStatus: RepairTicket['status']) => {
    if (ticket.status === targetStatus) return;

    if (targetStatus === 'completed' && onRequestSettlement) {
      await persistPartsIfAny();
      onRequestSettlement(ticket);
      return;
    }

    setIsSubmitting(true);
    try {
      await persistPartsIfAny();
      await updateStatus(ticket.id, targetStatus);
      const label =
        targetStatus === 'in_progress' ? t('status.started') :
        targetStatus === 'ready' ? t('status.readyForPickup') :
        targetStatus === 'pending' ? t('status.pending') :
        t(`status.${targetStatus}`, targetStatus.replace('_', ' '));
      toast.success(t('ticket.statusUpdated'), t('ticket.statusUpdatedDesc', { ticketNumber: ticket.ticketNumber, label }));
    } catch (err: any) {
      toast.error(t('error.updateFailed'), err?.message || t('error.couldNotUpdate'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClaimed = async () => {
    await persistPartsIfAny();
    if (onRequestSettlement) {
      onRequestSettlement(ticket);
    } else {
      await handleSetStatus('completed');
    }
  };


  const handleCancel = async () => {
    setIsSubmitting(true);
    await updateStatus(ticket.id, 'cancelled');
    toast.success(t('ticket.ticketCancelled'), t('ticket.ticketCancelledDesc', { ticketNumber: ticket.ticketNumber }));
    setIsSubmitting(false);
    setShowConfirmCancel(false);
  };

  const handleReturn = async () => {
    if (!returnForm.reason.trim()) {
      toast.error(t('common.required'), t('error.returnReasonRequired'));
      return;
    }
    setIsSubmitting(true);
    
    const parsedCost = parseFloat(returnForm.estimatedCost) || 0;
    const isWarranty = !returnForm.chargeCustomer;
    
    // Create the return child ticket linked to original parent
    const childTicket = await createTicket({
      customerName: ticket.customerName,
      customerPhone: ticket.customerPhone,
      customerId: ticket.customerId,
      deviceBrand: ticket.deviceBrand,
      deviceModel: ticket.deviceModel,
      issueDescription: `[RETURN of #${ticket.ticketNumber}] ${returnForm.reason.trim()}`,
      estimatedCost: returnForm.chargeCustomer ? parsedCost : 0,
      actualCost: isWarranty ? 0 : undefined,
      depositAmount: 0,
      status: 'pending',
      parentTicketId: ticket.parentTicketId || ticket.id,
      parentTicketNumber: ticket.parentTicketNumber || ticket.ticketNumber,
      isReturn: true,
      paymentStatus: isWarranty ? 'paid' : 'pending',
      lockType: ticket.lockType,
      lockValue: ticket.lockValue,
      estimatedCompletionDate: returnForm.pickupDate || undefined,
    });

    await updateTicket(ticket.id, {
      returnReason: returnForm.reason.trim(),
      returnDate: new Date().toISOString(),
      activeReturnTicketId: childTicket?.id,
      activeReturnTicketNumber: childTicket?.ticketNumber,
    });
    await updateStatus(ticket.id, 'returned');
    
    toast.success(
      t('ticket.ticketReturned'), 
      childTicket ? `Return Ticket #${childTicket.ticketNumber} created and linked to #${ticket.ticketNumber}` : t('ticket.ticketReturnedDesc', { ticketNumber: ticket.ticketNumber })
    );
    setIsSubmitting(false);
    setShowReturnPrompt(false);
    setReturnForm({ reason: '', estimatedCost: '', pickupDate: '', chargeCustomer: false });
  };

  const isTerminal = ticket.status === 'completed' || ticket.status === 'cancelled';

  return (
    <>
      <SlidePanel
        isOpen={!!ticket}
        onClose={onClose}
        title={`${t('ticket.ticketNumber')}${ticket.ticketNumber}`}
        subtitle={t('ticket.repairDetails')}
        width="md"
        footer={
          <div className={styles.footerActions}>
            <div className={styles.footerLeftActions}>
              <Button variant="secondary" onClick={onEdit} leftIcon={<Edit size={16} />}>
                {t('ticket.editTicket')}
              </Button>
              <Button variant="secondary" onClick={() => setIsPrintModalOpen(true)} leftIcon={<Printer size={16} />}>
                {t('ticket.printLabel')}
              </Button>
              {ticket.status === 'completed' && (
                <Button variant="secondary" onClick={() => setShowReturnPrompt(true)}>
                  {t('ticket.markReturned')}
                </Button>
              )}
              {ticket.status !== 'cancelled' && (
                <Button variant="danger" onClick={() => setShowConfirmCancel(true)} disabled={isSubmitting}>
                  {t('ticket.cancelTicket')}
                </Button>
              )}
            </div>

            {!isTerminal && (() => {
              // If this parent ticket has an active child return ticket, direct user to that ticket
              if (ticket.status === 'returned' && childReturnTicket && onSelectTicket) {
                return (
                  <Button variant="primary" onClick={() => onSelectTicket(childReturnTicket)} leftIcon={<ArrowRight size={16} />}>
                    Go to Return Ticket #{childReturnTicket.ticketNumber} →
                  </Button>
                );
              }
              const next = nextStatusMap[ticket.status];
              if (!next) return null;
              if (next === 'completed') {
                return (
                  <Button variant="primary" onClick={handleClaimed} disabled={isSubmitting} leftIcon={<BadgeCheck size={16} />}>
                    {t('ticket.completeHandover')}
                  </Button>
                );
              }
              const statusLabel = next === 'in_progress' ? t('ticket.startRepair') : 
                                  next === 'ready' ? t('ticket.markReady') : 
                                  next === 'completed' ? t('ticket.markClaimed') : '';
              return (
                <Button variant="primary" onClick={() => handleSetStatus(next)} disabled={isSubmitting} leftIcon={<ArrowRight size={16} />}>
                  {statusLabel}
                </Button>
              );
            })()}
          </div>
        }
      >
        <div className={styles.content}>
          {/* Banner if this ticket is a child return ticket */}
          {ticket.isReturn && (
            <div style={{
              background: '#fef3c7',
              border: '1px solid #fde68a',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}>
              <div>
                <strong style={{ color: '#92400e', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  🔁 RETURN TICKET
                </strong>
                <span style={{ fontSize: '12px', color: '#b45309', display: 'block', marginTop: '2px' }}>
                  This ticket belongs to original Ticket #{parentTicket?.ticketNumber || ticket.parentTicketNumber || ticket.parentTicketId}.
                </span>
              </div>
              {parentTicket && onSelectTicket && (
                <Button size="sm" variant="ghost" onClick={() => onSelectTicket(parentTicket)} style={{ whiteSpace: 'nowrap' }}>
                  View Original #{parentTicket.ticketNumber} →
                </Button>
              )}
            </div>
          )}

          {/* Banner if this ticket has a child return ticket in progress */}
          {ticket.status === 'returned' && childReturnTicket && (
            <div style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}>
              <div>
                <strong style={{ color: '#1d4ed8', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  ⚠️ RETURN RECORDED
                </strong>
                <span style={{ fontSize: '12px', color: '#2563eb', display: 'block', marginTop: '2px' }}>
                  Active child return ticket: #{childReturnTicket.ticketNumber} ({childReturnTicket.status.replace('_', ' ')}).
                </span>
              </div>
              {onSelectTicket && (
                <Button size="sm" variant="primary" onClick={() => onSelectTicket(childReturnTicket)} style={{ whiteSpace: 'nowrap' }}>
                  Go to Return Ticket #{childReturnTicket.ticketNumber} →
                </Button>
              )}
            </div>
          )}

          <div className={styles.statusHeader}>
            <RepairStatusBadge status={ticket.status} />
            <span className={styles.date}>Created: {formatDate(ticket.createdAt)}</span>
          </div>

          {/* Quick One-Click Status Change Bar */}
          <div className={styles.statusButtonBar}>
            <div className={styles.statusButtonBarHeader}>
              <span className={styles.statusButtonBarTitle}>
                <Activity size={13} />
                {t('ticket.changeStatusDirectly')}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                {t('ticket.clickToJump')}
              </span>
            </div>
            <div className={styles.statusButtonsGrid}>
              <button
                type="button"
                className={[styles.statusBtn, styles.statusBtnStarted, ticket.status === 'in_progress' && styles.statusBtnActive].filter(Boolean).join(' ')}
                onClick={() => handleSetStatus('in_progress')}
                disabled={isSubmitting || ticket.status === 'in_progress'}
              >
                <Wrench size={14} />
                <span>{t('status.started')}</span>
                {ticket.status === 'in_progress' && <span className={styles.currentPill}>{t('common.current')}</span>}
              </button>

              <button
                type="button"
                className={[styles.statusBtn, styles.statusBtnReady, ticket.status === 'ready' && styles.statusBtnActive].filter(Boolean).join(' ')}
                onClick={() => handleSetStatus('ready')}
                disabled={isSubmitting || ticket.status === 'ready'}
              >
                <CheckCircle2 size={14} />
                <span>{t('status.ready')}</span>
                {ticket.status === 'ready' && <span className={styles.currentPill}>{t('common.current')}</span>}
              </button>

              <button
                type="button"
                className={[styles.statusBtn, styles.statusBtnClaimed, ticket.status === 'completed' && styles.statusBtnActive].filter(Boolean).join(' ')}
                onClick={handleClaimed}
                disabled={isSubmitting}
              >
                <BadgeCheck size={14} />
                <span>{t('ticket.completeHandover')}</span>
                {ticket.status === 'completed' && <span className={styles.currentPill}>{t('common.done')}</span>}
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('ticket.customerContact')}</h3>
            <div className={styles.grid}>
              <div className={styles.item}>
                <span className={styles.label}>{t('common.name')}</span>
                <span className={styles.value}>{ticket.customerName}</span>
              </div>
              <div className={styles.item}>
                <span className={styles.label}>{t('common.phone')}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={styles.value}>{ticket.customerPhone || '—'}</span>
                  {ticket.customerPhone && (
                    <a
                      href={`tel:${ticket.customerPhone}`}
                      style={{ fontSize: '11.5px', color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 700 }}
                      title={t('ticket.callCustomer')}
                    >
                      📞 {t('common.call')}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {ticket.customerPhone && (
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: '8px',
                  color: '#047857',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginTop: '2px',
                }}
                onClick={() => {
                  const phoneClean = ticket.customerPhone.replace(/[^0-9]/g, '');
                  const remaining = (ticket.actualCost ?? ticket.estimatedCost) - (ticket.depositAmount || 0);
                  const msg = encodeURIComponent(
                    `Bonjour ${ticket.customerName}! Votre ${ticket.deviceBrand} ${ticket.deviceModel} (Ticket #${ticket.ticketNumber}) est réparé et prêt à être récupéré chez ${settings.storeName || 'PhoneShop Pro'}. Montant à régler: ${formatCurrency(Math.max(0, remaining))}. Merci!`
                  );
                  window.open(`https://wa.me/${phoneClean}?text=${msg}`, '_blank');
                }}
              >
                <span>💬 {t('ticket.whatsappCustomer')}</span>
              </button>
            )}

            {matchedCustomer && onViewCustomerProfile && (
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '8px',
                  color: '#1d4ed8',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginTop: '6px',
                  width: '100%',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => {
                  onClose();
                  onViewCustomerProfile(matchedCustomer);
                }}
                title={t('ticket.openCustomerProfile')}
              >
                <span>👤 {t('ticket.openCustomerProfile')} →</span>
              </button>
            )}

            {onRepairAgain && (
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  color: '#334155',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginTop: '6px',
                  width: '100%',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => {
                  onClose();
                  onRepairAgain(ticket);
                }}
                title={t('ticket.createNewTicketSameDevice')}
              >
                <Plus size={16} />
                <span>{t('ticket.createNewTicketSameDevice')}</span>
              </button>
            )}


            {/* Past Repair History Drawer */}
            <div style={{ marginTop: '4px' }}>
              <CustomerHistoryWidget
                customerId={ticket.customerId}
                customerName={ticket.customerName}
                customerPhone={ticket.customerPhone}
                currentTicketId={ticket.id}
                defaultOpen={false}
              />
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('ticket.deviceIssue')}</h3>
            <div className={styles.grid}>
              <div className={styles.item}>
                <span className={styles.label}>{t('inventory.brand')}</span>
                <span className={styles.value}>{ticket.deviceBrand}</span>
              </div>
              <div className={styles.item}>
                <span className={styles.label}>{t('inventory.model')}</span>
                <span className={styles.value}>{ticket.deviceModel}</span>
              </div>
            </div>
            <div className={styles.issueBox}>
              <span className={styles.label}>{t('ticket.issueDescription')}</span>
              <p className={styles.issueText}>{ticket.issueDescription}</p>
            </div>
          </div>

          {/* Technician Remark / Workshop Findings */}
          <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                <span>🔍 {t('ticket.technicianRemark')}</span>
              </h3>
              {!isEditingRemark && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditingRemark(true)}>
                  <Edit size={13} style={{ marginRight: 4 }} />
                  {ticket.remark ? t('ticket.editRemark') : t('ticket.addRemark')}
                </Button>
              )}
            </div>

            {isEditingRemark ? (
              <div className={styles.remarkEditContainer}>
                <textarea
                  className={styles.remarkTextarea}
                  rows={3}
                  placeholder={t('ticket.remarkPlaceholder')}
                  value={remarkInput}
                  onChange={(e) => setRemarkInput(e.target.value)}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRemarkInput(ticket.remark || '');
                      setIsEditingRemark(false);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={isSubmitting}
                    onClick={handleSaveRemark}
                  >
                    {t('ticket.saveAndSync')}
                  </Button>
                </div>
              </div>
            ) : ticket.remark ? (
              <div className={styles.remarkDisplayBox}>
                <p className={styles.remarkDisplayText}>{ticket.remark}</p>
                <span className={styles.remarkSyncBadge}>🌐 {t('ticket.visibleToCustomer')}</span>
              </div>
            ) : (
              <div
                className={styles.remarkEmptyBox}
                onClick={() => setIsEditingRemark(true)}
              >
                <span>{t('ticket.clickToAddRemark')}</span>
              </div>
            )}
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('ticket.deviceSecurityLock')}</h3>
            <LockCodeViewer lockType={ticket.lockType} lockValue={ticket.lockValue} />
          </div>

          <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>{t('ticket.serviceDetails')}</h3>
              {ticket.status !== 'cancelled' && !isEditingCost && (
                <Button variant="ghost" size="sm" onClick={handleEditCostsClick}>
                  {t('ticket.editCosts')}
                </Button>
              )}
            </div>
            
            {isEditingCost ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--color-surface-variant)', padding: '16px', borderRadius: '8px' }}>
                <Input 
                  label={t('ticket.estimatedCost')} 
                  type="number" 
                  value={costForm.estimatedCost} 
                  onChange={e => setCostForm(p => ({ ...p, estimatedCost: e.target.value }))} 
                />
                <Input 
                  label={t('ticket.actualCost')} 
                  type="number" 
                  placeholder={t('ticket.actualCostPlaceholder')}
                  value={costForm.actualCost} 
                  onChange={e => setCostForm(p => ({ ...p, actualCost: e.target.value }))} 
                />
                <Input 
                  label={t('ticket.depositPaid')} 
                  type="number" 
                  value={costForm.depositAmount} 
                  onChange={e => setCostForm(p => ({ ...p, depositAmount: e.target.value }))} 
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingCost(false)}>{t('common.cancel')}</Button>
                  <Button size="sm" onClick={saveCost}>{t('ticket.saveCosts')}</Button>
                </div>
              </div>
            ) : (
              <div className={styles.grid}>
                <div className={styles.item}>
                  <span className={styles.label}>{t('ticket.technician')}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isAssigningTech ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                        <select
                          style={{
                            padding: '6px 10px',
                            borderRadius: '8px',
                            border: '1.5px solid var(--color-border)',
                            fontSize: '13px',
                            fontWeight: 600,
                            background: 'var(--color-surface)',
                            cursor: 'pointer',
                          }}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) handleAssignTechnician(e.target.value);
                          }}
                          autoFocus
                        >
                          <option value="" disabled>{t('ticket.selectTechnician')}</option>
                          {technicians.map(t => (
                            <option key={t.id} value={t.name}>{t.name} ({t.email})</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 0' }}
                          onClick={() => setIsAssigningTech(false)}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={styles.value} style={{
                          background: ticket.assignedTechnician ? '#dbeafe' : '#fee2e2',
                          padding: '3px 10px',
                          borderRadius: '8px',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          color: ticket.assignedTechnician ? '#1e40af' : '#991b1b'
                        }}>
                          {ticket.assignedTechnician ? `🔧 ${ticket.assignedTechnician}` : `⚠️ ${t('ticket.unassigned')}`}
                        </span>
                        <button
                          type="button"
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface-variant)',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                          onClick={() => setIsAssigningTech(true)}
                        >
                          <UserCheck size={12} />
                          {ticket.assignedTechnician ? t('common.change') : t('common.assign')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className={styles.item}>
                  <span className={styles.label}>{t('ticket.createdBy')}</span>
                  <span className={styles.value}>
                    {ticket.createdByName ? (
                      <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', background: 'var(--color-surface-variant)', padding: '2px 8px', borderRadius: '12px' }}>
                        {ticket.createdByName}
                      </span>
                    ) : t('common.system')}
                  </span>
                </div>
                <div className={styles.item}>
                  <span className={styles.label}>{t('ticket.cost')}</span>
                  <span className={styles.value}>
                    {ticket.actualCost ? `${formatCurrency(ticket.actualCost)} (${t('common.final')})` : `~${formatCurrency(ticket.estimatedCost)} (${t('common.est')})`}
                  </span>
                </div>
                {ticket.depositAmount ? (
                  <div className={styles.item}>
                    <span className={styles.label}>{t('ticket.depositPaid')}</span>
                    <span className={styles.value} style={{ color: 'var(--color-success)' }}>
                      {formatCurrency(ticket.depositAmount)}
                    </span>
                  </div>
                ) : null}
                <div className={styles.item}>
                  <span className={styles.label}>
                    {ticket.status === 'completed' ? t('ticket.settlementStatus') : t('ticket.remainingBalance')}
                  </span>
                  <span className={styles.value} style={{ fontWeight: 600 }}>
                    {(() => {
                      const total = ticket.actualCost ?? ticket.estimatedCost;
                      const totalPaid = ticket.paidAmount !== undefined 
                        ? ticket.paidAmount 
                        : (ticket.depositAmount || 0) + (ticket.handoverAmountPaid || 0);
                      const rem = total - totalPaid;
                      if (ticket.status === 'completed') {
                        if (rem <= 0 && total > 0) {
                          return <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓ {t('ticket.fullyPaid')} ({formatCurrency(totalPaid)})</span>;
                        }
                        return (
                          <span style={{ color: '#b45309', fontWeight: 700 }}>
                            ⚠️ {t('ticket.debtRecorded')}: {formatCurrency(Math.max(0, rem))} ({t('ticket.paid')}: {formatCurrency(totalPaid)})
                          </span>
                        );
                      }
                      if (rem <= 0 && total > 0) return <span style={{ color: 'var(--color-success)' }}>{t('ticket.paidInFull')}</span>;
                      return formatCurrency(Math.max(0, rem));
                    })()}
                  </span>
                </div>
                {ticket.settlementNotes && (
                  <div className={styles.item} style={{ gridColumn: '1 / -1' }}>
                    <span className={styles.label}>{t('ticket.handoverRemark')}</span>
                    <span className={styles.value} style={{ fontStyle: 'italic', color: 'var(--color-on-surface-variant)' }}>
                      {ticket.settlementNotes}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Linked Tickets (Device History) */}
          {linkedTickets.length > 1 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <Clock size={14} style={{ marginRight: '6px', color: 'var(--color-primary)' }} />
                Device Repair History (General Ticket)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                {linkedTickets.map((t, idx) => {
                  const isActive = t.id === ticket.id;
                  return (
                    <div 
                      key={t.id} 
                      onClick={(!isActive && onSelectTicket) ? () => onSelectTicket(t) : undefined}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        fontSize: '12px', 
                        padding: '10px 12px', 
                        background: isActive ? 'var(--color-primary-light, #e0f2fe)' : 'var(--color-surface-variant, #f8fafc)', 
                        border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border, #e2e8f0)', 
                        borderRadius: '6px',
                        cursor: (!isActive && onSelectTicket) ? 'pointer' : 'default',
                        transition: 'background 0.15s ease, border-color 0.15s ease',
                      }}
                      title={(!isActive && onSelectTicket) ? `Click to view Ticket #${t.ticketNumber}` : undefined}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ textTransform: 'uppercase', color: isActive ? 'var(--color-primary)' : 'var(--color-text)' }}>
                            {t.ticketNumber}
                          </strong>
                          {t.isReturn && <span style={{ background: '#fef08a', color: '#854d0e', padding: '2px 6px', borderRadius: '12px', fontSize: '10px', fontWeight: 600 }}>RETURN</span>}
                          {idx === 0 && <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '12px', fontSize: '10px', fontWeight: 600 }}>MAIN</span>}
                          <span style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px', textTransform: 'capitalize' }}>
                            {t.status.replace('_', ' ')}
                          </span>
                          {!isActive && onSelectTicket && (
                            <span style={{ color: 'var(--color-primary)', fontSize: '11px', fontWeight: 500 }}>
                              View →
                            </span>
                          )}
                        </div>
                        <span style={{ color: 'var(--color-on-surface-variant)' }}>
                          {t.issueDescription}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>{new Date(t.createdAt).toLocaleDateString()}</span>
                        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                          {formatCurrency(t.actualCost ?? t.estimatedCost)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status History Timeline */}
          {ticket.statusHistory && ticket.statusHistory.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('ticket.statusHistory')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                {ticket.statusHistory.map((h, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', padding: '8px 12px', background: 'var(--color-surface-variant, #f8fafc)', borderRadius: '6px' }}>
                    <div>
                      <strong style={{ textTransform: 'capitalize' }}>{t(`status.${h.status}`, h.status.replace('_', ' '))}</strong>
                      <span style={{ color: 'var(--color-on-surface-variant)', marginLeft: '6px' }}>{t('common.by')} {h.changedByName}</span>
                    </div>
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>{formatDate(h.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Parts Used Section - visible on ALL statuses */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}><Package size={14} style={{marginRight:4}} />{t('ticket.partsUsed')}</h3>

            {((ticket.partsUsed && ticket.partsUsed.length > 0) || parts.length > 0) && (
              <div className={styles.partsList}>
                {ticket.partsUsed?.map((pu, idx) => (
                  <div key={`existing-${idx}`} className={styles.partRow} style={{ opacity: 0.7 }}>
                    <span className={styles.partName}>{pu.name || (pu as any).productName}</span>
                    <span className={styles.partSku}>{pu.cost ? formatCurrency(pu.cost) : t('common.saved')}</span>
                    <button className={styles.removePartBtn} disabled style={{ cursor: 'not-allowed' }}>
                      <CheckCircle size={12} />
                    </button>
                  </div>
                ))}
                {parts.map(p => (
                  <div key={p.product.id} className={styles.partRow}>
                    <span className={styles.partName}>{p.product.name} {p.product.model}</span>
                    <span className={styles.partSku}>{p.product.sku} <span style={{ color: 'var(--color-primary)', fontSize: '10px' }}>({t('common.new')})</span></span>
                    <button className={styles.removePartBtn} onClick={() => removePart(p.product.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {parts.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleSavePartsOnly}
                      isLoading={isSubmitting}
                    >
                      {t('ticket.saveAndDeductParts', { count: parts.length })}
                    </Button>
                  </div>
                )}
                {/* Total Parts Cost */}
                {ticket.partsUsed && ticket.partsUsed.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '10px', borderTop: '2px solid var(--color-success, #10b981)' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>{t('ticket.totalPartsCost')}</span>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-success, #10b981)' }}>
                      {formatCurrency(ticket.partsUsed.reduce((sum, p) => sum + (p.cost || 0), 0))}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className={styles.partSearchWrap}>
              <Input
                placeholder={t('ticket.searchInventoryParts')}
                value={partSearch}
                onChange={e => setPartSearch(e.target.value)}
              />
              {filteredParts.length > 0 && (
                <div className={styles.partDropdown}>
                  {filteredParts.map(p => (
                    <button key={p.id} className={styles.partOption} onClick={() => addPart(p)}>
                      <Plus size={12} />
                      <span>{p.name} {p.model}</span>
                      <span className={styles.partStock}>{t('inventory.inStock', { count: p.stock })}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {showCustomPartForm ? (
              <div style={{ marginTop: '12px', padding: '12px', background: 'var(--color-surface-variant, #f8fafc)', borderRadius: '8px', border: '1px dashed var(--color-border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Input
                    placeholder="Part Name (e.g. Generic Screen Protector)"
                    value={customPartName}
                    onChange={e => setCustomPartName(e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="Cost Price (0.00)"
                    value={customPartCost}
                    onChange={e => setCustomPartCost(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <Button variant="ghost" size="sm" onClick={() => setShowCustomPartForm(false)}>Cancel</Button>
                    <Button variant="primary" size="sm" onClick={handleAddCustomPart} disabled={!customPartName.trim()}>Add Part</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '8px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => setShowCustomPartForm(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-primary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  + Add Custom Part (Not in Inventory)
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Print Label Area */}
        <div className={styles.printLabelArea} aria-hidden="true">
          <div className={styles.printHeader} style={{ transform: 'translateX(-2mm)' }}>{settings.storeName || 'PhoneShop Pro'}</div>
          <div style={{ borderTop: '1.5px solid black', width: '100%', margin: '1mm 0 1mm 0' }} />
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#111', margin: '1mm 0', transform: 'translateX(-5mm)' }}>
            {ticket.deviceBrand} {ticket.deviceModel}{ticket.customerPhone ? ` ${ticket.customerPhone}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '8.5px', color: '#111', margin: '0.5mm 0', transform: 'translateX(-5mm)' }}>
            <div><strong>{t('ticket.customer', 'Client')}&nbsp;:&nbsp;</strong>{ticket.customerName}</div>
            <div><strong>{t('ticket.issue', 'Prob')}&nbsp;:&nbsp;</strong>{ticket.issueDescription || 'Diagnostic'}</div>
            <div><strong>{t('ticket.cost', 'Prix')}&nbsp;:&nbsp;</strong>{formatCurrency(ticket.actualCost ?? ticket.estimatedCost)}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '2mm 0 0 0' }}>
            <QRCodeSVG value={`${settings.trackingBaseUrl || `${window.location.origin}/track`}/${ticket.ticketNumber}?pin=${ticket.trackingPin || ticket.customerPhone?.slice(-4) || ''}`} size={76} level="M" />
            <div style={{ fontSize: '8px', fontWeight: 400, color: '#333', marginTop: '1px', letterSpacing: '0.5px', transform: 'translateX(-6mm)' }}>{ticket.ticketNumber}</div>
            <div style={{ fontSize: '6.5px', color: '#666', marginTop: '2px', textAlign: 'center' }}>{t('ticket.scanToTrack')}</div>
          </div>
        </div>
      </SlidePanel>

      <ConfirmDialog
        isOpen={showConfirmCancel}
        onClose={() => setShowConfirmCancel(false)}
        onConfirm={handleCancel}
        title={t('ticket.cancelTicket')}
        message={t('ticket.confirmCancelTicket', { ticketNumber: ticket?.ticketNumber })}
        confirmLabel={t('ticket.cancelTicket')}
        isLoading={isSubmitting}
      />

      <Modal
        isOpen={showReturnPrompt}
        onClose={() => { setShowReturnPrompt(false); setReturnForm({ reason: '', estimatedCost: '', pickupDate: '', chargeCustomer: false }); }}
        title={t('ticket.returnModalTitle')}
        subtitle={`${ticket.deviceBrand} ${ticket.deviceModel} — ${ticket.customerName}`}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Button variant="secondary" onClick={() => { setShowReturnPrompt(false); setReturnForm({ reason: '', estimatedCost: '', pickupDate: '', chargeCustomer: false }); }}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleReturn} disabled={isSubmitting || !returnForm.reason.trim()}>
              {isSubmitting ? t('common.loading') : t('ticket.confirmReturn')}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Info banner */}
          <div style={{
            background: 'var(--color-warning-container, #fef3c7)',
            border: '1px solid var(--color-warning, #f59e0b)',
            borderRadius: '8px',
            padding: '12px 14px',
            fontSize: '13px',
            color: 'var(--color-on-warning-container, #92400e)',
            lineHeight: '1.5',
          }}>
            {t('ticket.returnInfoBanner')}
          </div>

          {/* Reason */}
          <Textarea
            label={t('ticket.returnReasonLabel')}
            value={returnForm.reason}
            onChange={e => setReturnForm(f => ({ ...f, reason: e.target.value }))}
            placeholder={t('ticket.returnReasonPlaceholder')}
            rows={3}
            autoFocus
          />

          {/* Charge toggle */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            background: 'var(--color-surface-variant, #f1f5f9)',
            borderRadius: '8px',
          }}>
            <input
              type="checkbox"
              id="return-charge"
              checked={returnForm.chargeCustomer}
              onChange={e => setReturnForm(f => ({ ...f, chargeCustomer: e.target.checked }))}
              style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
            />
            <label htmlFor="return-charge" style={{ fontSize: '13px', cursor: 'pointer', flex: 1 }}>
              {t('ticket.returnChargeCustomer')}
            </label>
          </div>

          {/* Estimated cost (only if charging) */}
          {returnForm.chargeCustomer && (
            <Input
              type="number"
              label={t('ticket.returnEstimatedCost')}
              value={returnForm.estimatedCost}
              onChange={e => setReturnForm(f => ({ ...f, estimatedCost: e.target.value }))}
              placeholder="0"
              min="0"
            />
          )}

          {/* Pickup date */}
          <Input
            type="date"
            label={t('ticket.returnPickupDate')}
            value={returnForm.pickupDate}
            onChange={e => setReturnForm(f => ({ ...f, pickupDate: e.target.value }))}
          />

          {/* Original ticket reference */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            background: 'var(--color-surface-variant, #f1f5f9)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--color-on-surface-variant)',
          }}>
            <span>{t('ticket.returnLinkedTo')}</span>
            <span style={{ fontWeight: 600 }}>#{ticket.ticketNumber}</span>
          </div>
        </div>
      </Modal>

      <PrintRepairTicketModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        ticket={ticket}
      />

      <AdminUnlockModal
        isOpen={showAdminUnlock}
        onClose={() => setShowAdminUnlock(false)}
        onSuccess={() => {
          setShowAdminUnlock(false);
          startEditingCost();
        }}
        actionName={`edit costs on completed ticket #${ticket.ticketNumber}`}
      />
    </>
  );
};
