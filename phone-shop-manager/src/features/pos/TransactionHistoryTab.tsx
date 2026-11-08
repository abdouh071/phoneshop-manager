import React, { useState, useEffect, useRef } from 'react';
import { SearchInput } from '../../components/ui/Input';
import { Printer, FileEdit, RotateCcw } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { RefundModal } from './RefundModal';
import { ReceiptModal } from './ReceiptModal';

import { EditTransactionModal } from './EditTransactionModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import type { CartItem, SaleTransaction } from '../../types';
import s from './TransactionHistory.module.css';
import { formatCurrency } from '../../utils/formatCurrency';
import { isReturnLine, returnedUnits, soldUnits } from '../../utils/saleEditLines';
import { normalizeArabic } from '../../utils/normalizeText';
import { usePermissions } from '../../hooks/usePermissions';

type UnlockPurpose = 'refund' | 'edit';

/**
 * One line of a receipt, as the history draws it. A unit the shop took back is a line
 * of its own on the document, so it gets a chip of its own here — with the minus the
 * reprint shows, and not the plain quantity of a purchase.
 */
const ArticleChip: React.FC<{ item: CartItem }> = ({ item }) => {
  const returned = isReturnLine(item);
  return (
    <span
      className={s.txArticleChip}
      title={returned ? 'Handed back — this amount comes off the invoice' : undefined}
      style={returned ? { background: 'var(--color-error-container, #fee2e2)' } : undefined}
    >
      <span
        className={s.txArticleQty}
        style={returned ? { color: 'var(--color-danger-text, #b91c1c)' } : undefined}
      >
        {returned ? '−' : ''}
        {Math.trunc(Number(item.quantity) || 0)}×
      </span>
      <span className={s.txArticleName}>
        {item.product?.name} {item.product?.model}
      </span>
    </span>
  );
};

export const TransactionHistoryTab: React.FC<{ initialSearch?: string; initialFocusId?: string }> = ({ initialSearch = '', initialFocusId = '' }) => {
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [txToRefund, setTxToRefund] = useState<SaleTransaction | null>(null);
  const [txToView, setTxToView] = useState<SaleTransaction | null>(null);
  const [txToEdit, setTxToEdit] = useState<SaleTransaction | null>(null);
  const [txRequiringUnlock, setTxRequiringUnlock] = useState<{ tx: SaleTransaction; purpose: UnlockPurpose } | null>(null);
  const [txToPrint, setTxToPrint] = useState<SaleTransaction | null>(null);
  const { transactions } = useCartStore();
  const { user } = useAuthStore();
  usePermissions();

  useEffect(() => {
    if (initialSearch) setSearchQuery(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    if (!initialFocusId || transactions.length === 0) return;
    const focus = normalizeArabic(initialFocusId);
    const match = transactions.find(t =>
      t.id === initialFocusId ||
      normalizeArabic(t.id).includes(focus)
    );
    if (match) {
      const timer = setTimeout(() => setTxToView(match), 400);
      return () => clearTimeout(timer);
    }
  }, [initialFocusId, transactions]);

  useEffect(() => {
    if (highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);


  const canEditDirectly = (t: SaleTransaction) => {
    if (t.status === 'refunded') return false;
    // Problem 1 fix: Only admin can directly edit or refund transactions.
    // Non-admins must enter admin password via AdminUnlockModal every time.
    return user?.role === 'admin';
  };

  const handleRefundClick = (t: SaleTransaction) => {
    if (t.status === 'refunded') return;
    if (canEditDirectly(t)) {
      setTxToRefund(t);
    } else {
      setTxRequiringUnlock({ tx: t, purpose: 'refund' });
    }
  };

  const handleEditClick = (t: SaleTransaction) => {
    if (t.status === 'refunded') return;
    if (canEditDirectly(t)) {
      setTxToEdit(t);
    } else {
      setTxRequiringUnlock({ tx: t, purpose: 'edit' });
    }
  };

  const handleUnlockSuccess = () => {
    if (!txRequiringUnlock) return;
    const { tx, purpose } = txRequiringUnlock;
    setTxRequiringUnlock(null);
    if (purpose === 'refund') setTxToRefund(tx);
    else setTxToEdit(tx);
  };

  const searchNeedle = normalizeArabic(searchQuery);
  const highlightNeedle = normalizeArabic(initialSearch);
  const filtered = transactions.filter(t => {
    if (!searchNeedle) return true;
    const matchesId = normalizeArabic(t.id).includes(searchNeedle) || normalizeArabic(t.invoiceNumber).includes(searchNeedle);
    const matchesCustomer = normalizeArabic(t.customerName).includes(searchNeedle) || normalizeArabic(t.shopName).includes(searchNeedle);
    const matchesArticle = t.items.some(item =>
      normalizeArabic([item?.product?.name, item?.product?.model, item?.product?.sku].filter(Boolean).join(' ')).includes(searchNeedle)
    );
    return matchesId || matchesCustomer || matchesArticle;
  });

  const groupedByDay = filtered.reduce((groups, t) => {
    const day = new Date(t.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (!groups[day]) groups[day] = [];
    groups[day].push(t);
    return groups;
  }, {} as Record<string, SaleTransaction[]>);

  const sortedDays = Object.keys(groupedByDay).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <div className={s.wrapper}>
      {/* Controls */}
      <div className={s.controls}>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by ID, invoice, customer, or product…"
          style={{ flex: 1, minWidth: 220 }}
        />
        <span className={s.txCount}>
          {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Empty State */}
      {filtered.length === 0 && (
        <div className={s.emptyState}>
          <span className={s.emptyIcon}>🧾</span>
          <p className={s.emptyTitle}>
            {searchQuery ? 'No transactions match your search' : 'No transactions yet'}
          </p>
          <p className={s.emptySub}>
            {searchQuery ? 'Try a different keyword or clear the search.' : 'Sales you complete will appear here.'}
          </p>
        </div>
      )}

      {/* Day Groups → Cards */}
      {sortedDays.map(day => {
        const dayTxs = groupedByDay[day];
        const dayTotal = dayTxs.filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'pending_approval').reduce((s, t) => s + t.total, 0);
        return (
          <div key={day} className={s.dayGroup}>
            <div className={s.dayHeader}>
              <span className={s.dayLabel}>{day}</span>
              <div className={s.dayDivider} />
              <span className={s.daySummary}>{formatCurrency(dayTotal)} · {dayTxs.length} sale{dayTxs.length !== 1 ? 's' : ''}</span>
            </div>

            {dayTxs.map(t => {
              const isPastAndLocked = !canEditDirectly(t) && t.status !== 'refunded';
              const isHighlighted = !!initialSearch && (
                normalizeArabic(t.id).includes(highlightNeedle) ||
                normalizeArabic(t.customerName).includes(highlightNeedle) ||
                normalizeArabic(t.invoiceNumber).includes(highlightNeedle)
              );
              const isRefunded = t.status === 'refunded';
              const isPartial = t.status === 'partially_refunded';
              /** What came back is drawn after what was bought, and never hidden behind
               *  the "+N more" chip: on a corrected invoice it is the fact the counter
               *  is looking for. */
              const boughtLines = t.items.filter(item => !isReturnLine(item));
              const backLines = t.items.filter(isReturnLine);
              const backCount = returnedUnits(t.items);
              const keptUnits = soldUnits(t.items) - backCount;
              const hiddenLines =
                Math.max(0, boughtLines.length - 2) + Math.max(0, backLines.length - 2);


              return (
                <div
                  key={t.id}
                  ref={isHighlighted ? (el) => { if (el) highlightRef.current = el; } : undefined}
                  className={[
                    s.txCard,
                    isHighlighted && s.txCardHighlighted,
                    isRefunded && s.txCardRefunded,
                  ].filter(Boolean).join(' ')}
                  onClick={() => setTxToView(t)}
                  title="Click to view receipt"
                >
                  {/* Top: ID + Total */}
                  <div className={s.txTopRow}>
                    <div className={s.txIdBlock}>
                      <code className={s.txId}>#{t.invoiceNumber ? t.invoiceNumber : t.id.slice(-8).toUpperCase()}</code>
                      <span className={s.txTime}>
                        {new Date(t.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>

                    </div>
                    <div className={s.txTotalBlock}>
                      <span className={s.txTotal}>{formatCurrency(t.total)}</span>
                      <span className={s.txMethod}>
                        {t.payments.length > 0 ? t.payments.map(p => p.method).join(' + ') : 'Charged to Ledger'}
                      </span>
                    </div>
                  </div>

                  {/* Middle: Articles */}
                  <div className={s.txArticlesRow}>
                    {boughtLines.slice(0, 2).map((item, idx) => (
                      <ArticleChip key={`sold-${idx}`} item={item} />
                    ))}
                    {backLines.slice(0, 2).map((item, idx) => (
                      <ArticleChip key={`back-${idx}`} item={item} />
                    ))}
                    {hiddenLines > 0 && (
                      <span className={s.txMoreChip}>+{hiddenLines} more</span>
                    )}
                    {t.saleType === 'parts_b2b' && (
                      <span style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                        📦 Parts B2B
                      </span>
                    )}
                    {isRefunded && <span className={s.txRefundedBadge}>⚠️ Refunded</span>}
                    {isPartial && <span className={s.txPartialBadge}>↩ Partial Return</span>}
                    {t.status === 'voided' && <span style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>🚫 Voided</span>}
                    {t.status === 'pending_approval' && <span style={{ backgroundColor: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>⏳ Approval Pending</span>}
                  </div>

                  {/* Bottom: Meta + Actions */}
                  <div className={s.txBottomRow} onClick={e => e.stopPropagation()}>
                    <div className={s.txMeta}>
                      {(t.shopName || t.customerName) && (
                        <span className={s.txMetaPill}>
                          <span className={s.txMetaIcon}>👤</span>
                          {t.shopName || t.customerName}
                        </span>
                      )}
                      {t.processedByName && (
                        <span className={s.txMetaPill}>
                          <span className={s.txMetaIcon}>🧑‍💼</span>
                          {t.processedByName}
                        </span>
                      )}
                      {!t.customerName && !t.shopName && !t.processedByName && (
                        <span className={s.txMetaPill}>
                          <span className={s.txMetaIcon}>🚶</span>
                          Walk-in
                        </span>
                      )}
                      <span className={s.txMetaPill}>
                        <span className={s.txMetaIcon}>📦</span>
                        {keptUnits} item{keptUnits !== 1 ? 's' : ''}
                        {backCount > 0 && (
                          <span style={{ color: 'var(--color-danger-text, #b91c1c)', fontWeight: 700 }}>
                            {' '}· −{backCount} back
                          </span>
                        )}
                      </span>
                    </div>

                    <div className={s.txActions}>
                      <button
                        type="button"
                        className={s.txActionBtn}
                        onClick={() => setTxToPrint(t)}
                        title="Reprint Receipt"
                      >
                        <Printer size={14} />
                      </button>
                      <button
                        type="button"
                        className={s.txActionBtn}
                        onClick={() => handleEditClick(t)}
                        disabled={isRefunded}
                        title={
                          isRefunded
                            ? 'Already refunded'
                            : isPastAndLocked
                            ? 'Requires Admin Password'
                            : 'Edit / Return Items'
                        }
                      >
                        <FileEdit size={14} />
                        {isPastAndLocked && <span style={{ fontSize: 9, lineHeight: 1 }}>🔒</span>}
                      </button>
                      <button
                        type="button"
                        className={s.txRefundBtn}
                        onClick={() => handleRefundClick(t)}
                        disabled={isRefunded}
                        title={
                          isRefunded
                            ? 'Already refunded'
                            : isPastAndLocked
                            ? 'Requires Admin Password'
                            : 'Full Refund'
                        }
                      >
                        <RotateCcw size={13} /> Refund
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* View Modal */}
      <ReceiptModal transaction={txToView} onClose={() => setTxToView(null)} mode="reprint" />

      {/* Print Modal */}
      <ReceiptModal transaction={txToPrint} onClose={() => setTxToPrint(null)} mode="reprint" />

      <RefundModal isOpen={!!txToRefund} onClose={() => setTxToRefund(null)} transaction={txToRefund} />
      <EditTransactionModal isOpen={!!txToEdit} onClose={() => setTxToEdit(null)} transaction={txToEdit} />
      <AdminUnlockModal
        isOpen={!!txRequiringUnlock}
        onClose={() => setTxRequiringUnlock(null)}
        onSuccess={handleUnlockSuccess}
        actionName={txRequiringUnlock?.purpose === 'edit'
          ? `Edit past receipt #${txRequiringUnlock.tx.invoiceNumber || txRequiringUnlock.tx.id.slice(0, 8)}`
          : `Refund past transaction #${txRequiringUnlock?.tx.invoiceNumber || txRequiringUnlock?.tx.id.slice(0, 8)}`}
        actionType={txRequiringUnlock?.purpose === 'edit' ? 'pos_edit_receipt' : 'pos_refund_transaction'}
        targetId={txRequiringUnlock?.tx.id}
        actionData={txRequiringUnlock ? {
          itemType: 'transaction',
          invoiceNumber: txRequiringUnlock.tx.invoiceNumber || txRequiringUnlock.tx.id.slice(0, 8),
          total: txRequiringUnlock.tx.total,
          customerName: txRequiringUnlock.tx.customerName || 'Walk-in Customer',
          itemCount: txRequiringUnlock.tx.items?.length || 0,
        } : undefined}
      />
    </div>
  );
};
