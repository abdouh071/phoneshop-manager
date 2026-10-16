import React, { useState, useMemo } from 'react';
import { 
  Clock, 
  Wrench, 
  CheckCircle2, 
  Archive, 
  ChevronDown, 
  AlertTriangle, 
  User, 
  Phone, 
  ShieldCheck, 
  MessageCircle, 
  Printer, 
  Eye, 
  Lock
} from 'lucide-react';
import type { RepairTicket } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import { detectIssueTag, getBrandIcon } from './repairConstants';
import styles from './StatusTables.module.css';

interface StatusTablesViewProps {
  tickets: RepairTicket[];
  onSelectTicket: (ticket: RepairTicket) => void;
  onAdvanceStatus: (e: React.MouseEvent, ticket: RepairTicket) => void;
  onPrintTicket?: (ticket: RepairTicket) => void;
  onOpenCustomerProfile?: (e: React.MouseEvent, ticket: RepairTicket) => void;
}

const formatTimeAgo = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 5) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

export const StatusTablesView: React.FC<StatusTablesViewProps> = ({
  tickets,
  onSelectTicket,
  onAdvanceStatus,
  onPrintTicket,
  onOpenCustomerProfile,
}) => {
  // Collapsible state for each of the 4 sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    completed: false, // all open by default for maximum visibility
  });

  const toggleCollapse = (status: string) => {
    setCollapsed(prev => ({ ...prev, [status]: !prev[status] }));
  };

  // Segregate tickets by status - returned phones go to Section 1 (Pending Intake) with priority
  const pendingTickets = useMemo(() => {
    return tickets
      .filter(t => t.status === 'pending' || t.status === 'returned')
      .sort((a, b) => {
        if (a.status === 'returned' && b.status !== 'returned') return -1;
        if (b.status === 'returned' && a.status !== 'returned') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [tickets]);
  const inProgressTickets = useMemo(() => tickets.filter(t => t.status === 'in_progress'), [tickets]);
  const readyTickets = useMemo(() => tickets.filter(t => t.status === 'ready'), [tickets]);
  const completedTickets = useMemo(() => tickets.filter(t => t.status === 'completed'), [tickets]);

  // Section metrics
  const pendingTotalValue = useMemo(() => 
    pendingTickets.reduce((sum, t) => sum + (t.estimatedCost || 0), 0)
  , [pendingTickets]);

  const inProgressTechCount = useMemo(() => {
    const techs = new Set(inProgressTickets.map(t => t.assignedTechnician).filter(Boolean));
    return techs.size;
  }, [inProgressTickets]);

  const readyUncollectedTotal = useMemo(() => 
    readyTickets.reduce((sum, t) => {
      const cost = t.actualCost ?? t.estimatedCost ?? 0;
      const deposit = t.depositAmount ?? 0;
      return sum + Math.max(0, cost - deposit);
    }, 0)
  , [readyTickets]);

  const todaySettledCount = useMemo(() => {
    const today = new Date().toDateString();
    return completedTickets.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === today).length;
  }, [completedTickets]);

  const renderOverdueOrSLA = (ticket: RepairTicket) => {
    const isOverdue = ticket.estimatedCompletionDate &&
      new Date(ticket.estimatedCompletionDate) < new Date() &&
      ticket.status !== 'completed' && ticket.status !== 'cancelled' && ticket.status !== 'returned';

    const isDueToday = ticket.estimatedCompletionDate &&
      new Date(ticket.estimatedCompletionDate).toDateString() === new Date().toDateString() &&
      ticket.status !== 'completed' && ticket.status !== 'cancelled' && ticket.status !== 'returned';

    if (isOverdue) {
      return (
        <span className={styles.slaOverdue}>
          <AlertTriangle size={11} /> Overdue
        </span>
      );
    }
    if (isDueToday) {
      return (
        <span className={styles.slaToday}>
          <Clock size={11} /> Due Today
        </span>
      );
    }
    if (ticket.estimatedCompletionDate) {
      return (
        <span className={styles.slaNormal}>
          Due: {new Date(ticket.estimatedCompletionDate).toLocaleDateString()}
        </span>
      );
    }
    return <span className={styles.slaNormal} style={{ opacity: 0.5 }}>No SLA set</span>;
  };

  const getCleanPhone = (phone?: string) => (phone || '').replace(/\D/g, '');

  return (
    <div className={styles.container}>

      {/* ══════════════════════════════════════════════════════════════════════
          TABLE 1: ⏳ PENDING INTAKE & DIAGNOSTIC
          ══════════════════════════════════════════════════════════════════════ */}
      <div className={`${styles.statusSection} ${styles.sectionPending} ${collapsed.pending ? styles.collapsed : ''}`}>
        <div className={styles.sectionHeader} onClick={() => toggleCollapse('pending')}>
          <div className={styles.headerLeft}>
            <div className={`${styles.statusIconBox} ${styles.iconPending}`}>
              <Clock size={18} />
            </div>
            <div className={styles.statusTitleBlock}>
              <div className={styles.statusTitleRow}>
                <h3 className={styles.statusTitle}>1. Pending Intake & Diagnostic</h3>
                <span className={`${styles.countBadge} ${styles.countPending}`}>
                  {pendingTickets.length} Ticket{pendingTickets.length === 1 ? '' : 's'}
                </span>
                {pendingTickets.some(t => t.status === 'returned') && (
                  <span className={styles.returnedCountPill} title="Repairs returned under warranty or callback">
                    <AlertTriangle size={11} /> {pendingTickets.filter(t => t.status === 'returned').length} Returned
                  </span>
                )}
              </div>
              <p className={styles.statusSubtitle}>Awaiting inspection, parts check, technician assignment, or warranty re-diagnosis</p>
            </div>
          </div>
          <div className={styles.headerRight}>
            {pendingTotalValue > 0 && (
              <span className={styles.revenueBadge} title="Total estimated value of pending repairs">
                Est. Total: <strong>{formatCurrency(pendingTotalValue)}</strong>
              </span>
            )}
            <ChevronDown size={18} className={styles.collapseIcon} />
          </div>
        </div>

        {!collapsed.pending && (
          <div className={styles.tableWrapper}>
            <table className={styles.statusTable}>
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>Ticket #</th>
                  <th>Device</th>
                  <th>Issue / Problem</th>
                  <th>Customer</th>
                  <th>Est. Cost & Deposit</th>
                  <th>Urgency / SLA</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={styles.emptyState}>
                        <span className={styles.emptyIcon}>✨</span>
                        <p className={styles.emptyTitle}>No pending repair tickets</p>
                        <p className={styles.emptySubtitle}>All incoming devices have been diagnosed and scheduled</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pendingTickets.map(ticket => {
                    const issue = detectIssueTag(ticket.issueDescription);
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    const isOverdue = ticket.estimatedCompletionDate && new Date(ticket.estimatedCompletionDate) < new Date();
                    const isReturned = ticket.status === 'returned';

                    return (
                      <tr 
                        key={ticket.id} 
                        className={`${styles.tableRow} ${isOverdue ? styles.tableRowOverdue : ''} ${isReturned ? styles.tableRowReturned : ''}`}
                        onClick={() => onSelectTicket(ticket)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span className={styles.ticketBadge}>{ticket.ticketNumber}</span>
                            {ticket.isReturn && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  border: '1px solid #fde68a',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                                title={`Return Ticket belonging to parent #${ticket.parentTicketNumber || ticket.parentTicketId}`}
                              >
                                🔁 Return {ticket.parentTicketNumber ? `of #${ticket.parentTicketNumber}` : ''}
                              </span>
                            )}
                            {isReturned && (
                              <span className={styles.returnedTag} title={ticket.returnReason ? `Return Reason: ${ticket.returnReason}` : 'Returned Phone'}>
                                <AlertTriangle size={10} /> Returned
                              </span>
                            )}
                            {isReturned && ticket.activeReturnTicketNumber && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: '#eff6ff',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                                title={`Active child return ticket: #${ticket.activeReturnTicketNumber}`}
                              >
                                Child #{ticket.activeReturnTicketNumber}
                              </span>
                            )}
                          </div>
                          <span className={styles.intakeTime}>{formatTimeAgo(ticket.createdAt)}</span>
                        </td>
                        <td>
                          <div className={styles.deviceCell}>
                            <span className={styles.deviceTitle}>
                              <span>{brandIcon}</span> {ticket.deviceBrand} {ticket.deviceModel}
                            </span>
                            {ticket.lockType && ticket.lockType !== 'none' && ticket.lockValue && (
                              <span className={styles.lockPill}>
                                <Lock size={10} /> {ticket.lockType === 'pattern' ? 'Pattern Lock' : `PIN: ${ticket.lockValue}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.issueCell}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className={styles.issueTag}>
                                <span>{issue.icon}</span> {issue.label}
                              </span>
                              {isReturned && (
                                <span className={styles.returnedTagBadge}>
                                  ⚠️ Returned
                                </span>
                              )}
                            </div>
                            {ticket.issueDescription && (
                              <span className={styles.issueDesc} title={ticket.issueDescription}>
                                {ticket.issueDescription}
                              </span>
                            )}
                            {isReturned && ticket.returnReason && (
                              <span className={styles.returnReasonText} title={`Return Reason: ${ticket.returnReason}`}>
                                <strong>Reason:</strong> {ticket.returnReason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.customerCell}>
                            <span 
                              className={`${styles.customerName} ${onOpenCustomerProfile ? styles.customerNameClickable : ''}`}
                              onClick={onOpenCustomerProfile ? (e) => { e.stopPropagation(); onOpenCustomerProfile(e, ticket); } : undefined}
                              title="Click to view Customer profile"
                            >
                              <User size={12} style={{ color: 'var(--color-primary)' }} />
                              {ticket.customerName}
                            </span>
                            {ticket.customerPhone && (
                              <span className={styles.customerPhone}>
                                <Phone size={10} /> {ticket.customerPhone}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.costBlock}>
                            <span className={styles.costMain}>~{formatCurrency(ticket.estimatedCost)}</span>
                            {ticket.depositAmount && ticket.depositAmount > 0 ? (
                              <span className={styles.depositPaid}>Deposit: {formatCurrency(ticket.depositAmount)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {isReturned ? (
                            <span className={styles.slaReturned} title={ticket.returnDate ? `Returned: ${new Date(ticket.returnDate).toLocaleDateString()}` : 'Returned Phone'}>
                              <AlertTriangle size={11} /> Return / Warranty
                            </span>
                          ) : (
                            renderOverdueOrSLA(ticket)
                          )}
                        </td>
                        <td>
                          <div className={styles.actionGroup} onClick={e => e.stopPropagation()}>
                            {isReturned && ticket.activeReturnTicketNumber ? (
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={() => onSelectTicket(ticket)}
                                title={`View details and link to child Return Ticket #${ticket.activeReturnTicketNumber}`}
                                style={{ fontSize: '11px', padding: '4px 8px', color: '#1d4ed8', borderColor: '#bfdbfe', background: '#eff6ff', fontWeight: 600 }}
                              >
                                Child #{ticket.activeReturnTicketNumber} Active →
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={`${styles.primaryActionBtn} ${styles.btnStart}`}
                                onClick={(e) => onAdvanceStatus(e, ticket)}
                                title={isReturned ? "Start Repair / Warranty Re-work (Move to Workbench)" : "Start Repair (Move to Workbench)"}
                              >
                                <Wrench size={13} /> {isReturned ? "Restart Repair →" : "Start Repair →"}
                              </button>
                            )}
                            {onPrintTicket && (
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={() => onPrintTicket(ticket)}
                                title="Print thermal device sticker / intake receipt"
                              >
                                <Printer size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() => onSelectTicket(ticket)}
                              title="Open ticket details"
                            >
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* ══════════════════════════════════════════════════════════════════════
          TABLE 2: ⚡ ACTIVE WORKBENCH / IN PROGRESS
          ══════════════════════════════════════════════════════════════════════ */}
      <div className={`${styles.statusSection} ${styles.sectionInProgress} ${collapsed.in_progress ? styles.collapsed : ''}`}>
        <div className={styles.sectionHeader} onClick={() => toggleCollapse('in_progress')}>
          <div className={styles.headerLeft}>
            <div className={`${styles.statusIconBox} ${styles.iconInProgress}`}>
              <Wrench size={18} />
            </div>
            <div className={styles.statusTitleBlock}>
              <div className={styles.statusTitleRow}>
                <h3 className={styles.statusTitle}>2. Active Workbench / In Progress</h3>
                <span className={`${styles.countBadge} ${styles.countInProgress}`}>
                  {inProgressTickets.length} Active
                </span>
              </div>
              <p className={styles.statusSubtitle}>Currently on the repair bench under physical disassembly and fixing</p>
            </div>
          </div>
          <div className={styles.headerRight}>
            {inProgressTechCount > 0 && (
              <span className={styles.revenueBadge} title="Technicians actively working">
                Active Techs: <strong>{inProgressTechCount}</strong>
              </span>
            )}
            <ChevronDown size={18} className={styles.collapseIcon} />
          </div>
        </div>

        {!collapsed.in_progress && (
          <div className={styles.tableWrapper}>
            <table className={styles.statusTable}>
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Ticket #</th>
                  <th>Device & Security</th>
                  <th>Work Order / Issue</th>
                  <th>Customer</th>
                  <th>Assigned Technician</th>
                  <th>Cost Est.</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inProgressTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={styles.emptyState}>
                        <span className={styles.emptyIcon}>🛠️</span>
                        <p className={styles.emptyTitle}>Workbench is currently clear</p>
                        <p className={styles.emptySubtitle}>Advance a ticket from Pending to begin repair work</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  inProgressTickets.map(ticket => {
                    const issue = detectIssueTag(ticket.issueDescription);
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    const isOverdue = ticket.estimatedCompletionDate && new Date(ticket.estimatedCompletionDate) < new Date();

                    return (
                      <tr 
                        key={ticket.id} 
                        className={`${styles.tableRow} ${isOverdue ? styles.tableRowOverdue : ''}`}
                        onClick={() => onSelectTicket(ticket)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span className={styles.ticketBadge}>{ticket.ticketNumber}</span>
                            {ticket.isReturn && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  border: '1px solid #fde68a',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                                title={`Return Ticket belonging to parent #${ticket.parentTicketNumber || ticket.parentTicketId}`}
                              >
                                🔁 Return {ticket.parentTicketNumber ? `of #${ticket.parentTicketNumber}` : ''}
                              </span>
                            )}
                          </div>
                          <span className={styles.intakeTime}>{formatTimeAgo(ticket.createdAt)}</span>
                        </td>
                        <td>
                          <div className={styles.deviceCell}>
                            <span className={styles.deviceTitle}>
                              <span>{brandIcon}</span> {ticket.deviceBrand} {ticket.deviceModel}
                            </span>
                            {ticket.lockType && ticket.lockType !== 'none' && ticket.lockValue ? (
                              <span className={styles.lockPill} title={`Device Security Code: ${ticket.lockValue}`}>
                                <Lock size={10} /> <strong>{ticket.lockType.toUpperCase()}:</strong> {ticket.lockValue}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', opacity: 0.5 }}>No Lock</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.issueCell}>
                            <span className={styles.issueTag}>
                              <span>{issue.icon}</span> {issue.label}
                            </span>
                            {ticket.issueDescription && (
                              <span className={styles.issueDesc} title={ticket.issueDescription}>
                                {ticket.issueDescription}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.customerCell}>
                            <span 
                              className={`${styles.customerName} ${onOpenCustomerProfile ? styles.customerNameClickable : ''}`}
                              onClick={onOpenCustomerProfile ? (e) => { e.stopPropagation(); onOpenCustomerProfile(e, ticket); } : undefined}
                              title="Click to view Customer profile"
                            >
                              <User size={12} style={{ color: 'var(--color-primary)' }} />
                              {ticket.customerName}
                            </span>
                            {ticket.customerPhone && (
                              <span className={styles.customerPhone}>
                                <Phone size={10} /> {ticket.customerPhone}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {ticket.assignedTechnician ? (
                            <span className={styles.techBadge}>
                              <span className={styles.techAvatar}>{ticket.assignedTechnician[0]}</span>
                              <span>{ticket.assignedTechnician}</span>
                            </span>
                          ) : (
                            <span className={styles.unassignedBadge}>⚠️ Unassigned</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.costBlock}>
                            <span className={styles.costMain}>~{formatCurrency(ticket.estimatedCost)}</span>
                            {ticket.depositAmount && ticket.depositAmount > 0 ? (
                              <span className={styles.depositPaid}>Paid: {formatCurrency(ticket.depositAmount)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className={styles.actionGroup} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`${styles.primaryActionBtn} ${styles.btnReady}`}
                              onClick={(e) => onAdvanceStatus(e, ticket)}
                              title="Mark repair tested and ready for customer pickup"
                            >
                              <CheckCircle2 size={13} /> Ready for Pickup →
                            </button>
                            {onPrintTicket && (
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={() => onPrintTicket(ticket)}
                                title="Print thermal device sticker / intake receipt"
                              >
                                <Printer size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() => onSelectTicket(ticket)}
                              title="Open ticket details"
                            >
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* ══════════════════════════════════════════════════════════════════════
          TABLE 3: 🚀 READY FOR PICKUP & CASHOUT
          ══════════════════════════════════════════════════════════════════════ */}
      <div className={`${styles.statusSection} ${styles.sectionReady} ${collapsed.ready ? styles.collapsed : ''}`}>
        <div className={styles.sectionHeader} onClick={() => toggleCollapse('ready')}>
          <div className={styles.headerLeft}>
            <div className={`${styles.statusIconBox} ${styles.iconReady}`}>
              <CheckCircle2 size={18} />
            </div>
            <div className={styles.statusTitleBlock}>
              <div className={styles.statusTitleRow}>
                <h3 className={styles.statusTitle}>3. Ready for Pickup & Cashout</h3>
                <span className={`${styles.countBadge} ${styles.countReady}`}>
                  {readyTickets.length} Ready
                </span>
              </div>
              <p className={styles.statusSubtitle}>Repairs complete and tested — customer ready to collect and settle</p>
            </div>
          </div>
          <div className={styles.headerRight}>
            {readyUncollectedTotal > 0 && (
              <span className={`${styles.revenueBadge} ${styles.revenueReady}`} title="Total uncollected balance to collect at pickup">
                To Collect: <strong>{formatCurrency(readyUncollectedTotal)}</strong>
              </span>
            )}
            <ChevronDown size={18} className={styles.collapseIcon} />
          </div>
        </div>

        {!collapsed.ready && (
          <div className={styles.tableWrapper}>
            <table className={styles.statusTable}>
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Ticket #</th>
                  <th>Device</th>
                  <th>Customer & Direct Notify</th>
                  <th>Financials (Cost & Deposit)</th>
                  <th>Balance Due</th>
                  <th>Completed By</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {readyTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={styles.emptyState}>
                        <span className={styles.emptyIcon}>🎉</span>
                        <p className={styles.emptyTitle}>No devices awaiting customer pickup</p>
                        <p className={styles.emptySubtitle}>All repaired devices have been collected by customers</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  readyTickets.map(ticket => {
                    const issue = detectIssueTag(ticket.issueDescription);
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    const cost = ticket.actualCost ?? ticket.estimatedCost ?? 0;
                    const deposit = ticket.depositAmount ?? 0;
                    const balance = Math.max(0, cost - deposit);
                    const cleanPhone = getCleanPhone(ticket.customerPhone);

                    return (
                      <tr 
                        key={ticket.id} 
                        className={styles.tableRow}
                        onClick={() => onSelectTicket(ticket)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span className={styles.ticketBadge}>{ticket.ticketNumber}</span>
                            {ticket.isReturn && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  border: '1px solid #fde68a',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                                title={`Return Ticket belonging to parent #${ticket.parentTicketNumber || ticket.parentTicketId}`}
                              >
                                🔁 Return {ticket.parentTicketNumber ? `of #${ticket.parentTicketNumber}` : ''}
                              </span>
                            )}
                          </div>
                          <span className={styles.intakeTime} style={{ color: '#059669', fontWeight: 600 }}>
                            Ready {formatTimeAgo(ticket.updatedAt || ticket.createdAt)}
                          </span>
                        </td>
                        <td>
                          <div className={styles.deviceCell}>
                            <span className={styles.deviceTitle}>
                              <span>{brandIcon}</span> {ticket.deviceBrand} {ticket.deviceModel}
                            </span>
                            <span className={styles.issueTag} style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                              <span>{issue.icon}</span> {issue.label}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className={styles.customerCell}>
                            <span 
                              className={`${styles.customerName} ${onOpenCustomerProfile ? styles.customerNameClickable : ''}`}
                              onClick={onOpenCustomerProfile ? (e) => { e.stopPropagation(); onOpenCustomerProfile(e, ticket); } : undefined}
                              title="Click to view Customer profile"
                            >
                              <User size={12} style={{ color: 'var(--color-primary)' }} />
                              {ticket.customerName}
                            </span>
                            {ticket.customerPhone && (
                              <div className={styles.customerPhone}>
                                <span>{ticket.customerPhone}</span>
                                <div className={styles.phoneActions} onClick={e => e.stopPropagation()}>
                                  {cleanPhone && (
                                    <a
                                      href={`https://wa.me/${cleanPhone}?text=Hello%20${encodeURIComponent(ticket.customerName)},%20your%20${encodeURIComponent(ticket.deviceBrand + ' ' + ticket.deviceModel)}%20is%20ready%20for%20pickup!`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`${styles.phoneActionBtn} ${styles.whatsappBtn}`}
                                      title="Send WhatsApp Ready message"
                                    >
                                      <MessageCircle size={10} /> WhatsApp
                                    </a>
                                  )}
                                  <a
                                    href={`tel:${ticket.customerPhone}`}
                                    className={`${styles.phoneActionBtn} ${styles.callBtn}`}
                                    title="Call customer"
                                  >
                                    <Phone size={10} /> Call
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.costBlock}>
                            <span className={styles.costMain}>{formatCurrency(cost)}</span>
                            {deposit > 0 ? (
                              <span className={styles.depositPaid}>Deposit Paid: {formatCurrency(deposit)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {balance > 0 ? (
                            <span className={styles.balanceDue}>
                              Unpaid: {formatCurrency(balance)}
                            </span>
                          ) : (
                            <span className={styles.balanceCleared}>
                              ✓ Paid in Full
                            </span>
                          )}
                        </td>
                        <td>
                          {ticket.assignedTechnician ? (
                            <span className={styles.techBadge}>
                              <span className={styles.techAvatar}>{ticket.assignedTechnician[0]}</span>
                              <span>{ticket.assignedTechnician}</span>
                            </span>
                          ) : (
                            <span style={{ opacity: 0.4 }}>—</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.actionGroup} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`${styles.primaryActionBtn} ${styles.btnDeliver}`}
                              onClick={(e) => onAdvanceStatus(e, ticket)}
                              title="Handover device to customer and settle ticket"
                            >
                              <CheckCircle2 size={13} /> Handover & Settle →
                            </button>
                            {onPrintTicket && (
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={() => onPrintTicket(ticket)}
                                title="Print thermal device sticker / intake receipt"
                              >
                                <Printer size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() => onSelectTicket(ticket)}
                              title="Open ticket details"
                            >
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* ══════════════════════════════════════════════════════════════════════
          TABLE 4: ✅ COMPLETED & WARRANTY VAULT
          ══════════════════════════════════════════════════════════════════════ */}
      <div className={`${styles.statusSection} ${styles.sectionCompleted} ${collapsed.completed ? styles.collapsed : ''}`}>
        <div className={styles.sectionHeader} onClick={() => toggleCollapse('completed')}>
          <div className={styles.headerLeft}>
            <div className={`${styles.statusIconBox} ${styles.iconCompleted}`}>
              <Archive size={18} />
            </div>
            <div className={styles.statusTitleBlock}>
              <div className={styles.statusTitleRow}>
                <h3 className={styles.statusTitle}>4. Completed & Warranty Vault</h3>
                <span className={`${styles.countBadge} ${styles.countCompleted}`}>
                  {completedTickets.length} Settled
                </span>
              </div>
              <p className={styles.statusSubtitle}>Delivered repairs, settled payments, and active post-repair warranties</p>
            </div>
          </div>
          <div className={styles.headerRight}>
            {todaySettledCount > 0 && (
              <span className={styles.revenueBadge} title="Repairs completed and settled today">
                Settled Today: <strong>{todaySettledCount}</strong>
              </span>
            )}
            <ChevronDown size={18} className={styles.collapseIcon} />
          </div>
        </div>

        {!collapsed.completed && (
          <div className={styles.tableWrapper}>
            <table className={styles.statusTable}>
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Ticket #</th>
                  <th>Device</th>
                  <th>Customer</th>
                  <th>Settled Total</th>
                  <th>Technician</th>
                  <th>Warranty Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {completedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={styles.emptyState}>
                        <span className={styles.emptyIcon}>📦</span>
                        <p className={styles.emptyTitle}>No completed repairs in this period</p>
                        <p className={styles.emptySubtitle}>Completed and settled repairs will be archived here</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  completedTickets.map(ticket => {
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    const finalCost = ticket.actualCost ?? ticket.estimatedCost ?? 0;

                    return (
                      <tr 
                        key={ticket.id} 
                        className={styles.tableRow}
                        onClick={() => onSelectTicket(ticket)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span className={styles.ticketBadge} style={{ color: '#475569', borderColor: '#cbd5e1' }}>
                              {ticket.ticketNumber}
                            </span>
                            {ticket.isReturn && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  border: '1px solid #fde68a',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                                title={`Return Ticket belonging to parent #${ticket.parentTicketNumber || ticket.parentTicketId}`}
                              >
                                🔁 Return {ticket.parentTicketNumber ? `of #${ticket.parentTicketNumber}` : ''}
                              </span>
                            )}
                          </div>
                          <span className={styles.intakeTime}>
                            {ticket.completedAt ? new Date(ticket.completedAt).toLocaleDateString() : formatTimeAgo(ticket.createdAt)}
                          </span>
                        </td>
                        <td>
                          <div className={styles.deviceCell}>
                            <span className={styles.deviceTitle}>
                              <span>{brandIcon}</span> {ticket.deviceBrand} {ticket.deviceModel}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                              {ticket.issueDescription || 'Repair Complete'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className={styles.customerCell}>
                            <span 
                              className={`${styles.customerName} ${onOpenCustomerProfile ? styles.customerNameClickable : ''}`}
                              onClick={onOpenCustomerProfile ? (e) => { e.stopPropagation(); onOpenCustomerProfile(e, ticket); } : undefined}
                              title="Click to view Customer profile"
                            >
                              <User size={12} style={{ color: 'var(--color-primary)' }} />
                              {ticket.customerName}
                            </span>
                            {ticket.customerPhone && (
                              <span className={styles.customerPhone}>
                                <Phone size={10} /> {ticket.customerPhone}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className={styles.costBlock}>
                            {ticket.paymentStatus === 'debt' || ticket.paymentStatus === 'partial' || (ticket.paidAmount !== undefined && ticket.paidAmount < finalCost) ? (
                              <>
                                <span className={styles.costMain} style={{ color: '#d97706' }}>
                                  ⚠️ {formatCurrency(ticket.paidAmount || 0)} <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#64748b' }}>/ {formatCurrency(finalCost)}</span>
                                </span>
                                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>
                                  Debt: {formatCurrency(Math.max(0, finalCost - (ticket.paidAmount || 0)))}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className={styles.costMain} style={{ color: '#059669' }}>
                                  ✓ {formatCurrency(finalCost)}
                                </span>
                                <span style={{ fontSize: '11px', color: '#64748b' }}>Settled in Full</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          {ticket.assignedTechnician ? (
                            <span className={styles.techBadge}>
                              <span className={styles.techAvatar}>{ticket.assignedTechnician[0]}</span>
                              <span>{ticket.assignedTechnician}</span>
                            </span>
                          ) : (
                            <span style={{ opacity: 0.4 }}>—</span>
                          )}
                        </td>
                        <td>
                          <span className={styles.warrantyBadge} title="Repair covered under shop warranty">
                            <ShieldCheck size={12} /> 90-Day Warranty
                          </span>
                        </td>
                        <td>
                          <div className={styles.actionGroup} onClick={e => e.stopPropagation()}>
                            {onPrintTicket && (
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={() => onPrintTicket(ticket)}
                                title="Print thermal device sticker / receipt"
                              >
                                <Printer size={13} style={{ marginRight: '4px' }} /> Print
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() => onSelectTicket(ticket)}
                              title="View full ticket history & invoice"
                            >
                              <Eye size={13} style={{ marginRight: '4px' }} /> View Summary
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
