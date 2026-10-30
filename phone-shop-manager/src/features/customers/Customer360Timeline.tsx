import React, { useState, useMemo } from 'react';
import {
  ShoppingBag, Wrench, BookOpen, DollarSign, Receipt,
  ChevronDown, ChevronUp, Calendar
} from 'lucide-react';
import { RepairStatusBadge } from '../../components/ui/Badge';
import type { SaleTransaction, CustomerDebtEntry } from '../../types';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { isDebtOverdue, getDaysOverdue } from '../../utils/debtAlerts';
import styles from './Timeline.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RepairTicket = any;

type SaleEvent    = { kind: 'sale';    date: string; data: SaleTransaction };
type RepairEvent  = { kind: 'repair';  date: string; data: RepairTicket };
type DebtOpenEvent= { kind: 'debt';    date: string; data: CustomerDebtEntry };
type DebtPayEvent = { kind: 'payment'; date: string; data: CustomerDebtEntry; paymentIndex: number };
type TimelineEvent= SaleEvent | RepairEvent | DebtOpenEvent | DebtPayEvent;
type FilterKind   = 'all' | 'sale' | 'repair' | 'debt' | 'payment';

interface Props {
  transactions: SaleTransaction[];
  tickets: RepairTicket[];
  debts: CustomerDebtEntry[];
  onViewReceipt?: (tx: SaleTransaction) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const monthKey = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// ─── Event sub-cards ──────────────────────────────────────────────────────────
const SaleCard: React.FC<{ event: SaleEvent; onViewReceipt?: (tx: SaleTransaction) => void }> = ({ event, onViewReceipt }) => {
  const [open, setOpen] = useState(false);
  const tx = event.data;
  const isB2B = tx.saleType === 'parts_b2b' || Boolean(tx.invoiceNumber);
  const refCode = tx.invoiceNumber ? `#${tx.invoiceNumber}` : `TX-#${tx.id.slice(-6)}`;

  const paymentMethods = tx.payments && tx.payments.length > 0
    ? tx.payments.map(p => {
        const m = p.method?.toLowerCase();
        if (m === 'debt') return '📒 Credit Tab';
        if (m === 'card') return '💳 Card';
        if (m === 'transfer' || m === 'bank_transfer') return '🏦 Transfer';
        if (m === 'store_credit') return '🎟️ Store Credit';
        return '💵 Cash';
      }).join(' + ')
    : '💵 Cash';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          {isB2B ? '📦 Parts Wholesale' : '🛒 Retail Sale'}
          <span className={styles.cardMeta}>{refCode}</span>
          {tx.status === 'refunded' && (
            <span style={{ fontSize: '10px', color: '#dc2626', background: '#fee2e2', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
              Refunded
            </span>
          )}
          {tx.status === 'partially_refunded' && (
            <span style={{ fontSize: '10px', color: '#d97706', background: '#fef3c7', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
              Partial Return
            </span>
          )}
        </div>
        <div className={styles.cardRight}>
          <span className={styles.amount}>{formatPrivateCurrency(tx.total)}</span>
          <button type="button" className={styles.expandBtn} onClick={() => setOpen(v => !v)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {open && (
        <div className={styles.cardBody}>
          <div className={styles.itemList}>
            {tx.items.map((item: any, i: number) => (
              <div key={i} className={styles.itemRow}>
                <span>{item.quantity}× {item.product.name} {item.product.model}</span>
                <span>{formatPrivateCurrency(item.product.price * item.quantity)}</span>
              </div>
            ))}
          </div>
          {tx.discount && (typeof tx.discount === 'object' ? tx.discount.value > 0 : (tx.discount as any) > 0) && (
            <div className={styles.debtRow} style={{ color: '#15803d', fontWeight: 600 }}>
              <span>🏷️ Discount Applied</span>
              <span>-{formatPrivateCurrency(typeof tx.discount === 'object' ? (tx.discount.type === 'percent' ? ((tx.subtotal || tx.total) * tx.discount.value / 100) : tx.discount.value) : (tx.discount as any))}</span>
            </div>
          )}
          <div className={styles.cardFooter}>
            <span className={styles.methodTag}>
              {paymentMethods}
            </span>
            {tx.processedByName && (
              <span className={styles.methodTag}>👤 Cashier: {tx.processedByName}</span>
            )}
            {onViewReceipt && (
              <button type="button" className={styles.linkBtn} onClick={() => onViewReceipt(tx)}>
                <Receipt size={12} /> {isB2B ? 'View Invoice' : 'View Receipt'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const RepairCard: React.FC<{ event: RepairEvent }> = ({ event }) => {
  const [open, setOpen] = useState(false);
  const tk = event.data;
  const isReturn = Boolean(tk.isReturn || tk.parentTicketId);
  const deposit = tk.depositAmount || 0;
  const actualCost = tk.actualCost ?? (tk.status === 'completed' ? tk.estimatedCost : 0);
  const totalCost = actualCost || tk.estimatedCost || 0;
  const paid = tk.paidAmount ?? deposit;
  const debt = Math.max(0, totalCost - paid);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          🔧 Repair Ticket
          <span className={styles.cardMeta}>#{tk.ticketNumber}</span>
          {isReturn && (
            <span style={{ background: '#fef08a', color: '#854d0e', fontSize: '10px', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
              🔁 RETURN
            </span>
          )}
        </div>
        <div className={styles.cardRight}>
          <RepairStatusBadge status={tk.status} />
          <button type="button" className={styles.expandBtn} onClick={() => setOpen(v => !v)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      <p className={styles.cardSubtitle}>{tk.deviceBrand} {tk.deviceModel}</p>
      {open && (
        <div className={styles.cardBody}>
          {tk.issueDescription && <p className={styles.issueText}><strong>Issue:</strong> {tk.issueDescription}</p>}
          {tk.remark && (
            <div style={{ fontSize: '11.5px', color: '#475569', background: '#f8fafc', border: '1px dashed #cbd5e1', padding: '4px 8px', borderRadius: '4px' }}>
              <strong>Tech Notes:</strong> "{tk.remark}"
            </div>
          )}
          {tk.partsUsed && tk.partsUsed.length > 0 && (
            <div style={{ fontSize: '11px', color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', padding: '4px 8px', borderRadius: '4px' }}>
              <strong>Spare Parts Installed:</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
                {tk.partsUsed.map((p: any, i: number) => (
                  <span key={i} style={{ background: '#ffffff', padding: '1px 5px', borderRadius: '3px', border: '1px solid #e0f2fe' }}>
                    {p.quantity}× {p.name} ({formatPrivateCurrency(p.cost)})
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className={styles.debtRow}>
            <span>Total Cost</span>
            <strong>{formatPrivateCurrency(totalCost)}</strong>
          </div>
          {deposit > 0 && (
            <div className={styles.debtRow}>
              <span>Intake Deposit</span>
              <span style={{ color: '#16a34a' }}>+{formatPrivateCurrency(deposit)}</span>
            </div>
          )}
          {tk.handoverAmountPaid && tk.handoverAmountPaid > 0 ? (
            <div className={styles.debtRow}>
              <span>Handover Collection</span>
              <span style={{ color: '#059669', fontWeight: 600 }}>+{formatPrivateCurrency(tk.handoverAmountPaid)}</span>
            </div>
          ) : null}
          {debt > 0 ? (
            <div className={styles.debtRow}>
              <span>Remaining Repair Debt</span>
              <span style={{ color: '#dc2626', fontWeight: 700 }}>{formatPrivateCurrency(debt)}</span>
            </div>
          ) : (tk.status === 'completed' || tk.paymentStatus === 'paid') ? (
            <div className={styles.debtRow}>
              <span>Settlement</span>
              <span style={{ color: '#16a34a', fontWeight: 700 }}>✅ Paid in Full</span>
            </div>
          ) : null}
          <div className={styles.cardFooter}>
            {tk.assignedTechnician && (
              <span className={styles.methodTag}>👨‍🔧 Tech: {tk.assignedTechnician}</span>
            )}
            {tk.createdByName && (
              <span className={styles.methodTag}>Intake: {tk.createdByName}</span>
            )}
            {tk.completedAt && (
              <span className={styles.methodTag} style={{ color: '#059669' }}>
                Claimed: {fmt(tk.completedAt)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const DebtOpenCard: React.FC<{ event: DebtOpenEvent }> = ({ event }) => {
  const [open, setOpen] = useState(false);
  const debt = event.data;
  const isRepairDebt = debt.type === 'repair' || debt.productOrService?.toLowerCase().includes('repair');
  const isPartsDebt = debt.type === 'parts_b2b';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          {isRepairDebt ? '🔧 Repair Credit Tab' : isPartsDebt ? '📦 Wholesale Parts Tab' : '📒 Credit Tab Opened'}
          <span className={styles.cardMeta}>{debt.invoiceNumber || debt.productOrService}</span>
        </div>
        <div className={styles.cardRight}>
          <span className={`${styles.amount} ${styles.amountDebt}`}>{formatPrivateCurrency(debt.totalAmount)}</span>
          <button type="button" className={styles.expandBtn} onClick={() => setOpen(v => !v)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      <p className={styles.cardSubtitle}>{debt.productOrService}</p>
      {open && (
        <div className={styles.cardBody}>
          <div className={styles.debtRow}>
            <span>Original Value</span>
            <strong>{formatPrivateCurrency(debt.totalAmount)}</strong>
          </div>
          {debt.amountPaid > 0 && (
            <div className={styles.debtRow}>
              <span>Total Paid Towards Debt</span>
              <span style={{ color: '#16a34a', fontWeight: 600 }}>{formatPrivateCurrency(debt.amountPaid)}</span>
            </div>
          )}
          <div className={styles.debtRow}>
            <span>Balance Owed</span>
            <span style={{ fontWeight: 700, color: debt.remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
              {formatPrivateCurrency(debt.remainingBalance)}
            </span>
          </div>
          {debt.dueDate && (
            <div className={styles.debtRow}>
              <span>Due Date</span>
              <span style={{ color: isDebtOverdue(debt) ? '#dc2626' : undefined, fontWeight: isDebtOverdue(debt) ? 700 : undefined }}>
                {fmt(debt.dueDate)} {isDebtOverdue(debt) ? `(${getDaysOverdue(debt.dueDate)}d late)` : ''}
              </span>
            </div>
          )}
          {debt.notes && <p className={styles.noteText}>{debt.notes}</p>}
          <div className={styles.cardFooter}>
            {debt.status === 'paid'
              ? <span className={styles.badgePaid}>✅ Fully Settled</span>
              : isDebtOverdue(debt)
                ? <span className={styles.badgeOverdue}>🔴 Overdue ({getDaysOverdue(debt.dueDate)}d late)</span>
                : debt.status === 'partially_paid'
                  ? <span className={styles.badgePartial}>🟡 Partially Paid ({formatPrivateCurrency(debt.remainingBalance)} left)</span>
                  : <span className={styles.badgeUnpaid}>🚨 Unpaid</span>
            }
          </div>
        </div>
      )}
    </div>
  );
};

const DebtPayCard: React.FC<{ event: DebtPayEvent }> = ({ event }) => {
  const payment = event.data.payments[event.paymentIndex];
  if (!payment) return null;
  const debt = event.data;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          💚 Debt Repayment
          <span className={styles.cardMeta}>{debt.productOrService}</span>
        </div>
        <span className={`${styles.amount} ${styles.amountPaid}`}>+{formatPrivateCurrency(payment.amount)}</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.debtRow}>
          <span>Method</span>
          <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{payment.method}</span>
        </div>
        {payment.receivedByName && (
          <div className={styles.debtRow}>
            <span>Received by</span>
            <strong>{payment.receivedByName}</strong>
          </div>
        )}
        <div className={styles.debtRow}>
          <span>Current Debt Balance</span>
          <span style={{ fontWeight: 700, color: debt.remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
            {formatPrivateCurrency(debt.remainingBalance)}
          </span>
        </div>
        {payment.note && <p className={styles.noteText}>Note: {payment.note}</p>}
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export const Customer360Timeline: React.FC<Props> = ({ transactions, tickets, debts, onViewReceipt }) => {
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);
  const [filter, setFilter] = useState<FilterKind>('all');

  const allEvents = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [
      ...transactions.map<SaleEvent>(tx => ({ kind: 'sale', date: tx.date, data: tx })),
      ...tickets.map<RepairEvent>(tk => ({ kind: 'repair', date: tk.createdAt, data: tk })),
      ...debts.map<DebtOpenEvent>(db => ({ kind: 'debt', date: db.date, data: db })),
      ...debts.flatMap<DebtPayEvent>(db =>
        (db.payments || []).map<DebtPayEvent>((_, idx) => ({
          kind: 'payment', date: db.payments[idx].date, data: db, paymentIndex: idx,
        }))
      ),
    ];
    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, tickets, debts]);

  const filtered = useMemo(() =>
    filter === 'all' ? allEvents : allEvents.filter(e => e.kind === filter),
    [allEvents, filter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    filtered.forEach(ev => {
      const key = monthKey(ev.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const counts = {
    all:     allEvents.length,
    sale:    allEvents.filter(e => e.kind === 'sale').length,
    repair:  allEvents.filter(e => e.kind === 'repair').length,
    debt:    allEvents.filter(e => e.kind === 'debt').length,
    payment: allEvents.filter(e => e.kind === 'payment').length,
  };

  const nodeClass = (kind: string) => {
    if (kind === 'sale')    return styles.nodeSale;
    if (kind === 'repair')  return styles.nodeRepair;
    if (kind === 'debt')    return styles.nodeDebt;
    if (kind === 'payment') return styles.nodePayment;
    return '';
  };

  const nodeIcon = (kind: string) => {
    if (kind === 'sale')    return <ShoppingBag size={12} />;
    if (kind === 'repair')  return <Wrench size={12} />;
    if (kind === 'debt')    return <BookOpen size={12} />;
    if (kind === 'payment') return <DollarSign size={12} />;
    return null;
  };

  const PILLS: { kind: FilterKind; label: string }[] = [
    { kind: 'all',     label: 'All' },
    { kind: 'sale',    label: '🛒 Sales' },
    { kind: 'repair',  label: '🔧 Repairs' },
    { kind: 'debt',    label: '📒 Debts' },
    { kind: 'payment', label: '💚 Payments' },
  ];

  if (allEvents.length === 0) {
    return (
      <div className={styles.emptyTimeline}>
        <Calendar size={32} strokeWidth={1.5} />
        <p>No activity history yet.</p>
        <span>Sales, repairs, and credit entries will appear here.</span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.filterRow}>
        {PILLS.map(p => (
          <button
            key={p.kind}
            type="button"
            className={[styles.pill, filter === p.kind ? styles.pillActive : ''].join(' ')}
            onClick={() => setFilter(p.kind)}
          >
            {p.label}
            <span className={styles.pillCount}>{counts[p.kind]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyTimeline}><p>No events of this type.</p></div>
      ) : (
        <div className={styles.timeline}>
          {grouped.map(([month, events]) => (
            <div key={month} className={styles.monthGroup}>
              <div className={styles.monthLabel}><span>{month}</span></div>
              {events.map((ev, idx) => (
                <div key={`${ev.kind}-${ev.date}-${idx}`} className={styles.timelineRow}>
                  <div className={styles.spine}>
                    <div className={[styles.node, nodeClass(ev.kind)].join(' ')}>
                      {nodeIcon(ev.kind)}
                    </div>
                    {idx < events.length - 1 && <div className={styles.line} />}
                  </div>
                  <div className={styles.eventContent}>
                    <div className={styles.eventTime}>{fmt(ev.date)} · {fmtTime(ev.date)}</div>
                    {ev.kind === 'sale'    && <SaleCard    event={ev} onViewReceipt={onViewReceipt} />}
                    {ev.kind === 'repair'  && <RepairCard  event={ev} />}
                    {ev.kind === 'debt'    && <DebtOpenCard event={ev} />}
                    {ev.kind === 'payment' && <DebtPayCard event={ev} />}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
