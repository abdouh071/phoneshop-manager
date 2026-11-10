import React, { useState, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Printer, Users, FileText } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { discountsGivenOf } from '../../utils/discountPolicy';
import { printZReportDirect, openZReportPrintWindow } from '../../utils/printWindow';
import { useToast } from '../../components/ui/Toast';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import { isSameLocalDate, toDateStr } from '../../store/endOfDayStore';
import { isClaimedAndPaidRepair } from '../../utils/repairFinancials';
import { computeDayFigures, mergeDayInvoices } from '../../utils/dayFigures';
import { isDebtPaymentCountedElsewhere } from '../../utils/debtPayments';
import { netUnitsSold } from '../../utils/saleEditLines';
import styles from './CashDrawer.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface CashDrawerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CashDrawerModal: React.FC<CashDrawerModalProps> = ({ isOpen, onClose }) => {
  const { transactions } = useCartStore();
  const { invoices: partsInvoices } = usePartsCartStore();
  const { tickets } = useRepairStore();
  const { debts } = useCustomerStore();
  const { storeName, currency } = useSettingsStore();
  const { user } = useAuthStore();
  const toast = useToast();

  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [customDate, setCustomDate] = useState<string>(() => toDateStr(new Date()));
  const [isPrinting, setIsPrinting] = useState(false);

  // Target Date calculation in local timezone
  const targetDateStr = useMemo(() => {
    if (dateFilter === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return toDateStr(d);
    }
    if (dateFilter === 'custom') {
      return customDate;
    }
    return toDateStr(new Date());
  }, [dateFilter, customDate]);

  // Combine POS transactions and Parts B2B invoices for the selected local date
  const shiftTransactions = useMemo(() => {
    const posTx = transactions || [];
    const partsTx = partsInvoices || [];
    const txMap = new Map<string, typeof posTx[0]>();
    posTx.forEach(t => txMap.set(t.id, t));
    partsTx.forEach(t => txMap.set(t.id, t));
    return Array.from(txMap.values()).filter(t => isSameLocalDate(t.date, targetDateStr));
  }, [transactions, partsInvoices, targetDateStr]);

  // Every money figure below is read off the one day-figures formula the End-of-Day
  // seal and the reports use, so the drawer card and the sealed day are the same money.
  // The counts and the staff breakdown are presentation-only and stay local.
  const stats = useMemo(() => {
    const figures = computeDayFigures(
      { transactions: mergeDayInvoices(transactions || [], partsInvoices || []), repairs: tickets, debts },
      targetDateStr
    );

    const isCancelledOrVoided = (t: typeof shiftTransactions[0]) =>
      t.status === 'voided' || t.status === 'cancelled' || t.status === 'pending_approval';
    const isRefunded = (t: typeof shiftTransactions[0]) => t.status === 'refunded';

    // Strictly active completed transactions (excludes refunded, cancelled, voided, pending_approval)
    const completed = shiftTransactions.filter(t => !isRefunded(t) && !isCancelledOrVoided(t));
    const refunded = shiftTransactions.filter(t => isRefunded(t));

    const grossSales = completed.reduce((sum, t) => sum + t.total, 0);
    const salesCount = completed.length;

    const refundsAmount = refunded.reduce((sum, t) => sum + t.total, 0);
    const refundsCount = refunded.length;

    const posRetailTxs = completed.filter(t => t.saleType !== 'parts_b2b');
    const partsB2BTxs = completed.filter(t => t.saleType === 'parts_b2b');

    // Cancelled / Voided transactions
    const cancelled = shiftTransactions.filter(t => isCancelledOrVoided(t));
    const cancelledCount = cancelled.length;
    const cancelledAmount = cancelled.reduce((sum, t) => sum + t.total, 0);

    const completedRepairs = tickets.filter(t =>
      t.status === 'completed' &&
      isSameLocalDate(t.completedAt || t.updatedAt, targetDateStr)
    );
    const claimedPaidRepairs = completedRepairs.filter(r => isClaimedAndPaidRepair(r));
    const createdRepairs = tickets.filter(t => isSameLocalDate(t.createdAt, targetDateStr));
    const todayDebtPayments = debts.flatMap(d => (d.payments || [])
      .filter(p => isSameLocalDate(p.date, targetDateStr) && !isDebtPaymentCountedElsewhere(d, p)));

    // Counts
    const posRetailCount = posRetailTxs.length;
    const partsB2BCount = partsB2BTxs.length;
    const repairHandoversCount = claimedPaidRepairs.length;
    const repairDepositsCount = createdRepairs.filter(t => (t.depositAmount || 0) > 0).length;
    const debtCollectionsCount = todayDebtPayments.filter(p => String(p.method || '').toLowerCase() === 'cash').length;

    // Net of what the day's corrections handed back, which is how the reports and the
    // sealed day count the same units.
    const unitsSold = completed.reduce((sum, t) => sum + netUnitsSold(t.items), 0);

    const discountsTotal = completed.reduce((sum, t) => sum + discountsGivenOf(t), 0);

    const avgTicket = salesCount > 0 ? Math.round(grossSales / salesCount) : 0;

    // Staff breakdown
    const staffMap = new Map<string, { count: number; total: number }>();
    completed.forEach(t => {
      const name = t.processedByName || 'Unassigned';
      const curr = staffMap.get(name) || { count: 0, total: 0 };
      staffMap.set(name, { count: curr.count + 1, total: curr.total + t.total });
    });

    const staffBreakdown = Array.from(staffMap.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      total: data.total,
    }));

    return {
      grossSales,
      salesCount,
      refundsAmount,
      refundsCount,
      cancelledCount,
      cancelledAmount,
      netCash: figures.totalCash,
      cashIn: figures.salesCash + figures.partsCash,
      posRetailCash: figures.salesCash,
      posRetailCount,
      partsB2BCash: figures.partsCash,
      partsB2BCount,
      repairsCashIn: figures.repairsCash,
      repairHandoversCash: figures.repairsHandoverCash,
      repairHandoversCount,
      repairDepositsCash: figures.repairsDepositCash,
      repairDepositsCount,
      debtCollectedCash: figures.debtCollectedCash,
      debtCollectedCard: figures.debtCollectedCard,
      debtCollectedMobile: figures.debtCollectedMobile,
      debtCollectionsCount,
      cardTotal: figures.totalCard,
      mobileTotal: figures.totalMobile,
      transferTotal: figures.salesTransfer + figures.partsTransfer + figures.repairsHandoverTransfer,
      debtTotal: figures.salesDebt + figures.partsDebt,
      creditTotal: figures.salesStoreCredit + figures.partsStoreCredit,
      unitsSold,
      discountsTotal,
      avgTicket,
      staffBreakdown,
    };
  }, [shiftTransactions, tickets, debts, targetDateStr, transactions, partsInvoices]);

  const formattedDateTitle = useMemo(() => {
    const d = new Date(targetDateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, [targetDateStr]);

  const handlePrintThermal = async () => {
    setIsPrinting(true);
    try {
      const result = await printZReportDirect(
        {
          date: formattedDateTitle,
          generatedBy: user?.name || 'Cashier',
          summary: stats,
        },
        storeName,
        currency
      );

      if (result.method === 'direct') {
        // A direct path carrying an error was refused by the server (for example,
        // the printer is offline). The report never printed — say so instead of
        // filing it as done.
        if (result.error) {
          toast.error('Print Failed', result.error);
          return;
        }
        toast.success('Z-Report Printed', 'End-of-Day report printed to thermal printer.');
      } else {
        toast.info('Browser Print Opened', 'Thermal server offline; opened print dialog.');
      }
    } catch (err: unknown) {
      toast.error('Print Failed', errorMessage(err) || 'Unable to print Z-Report.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrintBrowser = () => {
    openZReportPrintWindow(
      {
        date: formattedDateTitle,
        generatedBy: user?.name || 'Cashier',
        summary: stats,
      },
      storeName,
      currency
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Daily Cash Drawer & Z-Report"
      subtitle="Shift, cash reconciliation and end of day summary"
      size="lg"
    >
      <div className={styles.container}>
        {/* Date Filter Bar */}
        <div className={styles.filterBar}>
          <div className={styles.datePills}>
            <button
              type="button"
              className={[styles.datePill, dateFilter === 'today' && styles.datePillActive].filter(Boolean).join(' ')}
              onClick={() => setDateFilter('today')}
            >
              Today
            </button>
            <button
              type="button"
              className={[styles.datePill, dateFilter === 'yesterday' && styles.datePillActive].filter(Boolean).join(' ')}
              onClick={() => setDateFilter('yesterday')}
            >
              Yesterday
            </button>
            <button
              type="button"
              className={[styles.datePill, dateFilter === 'custom' && styles.datePillActive].filter(Boolean).join(' ')}
              onClick={() => setDateFilter('custom')}
            >
              Custom Date
            </button>

            {dateFilter === 'custom' && (
              <input
                type="date"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                className={styles.customDateInput}
              />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className={styles.shiftInfo}>
              <span>📅 {formattedDateTitle}</span>
            </div>
            <EndOfDayButton variant="compact" />
          </div>
        </div>

        {/* 4 Main KPI Cards */}
        <div className={styles.kpiGrid}>
          {/* 1. Gross Sales */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Total Sales</span>
              <span className={styles.kpiIcon}>📈</span>
            </div>
            <div className={styles.kpiValue}>{formatCurrency(stats.grossSales)}</div>
            <div className={styles.kpiSub}>{stats.salesCount} completed sale{stats.salesCount !== 1 ? 's' : ''}</div>
          </div>

          {/* 2. Cash Collected (POS + Repairs + Debts) */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Cash In</span>
              <span className={styles.kpiIcon}>💵</span>
            </div>
            <div className={styles.kpiValue}>{formatCurrency(stats.cashIn + stats.repairsCashIn + stats.debtCollectedCash)}</div>
            <div className={styles.kpiSub}>
              <span>POS: {formatCurrency(stats.cashIn)}</span>
              {stats.repairsCashIn > 0 && <span> • Rep: +{formatCurrency(stats.repairsCashIn)}</span>}
              {stats.debtCollectedCash > 0 && <span> • Debt: +{formatCurrency(stats.debtCollectedCash)}</span>}
            </div>
          </div>

          {/* 3. Refunds Given */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Refunds Given</span>
              <span className={styles.kpiIcon}>↩️</span>
            </div>
            <div className={[styles.kpiValue, styles.kpiValueRefund].join(' ')}>
              {stats.refundsAmount > 0 ? `-${formatCurrency(stats.refundsAmount)}` : formatCurrency(0)}
            </div>
            <div className={styles.kpiSub}>{stats.refundsCount} refund{stats.refundsCount !== 1 ? 's' : ''} (excluded from drawer)</div>
          </div>

          {/* 4. Net Cash in Drawer */}
          <div className={[styles.kpiCard, styles.kpiCardNet].join(' ')}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel} style={{ color: '#047857' }}>Net Cash in Drawer</span>
              <span className={styles.kpiIcon}>💰</span>
            </div>
            <div className={[styles.kpiValue, styles.kpiValueNet].join(' ')}>{formatCurrency(stats.netCash)}</div>
            <div className={styles.kpiSub} style={{ color: '#059669' }}>Real cash to count in till</div>
          </div>
        </div>

        {/* Secondary Stats Row */}
        <div className={styles.secondaryRow}>
          <div className={styles.secondaryItem}>
            <div className={styles.secondaryIcon}>📦</div>
            <div className={styles.secondaryMeta}>
              <span className={styles.secondaryLabel}>Units Sold</span>
              <span className={styles.secondaryValue}>{stats.unitsSold} items</span>
            </div>
          </div>

          <div className={styles.secondaryItem}>
            <div className={styles.secondaryIcon}>🏷️</div>
            <div className={styles.secondaryMeta}>
              <span className={styles.secondaryLabel}>Discounts Given</span>
              <span className={styles.secondaryValue}>{formatCurrency(stats.discountsTotal)}</span>
            </div>
          </div>

          <div className={styles.secondaryItem}>
            <div className={styles.secondaryIcon}>🧾</div>
            <div className={styles.secondaryMeta}>
              <span className={styles.secondaryLabel}>Average Ticket</span>
              <span className={styles.secondaryValue}>{formatCurrency(stats.avgTicket)}</span>
            </div>
          </div>
        </div>

        {/* Detailed Financial Panels: Inflow Reconciliation & Tender Breakdown */}
        <div className={styles.detailsGrid}>
          {/* Panel 1: Physical Cash Inflows (Till Reconciliation) */}
          <div className={styles.detailPanel}>
            <div className={styles.detailPanelHeader}>
              <div className={styles.detailPanelHeaderLeft}>
                <span>💵</span>
                <span>Physical Cash Inflows (Till)</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #64748b)' }}>Itemized</span>
            </div>

            <div className={styles.detailRows}>
              <div className={styles.detailRow}>
                <div className={styles.detailRowLeft}>
                  <span>🛒 Retail POS Cash</span>
                  <span className={styles.detailRowSub}>({stats.posRetailCount} sale{stats.posRetailCount !== 1 ? 's' : ''})</span>
                </div>
                <span className={styles.detailRowRight}>{formatCurrency(stats.posRetailCash)}</span>
              </div>

              {stats.partsB2BCash > 0 && (
                <div className={styles.detailRow}>
                  <div className={styles.detailRowLeft}>
                    <span>🔧 Parts B2B Wholesale</span>
                    <span className={styles.detailRowSub}>({stats.partsB2BCount} order{stats.partsB2BCount !== 1 ? 's' : ''})</span>
                  </div>
                  <span className={styles.detailRowRight}>{formatCurrency(stats.partsB2BCash)}</span>
                </div>
              )}

              <div className={styles.detailRow}>
                <div className={styles.detailRowLeft}>
                  <span>📱 Repair Handover Pickups</span>
                  <span className={styles.detailRowSub}>({stats.repairHandoversCount} device{stats.repairHandoversCount !== 1 ? 's' : ''})</span>
                </div>
                <span className={styles.detailRowRight}>{formatCurrency(stats.repairHandoversCash)}</span>
              </div>

              {stats.repairDepositsCash > 0 && (
                <div className={styles.detailRow}>
                  <div className={styles.detailRowLeft}>
                    <span>📥 Repair Intake Deposits</span>
                    <span className={styles.detailRowSub}>({stats.repairDepositsCount} deposit{stats.repairDepositsCount !== 1 ? 's' : ''})</span>
                  </div>
                  <span className={styles.detailRowRight}>{formatCurrency(stats.repairDepositsCash)}</span>
                </div>
              )}

              {stats.debtCollectedCash > 0 && (
                <div className={styles.detailRow}>
                  <div className={styles.detailRowLeft}>
                    <span>🤝 Customer Debt Repaid</span>
                    <span className={styles.detailRowSub}>({stats.debtCollectionsCount} payment{stats.debtCollectionsCount !== 1 ? 's' : ''})</span>
                  </div>
                  <span className={styles.detailRowRight}>{formatCurrency(stats.debtCollectedCash)}</span>
                </div>
              )}

              {stats.refundsCount > 0 && (
                <div className={styles.detailRow} style={{ color: '#dc2626' }}>
                  <div className={styles.detailRowLeft}>
                    <span>↩️ Refunds Given</span>
                    <span className={styles.detailRowSub}>({stats.refundsCount} excluded)</span>
                  </div>
                  <span className={styles.detailRowRight} style={{ color: '#dc2626' }}>-{formatCurrency(stats.refundsAmount)}</span>
                </div>
              )}

              {stats.cancelledCount > 0 && (
                <div className={styles.detailRow} style={{ color: '#64748b' }}>
                  <div className={styles.detailRowLeft}>
                    <span>🚫 Voided / Cancelled</span>
                    <span className={styles.detailRowSub}>({stats.cancelledCount} voided)</span>
                  </div>
                  <span className={styles.detailRowRight} style={{ color: '#64748b', textDecoration: 'line-through' }}>{formatCurrency(0)}</span>
                </div>
              )}
            </div>

            <div className={styles.detailDivider}></div>

            <div className={[styles.detailTotalRow, styles.detailTotalRowGreen].join(' ')}>
              <span>Net Physical Cash in Till</span>
              <span>{formatCurrency(stats.netCash)}</span>
            </div>
          </div>

          {/* Panel 2: All Payment Methods (Tender Breakdown) */}
          <div className={styles.detailPanel}>
            <div className={styles.detailPanelHeader}>
              <div className={styles.detailPanelHeaderLeft}>
                <span>💳</span>
                <span>All Payment Methods (Tender)</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #64748b)' }}>By Method</span>
            </div>

            <div className={styles.detailRows}>
              <div className={styles.detailRow}>
                <div className={styles.detailRowLeft}>
                  <span>💵 Cash Payments</span>
                </div>
                <span className={styles.detailRowRight}>{formatCurrency(stats.posRetailCash + stats.partsB2BCash)}</span>
              </div>

              <div className={styles.detailRow}>
                <div className={styles.detailRowLeft}>
                  <span>💳 Card / TPE Terminal</span>
                  {stats.debtCollectedCard > 0 && (
                    <span className={styles.detailRowSub}>
                      ({formatCurrency(stats.cardTotal)} sales + repairs + {formatCurrency(stats.debtCollectedCard)} debt)
                    </span>
                  )}
                </div>
                <span className={styles.detailRowRight}>{formatCurrency(stats.cardTotal + stats.debtCollectedCard)}</span>
              </div>

              <div className={styles.detailRow}>
                <div className={styles.detailRowLeft}>
                  <span>📱 Mobile / BaridiMob</span>
                  {stats.debtCollectedMobile > 0 && (
                    <span className={styles.detailRowSub}>
                      ({formatCurrency(stats.mobileTotal)} sales + repairs + {formatCurrency(stats.debtCollectedMobile)} debt)
                    </span>
                  )}
                </div>
                <span className={styles.detailRowRight}>{formatCurrency(stats.mobileTotal + stats.debtCollectedMobile)}</span>
              </div>

              {stats.transferTotal > 0 && (
                <div className={styles.detailRow}>
                  <div className={styles.detailRowLeft}>
                    <span>🏦 Bank Transfer</span>
                  </div>
                  <span className={styles.detailRowRight}>{formatCurrency(stats.transferTotal)}</span>
                </div>
              )}

              {stats.debtTotal > 0 && (
                <div className={styles.detailRow}>
                  <div className={styles.detailRowLeft}>
                    <span>📋 Charged to Debt Tab</span>
                  </div>
                  <span className={styles.detailRowRight}>{formatCurrency(stats.debtTotal)}</span>
                </div>
              )}

              {stats.creditTotal > 0 && (
                <div className={styles.detailRow}>
                  <div className={styles.detailRowLeft}>
                    <span>🎟️ Store Credit</span>
                  </div>
                  <span className={styles.detailRowRight}>{formatCurrency(stats.creditTotal)}</span>
                </div>
              )}
            </div>

            <div className={styles.detailDivider}></div>

            <div className={styles.detailTotalRow}>
              <span>Gross Sales Volume</span>
              <span>{formatCurrency(stats.grossSales)}</span>
            </div>
          </div>
        </div>

        {/* Staff / Cashier Breakdown */}
        {stats.staffBreakdown.length > 0 && (
          <div>
            <div className={styles.sectionTitle}>
              <Users size={15} />
              <span>Cashier / Staff Performance</span>
            </div>
            <div className={styles.staffGrid}>
              {stats.staffBreakdown.map((s, idx) => (
                <div key={idx} className={styles.staffCard}>
                  <div className={styles.staffNameCol}>
                    <span className={styles.staffName}>{s.name}</span>
                    <span className={styles.staffSalesCount}>{s.count} sale{s.count !== 1 ? 's' : ''}</span>
                  </div>
                  <span className={styles.staffTotal}>{formatCurrency(s.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Transactions in Shift */}
        <div>
          <div className={styles.sectionTitle}>
            <FileText size={15} />
            <span>Shift Transactions ({shiftTransactions.length})</span>
          </div>

          <div className={styles.txFeed}>
            {shiftTransactions.length === 0 ? (
              <div className={styles.emptyTransactions}>
                No transactions recorded for {formattedDateTitle}.
              </div>
            ) : (
              shiftTransactions.map(t => {
                const isRefunded = t.status === 'refunded';
                const isCancelled = t.status === 'voided' || t.status === 'cancelled' || t.status === 'pending_approval';
                const mainMethod = t.payments && t.payments[0]?.method ? t.payments[0].method.toLowerCase() : 'cash';
                let pillClass = styles.paymentPill;
                if (mainMethod === 'cash') pillClass = `${styles.paymentPill} ${styles.paymentPillCash}`;
                else if (mainMethod === 'card') pillClass = `${styles.paymentPill} ${styles.paymentPillCard}`;
                else if (mainMethod === 'debt') pillClass = `${styles.paymentPill} ${styles.paymentPillDebt}`;

                return (
                  <div key={t.id} className={styles.txFeedRow}>
                    <span className={styles.txFeedId}>
                      {new Date(t.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={styles.txFeedItems} title={t.items.map(i => `${i.isReturn ? '−' : ''}${i.quantity}x ${i.product.name}`).join(', ')}>
                      {t.items.slice(0, 2).map(i => `${i.isReturn ? '−' : ''}${i.quantity}× ${i.product.name} ${i.product.model || ''}`).join(', ')}
                      {t.items.length > 2 ? ` (+${t.items.length - 2} more)` : ''}
                    </span>
                    <span className={styles.txFeedCustomer}>
                      {t.customerName || 'Walk-in'}
                      {isRefunded && <span style={{ marginLeft: '6px', fontSize: '10px', background: '#fee2e2', color: '#b91c1c', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>REFUNDED</span>}
                      {isCancelled && <span style={{ marginLeft: '6px', fontSize: '10px', background: '#f1f5f9', color: '#64748b', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>VOIDED</span>}
                    </span>
                    <span className={pillClass}>
                      {mainMethod === 'cash' ? '💵 Cash' : mainMethod === 'card' ? '💳 Card' : mainMethod === 'debt' ? '📋 Debt' : mainMethod.toUpperCase()}
                    </span>
                    <span className={[
                      styles.txFeedAmount,
                      isRefunded && styles.txFeedRefunded,
                      isCancelled && styles.txFeedCancelled
                    ].filter(Boolean).join(' ')}>
                      {isRefunded ? `-${formatCurrency(t.total)}` : isCancelled ? formatCurrency(0) : formatCurrency(t.total)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer with End of Day Declare & Print Buttons */}
        <div className={styles.footer}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <EndOfDayButton variant="button" />
          </div>

          <div className={styles.printBtns}>
            <button
              type="button"
              className={styles.printBrowserBtn}
              onClick={handlePrintBrowser}
              title="Open Browser Print Dialog"
            >
              <FileText size={14} />
              <span>Preview / PDF</span>
            </button>

            <button
              type="button"
              className={styles.printThermalBtn}
              onClick={handlePrintThermal}
              disabled={isPrinting}
              title="Print directly to 80mm POS Thermal Printer"
            >
              <Printer size={15} />
              <span>{isPrinting ? 'Printing...' : 'Print Z-Report (Thermal)'}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
