import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import {
  GitMerge,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  DollarSign,
  Package,
  Calendar,
} from 'lucide-react';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import type { RepairTicket } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatStandardPhone } from '../../utils/phoneUtils';
import styles from '../customers/MergeCustomersModal.module.css';

interface MergeRepairsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTicketA?: RepairTicket | null;
  initialTicketB?: RepairTicket | null;
  initialReason?: string;
}

export const MergeRepairsModal: React.FC<MergeRepairsModalProps> = ({
  isOpen,
  onClose,
  initialTicketA,
  initialTicketB,
  initialReason,
}) => {
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

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'completed': return { bg: '#dcfce7', text: '#15803d' };
      case 'ready': return { bg: '#e0e7ff', text: '#3730a3' };
      case 'in_progress': return { bg: '#fef3c7', text: '#b45309' };
      case 'cancelled': return { bg: '#fee2e2', text: '#b91c1c' };
      default: return { bg: '#f1f5f9', text: '#475569' };
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Fusion & Deduplicate Repair Tickets"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div>
            {detectedDuplicates.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMergeAll}
                isLoading={isSubmitting}
                style={{
                  borderColor: '#ca8a04',
                  color: '#854d0e',
                  background: '#fefce8',
                  fontWeight: 600,
                }}
              >
                ⚡ Safe Fusion All ({detectedDuplicates.length})
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmMerge}
              isLoading={isSubmitting}
              leftIcon={<GitMerge size={16} />}
            >
              Declare as One & Fusion
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        {/* Banner Notice */}
        <div className={styles.banner}>
          <GitMerge size={22} className={styles.bannerIcon} />
          <p className={styles.bannerText}>
            Consolidate duplicate repair tickets for the same phone. All parts used, technician remarks,
            and payments will be safely merged into the primary ticket. The secondary ticket is archived
            (kept in the database, never deleted).
          </p>
        </div>

        {/* Detected Duplicates Picker */}
        {detectedDuplicates.length > 0 && (
          <div className={styles.duplicateSelectorBar}>
            <div className={styles.duplicateBarHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600 }}>⚡ Detected Duplicate Tickets ({detectedDuplicates.length})</span>
                <span style={{ fontSize: '11px', color: '#a16207' }}>Match: Same Customer & Device</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleMergeAll}
                isLoading={isSubmitting}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderColor: '#ca8a04',
                  color: '#854d0e',
                  background: '#fefce8',
                  fontWeight: 600,
                }}
              >
                ⚡ Safe Fusion All ({detectedDuplicates.length})
              </Button>
            </div>
            <select
              className={styles.duplicateSelect}
              value={selectedPairIndex}
              onChange={(e) => handleDuplicateSelect(Number(e.target.value))}
            >
              <option value={-1}>-- Choose a detected duplicate or select manually below --</option>
              {detectedDuplicates.map((dup, idx) => (
                <option key={`${dup.ticketA.id}_${dup.ticketB.id}`} value={idx}>
                  #{dup.ticketA.ticketNumber} ({dup.ticketA.status}) ➔ #{dup.ticketB.ticketNumber} ({dup.ticketB.status}) — {dup.ticketA.customerName} | {dup.ticketA.deviceBrand} {dup.ticketA.deviceModel} — [{dup.reason}]
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Side-by-Side Comparison Grid */}
        <div className={styles.comparisonGrid}>
          {/* Ticket A Card */}
          <div
            className={`${styles.accountCard} ${primaryTicketId === ticketAId ? styles.accountCardActive : ''}`}
            onClick={() => ticketA && setPrimaryTicketId(ticketA.id)}
            style={{ cursor: 'pointer' }}
          >
            <div className={styles.searchSelectWrap} onClick={e => e.stopPropagation()}>
              <label className={styles.selectLabel}>Ticket 1:</label>
              <select
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  background: '#ffffff',
                }}
                value={ticketAId}
                onChange={(e) => {
                  setTicketAId(e.target.value);
                  setSelectedPairIndex(-1);
                }}
              >
                {activeTickets.map(t => (
                  <option key={t.id} value={t.id} disabled={t.id === ticketBId}>
                    #{t.ticketNumber} — {t.customerName} ({t.deviceBrand} {t.deviceModel}) [{t.status}]
                  </option>
                ))}
              </select>
            </div>

            {ticketA && (
              <>
                <div className={styles.accountCardHeader}>
                  <div>
                    <h4 className={styles.accountName}>#{ticketA.ticketNumber}</h4>
                    <p className={styles.accountShopName}>
                      <Smartphone size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {ticketA.deviceBrand} {ticketA.deviceModel}
                    </p>
                  </div>
                  <span
                    style={{
                      background: getStatusBadgeStyle(ticketA.status).bg,
                      color: getStatusBadgeStyle(ticketA.status).text,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {ticketA.status}
                  </span>
                </div>

                <div className={styles.accountMeta}>
                  <span>👤 {ticketA.customerName}</span>
                  {ticketA.customerPhone && <span>📞 {formatStandardPhone(ticketA.customerPhone)}</span>}
                </div>

                <div style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', color: '#334155' }}>
                  <strong>Issue:</strong> {ticketA.issueDescription}
                  {ticketA.remark && <div style={{ marginTop: 4, color: '#64748b' }}><strong>Notes:</strong> {ticketA.remark}</div>}
                </div>

                <div className={styles.statRow}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Est. Cost</span>
                    <span className={styles.statValue}>{formatCurrency(ticketA.estimatedCost || 0)}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Deposit</span>
                    <span className={styles.statValue}>{formatCurrency(ticketA.depositAmount || 0)}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Parts Used</span>
                    <span className={styles.statValue}>{ticketA.partsUsed?.length || 0}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: primaryTicketId === ticketA.id ? '#2563eb' : '#64748b' }}>
                  <input
                    type="radio"
                    name="primarySelection"
                    checked={primaryTicketId === ticketA.id}
                    onChange={() => setPrimaryTicketId(ticketA.id)}
                  />
                  <span>Keep as Authoritative Ticket #{ticketA.ticketNumber}</span>
                </div>
              </>
            )}
          </div>

          {/* Merge Arrow */}
          <div className={styles.mergeArrowWrap}>
            <div style={{
              background: '#e2e8f0',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <GitMerge size={18} />
            </div>
          </div>

          {/* Ticket B Card */}
          <div
            className={`${styles.accountCard} ${primaryTicketId === ticketBId ? styles.accountCardActive : ''}`}
            onClick={() => ticketB && setPrimaryTicketId(ticketB.id)}
            style={{ cursor: 'pointer' }}
          >
            <div className={styles.searchSelectWrap} onClick={e => e.stopPropagation()}>
              <label className={styles.selectLabel}>Ticket 2:</label>
              <select
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  background: '#ffffff',
                }}
                value={ticketBId}
                onChange={(e) => {
                  setTicketBId(e.target.value);
                  setSelectedPairIndex(-1);
                }}
              >
                {activeTickets.map(t => (
                  <option key={t.id} value={t.id} disabled={t.id === ticketAId}>
                    #{t.ticketNumber} — {t.customerName} ({t.deviceBrand} {t.deviceModel}) [{t.status}]
                  </option>
                ))}
              </select>
            </div>

            {ticketB && (
              <>
                <div className={styles.accountCardHeader}>
                  <div>
                    <h4 className={styles.accountName}>#{ticketB.ticketNumber}</h4>
                    <p className={styles.accountShopName}>
                      <Smartphone size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {ticketB.deviceBrand} {ticketB.deviceModel}
                    </p>
                  </div>
                  <span
                    style={{
                      background: getStatusBadgeStyle(ticketB.status).bg,
                      color: getStatusBadgeStyle(ticketB.status).text,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {ticketB.status}
                  </span>
                </div>

                <div className={styles.accountMeta}>
                  <span>👤 {ticketB.customerName}</span>
                  {ticketB.customerPhone && <span>📞 {formatStandardPhone(ticketB.customerPhone)}</span>}
                </div>

                <div style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', color: '#334155' }}>
                  <strong>Issue:</strong> {ticketB.issueDescription}
                  {ticketB.remark && <div style={{ marginTop: 4, color: '#64748b' }}><strong>Notes:</strong> {ticketB.remark}</div>}
                </div>

                <div className={styles.statRow}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Est. Cost</span>
                    <span className={styles.statValue}>{formatCurrency(ticketB.estimatedCost || 0)}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Deposit</span>
                    <span className={styles.statValue}>{formatCurrency(ticketB.depositAmount || 0)}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Parts Used</span>
                    <span className={styles.statValue}>{ticketB.partsUsed?.length || 0}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: primaryTicketId === ticketB.id ? '#2563eb' : '#64748b' }}>
                  <input
                    type="radio"
                    name="primarySelection"
                    checked={primaryTicketId === ticketB.id}
                    onChange={() => setPrimaryTicketId(ticketB.id)}
                  />
                  <span>Keep as Authoritative Ticket #{ticketB.ticketNumber}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Fusion Outcome Summary */}
        {primaryTicket && secondaryTicket && (
          <div className={styles.summaryBox}>
            <span className={styles.summaryTitle}>
              <CheckCircle2 size={16} color="#16a34a" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Fusion Outcome (Preserved as #{primaryTicket.ticketNumber})
            </span>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryItemLabel}>Retained Status</span>
                <span className={styles.summaryItemValue} style={{ textTransform: 'capitalize' }}>
                  {primaryTicket.status}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryItemLabel}>Consolidated Parts</span>
                <span className={styles.summaryItemValue}>
                  {Array.from(new Set([...(primaryTicket.partsUsed || []), ...(secondaryTicket.partsUsed || [])].map(p => p.productId))).length} parts
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryItemLabel}>Max Deposit Kept</span>
                <span className={styles.summaryItemValue}>
                  {formatCurrency(Math.max(primaryTicket.depositAmount || 0, secondaryTicket.depositAmount || 0))}
                </span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              Ticket <strong>#{secondaryTicket.ticketNumber}</strong> will be archived into <strong>#{primaryTicket.ticketNumber}</strong>. It remains stored in the database but hidden from active lists.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};
