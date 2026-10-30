import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Printer, Send, Download, FileText, Calendar, Store, User,
  CheckCircle2, AlertCircle, ArrowUpRight, DollarSign, X, ShieldCheck,
  TrendingDown, TrendingUp, History, CreditCard
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCartStore } from '../../store/cartStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useCustomerStore } from '../../store/customerStore';
import { useRepairStore } from '../../store/repairStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { exportToCSV } from '../../utils/exportUtils';
import { matchesCustomer } from '../../utils/customerFinancials';
import { formatWhatsAppUrl } from '../../utils/phoneUtils';
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

export const AccountStatementModal: React.FC<AccountStatementModalProps> = ({
  customer,
  isOpen,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-DZ' : i18n.language === 'fr' ? 'fr-FR' : 'en-US';

  const formatDateStr = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const { transactions } = useCartStore();
  const { invoices, fetchInvoices } = usePartsCartStore();
  const { debts, getCustomerDebts, getCustomerDebtTotal } = useCustomerStore();
  const { tickets } = useRepairStore();
  const settings = useSettingsStore();
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);

  useEffect(() => {
    if (invoices.length === 0) {
      fetchInvoices();
    }
  }, [invoices.length, fetchInvoices]);

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
      label = `${t('statementModal.thisMonth', 'This Month')} (${start.toLocaleDateString(locale, { month: 'short', year: 'numeric' })})`;
    } else if (datePreset === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      label = `${t('statementModal.lastMonth', 'Last Month')} (${start.toLocaleDateString(locale, { month: 'short', year: 'numeric' })})`;
    } else if (datePreset === 'last_30_days') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      label = `${t('statementModal.last30Days', 'Last 30 Days')} (${formatDateStr(start.toISOString())} - ${formatDateStr(end.toISOString())})`;
    } else if (datePreset === 'this_year') {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      label = `${t('statementModal.thisYear', 'This Year')} (${now.getFullYear()})`;
    } else if (datePreset === 'all') {
      start = null;
      label = t('statementModal.allTime', 'All Time History');
    } else if (datePreset === 'custom') {
      start = customStart ? new Date(`${customStart}T00:00:00`) : null;
      end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : end;
      label = `${t('statementModal.customRange', 'Custom Period')} (${customStart || 'Start'} - ${customEnd || 'Present'})`;
    }

    return { startDate: start, endDate: end, dateRangeLabel: label };
  }, [datePreset, customStart, customEnd, locale, t]);

  // Compile Unified, Deduplicated Ledger Events
  const allEvents = useMemo(() => {
    if (!customer) return [];

    // Combine Retail POS and Wholesale B2B Parts Invoices without duplicates
    const allTxsMap = new Map<string, SaleTransaction>();
    transactions.forEach(t => allTxsMap.set(t.id, t));
    invoices.forEach(inv => allTxsMap.set(inv.id, inv));
    const allCombinedTxs = Array.from(allTxsMap.values());

    // 1. Transactions (Retail POS or B2B Parts Invoices)
    const custTxs = allCombinedTxs.filter(tx => matchesCustomer(customer, tx));

    // 2. Debts (robust matching by ID, phone, or name)
    const custDebts = debts
      .filter(d => matchesCustomer(customer, d) || d.customerId === customer.id)
      .sort((a, b) => new Date(a.createdAt || a.date).getTime() - new Date(b.createdAt || b.date).getTime());

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

    // 3. Repair Tickets (Include repair revenue and intake deposits)
    const custTickets = tickets.filter(t => matchesCustomer(customer, t));

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

        const partsDesc = t.partsUsed && t.partsUsed.length > 0
          ? ` [Parts: ${t.partsUsed.map(p => `${p.quantity}× ${p.name}`).join(', ')}]`
          : '';

        let repairDesc = `Repair Service #${refNumber} (${deviceDesc}${issueSummary})${partsDesc}`;
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
  }, [customer, transactions, invoices, debts, tickets]);

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

  const isDebt = statementData.closingBalance > 0;

  const handleShareWhatsApp = () => {
    const shopDisplayName = customer.shopName || customer.name;
    const text = `🏪 *${t('statementModal.simplifiedTitle', 'Relevé de compte client')}*
*Client:* ${shopDisplayName}
*Période:* ${dateRangeLabel}
━━━━━━━━━━━━━━━━━━━
💰 *${t('statementModal.closingBalanceLabel', 'SOLDE RESTANT DÛ')}:* ${formatCurrency(statementData.closingBalance)}
📦 ${t('statementModal.totalBilled', 'Total facturé')}: ${formatCurrency(statementData.periodDebits)}
💳 ${t('statementModal.totalPaid', 'Total réglé')}: ${formatCurrency(statementData.periodCredits)}
━━━━━━━━━━━━━━━━━━━
${settings.storeName ? `${settings.storeName}\n` : ''}`;

    const url = formatWhatsAppUrl(customer.phone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${customer.shopName || customer.name}`}
      subtitle={`${t('statementModal.simplifiedTitle', 'Relevé de compte client')} • ${dateRangeLabel}`}
      size="lg"
      footer={
        <div className={styles.actionsBar}>
          <Button variant="secondary" onClick={handleExportCSV} leftIcon={<Download size={15} />}>
            {t('statementModal.exportCsv', 'Export CSV')}
          </Button>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              variant="secondary"
              onClick={handleShareWhatsApp}
              leftIcon={<Send size={15} />}
              style={{ background: '#25D366', color: '#ffffff', borderColor: '#22c55e' }}
            >
              WhatsApp ({formatPrivateCurrency(statementData.closingBalance)})
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('statementModal.close', 'Fermer')}
            </Button>
            <Button onClick={handlePrint} leftIcon={<Printer size={15} />}>
              {t('statementModal.printPdf', 'Imprimer / PDF')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.modalContainer}>
        {/* Print-only Header */}
        <div className={styles.printHeader}>
          <h2 className={styles.printStoreTitle}>{settings.storeName || 'PHONE SHOP MANAGER PRO'}</h2>
          <p className={styles.printMeta}>
            {t('statementModal.simplifiedTitle', 'Relevé de compte client')} — {customer.shopName || customer.name} ({customer.phone}) • {dateRangeLabel}
          </p>
        </div>

        {/* 1. Clean Filter Toolbar */}
        <div className={styles.toolbarRow}>
          <div className={styles.segmentedControl}>
            <button
              type="button"
              className={[styles.segmentBtn, datePreset === 'this_month' && styles.segmentBtnActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('this_month')}
            >
              {t('statementModal.thisMonth', 'Ce mois')}
            </button>
            <button
              type="button"
              className={[styles.segmentBtn, datePreset === 'last_month' && styles.segmentBtnActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('last_month')}
            >
              {t('statementModal.lastMonth', 'Mois dernier')}
            </button>
            <button
              type="button"
              className={[styles.segmentBtn, datePreset === 'this_year' && styles.segmentBtnActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('this_year')}
            >
              {t('statementModal.thisYear', 'Cette année')}
            </button>
            <button
              type="button"
              className={[styles.segmentBtn, datePreset === 'all' && styles.segmentBtnActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('all')}
            >
              {t('statementModal.allTime', 'Tout')}
            </button>
            <button
              type="button"
              className={[styles.segmentBtn, datePreset === 'custom' && styles.segmentBtnActive].filter(Boolean).join(' ')}
              onClick={() => setDatePreset('custom')}
            >
              {t('statementModal.customRange', 'Dates')}
            </button>
          </div>

          {datePreset === 'custom' && (
            <div className={styles.customDateRow}>
              <span>{t('statementModal.from', 'Du :')}</span>
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className={styles.dateInput}
              />
              <span>{t('statementModal.to', 'Au :')}</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className={styles.dateInput}
              />
            </div>
          )}
        </div>

        {/* 2. Hero Balance Card */}
        <div className={[styles.heroCard, isDebt ? styles.heroCardDebt : styles.heroCardSettled].join(' ')}>
          <div className={styles.heroHeader}>
            <span className={styles.heroSubtitle}>{t('statementModal.closingBalanceLabel', 'Solde restant dû')}</span>
            <span className={[styles.statusBadge, isDebt ? styles.statusBadgeUnpaid : styles.statusBadgePaid].join(' ')}>
              {isDebt ? (
                <>
                  <AlertCircle size={13} />
                  {t('statementModal.unpaidStatus', 'En attente de règlement')}
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} />
                  {t('statementModal.paidStatus', 'Compte à jour')}
                </>
              )}
            </span>
          </div>

          <div className={[styles.heroAmount, isDebt ? styles.heroAmountDebt : styles.heroAmountSettled].join(' ')}>
            {formatPrivateCurrency(statementData.closingBalance)}
          </div>

          <div className={styles.heroMetaRow}>
            <div className={styles.heroMetaItem}>
              <span className={styles.metaLabel}>{t('statementModal.totalBilled', 'Total facturé')} :</span>
              <span className={styles.metaValueBilled}>+{formatPrivateCurrency(statementData.periodDebits)}</span>
            </div>
            <span className={styles.metaDivider}>•</span>
            <div className={styles.heroMetaItem}>
              <span className={styles.metaLabel}>{t('statementModal.totalPaid', 'Déjà réglé')} :</span>
              <span className={styles.metaValuePaid}>-{formatPrivateCurrency(statementData.periodCredits)}</span>
            </div>
            {statementData.openingBalance > 0 && (
              <>
                <span className={styles.metaDivider}>•</span>
                <div className={styles.heroMetaItem}>
                  <span className={styles.metaLabel}>{t('statementModal.priorDebt', 'Report antérieur')} :</span>
                  <strong>{formatPrivateCurrency(statementData.openingBalance)}</strong>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 3. Transaction History */}
        <div className={styles.transactionsSection}>
          <div className={styles.sectionHeader}>
            <h4 className={styles.sectionTitle}>
              <History size={15} />
              {t('statementModal.transactionsTitle', 'Historique des opérations')}
            </h4>
            <span className={styles.countBadge}>
              {statementData.periodJournal.length} {t('statementModal.operation', 'opérations')}
            </span>
          </div>

          <div className={styles.tableCard}>
            <table className={styles.cleanTable}>
              <thead>
                <tr>
                  <th className={styles.colDate}>{t('statementModal.date', 'Date')}</th>
                  <th>{t('statementModal.operation', 'Opération & Prestations')}</th>
                  <th style={{ textAlign: 'right' }}>{t('statementModal.amount', 'Montant')}</th>
                  <th style={{ textAlign: 'right' }}>{t('statementModal.balance', 'Solde')}</th>
                </tr>
              </thead>
              <tbody>
                {statementData.openingBalance > 0 && (
                  <tr>
                    <td className={styles.colDate}>{startDate ? formatDateStr(startDate.toISOString()) : '---'}</td>
                    <td className={styles.colDesc}>
                      <div className={styles.opMainTitle}>{t('statementModal.balanceFwd', 'Solde initial (Report)')}</div>
                      <div className={styles.opMetaRow}>
                        <span className={[styles.typeBadge, styles.typeOpening].join(' ')}>
                          {t('statementModal.openingBalanceDesc', 'Report antérieur')}
                        </span>
                      </div>
                    </td>
                    <td className={styles.colAmount}>-</td>
                    <td className={styles.colBalance}>{formatPrivateCurrency(statementData.openingBalance)}</td>
                  </tr>
                )}

                {statementData.periodJournal.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.emptyState}>
                      {t('statementModal.noTransactions', 'Aucune opération sur cette période.')}
                    </td>
                  </tr>
                ) : (
                  statementData.periodJournal.map((item, idx) => {
                    const isDebit = item.debit > 0;
                    return (
                      <tr key={idx}>
                        <td className={styles.colDate}>{formatDateStr(item.date)}</td>
                        <td className={styles.colDesc}>
                          <div className={styles.opMainTitle}>{item.description}</div>
                          <div className={styles.opMetaRow}>
                            <span className={[
                              styles.typeBadge,
                              item.type === 'repair' ? styles.typeRepair :
                              item.type === 'invoice' ? styles.typeInvoice :
                              item.type === 'payment' ? styles.typePayment :
                              item.type === 'refund' ? styles.typeRefund : styles.typeTab
                            ].join(' ')}>
                              {item.type === 'repair' ? t('statementModal.repair', 'Réparation') :
                               item.type === 'invoice' ? t('statementModal.invoice', 'Pièce') :
                               item.type === 'payment' ? t('statementModal.payment', 'Paiement') :
                               item.type === 'refund' ? t('statementModal.refund', 'Remboursement') :
                               t('statementModal.creditTab', 'Dette')}
                            </span>
                            {item.refNumber && (
                              <span className={styles.opRefCode}>#{item.refNumber}</span>
                            )}
                          </div>
                        </td>
                        <td className={[styles.colAmount, isDebit ? styles.amountDebit : styles.amountCredit].join(' ')}>
                          {isDebit ? `+${formatPrivateCurrency(item.debit)}` : `-${formatPrivateCurrency(item.credit)}`}
                        </td>
                        <td className={styles.colBalance}>
                          {formatPrivateCurrency(item.runningBalance)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Print-only Signatures */}
        <div className={styles.printSignatures}>
          <div className={styles.signatureBlock}>
            {t('statementModal.authStamp', 'Signature & Cachet Magasin')}
          </div>
          <div className={styles.signatureBlock}>
            {t('statementModal.clientSignature', 'Signature & Accord Client')}
          </div>
        </div>
      </div>
    </Modal>
  );
};
