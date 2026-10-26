import React, { useState, useMemo } from 'react';
import {
  Printer, Send, Download, FileText, Calendar, Store, User,
  CheckCircle2, AlertCircle, ArrowUpRight, DollarSign, X, ShieldCheck
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCartStore } from '../../store/cartStore';
import { useCustomerStore } from '../../store/customerStore';
import { useRepairStore } from '../../store/repairStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { exportToCSV } from '../../utils/exportUtils';
import type { Customer, SaleTransaction, CustomerDebtEntry } from '../../types';
import styles from './AccountStatement.module.css';

interface AccountStatementModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
}

type DatePreset = 'this_month' | 'last_month' | 'last_30_days' | 'this_year' | 'all' | 'custom';

export interface LedgerEvent {
  id: string;
  date: string;
  type: 'invoice' | 'debt_tab' | 'payment' | 'refund' | 'repair';
  refNumber: string;
  description: string;
  debit: number;      // Total Amount Billed / Invoiced (+)
  credit: number;     // Total Amount Paid / Credited (-)
  netChange: number;  // debit - credit
  method?: string;
  rawTimestamp: number;
}

const formatDateStr = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const normalizePhone = (p?: string) => (p ? p.replace(/\D/g, '') : '');

export const AccountStatementModal: React.FC<AccountStatementModalProps> = ({
  customer,
  isOpen,
  onClose,
}) => {
  const { transactions } = useCartStore();
  const { getCustomerDebts, getCustomerDebtTotal } = useCustomerStore();
  const { tickets } = useRepairStore();
  const settings = useSettingsStore();
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);

  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Determine active start/end Date objects
  const { startDate, endDate, dateRangeLabel } = useMemo(() => {
    const now = new Date();
    let start: Date | null = null;
    let end: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let label = '';

    if (datePreset === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      label = `This Month (${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`;
    } else if (datePreset === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      label = `Last Month (${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`;
    } else if (datePreset === 'last_30_days') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      label = `Last 30 Days (${formatDateStr(start.toISOString())} - ${formatDateStr(end.toISOString())})`;
    } else if (datePreset === 'this_year') {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      label = `This Year (${now.getFullYear()})`;
    } else if (datePreset === 'all') {
      start = null;
      label = 'All Time History';
    } else if (datePreset === 'custom') {
      start = customStart ? new Date(`${customStart}T00:00:00`) : null;
      end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : end;
      label = `Custom Period (${customStart || 'Start'} to ${customEnd || 'Present'})`;
    }

    return { startDate: start, endDate: end, dateRangeLabel: label };
  }, [datePreset, customStart, customEnd]);

  // Compile Unified, Deduplicated Ledger Events
  const allEvents = useMemo(() => {
    if (!customer) return [];

    const custNameLower = customer.name.toLowerCase().trim();
    const custShopLower = (customer.shopName || '').toLowerCase().trim();
    const custPhone = normalizePhone(customer.phone);

    // 1. Transactions (Retail POS or B2B Parts Invoices)
    const custTxs = transactions.filter(tx => {
      if (tx.customerId && tx.customerId === customer.id) return true;
      if (custPhone && tx.customerPhone && normalizePhone(tx.customerPhone) === custPhone) return true;
      if (custShopLower && tx.shopName && tx.shopName.toLowerCase().trim() === custShopLower) return true;
      return (tx.customerName || '').toLowerCase().trim() === custNameLower;
    });

    // 2. Debts
    const custDebts = getCustomerDebts(customer.id);
    const linkedDebtIds = new Set<string>();

    // Map any debt that was created directly from a transaction
    custTxs.forEach(tx => {
      if (tx.accountSettlement?.debtEntryId) {
        linkedDebtIds.add(tx.accountSettlement.debtEntryId);
      }
    });

    // Also match debts whose invoiceNumber or notes match a transaction
    custDebts.forEach(debt => {
      if (debt.invoiceNumber) {
        const matchingTx = custTxs.find(tx => tx.invoiceNumber === debt.invoiceNumber);
        if (matchingTx) linkedDebtIds.add(debt.id);
      }
      if (debt.notes) {
        const matchingTx = custTxs.find(tx => debt.notes?.includes(tx.id) || (tx.invoiceNumber && debt.notes?.includes(tx.invoiceNumber)));
        if (matchingTx) linkedDebtIds.add(debt.id);
      }
    });

    // 3. Repair Tickets (Problem 10 fix: Include repair revenue and intake deposits)
    const custTickets = tickets.filter(t => {
      if (t.customerId && t.customerId === customer.id) return true;
      if (custPhone && t.customerPhone && normalizePhone(t.customerPhone) === custPhone) return true;
      return (t.customerName || '').toLowerCase().trim() === custNameLower;
    });

    custTickets.forEach(t => {
      if (t.debtEntryId) linkedDebtIds.add(t.debtEntryId);
    });

    custDebts.forEach(debt => {
      if (debt.type === 'repair' || (debt.productOrService && debt.productOrService.toLowerCase().includes('repair'))) {
        const matchingTicket = custTickets.find(t =>
          (t.ticketNumber && debt.productOrService.includes(t.ticketNumber)) ||
          (debt.notes && t.ticketNumber && debt.notes.includes(t.ticketNumber)) ||
          (t.debtEntryId && t.debtEntryId === debt.id)
        );
        if (matchingTicket) linkedDebtIds.add(debt.id);
      }
    });

    const events: LedgerEvent[] = [];

    // Process all Transactions
    custTxs.forEach(tx => {
      const isB2B = tx.saleType === 'parts_b2b' || Boolean(tx.invoiceNumber);
      const refNumber = tx.invoiceNumber || `TX-${tx.id.slice(0, 8)}`;
      const itemsDesc = tx.items.map(i => `${i.quantity}× ${i.product.name} ${i.product.model}`).join(', ');

      const totalBilled = tx.total;

      // Determine upfront payment made at the time of purchase
      let paidUpfront = 0;
      if (tx.status === 'refunded') {
        paidUpfront = 0;
      } else if (tx.accountSettlement) {
        paidUpfront = tx.accountSettlement.paidAmount || 0;
      } else if (tx.payments && tx.payments.length > 0) {
        // Retail POS sale: sum of all non-debt payment methods (cash, card, transfer)
        paidUpfront = tx.payments
          .filter(p => p.method !== 'debt')
          .reduce((sum, p) => sum + p.amount, 0);
      } else {
        paidUpfront = tx.total;
      }

      const chargedAmount = Math.max(0, totalBilled - paidUpfront);
      const paymentMethodsStr = tx.payments?.map(p => p.method.toUpperCase()).join('+') || 'CASH';

      let description = '';
      if (isB2B) {
        if (chargedAmount === 0) {
          description = `Parts Commercial Invoice (${itemsDesc}) — Paid Full via ${paymentMethodsStr}`;
        } else if (paidUpfront === 0) {
          description = `Parts Commercial Invoice (${itemsDesc}) — 100% Charged to Account`;
        } else {
          description = `Parts Commercial Invoice (${itemsDesc}) — Paid ${formatCurrency(paidUpfront)} via ${paymentMethodsStr}, ${formatCurrency(chargedAmount)} on Credit Tab`;
        }
      } else {
        if (chargedAmount === 0) {
          description = `POS Sale (${itemsDesc}) — Paid Full via ${paymentMethodsStr}`;
        } else {
          description = `POS Sale (${itemsDesc}) — Paid ${formatCurrency(paidUpfront)}, ${formatCurrency(chargedAmount)} on Credit Tab`;
        }
      }

      events.push({
        id: `tx_${tx.id}`,
        date: tx.date,
        type: 'invoice',
        refNumber,
        description,
        debit: totalBilled,
        credit: paidUpfront,
        netChange: totalBilled - paidUpfront,
        rawTimestamp: new Date(tx.date).getTime(),
      });

      // Handle Refunds
      if (tx.status === 'refunded') {
        events.push({
          id: `refund_${tx.id}`,
          date: tx.date,
          type: 'refund',
          refNumber: `REF-${refNumber}`,
          description: `Full Refund Credit for Order #${refNumber} (${itemsDesc})`,
          debit: 0,
          credit: totalBilled,
          netChange: -totalBilled,
          rawTimestamp: new Date(tx.date).getTime() + 1, // slightly after sale
        });
      }
    });

    // Process Debts & Payment Settlements
    custDebts.forEach(debt => {
      const isLinked = linkedDebtIds.has(debt.id);

      // Compute total of subsequent payments recorded on this debt
      const subsequentPayments = debt.payments || [];
      const subsequentPaymentsTotal = subsequentPayments.reduce((sum, p) => sum + p.amount, 0);

      // If NOT linked to a transaction, this is a standalone debt (e.g. manual tab or initial balance)
      if (!isLinked) {
        // Initial down payment made at debt creation
        const initialDownPayment = Math.max(0, (debt.amountPaid || 0) - subsequentPaymentsTotal);

        events.push({
          id: `debt_open_${debt.id}`,
          date: debt.date || debt.createdAt,
          type: 'debt_tab',
          refNumber: debt.invoiceNumber || `TAB-${debt.id.slice(0, 6)}`,
          description: `Credit Tab / Debt Entry: ${debt.productOrService}${debt.dueDate ? ` (Due: ${debt.dueDate.slice(0, 10)})` : ''}${initialDownPayment > 0 ? ` (Down payment: ${formatCurrency(initialDownPayment)})` : ''}`,
          debit: debt.totalAmount,
          credit: initialDownPayment,
          netChange: debt.totalAmount - initialDownPayment,
          rawTimestamp: new Date(debt.date || debt.createdAt).getTime(),
        });
      }

      // Record subsequent individual payments made on this debt
      subsequentPayments.forEach(pay => {
        events.push({
          id: `pay_${pay.id}`,
          date: pay.date,
          type: 'payment',
          refNumber: `PAY-${pay.id.slice(-6)}`,
          description: `Debt Settlement Payment on "${debt.productOrService}" via ${pay.method.toUpperCase()}${pay.note ? ` (${pay.note})` : ''}`,
          debit: 0,
          credit: pay.amount,
          netChange: -pay.amount,
          method: pay.method,
          rawTimestamp: new Date(pay.date).getTime(),
        });
      });
    });

    // Process Repair Tickets (Problem 10 fix: Include repair revenue and intake deposits)
    custTickets.forEach(t => {
      const isCompleted = t.status === 'completed';
      const deposit = t.depositAmount || 0;
      const refNumber = t.ticketNumber || `REP-${t.id.slice(0, 6)}`;
      const deviceDesc = `${t.deviceBrand || ''} ${t.deviceModel || ''}`.trim() || 'Device';
      const issueSummary = t.issueDescription ? ` (${t.issueDescription.slice(0, 35)})` : '';

      // 1. Intake Deposit (credited at creation date if paid)
      if (deposit > 0 && t.createdAt) {
        events.push({
          id: `rep_dep_${t.id}`,
          date: t.createdAt,
          type: 'payment',
          refNumber: `DEP-${refNumber}`,
          description: `Intake Deposit for Repair #${refNumber} (${deviceDesc})`,
          debit: 0,
          credit: deposit,
          netChange: -deposit,
          rawTimestamp: new Date(t.createdAt).getTime(),
        });
      }

      // 2. Handover / Completed Repair Service (billed at completion date)
      if (isCompleted) {
        const finalCost = t.actualCost ?? t.estimatedCost ?? 0;
        const totalPaid = t.paidAmount ?? 0;
        const handoverPaid = Math.max(0, t.handoverAmountPaid ?? (totalPaid - deposit));

        let repairDesc = `Repair Service #${refNumber} (${deviceDesc}${issueSummary})`;
        if (finalCost === 0) {
          repairDesc += ' — Free / Warranty Service';
        } else if (totalPaid >= finalCost) {
          repairDesc += ' — Paid in Full';
        } else if (totalPaid > 0) {
          repairDesc += ` — Paid ${formatCurrency(totalPaid)}, ${formatCurrency(finalCost - totalPaid)} on Credit Tab`;
        } else {
          repairDesc += ' — 100% Charged to Account Credit';
        }

        events.push({
          id: `rep_${t.id}`,
          date: t.completedAt || t.updatedAt || t.createdAt,
          type: 'repair',
          refNumber,
          description: repairDesc,
          debit: finalCost,
          credit: handoverPaid,
          netChange: finalCost - handoverPaid,
          rawTimestamp: new Date(t.completedAt || t.updatedAt || t.createdAt).getTime(),
        });
      }
    });

    // Sort strictly chronologically ascending
    return events.sort((a, b) => a.rawTimestamp - b.rawTimestamp);
  }, [customer, transactions, getCustomerDebts, tickets]);

  // Compute Opening Balance, Period Journal, and Closing Balance atomically
  const statementData = useMemo(() => {
    let openingBalance = 0;
    const periodJournal: (LedgerEvent & { runningBalance: number })[] = [];
    let runningBalance = 0;

    let periodDebits = 0;
    let periodCredits = 0;

    const startTs = startDate ? startDate.getTime() : 0;
    const endTs = endDate.getTime();

    for (const ev of allEvents) {
      const evTs = ev.rawTimestamp;

      if (evTs < startTs) {
        // Historical transactions before the period start form the Opening Balance
        openingBalance += ev.netChange;
      } else if (evTs <= endTs) {
        if (periodJournal.length === 0) {
          runningBalance = openingBalance;
        }
        runningBalance += ev.netChange;
        periodDebits += ev.debit;
        periodCredits += ev.credit;

        periodJournal.push({
          ...ev,
          runningBalance,
        });
      }
    }

    if (periodJournal.length === 0) {
      runningBalance = openingBalance;
    }

    const closingBalance = openingBalance + periodDebits - periodCredits;

    return {
      openingBalance,
      periodDebits,
      periodCredits,
      closingBalance,
      periodJournal,
    };
  }, [allEvents, startDate, endDate]);

  if (!customer) return null;

  const currentTotalDebt = getCustomerDebtTotal(customer.id);
  const statementNumber = `STMT-${customer.id.slice(0, 4).toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

  // Reconciliation Check: when all time is selected, closingBalance should match currentTotalDebt exactly
  const isAllTime = datePreset === 'all';
  const balanceDiscrepancy = Math.abs(statementData.closingBalance - currentTotalDebt);
  const isReconciled = !isAllTime || balanceDiscrepancy < 0.01;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const filename = `Account_Statement_${(customer.shopName || customer.name).replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
    const headers = ['Date', 'Reference', 'Type', 'Description', 'Debit (+ Charged)', 'Credit (- Paid)', 'Running Balance'];

    const rows: (string | number)[][] = [
      ['---', '---', 'OPENING BALANCE', 'Balance brought forward from prior periods', '', '', statementData.openingBalance.toFixed(2)],
      ...statementData.periodJournal.map(item => [
        formatDateStr(item.date),
        item.refNumber,
        item.type.toUpperCase(),
        item.description,
        item.debit > 0 ? item.debit.toFixed(2) : '',
        item.credit > 0 ? item.credit.toFixed(2) : '',
        item.runningBalance.toFixed(2),
      ]),
      ['---', '---', 'CLOSING BALANCE', 'Total Net Balance Owed at End of Period', statementData.periodDebits.toFixed(2), statementData.periodCredits.toFixed(2), statementData.closingBalance.toFixed(2)],
    ];

    exportToCSV(filename, headers, rows);
  };

  const handleShareWhatsApp = () => {
    const shopDisplayName = customer.shopName || customer.name;
    const text = `🏪 *ACCOUNT STATEMENT / RELEVÉ DE COMPTE*
*Client:* ${shopDisplayName}
*Date:* ${new Date().toLocaleDateString()}
*Period:* ${dateRangeLabel}
━━━━━━━━━━━━━━━━━━━
📊 *Opening Balance:* ${formatCurrency(statementData.openingBalance)}
📦 *Invoices / Billed (+):* ${formatCurrency(statementData.periodDebits)}
💳 *Payments Received (-):* ${formatCurrency(statementData.periodCredits)}
━━━━━━━━━━━━━━━━━━━
🔴 *CLOSING BALANCE DUE:* ${formatCurrency(statementData.closingBalance)}
━━━━━━━━━━━━━━━━━━━
${settings.storeName ? `Issued by: ${settings.storeName}\n` : ''}Please review your account statement and contact us for any inquiries. Thank you!`;

    const cleanPhone = customer.phone.replace(/\D/g, '');
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="B2B Account Statement & Ledger"
      subtitle={`${customer.shopName || customer.name} • ${dateRangeLabel}`}
      size="lg"
      footer={
        <div className={styles.actionsBar} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" onClick={handleExportCSV} leftIcon={<Download size={15} />}>
              Export CSV
            </Button>
            <Button
              variant="secondary"
              onClick={handleShareWhatsApp}
              leftIcon={<Send size={15} />}
              style={{ background: '#25D366', color: '#ffffff', borderColor: '#22c55e' }}
            >
              Share via WhatsApp
            </Button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isReconciled && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
                <ShieldCheck size={14} /> 100% Reconciled
              </span>
            )}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={handlePrint} leftIcon={<Printer size={15} />}>
              Print / Save PDF
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.modalContainer}>
        {/* Date Filter & Controls Toolbar */}
        <div className={styles.controlsBar}>
          <div className={styles.filterPills}>
            <button
              type="button"
              className={[styles.filterPill, datePreset === 'this_month' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('this_month')}
            >
              This Month
            </button>
            <button
              type="button"
              className={[styles.filterPill, datePreset === 'last_month' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('last_month')}
            >
              Last Month
            </button>
            <button
              type="button"
              className={[styles.filterPill, datePreset === 'last_30_days' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('last_30_days')}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              className={[styles.filterPill, datePreset === 'this_year' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('this_year')}
            >
              This Year
            </button>
            <button
              type="button"
              className={[styles.filterPill, datePreset === 'all' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('all')}
            >
              All Time
            </button>
            <button
              type="button"
              className={[styles.filterPill, datePreset === 'custom' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('custom')}
            >
              Custom Range
            </button>
          </div>

          {datePreset === 'custom' && (
            <div className={styles.customDateRow}>
              <span>From:</span>
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className={styles.dateInput}
              />
              <span>To:</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className={styles.dateInput}
              />
            </div>
          )}
        </div>

        {/* Printable Statement Sheet */}
        <div className={`${styles.statementSheet} printable-statement`}>
          {/* Statement Header */}
          <div className={styles.statementHeader}>
            <div className={styles.storeInfo}>
              <h2>{settings.storeName || 'PHONE SHOP MANAGER PRO'}</h2>
              <p className={styles.storeSub}>Wholesale Parts & Commercial Ledger Division</p>
              {'phone' in settings && (settings as any).phone && <p className={styles.storeSub}>📞 {(settings as any).phone}</p>}
              {'address' in settings && (settings as any).address && <p className={styles.storeSub}>📍 {(settings as any).address}</p>}
            </div>

            <div className={styles.statementMeta}>
              <span className={styles.statementBadge}>RELEVÉ DE COMPTE</span>
              <h3 className={styles.statementTitle}>ACCOUNT STATEMENT</h3>
              <p className={styles.statementDate}>Ref: <strong>{statementNumber}</strong></p>
              <p className={styles.statementDate}>Date: <strong>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong></p>
            </div>
          </div>

          {/* Client & Period Info */}
          <div className={styles.partiesGrid}>
            <div className={styles.clientCol}>
              <h4>CLIENT ACCOUNT DETAILS</h4>
              <p className={styles.clientName}>{customer.shopName || customer.name}</p>
              {customer.shopName && <p className={styles.clientDetail}>Contact Person: <strong>{customer.name}</strong></p>}
              <p className={styles.clientDetail}>Phone: {customer.phone}</p>
              {customer.email && <p className={styles.clientDetail}>Email: {customer.email}</p>}
              {customer.address && <p className={styles.clientDetail}>Address: {customer.address}</p>}
              {(customer.rc || customer.nif || customer.nis || customer.art) && (
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#475569', lineHeight: 1.4 }}>
                  {customer.rc && <div>RC: <strong>{customer.rc}</strong></div>}
                  {customer.nif && <div>NIF: <strong>{customer.nif}</strong></div>}
                  {customer.nis && <div>NIS: <strong>{customer.nis}</strong></div>}
                  {customer.art && <div>Art: <strong>{customer.art}</strong></div>}
                </div>
              )}
              {customer.creditLimit && customer.creditLimit > 0 && (
                <p className={styles.clientDetail} style={{ color: '#2563eb', fontWeight: 600 }}>
                  Credit Limit: {formatPrivateCurrency(customer.creditLimit)}
                </p>
              )}
            </div>

            <div className={styles.accountCol}>
              <h4>STATEMENT PERIOD</h4>
              <p className={styles.clientName}>{dateRangeLabel}</p>
              <p className={styles.clientDetail}>Account Type: <strong>{customer.shopName ? '🏪 Commercial / Phone Shop' : '👤 Retail Client'}</strong></p>
              <p className={styles.clientDetail}>Live Ledger Balance: <strong style={{ color: currentTotalDebt > 0 ? '#dc2626' : '#16a34a' }}>{formatPrivateCurrency(currentTotalDebt)}</strong></p>
            </div>
          </div>

          {/* 4 Financial KPI Summary Cards */}
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>1. Opening Balance</div>
              <p className={styles.kpiValue}>{formatPrivateCurrency(statementData.openingBalance)}</p>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>2. Billed / Invoices (+)</div>
              <p className={styles.kpiValue} style={{ color: '#2563eb' }}>+{formatPrivateCurrency(statementData.periodDebits)}</p>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>3. Payments Received (-)</div>
              <p className={[styles.kpiValue, styles.kpiValuePaid].join(' ')}>-{formatPrivateCurrency(statementData.periodCredits)}</p>
            </div>
            <div className={styles.kpiCard} style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
              <div className={styles.kpiLabel} style={{ color: '#991b1b' }}>4. Closing Balance Due</div>
              <p className={[styles.kpiValue, styles.kpiValueClosing].join(' ')}>{formatPrivateCurrency(statementData.closingBalance)}</p>
            </div>
          </div>

          {/* Ledger Table */}
          <div className={styles.tableContainer}>
            <table className={styles.statementTable}>
              <thead>
                <tr>
                  <th style={{ width: '105px' }}>Date</th>
                  <th style={{ width: '125px' }}>Reference</th>
                  <th style={{ width: '105px' }}>Type</th>
                  <th>Description / Line Items</th>
                  <th className={styles.numCol} style={{ width: '110px' }}>Debit (+)</th>
                  <th className={styles.numCol} style={{ width: '110px' }}>Credit (-)</th>
                  <th className={styles.numCol} style={{ width: '115px' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening Balance Row */}
                <tr className={styles.trOpening}>
                  <td>{startDate ? formatDateStr(startDate.toISOString()) : 'Prior'}</td>
                  <td><code>OPENING</code></td>
                  <td>
                    <span className={[styles.typeBadge, styles.typeTab].join(' ')}>
                      Balance Fwd
                    </span>
                  </td>
                  <td>Balance brought forward from prior transactions</td>
                  <td className={styles.numCol}>-</td>
                  <td className={styles.numCol}>-</td>
                  <td className={[styles.numCol, styles.balanceText].join(' ')} data-col="balance">
                    {formatPrivateCurrency(statementData.openingBalance)}
                  </td>
                </tr>

                {statementData.periodJournal.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                      No new ledger transactions or invoices recorded in this date range.
                    </td>
                  </tr>
                ) : (
                  statementData.periodJournal.map((item, idx) => (
                    <tr key={idx}>
                      <td>{formatDateStr(item.date)}</td>
                      <td><code style={{ fontSize: '11px', fontWeight: 600 }}>{item.refNumber}</code></td>
                      <td>
                        <span className={[
                          styles.typeBadge,
                          item.type === 'repair' ? styles.typeRepair :
                          item.type === 'invoice' ? styles.typeInvoice :
                          item.type === 'payment' ? styles.typePayment :
                          item.type === 'refund' ? styles.typeRefund : styles.typeTab
                        ].join(' ')}>
                          {item.type === 'repair' ? 'Repair' : item.type === 'invoice' ? 'Invoice' : item.type === 'payment' ? 'Payment' : item.type === 'refund' ? 'Refund' : 'Credit Tab'}
                        </span>
                      </td>
                      <td style={{ maxWidth: '280px', lineHeight: 1.3 }}>{item.description}</td>
                      <td className={[styles.numCol, item.debit > 0 && styles.debitText].filter(Boolean).join(' ')} data-col="debit">
                        {item.debit > 0 ? `+${formatPrivateCurrency(item.debit)}` : '-'}
                      </td>
                      <td className={[styles.numCol, item.credit > 0 && styles.creditText].filter(Boolean).join(' ')} data-col="credit">
                        {item.credit > 0 ? `-${formatPrivateCurrency(item.credit)}` : '-'}
                      </td>
                      <td className={[styles.numCol, styles.balanceText].join(' ')} data-col="balance">
                        {formatPrivateCurrency(item.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Statement Signatures & Terms */}
          <div className={styles.statementFooter}>
            <div className={styles.signaturesRow}>
              <div className={styles.signatureBox}>
                <div className={styles.signatureLine}>
                  Authorized Store Signature & Stamp
                </div>
              </div>
              <div className={styles.signatureBox}>
                <div className={styles.signatureLine}>
                  Client Acknowledgment & Signature
                </div>
              </div>
            </div>

            <p className={styles.statementNote}>
              This document is an official accounting record of all wholesale parts invoices, credit tabs, and settlement payments.
              Please report any discrepancies within 7 business days.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
};
