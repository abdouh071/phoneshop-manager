import React from 'react';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Wrench,
  Package,
  DollarSign,
  ArrowRight,
  ShieldCheck,
  User,
  Smartphone,
} from 'lucide-react';
import type { RepairTicket, CustomerDebtEntry } from '../../types';
import { buildPhoneLifecycle, type PhoneLifecycleStage } from '../../utils/phoneLifecycle';
import { formatCurrency } from '../../utils/formatCurrency';
import styles from './PhoneLifecycleHistoryCard.module.css';

interface PhoneLifecycleHistoryCardProps {
  ticket: RepairTicket;
  allTickets: RepairTicket[];
  debts?: CustomerDebtEntry[];
  onSelectTicket?: (t: RepairTicket) => void;
}

export const PhoneLifecycleHistoryCard: React.FC<PhoneLifecycleHistoryCardProps> = ({
  ticket,
  allTickets,
  debts = [],
  onSelectTicket,
}) => {
  const analysis = React.useMemo(() => {
    return buildPhoneLifecycle(ticket, allTickets, debts);
  }, [ticket, allTickets, debts]);

  const {
    mainTicket,
    familyTickets,
    stages,
    financials,
    wasReturned,
    isReturnResolved,
    returnReason,
  } = analysis;

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const getDotClass = (stage: PhoneLifecycleStage['stage']) => {
    switch (stage) {
      case 'intake':
        return styles.dotIntake;
      case 'repaired':
        return styles.dotRepaired;
      case 'handover':
        return styles.dotHandover;
      case 'returned':
        return styles.dotReturned;
      case 're_repaired':
        return styles.dotReRepaired;
      case 're_handover':
        return styles.dotReHandover;
      default:
        return '';
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Smartphone size={16} color="var(--color-primary, #4f46e5)" />
          <span className={styles.headerTitle}>
            Complete Phone Lifecycle & Service History
          </span>
        </div>

        <div>
          {isReturnResolved ? (
            <span className={[styles.statusPill, styles.statusPillResolved].join(' ')}>
              <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Return Re-repaired & Completed
            </span>
          ) : wasReturned ? (
            <span className={[styles.statusPill, styles.statusPillReturned].join(' ')}>
              <RotateCcw size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Active Return Under Repair
            </span>
          ) : mainTicket.status === 'completed' ? (
            <span className={[styles.statusPill, styles.statusPillCompleted].join(' ')}>
              <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Repaired & Picked Up
            </span>
          ) : (
            <span className={[styles.statusPill, styles.statusPillActive].join(' ')}>
              In Progress
            </span>
          )}
        </div>
      </div>

      {/* Linked ticket family switcher (if more than 1 ticket) */}
      {familyTickets.length > 1 && (
        <div className={styles.familyTicketsRow}>
          <span style={{ fontWeight: 600, color: '#475569' }}>Tickets:</span>
          {familyTickets.map((t, idx) => {
            const isCurrent = t.id === ticket.id;
            const isMain = t.id === mainTicket.id;
            return (
              <button
                key={t.id}
                type="button"
                className={[
                  styles.familyTicketBtn,
                  isCurrent && styles.familyTicketBtnActive,
                ].filter(Boolean).join(' ')}
                onClick={() => onSelectTicket?.(t)}
                disabled={isCurrent}
              >
                <span>{isMain ? '⭐ Main #' : '🔁 Return #'}{t.ticketNumber}</span>
                {t.isReturn && <span style={{ fontSize: '9px' }}>(Return)</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Chronological Lifecycle Timeline */}
      <div className={styles.timeline}>
        {stages.map((st, i) => (
          <div key={i} className={styles.timelineItem}>
            <div className={[styles.timelineDot, getDotClass(st.stage)].join(' ')} />

            <div className={styles.itemHeader}>
              <span className={styles.itemTitle}>
                {st.title}
                {st.ticketNumber && st.ticketNumber !== ticket.ticketNumber && (
                  <span style={{ fontSize: '10.5px', color: '#6366f1', fontWeight: 600 }}>
                    (#{st.ticketNumber})
                  </span>
                )}
              </span>
              <span className={styles.itemDate}>{formatDate(st.timestamp)}</span>
            </div>

            {st.actorOrTechnician && (
              <span className={styles.itemActor}>
                Staff / Tech: <strong>{st.actorOrTechnician}</strong>
              </span>
            )}

            <div className={styles.itemSummary}>{st.summary}</div>

            {/* Return Reason Box */}
            {st.stage === 'returned' && (
              <div className={styles.reasonBox}>
                <strong>Return Reason Reported by Client:</strong>
                <p style={{ margin: '3px 0 0', fontStyle: 'italic' }}>"{st.issueOrReason}"</p>
                {st.isWarranty !== undefined && (
                  <span style={{ display: 'block', marginTop: 4, fontWeight: 600, fontSize: '11px' }}>
                    {st.isWarranty ? '🛡️ Free Warranty Repair' : '💵 Charged Re-repair'}
                  </span>
                )}
              </div>
            )}

            {/* Initial Problem Reported */}
            {st.stage === 'intake' && st.issueOrReason && (
              <div style={{ background: '#f8fafc', padding: '5px 8px', borderRadius: 4, fontSize: '11.5px', color: '#334155' }}>
                <strong>Issue Reported:</strong> {st.issueOrReason}
              </div>
            )}

            {/* Parts Used */}
            {st.partsUsed && st.partsUsed.length > 0 && (
              <div className={styles.partsBox}>
                <span className={styles.partsTitle}>Parts Installed ({st.partsUsed.length}):</span>
                {st.partsUsed.map((p, idx) => (
                  <div key={idx} className={styles.partRow}>
                    <span>{p.quantity}x {p.name}</span>
                    <span>{formatCurrency(p.cost * p.quantity)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Financial Details for this stage */}
            {st.financialInfo && (
              <div className={styles.financialRow}>
                {st.financialInfo.cost !== undefined && st.financialInfo.cost > 0 && (
                  <span className={styles.financialBadge}>
                    Price: {formatCurrency(st.financialInfo.cost)}
                  </span>
                )}
                {st.financialInfo.deposit !== undefined && st.financialInfo.deposit > 0 && (
                  <span className={[styles.financialBadge, styles.badgePaid].join(' ')}>
                    Deposit: {formatCurrency(st.financialInfo.deposit)}
                  </span>
                )}
                {st.financialInfo.paidNow !== undefined && st.financialInfo.paidNow > 0 && (
                  <span className={[styles.financialBadge, styles.badgePaid].join(' ')}>
                    Paid at Handover: {formatCurrency(st.financialInfo.paidNow)}
                  </span>
                )}
                {st.financialInfo.isDebt && st.financialInfo.remainingDebt !== undefined && st.financialInfo.remainingDebt > 0 && (
                  <span className={[styles.financialBadge, styles.badgeDebt].join(' ')}>
                    ⚠️ Dept: {formatCurrency(st.financialInfo.remainingDebt)}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Unified Financial Ledger Box */}
      <div className={styles.ledgerBox}>
        <div className={styles.ledgerTitle}>
          <span>Financial Details & Balance Summary</span>
          {financials.isFullySettled ? (
            <span style={{ color: '#16a34a', fontSize: '11.5px', fontWeight: 600 }}>
              ✓ Paid in Full
            </span>
          ) : (
            <span style={{ color: '#dc2626', fontSize: '11.5px', fontWeight: 600 }}>
              ⚠️ Active Debt Balance
            </span>
          )}
        </div>

        <div className={styles.ledgerGrid}>
          <div className={styles.ledgerCard}>
            <span className={styles.ledgerCardLabel}>Total Repair Cost</span>
            <span className={styles.ledgerCardValue}>
              {formatCurrency(financials.totalBilledCost)}
            </span>
          </div>

          <div className={[styles.ledgerCard, styles.ledgerPaid].join(' ')}>
            <span className={styles.ledgerCardLabel}>Total Collected</span>
            <span className={styles.ledgerCardValue}>
              {formatCurrency(financials.totalCollected)}
            </span>
          </div>

          <div className={[styles.ledgerCard, financials.netRemainingDebt > 0 ? styles.ledgerDebt : styles.ledgerPaid].join(' ')}>
            <span className={styles.ledgerCardLabel}>Remaining Dept</span>
            <span className={styles.ledgerCardValue}>
              {formatCurrency(financials.netRemainingDebt)}
            </span>
          </div>

          {financials.initialDeposit > 0 && (
            <div className={styles.ledgerCard}>
              <span className={styles.ledgerCardLabel}>Intake Deposit</span>
              <span className={styles.ledgerCardValue}>
                {formatCurrency(financials.initialDeposit)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
