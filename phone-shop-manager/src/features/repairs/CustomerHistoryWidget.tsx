import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  Sparkles,
  Smartphone,
  Clock,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Wrench,
  RotateCcw,
  XCircle,
  CreditCard,
  AlertCircle,
  Store,
  User,
} from 'lucide-react';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { usePrivacyStore } from '../../store/privacyStore';
import type { RepairTicket, Customer } from '../../types';
import styles from './CustomerHistoryWidget.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { isPhoneMatch, normalizePhoneDigits } from '../../utils/phoneUtils';
import { isTicketActiveReturnPending } from '../../utils/phoneLifecycle';

interface CustomerHistoryWidgetProps {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  currentTicketId?: string;
  onSelectDevice?: (brand: string, model: string) => void;
  onViewTicket?: (ticket: RepairTicket) => void;
  defaultOpen?: boolean;
}

export interface TicketComputedStatus {
  exactStatus: 'dept' | 'taken' | 'completed' | 'in_progress' | 'pending' | 'cancelled' | 'returned';
  statusLabel: string;
  paidAmount: number;
  debtAmount: number;
  totalCost: number;
  isDebt: boolean;
  isActivelyReturned: boolean;
}

export const CustomerHistoryWidget: React.FC<CustomerHistoryWidgetProps> = ({
  customerId,
  customerName = '',
  customerPhone = '',
  currentTicketId,
  onSelectDevice,
  onViewTicket,
  defaultOpen = false,
}) => {
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);
  const { tickets } = useRepairStore();
  const { customers, debts } = useCustomerStore();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const cleanPhone = normalizePhoneDigits(customerPhone);
  const cleanName = (customerName || '').trim().toLowerCase();

  // 1. Detect matching customer account
  const matchedCustomer = useMemo<Customer | null>(() => {
    // A. Match by explicit customerId
    if (customerId) {
      const found = customers.find(c => c.id === customerId);
      if (found) return found;
    }

    // B. Match by phone if phone has at least 7 digits (Single Source of Truth)
    if (cleanPhone.length >= 7) {
      const found = customers.find(c =>
        isPhoneMatch(c.phone, customerPhone) ||
        (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, customerPhone))
      );
      if (found) return found;
    }

    // C. Match by name and partial phone (>= 6 digits)
    if (cleanName.length >= 2 && cleanPhone.length >= 6) {
      const found = customers.find(c => {
        const cName = (c.name || '').trim().toLowerCase();
        const pMatch = isPhoneMatch(c.phone, customerPhone) || (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, customerPhone));
        const nMatch = cName === cleanName || cName.includes(cleanName) || cleanName.includes(cName);
        return pMatch && nMatch;
      });
      if (found) return found;
    }

    // D. Match by exact full name if cleanName has at least 3 chars and no phone provided
    if (cleanName.length >= 3 && (!cleanPhone || cleanPhone.length < 4)) {
      const found = customers.find(c => c.name.trim().toLowerCase() === cleanName);
      if (found) return found;
    }

    return null;
  }, [customers, customerId, customerPhone, cleanPhone, cleanName]);

  // 2. Detect matching debts for this customer / phone
  const matchedDebts = useMemo(() => {
    if (!matchedCustomer && cleanPhone.length < 7 && cleanName.length < 3) return [];

    return debts
      .filter(d => {
        if (matchedCustomer && d.customerId === matchedCustomer.id) return true;
        if (cleanPhone.length >= 7 && isPhoneMatch(d.customerPhone, customerPhone)) return true;
        if (cleanName.length >= 3 && d.customerName.trim().toLowerCase() === cleanName) return true;
        return false;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [debts, matchedCustomer, customerPhone, cleanPhone, cleanName]);

  const activeDebts = useMemo(() => {
    return matchedDebts.filter(d => d.status !== 'paid' && d.remainingBalance > 0);
  }, [matchedDebts]);

  // 3. Detect past repair tickets
  const matchedTickets = useMemo(() => {
    if (matchedCustomer) {
      return tickets
        .filter(t => {
          if (currentTicketId && t.id === currentTicketId) return false;
          if (t.customerId && t.customerId === matchedCustomer.id) return true;
          if (isPhoneMatch(t.customerPhone, matchedCustomer.phone)) return true;
          return false;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (cleanPhone.length >= 7) {
      return tickets
        .filter(t => {
          if (currentTicketId && t.id === currentTicketId) return false;
          return isPhoneMatch(t.customerPhone, customerPhone);
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (cleanName.length >= 2 && cleanPhone.length >= 6) {
      return tickets
        .filter(t => {
          if (currentTicketId && t.id === currentTicketId) return false;
          const tName = (t.customerName || '').trim().toLowerCase();
          const pMatch = isPhoneMatch(t.customerPhone, customerPhone);
          const nMatch = tName === cleanName || tName.includes(cleanName) || cleanName.includes(tName);
          return pMatch && nMatch;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return [];
  }, [tickets, matchedCustomer, customerPhone, cleanPhone, cleanName, currentTicketId]);

  // 4. Exact status & financial calculation per ticket:
  //    - 'dept': Handed over / taken with unpaid debt
  //    - 'taken': Completed and picked up / fully paid
  //    - 'completed': Finished repair in shop waiting for pickup (ready)
  //    - 'in_progress', 'pending', 'cancelled', 'returned'
  const getTicketStatusAndFinancials = (t: RepairTicket): TicketComputedStatus => {
    const totalCost = t.actualCost ?? t.estimatedCost ?? 0;
    const deposit = t.depositAmount || 0;

    // Check if there is an active debt entry in customer debts linked to this ticket
    const linkedDebt = debts.find(
      d =>
        (t.debtEntryId && d.id === t.debtEntryId) ||
        (d.linkedTicketId && d.linkedTicketId === t.id) ||
        (d.type === 'repair' &&
          (d.productOrService.includes(t.ticketNumber) ||
            (t.customerId && d.customerId === t.customerId && d.date.slice(0, 10) === t.createdAt.slice(0, 10))))
    );

    let debtAmount = 0;
    let paidAmount = 0;
    let isDebt = false;

    if (linkedDebt) {
      if (linkedDebt.status !== 'paid' && linkedDebt.remainingBalance > 0) {
        debtAmount = linkedDebt.remainingBalance;
        paidAmount = Math.max(0, totalCost - debtAmount);
        isDebt = true;
      } else {
        // Debt was fully paid off in the customer ledger
        debtAmount = 0;
        paidAmount = totalCost;
        isDebt = false;
      }
    } else if (t.paymentStatus === 'debt') {
      debtAmount = Math.max(0, totalCost - deposit);
      paidAmount = deposit;
      isDebt = debtAmount > 0;
    } else if (t.paymentStatus === 'partial') {
      const alreadyPaid = t.paidAmount ?? deposit;
      debtAmount = Math.max(0, totalCost - alreadyPaid);
      paidAmount = alreadyPaid;
      isDebt = debtAmount > 0;
    } else if (t.paymentStatus === 'paid') {
      paidAmount = totalCost;
      debtAmount = 0;
      isDebt = false;
    } else if (t.status === 'completed') {
      // Completed ticket with no outstanding debt record
      paidAmount = totalCost;
      debtAmount = 0;
      isDebt = false;
    } else {
      // pending, in_progress, ready, cancelled, returned
      paidAmount = deposit;
      debtAmount = 0;
      isDebt = false;
    }

    // Determine exact status string
    let exactStatus: TicketComputedStatus['exactStatus'];
    let statusLabel = '';

    const isActivelyReturned = isTicketActiveReturnPending(t, tickets);

    if (isDebt && debtAmount > 0) {
      exactStatus = 'dept';
      statusLabel = 'Dept';
    } else if (t.status === 'completed' || (t.status === 'returned' && !isActivelyReturned)) {
      exactStatus = 'taken';
      statusLabel = 'Taken';
    } else if (t.status === 'ready') {
      exactStatus = 'completed';
      statusLabel = 'Completed';
    } else if (t.status === 'in_progress') {
      exactStatus = 'in_progress';
      statusLabel = 'In Progress';
    } else if (t.status === 'pending') {
      exactStatus = 'pending';
      statusLabel = 'Pending';
    } else if (t.status === 'cancelled') {
      exactStatus = 'cancelled';
      statusLabel = 'Cancelled';
    } else {
      exactStatus = 'returned';
      statusLabel = 'Returned';
    }

    return {
      exactStatus,
      statusLabel,
      paidAmount,
      debtAmount,
      totalCost,
      isDebt,
      isActivelyReturned,
    };
  };

  // 5. Total active debt for this customer
  const totalActiveDebt = useMemo(() => {
    const debtsSum = activeDebts.reduce((sum, d) => sum + d.remainingBalance, 0);

    // Also include any repair tickets that have debt not recorded in debts collection
    let unlinkedTicketDebt = 0;
    matchedTickets.forEach(t => {
      const fin = getTicketStatusAndFinancials(t);
      if (
        fin.isDebt &&
        !debts.some(
          d =>
            (t.debtEntryId && d.id === t.debtEntryId) ||
            (d.linkedTicketId && d.linkedTicketId === t.id) ||
            (d.type === 'repair' && d.productOrService.includes(t.ticketNumber))
        )
      ) {
        unlinkedTicketDebt += fin.debtAmount;
      }
    });

    return debtsSum + unlinkedTicketDebt;
  }, [activeDebts, matchedTickets, debts]);

  // 6. Total spent amount:
  //    "make also a total spent ammount but if it is under dept dont count it with the spent ammount , keep it in dept"
  //    Only actual paid money is counted towards totalSpentAmount; any unpaid debt balance is strictly kept in dept.
  const totalSpentAmount = useMemo(() => {
    let repairsPaid = 0;
    matchedTickets.forEach(t => {
      const fin = getTicketStatusAndFinancials(t);
      // Only count actual paid money for taken/completed repairs or deposits
      if (t.status === 'completed' || t.status === 'ready') {
        repairsPaid += fin.paidAmount;
      } else if (t.depositAmount && t.depositAmount > 0) {
        repairsPaid += t.depositAmount;
      }
    });

    if (matchedCustomer) {
      return matchedCustomer.totalSpent !== undefined ? matchedCustomer.totalSpent : repairsPaid;
    }

    return repairsPaid;
  }, [matchedCustomer, matchedTickets, debts]);

  // If nothing detected, don't show the widget
  const isDetected = matchedCustomer !== null || matchedTickets.length > 0 || activeDebts.length > 0;
  if (!isDetected) return null;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  const hasDebt = totalActiveDebt > 0;

  return (
    <div className={[styles.historyCard, hasDebt && styles.historyCardDebt].filter(Boolean).join(' ')}>
      {/* Loyalty & Account Header Strip */}
      <div className={styles.historyHeader} onClick={() => setIsOpen(prev => !prev)}>
        <div className={styles.headerLeft}>
          <span className={[styles.historyBadge, hasDebt && styles.historyBadgeDebt].filter(Boolean).join(' ')}>
            {hasDebt ? <AlertTriangle size={11} /> : <Sparkles size={11} />}
            <span>{hasDebt ? 'Dept Detected' : matchedCustomer ? 'Account Found' : 'History'}</span>
          </span>

          <span className={styles.headerTitle}>
            {matchedCustomer ? (
              <>
                <span className={styles.customerNameTitle}>{matchedCustomer.name}</span>
                {matchedTickets.length > 0 && (
                  <span className={styles.ticketsCountBadge}>
                    · {matchedTickets.length} Past Repair{matchedTickets.length > 1 ? 's' : ''}
                  </span>
                )}
              </>
            ) : (
              <span>
                {matchedTickets.length} Past Repair{matchedTickets.length > 1 ? 's' : ''} Found
              </span>
            )}
          </span>

          {totalSpentAmount > 0 && (
            <span className={styles.headerSpentStat}>
              · Total Spent: <strong>{formatPrivateCurrency(totalSpentAmount)}</strong>
            </span>
          )}

          {hasDebt && (
            <span className={styles.headerDebtStat}>
              ⚠️ Dept: <strong>{formatPrivateCurrency(totalActiveDebt)}</strong>
            </span>
          )}
        </div>

        <ChevronDown
          size={16}
          className={[styles.toggleIcon, isOpen && styles.toggleIconRotated].filter(Boolean).join(' ')}
        />
      </div>

      {/* Expandable History Feed */}
      {isOpen && (
        <div className={styles.historyBody}>
          {/* Account Profile Summary Strip if Customer Account is Detected */}
          {matchedCustomer && (
            <div className={styles.accountBanner}>
              <div className={styles.accountLeft}>
                <div className={styles.accountAvatar}>
                  {matchedCustomer.accountType === 'shop_repairer' || matchedCustomer.accountType === 'b2b' ? (
                    <Store size={15} />
                  ) : (
                    <User size={15} />
                  )}
                </div>
                <div className={styles.accountDetails}>
                  <div className={styles.accountNameRow}>
                    <span className={styles.accountName}>{matchedCustomer.name}</span>
                    <span className={styles.accountTypeBadge}>
                      {matchedCustomer.accountType === 'shop_repairer'
                        ? 'Shop / Repairer'
                        : matchedCustomer.accountType === 'b2b'
                        ? 'B2B Client'
                        : 'Retail Client'}
                    </span>
                  </div>
                  <span className={styles.accountPhone}>{matchedCustomer.phone}</span>
                </div>
              </div>

              <div className={styles.accountRight}>
                <div className={styles.accountPillSuccess}>
                  <span>Total Spent:</span>
                  <strong>{formatPrivateCurrency(totalSpentAmount)}</strong>
                </div>

                {hasDebt ? (
                  <div className={styles.accountPillDebt}>
                    <AlertCircle size={12} />
                    <span>Dept:</span>
                    <strong>{formatPrivateCurrency(totalActiveDebt)}</strong>
                  </div>
                ) : (
                  <div className={styles.accountPillGoodStanding}>
                    <CheckCircle2 size={12} />
                    <span>0 Dept · Good Standing</span>
                  </div>
                )}

                {Boolean(matchedCustomer.storeCredit && matchedCustomer.storeCredit > 0) && (
                  <div className={styles.accountPillCredit}>
                    <CreditCard size={12} />
                    <span>Credit: {formatPrivateCurrency(matchedCustomer.storeCredit)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Unpaid Debts Section (if any) */}
          {activeDebts.length > 0 && (
            <div className={styles.activeDebtsSection}>
              <div className={styles.debtsSectionHeader}>
                <AlertTriangle size={13} color="#b91c1c" />
                <span>Active Depts ({activeDebts.length})</span>
                <span className={styles.debtsTotalDue}>
                  Total: {formatPrivateCurrency(totalActiveDebt)}
                </span>
              </div>

              <div className={styles.debtsList}>
                {activeDebts.map(d => (
                  <div key={d.id} className={styles.debtItem}>
                    <div className={styles.debtItemLeft}>
                      <span className={styles.debtService}>{d.productOrService}</span>
                      <span className={styles.debtDate}>📅 {formatDate(d.date || d.createdAt)}</span>
                    </div>
                    <div className={styles.debtItemRight}>
                      <span className={styles.debtDueLabel}>Remaining:</span>
                      <span className={styles.debtDueValue}>{formatPrivateCurrency(d.remainingBalance)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Customer Registered Devices Vault */}
          {matchedCustomer?.registeredDevices && matchedCustomer.registeredDevices.length > 0 && (
            <div className={styles.vaultSection}>
              <div className={styles.sectionHeaderLabel}>
                <Sparkles size={12} color="#4f46e5" />
                <span>Registered Devices Vault ({matchedCustomer.registeredDevices.length})</span>
              </div>

              <div className={styles.vaultGrid}>
                {matchedCustomer.registeredDevices.map(dev => (
                  <div key={dev.id} className={styles.vaultCard}>
                    <div className={styles.vaultCardLeft}>
                      <Smartphone size={14} color="#4f46e5" />
                      <div className={styles.vaultCardDetails}>
                        <span className={styles.vaultCardName}>
                          {dev.brand} {dev.model}
                        </span>
                        {dev.imei && <span className={styles.vaultCardSub}>IMEI: {dev.imei}</span>}
                        {dev.notes && <span className={styles.vaultCardNotes}>📝 {dev.notes}</span>}
                      </div>
                    </div>

                    {onSelectDevice && (
                      <button
                        type="button"
                        className={styles.repeatBtn}
                        onClick={() => onSelectDevice(dev.brand, dev.model)}
                        title={`Select ${dev.brand} ${dev.model} for this ticket`}
                      >
                        <span>⚡ Use Device</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past Repairs Feed */}
          {matchedTickets.length > 0 ? (
            <div className={styles.repairsSection}>
              <div className={styles.sectionHeaderLabel}>
                <span>Past Repairs ({matchedTickets.length})</span>
              </div>

              {matchedTickets.map(t => {
                const fin = getTicketStatusAndFinancials(t);

                return (
                  <div
                    key={t.id}
                    className={[styles.ticketItem, fin.isDebt && styles.ticketItemDebt].filter(Boolean).join(' ')}
                  >
                    <div className={styles.itemTop}>
                      <span className={styles.itemDevice}>
                        <Smartphone size={13} color="#4f46e5" />
                        <span>
                          {t.deviceBrand} {t.deviceModel}
                        </span>
                        <span className={styles.ticketNumberText}>(#{t.ticketNumber})</span>
                      </span>

                      {/* Exact Status Badge */}
                      <span
                        className={[
                          styles.itemStatus,
                          fin.exactStatus === 'dept' && styles.statusDept,
                          fin.exactStatus === 'taken' && styles.statusTaken,
                          fin.exactStatus === 'completed' && styles.statusCompleted,
                          fin.exactStatus === 'in_progress' && styles.statusInProgress,
                          fin.exactStatus === 'pending' && styles.statusPending,
                          fin.exactStatus === 'cancelled' && styles.statusCancelled,
                          fin.exactStatus === 'returned' && styles.statusReturned,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {fin.exactStatus === 'dept' && <AlertTriangle size={10} />}
                        {fin.exactStatus === 'taken' && <CheckCircle2 size={10} />}
                        {fin.exactStatus === 'completed' && <Wrench size={10} />}
                        {fin.exactStatus === 'in_progress' && <Clock size={10} />}
                        {fin.exactStatus === 'cancelled' && <XCircle size={10} />}
                        {fin.exactStatus === 'returned' && <RotateCcw size={10} />}
                        <span>
                          {fin.exactStatus === 'dept'
                            ? `Dept: ${formatPrivateCurrency(fin.debtAmount)}`
                            : fin.exactStatus === 'taken'
                            ? 'Taken (Paid)'
                            : fin.exactStatus === 'completed'
                            ? 'Completed (Ready)'
                            : fin.statusLabel}
                        </span>
                      </span>
                    </div>

                    <div className={styles.itemMiddle}>
                      <span className={styles.itemIssue} title={t.issueDescription}>
                        🔧 {t.issueDescription}
                      </span>

                      {/* Return and Re-repair notes */}
                      {t.status === 'returned' && !fin.isActivelyReturned && (
                        <div style={{
                          fontSize: '11px',
                          color: '#15803d',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          padding: '3px 7px',
                          borderRadius: '4px',
                          marginTop: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                        }}>
                          <CheckCircle2 size={11} /> Return re-repaired & completed
                        </div>
                      )}

                      {t.returnReason && (
                        <div style={{
                          fontSize: '11px',
                          color: '#9a3412',
                          background: '#fff7ed',
                          border: '1px solid #ffedd5',
                          padding: '3px 7px',
                          borderRadius: '4px',
                          marginTop: '4px',
                          fontStyle: 'italic',
                        }}>
                          <strong>Return Reason:</strong> "{t.returnReason}"
                        </div>
                      )}

                      {/* Financial Detail for Ticket */}
                      <div className={styles.itemFinancials}>
                        {fin.isDebt ? (
                          <span className={styles.debtCostBreakdown}>
                            <span className={styles.costTotalText}>Total: {formatPrivateCurrency(fin.totalCost)}</span>
                            {fin.paidAmount > 0 && (
                              <span className={styles.costPaidText}>Paid: {formatPrivateCurrency(fin.paidAmount)}</span>
                            )}
                            <span className={styles.costDebtText}>Dept: {formatPrivateCurrency(fin.debtAmount)}</span>
                          </span>
                        ) : fin.exactStatus === 'taken' ? (
                          <span className={styles.itemCostPaid}>
                            Paid: {formatPrivateCurrency(fin.totalCost)}
                          </span>
                        ) : (
                          <span className={styles.itemCost}>
                            {formatPrivateCurrency(fin.totalCost)}
                            {Boolean(t.depositAmount && t.depositAmount > 0) && (
                              <span className={styles.depositNote}>
                                {' '}(Deposit: {formatPrivateCurrency(t.depositAmount)})
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className={styles.itemBottom}>
                      <span className={styles.itemDate}>
                        📅 {formatDate(t.createdAt)}
                        {t.completedAt && (
                          <span className={styles.completedDateNote}>
                            {' · '}
                            {fin.exactStatus === 'taken' ? 'Taken' : 'Settled'}: {formatDate(t.completedAt)}
                          </span>
                        )}
                      </span>

                      <div className={styles.itemActions}>
                        {onSelectDevice && (
                          <button
                            type="button"
                            className={styles.repeatBtn}
                            onClick={() => onSelectDevice(t.deviceBrand, t.deviceModel)}
                            title="Auto-fill this brand and model into the form"
                          >
                            <span>⚡ Repeat Device</span>
                          </button>
                        )}

                        {onViewTicket && (
                          <button
                            type="button"
                            className={styles.viewTicketBtn}
                            onClick={() => onViewTicket(t)}
                          >
                            <span>View Ticket →</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : matchedCustomer && activeDebts.length === 0 && (!matchedCustomer.registeredDevices || matchedCustomer.registeredDevices.length === 0) ? (
            <div className={styles.noRepairsNotice}>
              <span>Existing customer account detected. No past repair tickets recorded yet.</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
