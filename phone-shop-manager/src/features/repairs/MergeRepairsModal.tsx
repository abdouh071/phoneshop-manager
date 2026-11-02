import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  DetectedPairsBar,
  EntitySelect,
  MergeBanner,
  MergeFooter,
  MergeSummaryBox,
  PairComparisonGrid,
} from '../../components/merge/MergeDialogPrimitives';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import type { RepairTicket } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatStandardPhone } from '../../utils/phoneUtils';
import styles from '../../components/merge/MergeDialog.module.css';

interface MergeRepairsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTicketA?: RepairTicket | null;
  initialTicketB?: RepairTicket | null;
  initialReason?: string;
}

const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'completed': return { bg: '#dcfce7', text: '#15803d' };
    case 'ready': return { bg: '#e0e7ff', text: '#3730a3' };
    case 'in_progress': return { bg: '#fef3c7', text: '#b45309' };
    case 'cancelled': return { bg: '#fee2e2', text: '#b91c1c' };
    default: return { bg: '#f1f5f9', text: '#475569' };
  }
};

const TicketPanel: React.FC<{
  selectLabel: string;
  value: string;
  tickets: RepairTicket[];
  otherTicketId: string;
  onChange: (id: string) => void;
  ticket?: RepairTicket;
  isPrimary: boolean;
  onMakePrimary: () => void;
}> = ({ selectLabel, value, tickets, otherTicketId, onChange, ticket, isPrimary, onMakePrimary }) => (
  <>
    <EntitySelect
      label={selectLabel}
      value={value}
      onChange={onChange}
      stopCardClick
      options={tickets.map(t => ({
        id: t.id,
        disabled: t.id === otherTicketId,
        label: `#${t.ticketNumber} — ${t.customerName} (${t.deviceBrand} ${t.deviceModel}) [${t.status}]`,
      }))}
    />

    {ticket && (
      <>
        <div className={styles.accountCardHeader}>
          <div>
            <h4 className={styles.accountName}>#{ticket.ticketNumber}</h4>
            <p className={styles.accountShopName}>
              <Smartphone size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              {ticket.deviceBrand} {ticket.deviceModel}
            </p>
          </div>
          <span
            style={{
              background: getStatusBadgeStyle(ticket.status).bg,
              color: getStatusBadgeStyle(ticket.status).text,
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {ticket.status}
          </span>
        </div>

        <div className={styles.accountMeta}>
          <span>👤 {ticket.customerName}</span>
          {ticket.customerPhone && <span>📞 {formatStandardPhone(ticket.customerPhone)}</span>}
        </div>

        <div style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', color: '#334155' }}>
          <strong>Issue:</strong> {ticket.issueDescription}
          {ticket.remark && <div style={{ marginTop: 4, color: '#64748b' }}><strong>Notes:</strong> {ticket.remark}</div>}
        </div>

        <div className={styles.statRow}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Est. Cost</span>
            <span className={styles.statValue}>{formatCurrency(ticket.estimatedCost || 0)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Deposit</span>
            <span className={styles.statValue}>{formatCurrency(ticket.depositAmount || 0)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Parts Used</span>
            <span className={styles.statValue}>{ticket.partsUsed?.length || 0}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: isPrimary ? '#2563eb' : '#64748b' }}>
          <input
            type="radio"
            name="primarySelection"
            checked={isPrimary}
            onChange={onMakePrimary}
          />
          <span>Keep as Authoritative Ticket #{ticket.ticketNumber}</span>
        </div>
      </>
    )}
  </>
);

export const MergeRepairsModal: React.FC<MergeRepairsModalProps> = ({ isOpen, onClose, initialTicketA, initialTicketB }) => {
  const { tickets, mergeTickets, findDuplicates } = useRepairStore();
  const toast = useToast();

  const detectedDuplicates = useMemo(() => findDuplicates(), [tickets, isOpen]);

  const [selectedPairIndex, setSelectedPairIndex] = useState<number>(-1);
  const [ticketAId, setTicketAId] = useState<string>('');
  const [ticketBId, setTicketBId] = useState<string>('');
  const [primaryTicketId, setPrimaryTicketId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active non-merged tickets for selection
  const activeTickets = useMemo(() => tickets.filter(t => !t.mergedIntoTicketId), [tickets]);

  // Initialize selection when modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (initialTicketA && initialTicketB) {
      setTicketAId(initialTicketA.id);
      setTicketBId(initialTicketB.id);
      setSelectedPairIndex(-1);
    } else if (initialTicketA) {
      setTicketAId(initialTicketA.id);
      const match = detectedDuplicates.find(
        d => d.ticketA.id === initialTicketA.id || d.ticketB.id === initialTicketA.id
      );
      if (match) {
        setTicketBId(match.ticketA.id === initialTicketA.id ? match.ticketB.id : match.ticketA.id);
      } else {
        const other = activeTickets.find(t => t.id !== initialTicketA.id);
        setTicketBId(other ? other.id : '');
      }
    } else if (detectedDuplicates.length > 0) {
      setSelectedPairIndex(0);
      setTicketAId(detectedDuplicates[0].ticketA.id);
      setTicketBId(detectedDuplicates[0].ticketB.id);
    } else if (activeTickets.length >= 2) {
      setTicketAId(activeTickets[0].id);
      setTicketBId(activeTickets[1].id);
    }
  }, [isOpen, initialTicketA, initialTicketB, detectedDuplicates, activeTickets]);

  const ticketA = useMemo(() => activeTickets.find(t => t.id === ticketAId), [activeTickets, ticketAId]);
  const ticketB = useMemo(() => activeTickets.find(t => t.id === ticketBId), [activeTickets, ticketBId]);

  // Auto-select preferred primary ticket
  useEffect(() => {
    if (!ticketA || !ticketB) return;

    // Active status beats cancelled
    if (ticketA.status !== 'cancelled' && ticketB.status === 'cancelled') {
      setPrimaryTicketId(ticketA.id);
      return;
    }
    if (ticketB.status !== 'cancelled' && ticketA.status === 'cancelled') {
      setPrimaryTicketId(ticketB.id);
      return;
    }

    // Paid/priced beats unpaid/unpriced
    const paidA = (ticketA.paidAmount || 0) > 0 || ticketA.paymentStatus === 'paid';
    const paidB = (ticketB.paidAmount || 0) > 0 || ticketB.paymentStatus === 'paid';
    if (paidA && !paidB) {
      setPrimaryTicketId(ticketA.id);
      return;
    }
    if (paidB && !paidA) {
      setPrimaryTicketId(ticketB.id);
      return;
    }

    // Default to the one with newer updatedAt or ticketA
    setPrimaryTicketId(ticketA.id);
  }, [ticketAId, ticketBId, ticketA, ticketB]);

  const primaryTicket = useMemo(() => {
    if (!ticketA || !ticketB) return null;
    return primaryTicketId === ticketB.id ? ticketB : ticketA;
  }, [ticketA, ticketB, primaryTicketId]);

  const secondaryTicket = useMemo(() => {
    if (!ticketA || !ticketB || !primaryTicket) return null;
    return primaryTicket.id === ticketA.id ? ticketB : ticketA;
  }, [ticketA, ticketB, primaryTicket]);

  const handleDuplicateSelect = (index: number) => {
    setSelectedPairIndex(index);
    if (detectedDuplicates[index]) {
      setTicketAId(detectedDuplicates[index].ticketA.id);
      setTicketBId(detectedDuplicates[index].ticketB.id);
    }
  };

  const handleConfirmMerge = async () => {
    if (!ticketA || !ticketB || !primaryTicket || !secondaryTicket) {
      toast.error('Invalid Selection', 'Please select two different tickets to fusion.');
      return;
    }
    if (ticketA.id === ticketB.id) {
      toast.error('Duplicate Selection', 'Cannot fusion a ticket into itself.');
      return;
    }

    setIsSubmitting(true);
    try {
      await mergeTickets(primaryTicket.id, secondaryTicket.id);

      toast.success(
        'Repair Tickets Fused Successfully',
        `Consolidated Ticket #${secondaryTicket.ticketNumber} into #${primaryTicket.ticketNumber}. Parts, history, and notes merged. Both documents preserved in database.`
      );
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Fusion Failed', 'Could not complete the repair ticket fusion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMergeAll = async () => {
    if (detectedDuplicates.length === 0) return;
    setIsSubmitting(true);
    let mergedCount = 0;
    try {
      for (const pair of detectedDuplicates) {
        const stateTickets = useRepairStore.getState().tickets;
        const tA = stateTickets.find(t => t.id === pair.ticketA.id && !t.mergedIntoTicketId);
        const tB = stateTickets.find(t => t.id === pair.ticketB.id && !t.mergedIntoTicketId);
        if (!tA || !tB || tA.id === tB.id) continue;

        let targetPrimaryId = tA.id;
        let targetSecondaryId = tB.id;

        // Active status beats cancelled
        if (tA.status !== 'cancelled' && tB.status === 'cancelled') {
          targetPrimaryId = tA.id;
          targetSecondaryId = tB.id;
        } else if (tB.status !== 'cancelled' && tA.status === 'cancelled') {
          targetPrimaryId = tB.id;
          targetSecondaryId = tA.id;
        } else {
          // Paid beats unpaid
          const paidA = (tA.paidAmount || 0) > 0 || tA.paymentStatus === 'paid';
          const paidB = (tB.paidAmount || 0) > 0 || tB.paymentStatus === 'paid';
          if (paidB && !paidA) {
            targetPrimaryId = tB.id;
            targetSecondaryId = tA.id;
          }
        }

        await mergeTickets(targetPrimaryId, targetSecondaryId);
        mergedCount++;
      }

      toast.success(
        'Batch Repair Fusion Completed',
        `Successfully merged ${mergedCount} duplicate repair ticket pairs. All parts and remarks safely combined.`
      );
      onClose();
    } catch (err) {
      console.error('Batch repair merge error:', err);
      toast.error('Batch Repair Fusion Incomplete', 'An error occurred during batch repair ticket fusion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const batchLabel = `Safe Fusion All (${detectedDuplicates.length})`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Fusion & Deduplicate Repair Tickets"
      size="md"
      footer={
        <MergeFooter
          batchLabel={detectedDuplicates.length > 1 ? batchLabel : undefined}
          onBatch={handleMergeAll}
          cancelLabel="Cancel"
          confirmLabel="Declare as One & Fusion"
          onConfirm={handleConfirmMerge}
          onCancel={onClose}
          isSubmitting={isSubmitting}
        />
      }
    >
      <div className={styles.container}>
        {/* Banner Notice */}
        <MergeBanner>
          Consolidate duplicate repair tickets for the same phone. All parts used, technician remarks,
          and payments will be safely merged into the primary ticket. The secondary ticket is archived
          (kept in the database, never deleted).
        </MergeBanner>

        {/* Detected Duplicates Picker */}
        {detectedDuplicates.length > 0 && (
          <DetectedPairsBar
            title="Detected Duplicate Tickets"
            count={detectedDuplicates.length}
            matchHint="Match: Same Customer & Device"
            manualSelectLabel="Choose a detected duplicate or select manually below"
            pairs={detectedDuplicates.map(dup => ({
              key: `${dup.ticketA.id}_${dup.ticketB.id}`,
              label: `#${dup.ticketA.ticketNumber} (${dup.ticketA.status}) ➔ #${dup.ticketB.ticketNumber} (${dup.ticketB.status}) — ${dup.ticketA.customerName} | ${dup.ticketA.deviceBrand} ${dup.ticketA.deviceModel} — [${dup.reason}]`,
            }))}
            selectedIndex={selectedPairIndex}
            onSelect={handleDuplicateSelect}
            batchLabel={batchLabel}
            onBatch={handleMergeAll}
            isBusy={isSubmitting}
          />
        )}

        {/* Side-by-Side Comparison Grid */}
        <PairComparisonGrid
          leftActive={primaryTicketId === ticketAId}
          rightActive={primaryTicketId === ticketBId}
          onLeftCardClick={() => { if (ticketA) setPrimaryTicketId(ticketA.id); }}
          onRightCardClick={() => { if (ticketB) setPrimaryTicketId(ticketB.id); }}
          left={
            <TicketPanel
              selectLabel="Ticket 1"
              value={ticketAId}
              tickets={activeTickets}
              otherTicketId={ticketBId}
              onChange={(id) => { setTicketAId(id); setSelectedPairIndex(-1); }}
              ticket={ticketA}
              isPrimary={primaryTicketId === ticketAId}
              onMakePrimary={() => setPrimaryTicketId(ticketAId)}
            />
          }
          right={
            <TicketPanel
              selectLabel="Ticket 2"
              value={ticketBId}
              tickets={activeTickets}
              otherTicketId={ticketAId}
              onChange={(id) => { setTicketBId(id); setSelectedPairIndex(-1); }}
              ticket={ticketB}
              isPrimary={primaryTicketId === ticketBId}
              onMakePrimary={() => setPrimaryTicketId(ticketBId)}
            />
          }
        />

        {/* Fusion Outcome Summary */}
        {primaryTicket && secondaryTicket && (
          <MergeSummaryBox
            title={
              <>
                <CheckCircle2 size={16} color="#16a34a" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                Fusion Outcome (Preserved as #{primaryTicket.ticketNumber})
              </>
            }
            items={[
              {
                label: 'Retained Status',
                value: primaryTicket.status,
                valueStyle: { textTransform: 'capitalize' },
              },
              {
                label: 'Consolidated Parts',
                value: `${Array.from(new Set([...(primaryTicket.partsUsed || []), ...(secondaryTicket.partsUsed || [])].map(p => p.productId))).length} parts`,
              },
              {
                label: 'Max Deposit Kept',
                value: formatCurrency(Math.max(primaryTicket.depositAmount || 0, secondaryTicket.depositAmount || 0)),
              },
            ]}
            footnoteIcon={<AlertTriangle size={14} style={{ flexShrink: 0 }} />}
            footnote={
              <>
                Ticket <strong>#{secondaryTicket.ticketNumber}</strong> will be archived into <strong>#{primaryTicket.ticketNumber}</strong>. It remains stored in the database but hidden from active lists.
              </>
            }
          />
        )}
      </div>
    </Modal>
  );
};
