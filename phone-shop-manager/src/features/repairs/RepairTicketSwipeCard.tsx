import React, { useState } from 'react';
import { Phone, ChevronRight, Clock, Wrench, CheckCircle2, Archive } from 'lucide-react';
import { useHaptic } from '../../hooks/useHaptic';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import type { RepairTicket } from '../../types';
import styles from './RepairTicketSwipeCard.module.css';

type SwipeStatus = 'pending' | 'in_progress' | 'ready';

const STATUS_SEQUENCE: SwipeStatus[] = ['pending', 'in_progress', 'ready'];

const STATUS_META: Record<SwipeStatus | 'completed', { label: string; color: string; icon: React.ReactNode }> = {
  pending:     { label: 'Pending',          color: '#64748b', icon: <Clock size={14} /> },
  in_progress: { label: 'In Progress',      color: '#d97706', icon: <Wrench size={14} /> },
  ready:       { label: 'Ready for Pickup', color: '#16a34a', icon: <CheckCircle2 size={14} /> },
  completed:   { label: 'Completed',        color: '#6366f1', icon: <Archive size={14} /> },
};

interface RepairTicketSwipeCardProps {
  ticket: RepairTicket;
  onClick: () => void;
}

/**
 * Mobile-optimised repair ticket card.
 * • Tapping the card opens the detail panel.
 * • Tapping the status badge cycles to the next status.
 * • Tapping the phone number opens a tel: link.
 */
export const RepairTicketSwipeCard: React.FC<RepairTicketSwipeCardProps> = ({
  ticket,
  onClick,
}) => {
  const haptic = useHaptic();
  const { updateStatus } = useRepairStore();
  const toast = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  const currentStatusIdx = STATUS_SEQUENCE.indexOf(ticket.status as SwipeStatus);
  const canCycle = currentStatusIdx !== -1 && currentStatusIdx < STATUS_SEQUENCE.length - 1;
  const nextStatus = canCycle ? STATUS_SEQUENCE[currentStatusIdx + 1] : null;
  const meta = STATUS_META[ticket.status as keyof typeof STATUS_META] ?? STATUS_META.pending;

  const handleStatusCycle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!nextStatus || isUpdating) return;
    haptic.tap();
    setIsUpdating(true);
    try {
      await updateStatus(ticket.id, nextStatus);
      haptic.success();
      toast.success('Status Updated', `Ticket #${ticket.ticketNumber} → ${STATUS_META[nextStatus].label}`);
    } catch {
      haptic.error();
      toast.error('Update Failed', 'Could not update ticket status.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.tap();
    if (ticket.customerPhone) {
      window.location.href = `tel:${ticket.customerPhone}`;
    }
  };

  const timeAgo = (() => {
    const d = new Date(ticket.updatedAt || ticket.createdAt);
    const diffMs = Date.now() - d.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
  })();

  return (
    <div className={styles.card} onClick={onClick} role="button" tabIndex={0}>
      {/* Status indicator bar */}
      <div
        className={styles.statusBar}
        style={{ background: meta.color }}
      />

      <div className={styles.body}>
        {/* Header row */}
        <div className={styles.header}>
          <div className={styles.ticketInfo}>
            <span className={styles.ticketNumber}>#{ticket.ticketNumber}</span>
            <span className={styles.device}>{ticket.deviceBrand} {ticket.deviceModel}</span>
          </div>
          <ChevronRight size={16} className={styles.chevron} />
        </div>

        {/* Customer row */}
        <div className={styles.customerRow}>
          <span className={styles.customerName}>{ticket.customerName}</span>
          {ticket.customerPhone && (
            <button
              className={styles.callBtn}
              onClick={handleCall}
              aria-label={`Call ${ticket.customerName}`}
            >
              <Phone size={14} />
              <span>{ticket.customerPhone}</span>
            </button>
          )}
        </div>

        {/* Issue */}
        {ticket.issue && (
          <p className={styles.issue}>{ticket.issue}</p>
        )}

        {/* Footer: status badge + time */}
        <div className={styles.footer}>
          <button
            className={[styles.statusBadge, canCycle && styles.statusBadgeTappable, isUpdating && styles.statusBadgeUpdating].filter(Boolean).join(' ')}
            style={{ background: `${meta.color}20`, color: meta.color, borderColor: `${meta.color}40` }}
            onClick={handleStatusCycle}
            disabled={isUpdating || !canCycle}
            title={canCycle ? `Tap to advance to "${STATUS_META[nextStatus!].label}"` : 'Status cannot be advanced here'}
          >
            {meta.icon}
            <span>{meta.label}</span>
            {canCycle && !isUpdating && (
              <ChevronRight size={10} style={{ opacity: 0.7 }} />
            )}
          </button>
          <span className={styles.timeAgo}>{timeAgo}</span>
        </div>
      </div>
    </div>
  );
};
