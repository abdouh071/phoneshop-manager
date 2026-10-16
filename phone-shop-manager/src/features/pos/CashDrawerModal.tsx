import React, { useState, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Printer, Users, FileText } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { printZReportDirect, openZReportPrintWindow } from '../../utils/printWindow';
import { useToast } from '../../components/ui/Toast';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import { isSameLocalDate } from '../../store/endOfDayStore';
import { isClaimedAndPaidRepair, getClaimedRepairHandoverCash } from '../../utils/repairFinancials';
import styles from './CashDrawer.module.css';

interface CashDrawerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CashDrawerModal: React.FC<CashDrawerModalProps> = ({ isOpen, onClose }) => {
  const { transactions } = useCartStore();
  const { tickets } = useRepairStore();
  const { debts } = useCustomerStore();
  const { storeName, currency } = useSettingsStore();
  const { user } = useAuthStore();
  const toast = useToast();

  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [customDate, setCustomDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isPrinting, setIsPrinting] = useState(false);

  // Target Date calculation
  const targetDateStr = useMemo(() => {
    const d = new Date();
    if (dateFilter === 'yesterday') {
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    }
    if (dateFilter === 'custom') {
      return customDate;
    }
    return d.toISOString().split('T')[0];
  }, [dateFilter, customDate]);

  // Filter transactions for the selected date
  const shiftTransactions = useMemo(() => {
    return transactions.filter(t => {
      return isSameLocalDate(t.date, targetDateStr);
    });
  }, [transactions, targetDateStr]);

  // Calculations for real exact cash & income
  const stats = useMemo(() => {
    const completed = shiftTransactions.filter(t => t.status !== 'refunded');
    const refunded = shiftTransactions.filter(t => t.status === 'refunded');

    const grossSales = completed.reduce((sum, t) => sum + t.total, 0);
    const salesCount = completed.length;

    const refundsAmount = refunded.reduce((sum, t) => sum + t.total, 0);
    const refundsCount = refunded.length;

    // 1. Direct POS Cash
    const cashIn = completed.reduce((sum, t) => {
      const cashPayments = (t.payments || [])
        .filter(p => p.method === 'cash')
        .reduce((s, p) => s + p.amount, 0);
      return sum + cashPayments;
    }, 0);

    // Non-cash breakdown
    const debtTotal = completed.reduce((sum, t) => {
      return sum + (t.payments || []).filter(p => p.method === 'debt').reduce((s, p) => s + p.amount, 0);
    }, 0);
    const creditTotal = completed.reduce((sum, t) => {
      return sum + (t.payments || []).filter(p => p.method === 'store_credit').reduce((s, p) => s + p.amount, 0);
    }, 0);

    // 2. Repairs Cash (intake deposits + handover completions)
    // Handovers only counted for claimed+paid phones; pure-debt completions excluded
    const completedRepairs = tickets.filter(t =>
      t.status === 'completed' &&
      isSameLocalDate(t.completedAt || t.updatedAt, targetDateStr)
    );
    const claimedPaidRepairs = completedRepairs.filter(r => isClaimedAndPaidRepair(r));
    const repairHandoversCash = claimedPaidRepairs.reduce((s, r) => {
      return s + getClaimedRepairHandoverCash(r);
    }, 0);

    const createdRepairs = tickets.filter(t => isSameLocalDate(t.createdAt, targetDateStr));
    const repairDepositsCash = createdRepairs.reduce((s, t) => s + (t.depositAmount || 0), 0);
    const repairsCashIn = repairHandoversCash + repairDepositsCash;

    // 3. Customer Debt Tab Collections Cash
    const todayDebtPayments = debts.flatMap(d => (d.payments || []).filter(p => isSameLocalDate(p.date, targetDateStr)));
    const debtCollectedCash = todayDebtPayments
      .filter(p => p.method === 'cash')
      .reduce((s, p) => s + p.amount, 0);

    // 4. Exact Physical Cash in Drawer
    const netCash = Math.max(0, (cashIn + repairsCashIn + debtCollectedCash) - refundsAmount);

    const unitsSold = completed.reduce((sum, t) => {
      return sum + t.items
        .filter(i => !i.isReturn)
        .reduce((s, i) => s + i.quantity, 0);
    }, 0);

    const discountsTotal = completed.reduce((sum, t) => {
      if (!t.discount) return sum;
      if (t.discount.type === 'percent') {
        return sum + t.subtotal * (t.discount.value / 100);
      }
      return sum + Math.min(t.discount.value, t.subtotal);
    }, 0);

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
      netCash,
      cashIn,
      repairsCashIn,
      debtCollectedCash,
      debtTotal,
      creditTotal,
      unitsSold,
      discountsTotal,
      avgTicket,
      staffBreakdown,
    };
  }, [shiftTransactions, tickets, debts, targetDateStr]);

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
        toast.success('Z-Report Printed', 'End-of-Day report printed to thermal printer.');
      } else {
        toast.info('Browser Print Opened', 'Thermal server offline; opened print dialog.');
      }
    } catch (err: any) {
      toast.error('Print Failed', err?.message || 'Unable to print Z-Report.');
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
            <div className={styles.kpiSub}>{stats.refundsCount} refund{stats.refundsCount !== 1 ? 's' : ''} processed</div>
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
              shiftTransactions.map(t => (
                <div key={t.id} className={styles.txFeedRow}>
                  <span className={styles.txFeedId}>
                    {new Date(t.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={styles.txFeedItems} title={t.items.map(i => `${i.quantity}x ${i.product.name}`).join(', ')}>
                    {t.items.slice(0, 2).map(i => `${i.quantity}× ${i.product.name} ${i.product.model}`).join(', ')}
                    {t.items.length > 2 ? ` (+${t.items.length - 2} more)` : ''}
                  </span>
                  <span className={styles.txFeedCustomer}>
                    {t.customerName || 'Walk-in'}
                  </span>
                  <span className={[styles.txFeedAmount, t.status === 'refunded' && styles.txFeedRefunded].filter(Boolean).join(' ')}>
                    {t.status === 'refunded' ? `-${formatCurrency(t.total)}` : formatCurrency(t.total)}
                  </span>
                </div>
              ))
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
