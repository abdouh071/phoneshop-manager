import React, { useState, useEffect, useRef } from 'react';
import { SearchInput } from '../../components/ui/Input';
import { Printer, FileEdit, RotateCcw } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { RefundModal } from './RefundModal';
import { ReceiptModal } from './ReceiptModal';

import { EditTransactionModal } from './EditTransactionModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import type { SaleTransaction } from '../../types';
import s from './TransactionHistory.module.css';
import { formatCurrency } from '../../utils/formatCurrency';
import { usePermissions } from '../../hooks/usePermissions';

type UnlockPurpose = 'refund' | 'edit';

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
    const match = transactions.find(t =>
      t.id === initialFocusId ||
      t.id.toLowerCase().includes(initialFocusId.toLowerCase())
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

  const filtered = transactions.filter(t => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const matchesId = t.id.toLowerCase().includes(q) || (t.invoiceNumber || '').toLowerCase().includes(q);
    const matchesCustomer = (t.customerName || '').toLowerCase().includes(q) || (t.shopName || '').toLowerCase().includes(q);
    const matchesArticle = t.items.some(item =>
      (item.product.name + ' ' + item.product.model + ' ' + (item.product.sku || '')).toLowerCase().includes(q)
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
                t.id.toLowerCase().includes(initialSearch.toLowerCase()) ||
                (t.customerName || '').toLowerCase().includes(initialSearch.toLowerCase()) ||
                (t.invoiceNumber || '').toLowerCase().includes(initialSearch.toLowerCase())
              );
              const isRefunded = t.status === 'refunded';
              const isPartial = t.status === 'partially_refunded';


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
                    {t.items.slice(0, 2).map((item, idx) => (
                      <span key={idx} className={s.txArticleChip}>
                        <span className={s.txArticleQty}>{item.quantity}×</span>
                        <span className={s.txArticleName}>{item.product.name} {item.product.model}</span>
                      </span>
                    ))}
                    {t.items.length > 2 && (
                      <span className={s.txMoreChip}>+{t.items.length - 2} more</span>
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
                        {t.items.reduce((acc, i) => acc + i.quantity, 0)} item{t.items.reduce((a, i) => a + i.quantity, 0) !== 1 ? 's' : ''}
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
