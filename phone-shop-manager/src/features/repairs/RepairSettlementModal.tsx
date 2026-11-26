import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Phone,
  DollarSign,
  Calendar,
  FileText,
  CreditCard,
  Banknote,
  Smartphone,
  User,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Customer, RepairTicket, RepairStatusHistoryEntry, PaymentMethod } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatStandardPhone, isPhoneMatch, normalizePhoneDigits, walkInCustomerId } from '../../utils/phoneUtils';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { activityLogService } from '../../services/activityLogService';
import { customerLogService } from '../../services/customerLogService';
import { offlineQueue } from '../../services/offlineQueue';
import styles from './RepairSettlementModal.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface RepairSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: RepairTicket | null;
  onSettled: (updatedTicket: RepairTicket) => void;
}

export const RepairSettlementModal: React.FC<RepairSettlementModalProps> = ({
  isOpen,
  onClose,
  ticket,
  onSettled,
}) => {
  const toast = useToast();
  const { updateTicket } = useRepairStore();
  const { customers, findOrCreateCustomer, addDebt, updateCustomer, updateDebtAmount, recordDebtPayment, recalculateCustomer } = useCustomerStore();
  const actor = useAuthStore(state => state.user);

  // Form State
  const [finalPrice, setFinalPrice] = useState<number>(0);
  const [isEditingPrice, setIsEditingPrice] = useState<boolean>(false);
  const [amountPaidNow, setAmountPaidNow] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [isEditingPhone, setIsEditingPhone] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [dueDate, setDueDate] = useState<string>('');
  const [settlementNotes, setSettlementNotes] = useState<string>('');
  const [showExtra, setShowExtra] = useState<boolean>(false);
  const [phoneError, setPhoneError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Initialize or reset form whenever ticket changes or modal opens
  useEffect(() => {
    if (ticket && isOpen) {
      const price = ticket.actualCost ?? ticket.estimatedCost ?? 0;
      const deposit = ticket.depositAmount || 0;
      // Money taken at an earlier handover is already on the ticket. A re-settle
      // collects whatever comes NOW, so the field must not arrive pre-filled with a
      // balance the till may already have been handed — saving that would inflate
      // paidAmount past what the shop ever collected.
      const previouslyCollected = ticket.status === 'completed' ? (ticket.handoverAmountPaid || 0) : 0;
      const remainingDue = Math.max(0, price - deposit - previouslyCollected);

      setFinalPrice(price);
      setIsEditingPrice(false);
      setAmountPaidNow(ticket.status === 'completed' ? '0' : remainingDue.toString());
      setCustomerPhone(ticket.customerPhone || '');
      setIsEditingPhone(!ticket.customerPhone);
      setPaymentMethod('cash');
      setDueDate('');
      setSettlementNotes('');
      setShowExtra(false);
      setPhoneError('');
      setIsSubmitting(false);
    }
  }, [ticket, isOpen]);

  // Proactively find existing customer account by phone or ID
  const matchingCustomer = useMemo(() => {
    // The counter is typing the customer's own line here, and the match must be
    // the same strict, dummy-guarded rule the rest of the app uses. The loose
    // suffix scan used to adopt a placeholder number's profile — a debt recorded
    // on a stranger's account is money the shop cannot chase.
    if (normalizePhoneDigits(customerPhone).length >= 7) {
      const found = customers.find(c =>
        isPhoneMatch(c.phone, customerPhone) ||
        (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, customerPhone))
      );
      if (found) return found;
    }
    if (ticket?.customerId) {
      return customers.find(c => c.id === ticket.customerId) || null;
    }
    return null;
  }, [customerPhone, ticket?.customerId, customers]);

  if (!ticket) return null;

  // Derived financial calculations
  const depositAlreadyPaid = ticket.depositAmount || 0;
  // What the ticket already says the shop collected. A completed ticket carries the
  // whole story in paidAmount (deposit plus every earlier handover); a re-settle adds
  // the money taken NOW on top instead of rewriting it, or the ledger claims the
  // shop took money it never saw.
  const alreadyCollected = ticket.status === 'completed'
    ? Math.max(ticket.paidAmount ?? 0, depositAlreadyPaid + (ticket.handoverAmountPaid || 0))
    : depositAlreadyPaid;
  const balanceDueBeforeHandover = Math.max(0, finalPrice - alreadyCollected);
  const paidNowNum = isNaN(Number(amountPaidNow)) ? 0 : Math.max(0, Number(amountPaidNow));
  const totalPaid = alreadyCollected + paidNowNum;
  const remainingDebt = Math.max(0, finalPrice - totalPaid);

  const isFullyPaid = remainingDebt <= 0 && finalPrice > 0;
  const isZeroPrice = finalPrice === 0;
  const isDebt = remainingDebt > 0;

  // Validation conditions
  const hasPhone = Boolean(customerPhone.trim());
  const isPhoneRequired = isDebt && !hasPhone;

  const handleQuickAmount = (amount: number) => {
    setAmountPaidNow(Math.max(0, amount).toString());
    setPhoneError('');
  };

  const handlePhoneChange = (val: string) => {
    setCustomerPhone(val);
    if (val.trim()) {
      setPhoneError('');
    }
  };

  const handleSubmit = async (e?: React.FormEvent, overrides?: { paidNow?: number; method?: PaymentMethod }) => {
    if (e) e.preventDefault();

    // 1. Validate price
    if (finalPrice < 0 || isNaN(finalPrice)) {
      toast.error('Invalid Price', 'Repair price cannot be negative.');
      return;
    }

    // Use overrides if provided (e.g. from quick-cash button)
    const effectivePaidNow = overrides?.paidNow !== undefined ? overrides.paidNow : paidNowNum;
    const effectiveMethod = overrides?.method || paymentMethod;
    const effectiveTotalPaid = alreadyCollected + effectivePaidNow;
    const effectiveRemainingDebt = Math.max(0, finalPrice - effectiveTotalPaid);
    const effectiveIsFullyPaid = effectiveRemainingDebt <= 0 && finalPrice > 0;
    const effectiveIsDebt = effectiveRemainingDebt > 0;

    // 2. Validate phone number when there is debt
    if (effectiveIsDebt) {
      const trimmedPhone = customerPhone.trim();
      if (!trimmedPhone) {
        setPhoneError('Client phone number is required to record the debt on their account.');
        setIsEditingPhone(true);
        toast.error('Phone Number Required', 'A phone number is required to register the client debt tab.');
        return;
      }

      const digitsOnly = trimmedPhone.replace(/\D/g, '');
      if (digitsOnly.length < 8) {
        setPhoneError('Please enter a valid phone number (at least 8 digits).');
        setIsEditingPhone(true);
        toast.error('Invalid Phone', 'Please enter a valid phone number with at least 8 digits.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const trimmedPhone = formatStandardPhone(customerPhone.trim()) || customerPhone.trim();
      let customerId = ticket.customerId;
      let matchedCustomer: Customer | null | undefined = matchingCustomer;

      // 3. Resolve or create customer account
      const devicePayload = ticket.deviceBrand && ticket.deviceModel ? {
        brand: ticket.deviceBrand.trim(),
        model: ticket.deviceModel.trim(),
        notes: ticket.issueDescription?.trim() || undefined,
      } : undefined;

      if (!matchedCustomer && trimmedPhone) {
        try {
          matchedCustomer = await findOrCreateCustomer({
            name: ticket.customerName.trim() || 'Client',
            phone: trimmedPhone,
            accountType: 'retail',
            device: devicePayload,
          });
        } catch (custErr) {
          console.warn('Customer find/create fallback:', custErr);
        }
      }

      if (matchedCustomer?.id) {
        customerId = matchedCustomer.id;
        // Keep phone up-to-date and enrich device vault non-destructively
        if (devicePayload) {
          useCustomerStore.getState().enrichCustomer(matchedCustomer.id, {
            phone: trimmedPhone || undefined,
            device: devicePayload,
          }).catch(console.warn);
        } else if (trimmedPhone && (!matchedCustomer.phone || !isPhoneMatch(matchedCustomer.phone, trimmedPhone))) {
          updateCustomer(matchedCustomer.id, { phone: trimmedPhone }).catch(console.error);
        }
      }

      const queueBefore = offlineQueue.getPendingCount();
      let settledOfflineOrQueued = typeof navigator !== 'undefined' && navigator.onLine === false;

      // 4. Record the money and the balance on the customer's account. A row that
      // already exists is synced to the new total AND told about the payment taken
      // NOW — failures propagate so an incomplete ledger save is never presented as done.
      let createdDebtId: string | undefined = ticket.debtEntryId;
      if (ticket.debtEntryId) {
        await updateDebtAmount(
          ticket.debtEntryId,
          finalPrice,
          `Repair #${ticket.ticketNumber} re-settled: total adjusted to ${formatCurrency(finalPrice)}`
        );
        if (effectivePaidNow > 0) {
          await recordDebtPayment(ticket.debtEntryId, {
            amount: effectivePaidNow,
            method: effectiveMethod,
            note: `Handover payment for Repair #${ticket.ticketNumber}`,
            receivedByName: actor?.name || 'Staff',
          });
        }
      } else if (effectiveIsDebt && (matchedCustomer || customerId)) {
          const targetCustId = matchedCustomer?.id || customerId!;
          const custName = matchedCustomer?.name || ticket.customerName || 'Client';
          const custPhone = trimmedPhone || matchedCustomer?.phone || ticket.customerPhone || '';

          const initialPayments = [];
          if (depositAlreadyPaid > 0) {
            initialPayments.push({
              id: `pay_dep_${Date.now()}`,
              date: ticket.createdAt || new Date().toISOString(),
              amount: depositAlreadyPaid,
              method: 'cash' as PaymentMethod,
              note: `Deposit paid at intake for Repair #${ticket.ticketNumber}`,
              receivedByName: actor?.name || 'Staff',
              // The ticket's deposit figure already counts this at the till.
              countedOn: 'repair' as const,
            });
          }
          if (effectivePaidNow > 0) {
            initialPayments.push({
              id: `pay_handover_${Date.now()}`,
              date: new Date().toISOString(),
              amount: effectivePaidNow,
              method: effectiveMethod,
              note: `Payment at handover for Repair #${ticket.ticketNumber}`,
              receivedByName: actor?.name || 'Staff',
              // The ticket's handover figure already counts this at the till.
              countedOn: 'repair' as const,
            });
          }

          const debtPayload = {
            customerId: targetCustId,
            customerName: custName,
            customerPhone: custPhone,
            productOrService: `Repair #${ticket.ticketNumber} - ${ticket.deviceBrand} ${ticket.deviceModel}`,
            totalAmount: finalPrice,
            amountPaid: effectiveTotalPaid,
            date: new Date().toISOString(),
            dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
            type: 'repair' as const,
            linkedTicketId: ticket.id,
            linkedTicketNumber: ticket.ticketNumber,
            notes: settlementNotes.trim()
              ? settlementNotes.trim()
              : `Repair #${ticket.ticketNumber} handed over with ${formatCurrency(effectiveRemainingDebt)} remaining debt.`,
            payments: initialPayments,
          };

          const newDebt = await addDebt(debtPayload);
          createdDebtId = newDebt.id;
          if (newDebt.id.startsWith('offline_')) {
            settledOfflineOrQueued = true;
          }
      }

      if (ticket.id.startsWith('offline_') || offlineQueue.getPendingCount() > queueBefore) {
        settledOfflineOrQueued = true;
      }

      // 5. Append status history entry
      const historyEntry: RepairStatusHistoryEntry = {
        status: 'completed',
        changedById: actor?.id ?? 'unknown',
        changedByName: actor?.name ?? 'Staff',
        at: new Date().toISOString(),
      };
      const updatedHistory = [...(ticket.statusHistory || []), historyEntry];

      // 6. Update Repair Ticket in Firestore & Store
      const paymentStatus: RepairTicket['paymentStatus'] =
        effectiveIsFullyPaid || isZeroPrice ? 'paid' : effectiveTotalPaid > 0 ? 'partial' : 'debt';

      const updates: Partial<RepairTicket> = {
        status: 'completed',
        actualCost: finalPrice,
        paidAmount: effectiveTotalPaid,
        handoverAmountPaid:
          (ticket.status === 'completed' ? (ticket.handoverAmountPaid || 0) : 0) + effectivePaidNow,
        // The tender stamp follows the same cycle rule as the amount: a re-settle
        // appends to the rows already on the ticket, a fresh cycle starts new ones.
        handoverPayments: effectivePaidNow > 0
          ? [
              ...(ticket.status === 'completed' ? (ticket.handoverPayments || []) : []),
              { amount: effectivePaidNow, method: effectiveMethod, date: new Date().toISOString() },
            ]
          : (ticket.status === 'completed' ? ticket.handoverPayments : undefined),
        paymentStatus,
        completedAt: new Date().toISOString(),
        debtEntryId: createdDebtId,
        customerPhone: trimmedPhone || ticket.customerPhone,
        customerId,
        settlementNotes: settlementNotes.trim() || undefined,
        statusHistory: updatedHistory,
      };

      await (updateTicket as (
        id: string,
        u: Partial<RepairTicket>,
        opts?: { onOutcome?: (o: 'committed' | 'queued') => void }
      ) => Promise<void>)(ticket.id, updates, {
        onOutcome: (outcome) => {
          if (outcome === 'queued') settledOfflineOrQueued = true;
        },
      });

      // 6b. Synchronize Parent Ticket if this is a Return Child Ticket
      const storeTickets = useRepairStore.getState().tickets;
      if (ticket.parentTicketId) {
        const parent = storeTickets.find(t => t.id === ticket.parentTicketId);
        if (parent) {
          const parentHistoryEntry: RepairStatusHistoryEntry = {
            status: 'completed',
            changedById: actor?.id ?? 'unknown',
            changedByName: actor?.name ?? 'Staff',
            at: new Date().toISOString(),
          };
          const updatedReturnRecords = (parent.returnRecords || []).map(r =>
            r.returnTicketId === ticket.id || r.returnTicketNumber === ticket.ticketNumber
              ? { ...r, status: 'completed' as const, resolvedAt: new Date().toISOString(), actualCost: finalPrice }
              : r
          );
          updateTicket(parent.id, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            activeReturnTicketId: undefined,
            returnRecords: updatedReturnRecords,
            statusHistory: [...(parent.statusHistory || []), parentHistoryEntry],
          }).catch(console.error);
        }
      } else if (ticket.activeReturnTicketId) {
        const child = storeTickets.find(t => t.id === ticket.activeReturnTicketId);
        // Settling the parent means the customer took the device back. The
        // open return ticket was never worked, so it closes as cancelled —
        // force-completing it used to record a re-repair that never happened.
        // A child that already reached `ready` carries real work and is left
        // for the counter to settle.
        if (child && (child.status === 'pending' || child.status === 'in_progress')) {
          updateTicket(child.id, {
            status: 'cancelled',
            updatedAt: new Date().toISOString(),
          }).then(() => {
            toast.info(
              'Return ticket cancelled',
              `Return ticket #${child.ticketNumber} was cancelled — the customer took the device back.`
            );
          }).catch(console.error);
        }
      }

      // 7. Activity Logs
      const debtDesc = effectiveIsDebt
        ? ` Paid: ${formatCurrency(effectivePaidNow)}. Debt recorded: ${formatCurrency(effectiveRemainingDebt)}.`
        : ` Paid in full: ${formatCurrency(effectiveTotalPaid)}.`;

      const isReturnTicket = Boolean(ticket.isReturn || ticket.parentTicketId);

      activityLogService.log(
        'repairs',
        isReturnTicket
          ? `Return repair #${ticket.ticketNumber} (for #${ticket.parentTicketNumber || 'main'}) completed & handed over`
          : `Repair #${ticket.ticketNumber} marked as taken/claimed`,
        {
          detail: `Device: ${ticket.deviceBrand} ${ticket.deviceModel}.${debtDesc}`,
          entityId: ticket.id,
          userName: actor?.name,
          userId: actor?.id,
        }
      ).catch(console.error);

      // Customer audit log (for registered and walk-in customers)
      // The walk-in key matches the one the repair page synthesizes for this ticket,
      // so the settlement log lands in exactly that ticket's walk-in history — and
      // it is unique per ticket, never per phone.
      const auditCustomerId = matchedCustomer?.id || ticket.customerId || walkInCustomerId(ticket.customerPhone, ticket.id);
      if (auditCustomerId) {
        customerLogService.log({
          customerId: auditCustomerId,
          customerName: matchedCustomer?.name || ticket.customerName || 'Client',
          actionType: effectiveIsDebt ? 'debt_added' : 'repair_updated',
          actionTitle: isReturnTicket
            ? `Return Re-repair #${ticket.ticketNumber} Completed & Handed Over`
            : `Repair #${ticket.ticketNumber} Claimed & Settled`,
          actionDescription: isReturnTicket
            ? `Return re-repair #${ticket.ticketNumber} for device (${ticket.deviceBrand} ${ticket.deviceModel}) completed and returned to customer.${debtDesc}`
            : `Repair #${ticket.ticketNumber} (${ticket.deviceBrand} ${ticket.deviceModel}) claimed.${debtDesc}`,
          actorId: actor?.id,
          actorName: actor?.name || 'Staff',
          actorRole: actor?.role,
          metadata: {
            ticketId: ticket.id,
            parentTicketId: ticket.parentTicketId,
            isReturn: ticket.isReturn,
            totalAmount: finalPrice,
            paidNow: effectivePaidNow,
            debt: effectiveRemainingDebt
          },
        }).catch(console.error);
      }

      // Authoritative recalculation of customer statistics (totalPurchases, totalSpent, lastVisitDate)
      const targetCustomer = matchedCustomer || (customerId ? customers.find(c => c.id === customerId) : null);
      if (targetCustomer) {
        recalculateCustomer(targetCustomer.id).catch(console.error);
      }

      // 8. Feedback distinguishing synchronized server confirmation vs offline queued save
      if (settledOfflineOrQueued) {
        toast.info(
          'Handover Saved Offline — Queued for Sync',
          effectiveIsFullyPaid || isZeroPrice
            ? `Ticket #${ticket.ticketNumber} settled locally (${formatCurrency(effectiveTotalPaid)}) and queued to sync when online.`
            : `Debt of ${formatCurrency(effectiveRemainingDebt)} for Ticket #${ticket.ticketNumber} saved locally and queued to sync when online.`
        );
      } else if (effectiveIsFullyPaid || isZeroPrice) {
        toast.success(
          'Phone Handed Over & Fully Paid! 🟢',
          `Ticket #${ticket.ticketNumber} marked as completed and fully paid (${formatCurrency(effectiveTotalPaid)}).`
        );
      } else {
        toast.success(
          'Phone Handed Over & Debt Recorded! 📋',
          `Debt of ${formatCurrency(effectiveRemainingDebt)} recorded on ${ticket.customerName}'s account (${trimmedPhone}).`
        );
      }

      const mergedTicket: RepairTicket = {
        ...ticket,
        ...updates,
      };

      onSettled(mergedTicket);
      onClose();
    } catch (err: unknown) {
      console.error('Failed to settle repair ticket:', err);
      toast.error('Settlement Failed', errorMessage(err) || 'Could not complete repair settlement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Phone Handover & Settlement"
      subtitle={`Ticket #${ticket.ticketNumber} · ${ticket.deviceBrand} ${ticket.deviceModel}`}
      size="md"
    >
      <form onSubmit={(e) => handleSubmit(e)} className={styles.modalBody}>
        {ticket.status === 'completed' && ticket.paymentStatus && (
          <div style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '10px 14px',
            fontSize: '12.5px',
            color: '#1d4ed8',
            marginBottom: '6px',
            lineHeight: 1.4,
          }}>
            ℹ️ <strong>Previously Settled:</strong> This ticket was completed ({ticket.paymentStatus.toUpperCase()})
            {ticket.completedAt ? ` on ${new Date(ticket.completedAt).toLocaleDateString()}` : ''}. Re-submitting will update the settlement records.
          </div>
        )}

        {/* Quick Fully-Paid Cash Button */}
        {balanceDueBeforeHandover > 0 && (
          <button
            type="button"
            onClick={() => handleSubmit(undefined, { paidNow: balanceDueBeforeHandover, method: 'cash' })}
            disabled={isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              padding: '14px 20px',
              background: 'linear-gradient(135deg, #059669, #10b981)',
              border: 'none',
              borderRadius: '12px',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 700,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)',
              transition: 'all 0.2s ease',
              marginBottom: '8px',
              letterSpacing: '0.2px',
            }}
            title="One-tap: Mark as fully paid in cash and hand over the phone"
          >
            <CheckCircle2 size={20} />
            Fully Paid — Cash ({formatCurrency(balanceDueBeforeHandover)})
          </button>
        )}
        {balanceDueBeforeHandover <= 0 && finalPrice > 0 && (
          <button
            type="button"
            onClick={() => handleSubmit(undefined, { paidNow: 0, method: 'cash' })}
            disabled={isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              padding: '14px 20px',
              background: 'linear-gradient(135deg, #059669, #10b981)',
              border: 'none',
              borderRadius: '12px',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 700,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)',
              transition: 'all 0.2s ease',
              marginBottom: '8px',
              letterSpacing: '0.2px',
            }}
            title="Deposit already covers full price — confirm handover"
          >
            <CheckCircle2 size={20} />
            ✅ Already Paid in Full — Confirm Handover
          </button>
        )}
        <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--color-on-surface-variant)', margin: '-2px 0 10px', fontWeight: 500 }}>
          or customize payment below ↓
        </div>
        {/* Top Summary Card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>
            <div className={styles.deviceTitle}>
              <Smartphone size={17} style={{ color: 'var(--color-primary)' }} />
              <span>{ticket.deviceBrand} {ticket.deviceModel}</span>
            </div>
            <span className={styles.ticketBadge}>{ticket.ticketNumber}</span>
          </div>

          <div className={styles.summaryDetails}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Client</span>
              <span className={styles.detailValue} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <User size={13} style={{ opacity: 0.7 }} />
                {ticket.customerName || 'Walk-in Client'}
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Issue</span>
              <span className={styles.detailValue} title={ticket.issueDescription}>
                {ticket.issueDescription || 'Repair'}
              </span>
            </div>
            {ticket.assignedTechnician && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Technician</span>
                <span className={styles.detailValue}>{ticket.assignedTechnician}</span>
              </div>
            )}
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className={styles.priceGrid}>
          <div className={styles.priceCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.priceCardLabel}>
                <DollarSign size={13} /> Total Repair Price
              </span>
              <button
                type="button"
                className={styles.editPriceBtn}
                onClick={() => setIsEditingPrice(!isEditingPrice)}
              >
                {isEditingPrice ? 'Done' : 'Adjust'}
              </button>
            </div>
            {isEditingPrice ? (
              <input
                type="number"
                min={0}
                className={styles.priceInputInline}
                value={finalPrice}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value) || 0);
                  setFinalPrice(val);
                }}
                autoFocus
              />
            ) : (
              <span className={styles.priceCardValue}>
                {formatCurrency(finalPrice)}
              </span>
            )}
          </div>

          <div className={[styles.priceCard, depositAlreadyPaid > 0 && styles.priceCardDeposit].filter(Boolean).join(' ')}>
            <span className={styles.priceCardLabel}>
              <ShieldCheck size={13} /> Deposit Already Paid
            </span>
            <span className={styles.priceCardValue}>
              {depositAlreadyPaid > 0 ? formatCurrency(depositAlreadyPaid) : '0 DA'}
            </span>
          </div>

          <div className={[styles.priceCard, styles.priceCardDue].join(' ')}>
            <span className={styles.priceCardLabel}>
              <ArrowRight size={13} /> Balance Due Today
            </span>
            <span className={styles.priceCardValue}>
              {formatCurrency(balanceDueBeforeHandover)}
            </span>
          </div>
        </div>

        {/* Payment Input Section */}
        <div className={styles.inputSection}>
          <div className={styles.sectionHeading}>
            <span>Amount Paid Now by Client</span>
            <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              In Algerian Dinar (DA)
            </span>
          </div>

          <Input
            type="number"
            min={0}
            max={finalPrice}
            step="any"
            value={amountPaidNow}
            onChange={(e) => {
              setAmountPaidNow(e.target.value);
              setPhoneError('');
            }}
            placeholder="0"
            leftIcon={<Banknote size={18} style={{ color: 'var(--color-primary)' }} />}
            autoFocus
          />

          {/* Quick Pre-fill Chips */}
          <div className={styles.chipRow}>
            <button
              type="button"
              className={[styles.quickChip, paidNowNum === balanceDueBeforeHandover && styles.quickChipActive].filter(Boolean).join(' ')}
              onClick={() => handleQuickAmount(balanceDueBeforeHandover)}
            >
              Full Payment ({formatCurrency(balanceDueBeforeHandover)})
            </button>
            <button
              type="button"
              className={[styles.quickChip, paidNowNum === 0 && styles.quickChipActive].filter(Boolean).join(' ')}
              onClick={() => handleQuickAmount(0)}
            >
              0 DA (All to Debt)
            </button>
            {balanceDueBeforeHandover >= 400 && (
              <button
                type="button"
                className={[styles.quickChip, paidNowNum === Math.round(balanceDueBeforeHandover / 2) && styles.quickChipActive].filter(Boolean).join(' ')}
                onClick={() => handleQuickAmount(Math.round(balanceDueBeforeHandover / 2))}
              >
                50% ({formatCurrency(Math.round(balanceDueBeforeHandover / 2))})
              </button>
            )}
          </div>

          {/* Payment Method Selector (when amount > 0) */}
          {paidNowNum > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>
                Payment Method:
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className={[styles.quickChip, paymentMethod === 'cash' && styles.quickChipActive].filter(Boolean).join(' ')}
                  onClick={() => setPaymentMethod('cash')}
                >
                  <Banknote size={12} /> Cash
                </button>
                <button
                  type="button"
                  className={[styles.quickChip, paymentMethod === 'card' && styles.quickChipActive].filter(Boolean).join(' ')}
                  onClick={() => setPaymentMethod('card')}
                >
                  <CreditCard size={12} /> Card / TPE
                </button>
                <button
                  type="button"
                  className={[styles.quickChip, paymentMethod === 'transfer' && styles.quickChipActive].filter(Boolean).join(' ')}
                  onClick={() => setPaymentMethod('transfer')}
                >
                  Transfer
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Status Banner */}
        {isFullyPaid || isZeroPrice ? (
          <div className={[styles.statusBanner, styles.statusBannerPaid].join(' ')}>
            <CheckCircle2 size={20} className={styles.bannerIcon} />
            <div>
              <div className={styles.bannerTitle}>
                🟢 Fully Paid ({formatCurrency(totalPaid)})
              </div>
              <div className={styles.bannerDesc}>
                Total price is settled in full. Device will be marked as claimed with zero debt.
              </div>
            </div>
          </div>
        ) : (
          <div className={[styles.statusBanner, styles.statusBannerDebt].join(' ')}>
            <AlertTriangle size={20} className={styles.bannerIcon} />
            <div>
              <div className={styles.bannerTitle}>
                ⚠️ Unpaid Balance: {formatCurrency(remainingDebt)} (Credit / Debt)
              </div>
              <div className={styles.bannerDesc}>
                Paid: {formatCurrency(totalPaid)} ({formatCurrency(depositAlreadyPaid)} deposit + {formatCurrency(paidNowNum)} now).
                The remaining {formatCurrency(remainingDebt)} will be added to the customer debt record.
              </div>
            </div>
          </div>
        )}

        {/* Customer Phone & Debt Record Section */}
        <div className={[styles.phoneCard, isPhoneRequired ? styles.phoneCardRequired : styles.phoneCardValid].join(' ')}>
          <div className={styles.phoneHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Phone size={14} style={{ color: isPhoneRequired ? '#dc2626' : 'var(--color-primary)' }} />
              <span>Client Phone Number</span>
              {isDebt && (
                <span className={hasPhone ? styles.phoneBadgeOk : styles.phoneBadgeReq}>
                  {hasPhone ? 'Account Linked' : 'Required for Debt'}
                </span>
              )}
            </div>

            {ticket.customerPhone && !isEditingPhone && (
              <button
                type="button"
                className={styles.editPhoneLink}
                onClick={() => setIsEditingPhone(true)}
              >
                Change Phone
              </button>
            )}
          </div>

          {/* Show phone input if missing, if required, or if editing */}
          {(!ticket.customerPhone || isEditingPhone || isPhoneRequired) ? (
            <div>
              <Input
                type="tel"
                value={customerPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="e.g. 0555 12 34 56 or 0661..."
                error={phoneError}
                leftIcon={<Phone size={14} />}
                required={isDebt}
              />
              {matchingCustomer && (
                <div className={styles.matchedAccountInfo}>
                  <User size={12} />
                  <span>Existing Account: <strong>{matchingCustomer.name}</strong></span>
                  {matchingCustomer.totalDebt ? (
                    <span className={styles.matchedDebtBadge}>
                      Current Debt: {formatCurrency(matchingCustomer.totalDebt)}
                    </span>
                  ) : (
                    <span style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 600, marginLeft: 'auto' }}>
                      Clean Ledger (0 DA)
                    </span>
                  )}
                </div>
              )}
              {isDebt && !hasPhone && (
                <p className={styles.phoneWarningText} style={{ marginTop: '4px' }}>
                  * The client's phone number is required to automatically link and register this debt of <strong>{formatCurrency(remainingDebt)}</strong> to their credit account.
                </p>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600 }}>
                <span style={{ color: 'var(--color-on-surface)' }}>{customerPhone}</span>
                <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 700 }}>
                  ✓ Auto-record debt to this client account
                </span>
              </div>
              {matchingCustomer && (
                <div className={styles.matchedAccountInfo} style={{ marginTop: '6px' }}>
                  <User size={12} />
                  <span>Account: <strong>{matchingCustomer.name}</strong></span>
                  {matchingCustomer.totalDebt ? (
                    <span className={styles.matchedDebtBadge}>
                      Current Balance: {formatCurrency(matchingCustomer.totalDebt)}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible Due Date & Settlement Note */}
        <div>
          <button
            type="button"
            className={styles.extraDetailsToggle}
            onClick={() => setShowExtra(!showExtra)}
          >
            {showExtra ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{showExtra ? 'Hide optional note & due date' : 'Add optional debt due date or notes'}</span>
          </button>

          {showExtra && (
            <div className={styles.collapsibleSection}>
              {isDebt && (
                <Input
                  type="date"
                  label="Debt Due Date (Optional)"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  leftIcon={<Calendar size={14} />}
                />
              )}
              <Input
                label="Handover / Payment Remark (Optional)"
                value={settlementNotes}
                onChange={(e) => setSettlementNotes(e.target.value)}
                placeholder="e.g. Screen replaced, customer promised to pay rest on Friday"
                leftIcon={<FileText size={14} />}
              />
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className={styles.modalFooter}>
          <div className={styles.footerLeft}>
            <span>Status after confirmation: <strong>Taken (Claimed)</strong></span>
          </div>

          <div className={styles.footerActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              variant={isDebt ? 'primary' : 'success'}
              isLoading={isSubmitting}
              leftIcon={isDebt ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            >
              {isFullyPaid || isZeroPrice
                ? 'Confirm Handover & Full Settlement'
                : `Confirm Handover & Record Debt (${formatCurrency(remainingDebt)})`}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
