import React, { useState, useEffect } from 'react';
import {
  Moon, CheckCircle2, DollarSign, Wrench, ShoppingBag, CreditCard,
  TrendingUp, Printer, X, ChevronDown,
  ChevronUp, Clock, Package, Edit3
} from 'lucide-react';
import { useEndOfDayStore } from '../../store/endOfDayStore';
import { usePrivacyStore } from '../../store/privacyStore';
import type { EndOfDayRecord } from '../../services/endOfDayService';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { PrivacyCurtainButton } from '../../components/layout/PrivacyCurtainButton';
import styles from './EndOfDayModal.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** If set, we're viewing a historical record; if null we're doing a live close */
  viewRecord?: EndOfDayRecord | null;
}

export const EndOfDayModal: React.FC<Props> = ({ isOpen, onClose, viewRecord }) => {
  const isPrivacyActive = usePrivacyStore((s) => s.isPrivacyActive);
  const { buildPreview, closeDay, todayRecord, isSaving, updateNotes } = useEndOfDayStore();

  const [preview, setPreview] = useState<Omit<EndOfDayRecord, 'id'> | null>(null);
  const [notes, setNotes]     = useState('');
  const [done, setDone]       = useState(false);
  const [saved, setSaved]     = useState<EndOfDayRecord | null>(null);
  const [expandSales, setExpandSales]   = useState(true);
  const [expandRepairs, setExpandRepairs] = useState(true);
  const [editingNotes, setEditingNotes] = useState(false);

  const alreadyClosed = !!todayRecord;

  // Build live preview when modal opens in "close" mode
  useEffect(() => {
    if (!isOpen) { setDone(false); setSaved(null); return; }
    if (viewRecord) {
      setPreview(viewRecord);
      setNotes(viewRecord.notes || '');
    } else if (!alreadyClosed) {
      setPreview(buildPreview());
      setNotes('');
    } else {
      setPreview(todayRecord);
      setNotes(todayRecord?.notes || '');
    }
  }, [isOpen, viewRecord]);

  if (!isOpen) return null;

  const data = viewRecord ?? saved ?? preview;
  const isReadOnly = !!(viewRecord || alreadyClosed || done);

  const handleClose = async () => {
    const record = await closeDay(false, notes);
    setSaved(record);
    setPreview(record);
    setDone(true);
  };

  const handlePrint = () => window.print();

  const handleSaveNotes = async () => {
    const id = (viewRecord ?? todayRecord ?? saved)?.id;
    if (!id || !notes) return;
    await updateNotes(id, notes);
    setEditingNotes(false);
  };

  if (!data) return null;

  const SectionHeader = ({
    title, icon, expanded, onToggle, accent
  }: { title: string; icon: React.ReactNode; expanded: boolean; onToggle: () => void; accent?: string }) => (
    <button
      type="button"
      className={styles.sectionHeader}
      onClick={onToggle}
      style={accent ? { borderLeftColor: accent } : {}}
    >
      <span className={styles.sectionHeaderLeft}>{icon}{title}</span>
      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  const Row = ({ label, value, bold, highlight, small }: {
    label: string; value: string; bold?: boolean; highlight?: 'green' | 'red' | 'blue'; small?: boolean;
  }) => (
    <div className={[styles.row, small && styles.rowSmall].filter(Boolean).join(' ')}>
      <span className={styles.rowLabel}>{label}</span>
      <span
        className={styles.rowValue}
        style={{
          fontWeight: bold ? 700 : undefined,
          color: highlight === 'green' ? '#16a34a' : highlight === 'red' ? '#dc2626' : highlight === 'blue' ? '#2563eb' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal} id="eod-print-area">

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.moonIcon}>
              {done || alreadyClosed || viewRecord ? <CheckCircle2 size={24} /> : <Moon size={24} />}
            </div>
            <div>
              <h2 className={styles.title}>
                {viewRecord ? `EOD Report — ${viewRecord.date}` : done || alreadyClosed ? 'Day Closed ✓' : 'End of Day Close'}
              </h2>
              <p className={styles.subtitle}>
                {viewRecord
                  ? `Closed ${viewRecord.isAutoClose ? 'automatically' : 'manually'} by ${viewRecord.closedByName}`
                  : done || alreadyClosed
                  ? `Closed at ${new Date(data.closedAt).toLocaleTimeString()} by ${data.closedByName}`
                  : `Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
                }
              </p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <PrivacyCurtainButton variant="icon" />
            <button type="button" className={styles.printBtn} onClick={handlePrint} title="Print Report">
              <Printer size={15} /> Print
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Already-closed banner */}
        {alreadyClosed && !viewRecord && (
          <div className={styles.alreadyClosedBanner}>
            <CheckCircle2 size={16} />
            <span>Today's day was already closed at {new Date(todayRecord!.closedAt).toLocaleTimeString()}. Showing read-only summary.</span>
          </div>
        )}

        <div className={styles.body}>

          {/* Grand Total Hero */}
          <div className={styles.heroGrid}>
            <div className={styles.heroCard}>
              <DollarSign size={20} className={styles.heroIcon} />
              <span className={styles.heroLabel}>Total Revenue</span>
              <span className={styles.heroValue}>{formatPrivateCurrency(data.totalRevenue)}</span>
            </div>
            <div className={[styles.heroCard, styles.heroCardGreen].join(' ')}>
              <TrendingUp size={20} className={styles.heroIcon} />
              <span className={styles.heroLabel}>Net Profit</span>
              <span className={styles.heroValue}>{formatPrivateCurrency(data.totalNetProfit)}</span>
            </div>
            <div className={[styles.heroCard, styles.heroCardBlue].join(' ')}>
              <CreditCard size={20} className={styles.heroIcon} />
              <span className={styles.heroLabel}>Cash in Drawer</span>
              <span className={styles.heroValue}>{formatPrivateCurrency(data.totalCash)}</span>
            </div>
          </div>

          {/* Payment Breakdown Banner */}
          <div className={styles.paymentRow}>
            <div className={styles.paymentItem}>
              <span>💵 Cash</span>
              <strong>{formatPrivateCurrency(data.totalCash)}</strong>
            </div>
            <div className={styles.paymentItem}>
              <span>💳 Card</span>
              <strong>{formatPrivateCurrency(data.totalCard)}</strong>
            </div>
            <div className={styles.paymentItem}>
              <span>📱 Mobile</span>
              <strong>{formatPrivateCurrency(data.totalMobile)}</strong>
            </div>
            {data.salesDebt > 0 && (
              <div className={[styles.paymentItem, styles.paymentItemDebt].join(' ')}>
                <span>⚠️ On Credit</span>
                <strong>{formatPrivateCurrency(data.salesDebt + data.repairsDebt)}</strong>
              </div>
            )}
          </div>

          {/* Sales Section */}
          <SectionHeader
            title={`Sales (${data.salesCount} transactions)`}
            icon={<ShoppingBag size={15} />}
            expanded={expandSales}
            onToggle={() => setExpandSales(v => !v)}
            accent="#4f46e5"
          />
          {expandSales && (
            <div className={styles.section}>
              <Row label="Gross Revenue"      value={formatPrivateCurrency(data.salesTotalRevenue)} bold />
              <Row label="Cost of Goods"      value={`- ${formatPrivateCurrency(data.salesCogs)}`} highlight="red" small />
              <Row label="Net Profit (Sales)" value={formatPrivateCurrency(data.salesNetProfit)} bold highlight="green" />
              <div className={styles.divider} />
              <Row label="💵 Cash Sales"   value={formatPrivateCurrency(data.salesCash)} small />
              <Row label="💳 Card Sales"   value={formatPrivateCurrency(data.salesCard)} small />
              <Row label="📱 Mobile Pay"   value={formatPrivateCurrency(data.salesMobile)} small />
              {data.salesDebt > 0 && <Row label="⚠️ Charged to Account" value={formatPrivateCurrency(data.salesDebt)} small highlight="red" />}
            </div>
          )}

          {/* Repairs Section */}
          <SectionHeader
            title={`Repairs (${data.repairsCompleted} completed)`}
            icon={<Wrench size={15} />}
            expanded={expandRepairs}
            onToggle={() => setExpandRepairs(v => !v)}
            accent="#d97706"
          />
          {expandRepairs && (
            <div className={styles.section}>
              <Row label="Repair Revenue"      value={formatPrivateCurrency(data.repairsTotalRevenue)} bold />
              <Row label="Parts Cost"          value={`- ${formatPrivateCurrency(data.repairsPartsCost)}`} highlight="red" small />
              <Row label="Net Profit (Repairs)" value={formatPrivateCurrency(data.repairsNetProfit)} bold highlight="green" />
              <div className={styles.divider} />
              <Row label="💵 Total Repair Cash" value={formatPrivateCurrency(data.repairsCash)} bold small />
              {Boolean(data.repairHandoversCash && data.repairHandoversCash > 0) && (
                <Row label="↳ Handover Settlements" value={formatPrivateCurrency(data.repairHandoversCash!)} small />
              )}
              {Boolean(data.repairDepositsCash && data.repairDepositsCash > 0) && (
                <Row label="↳ Intake Deposits" value={formatPrivateCurrency(data.repairDepositsCash!)} small />
              )}
              {data.repairsDebt > 0 && <Row label="⚠️ Unpaid / Debt" value={formatPrivateCurrency(data.repairsDebt)} small highlight="red" />}
            </div>
          )}

          {/* Debt Collections Recovered */}
          {Boolean(data.debtCollectedCash && data.debtCollectedCash > 0) && (
            <>
              <div className={styles.sectionHeader} style={{ cursor: 'default', borderLeftColor: '#10b981' }}>
                <span className={styles.sectionHeaderLeft}>
                  <DollarSign size={15} /> Customer Debt Recovered (Dette)
                </span>
              </div>
              <div className={styles.section}>
                <Row label="💵 Cash Debt Repayments" value={formatPrivateCurrency(data.debtCollectedCash!)} bold highlight="green" />
              </div>
            </>
          )}

          {/* Parts / B2B */}
          {data.partsSalesCount > 0 && (
            <>
              <div className={styles.sectionHeader} style={{ cursor: 'default', borderLeftColor: '#0891b2' }}>
                <span className={styles.sectionHeaderLeft}>
                  <Package size={15} /> Parts / B2B ({data.partsSalesCount} invoices)
                </span>
              </div>
              <div className={styles.section}>
                <Row label="B2B Parts Revenue" value={formatPrivateCurrency(data.partsSalesRevenue)} bold />
              </div>
            </>
          )}

          {/* Notes */}
          <div className={styles.notesSection}>
            <div className={styles.notesTitleRow}>
              <span className={styles.notesTitle}>📝 Notes / Remarks</span>
              {isReadOnly && (
                <button type="button" className={styles.editNotesBtn}
                  onClick={() => setEditingNotes(v => !v)}>
                  <Edit3 size={12} /> {editingNotes ? 'Cancel' : 'Edit'}
                </button>
              )}
            </div>
            {isReadOnly && !editingNotes ? (
              <p className={styles.notesReadOnly}>{notes || <em>No notes recorded.</em>}</p>
            ) : (
              <>
                <textarea
                  className={styles.notesArea}
                  placeholder="Optional: cash count differences, incidents, technician notes…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                />
                {editingNotes && (
                  <button type="button" className={styles.saveNotesBtn} onClick={handleSaveNotes}>
                    Save Notes
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {!isReadOnly ? (
            <>
              <button type="button" className={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.closeDay}
                onClick={handleClose}
                disabled={isSaving}
              >
                {isSaving ? (
                  <><Clock size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                ) : (
                  <><Moon size={15} /> Close Day & Lock Report</>
                )}
              </button>
            </>
          ) : (
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
