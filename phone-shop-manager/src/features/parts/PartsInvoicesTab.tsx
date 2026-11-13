import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchInput } from '../../components/ui/Input';
import { Printer, Store, User, FileText, Calendar, CheckCircle2, Clock, AlertCircle, FileEdit, RotateCcw, RefreshCw, LockKeyhole } from 'lucide-react';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { discountsGivenOf } from '../../utils/discountPolicy';
import { normalizeArabic } from '../../utils/normalizeText';
import type { SaleTransaction, Customer } from '../../types';
import { PartsInvoiceModal } from './PartsInvoiceModal';
import { EditTransactionModal } from '../pos/EditTransactionModal';
import { RefundModal } from '../pos/RefundModal';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { AccountStatementModal } from '../customers/AccountStatementModal';
import styles from './PartsInvoicesTab.module.css';

interface PartsInvoicesTabProps {
  onOpenCustomerProfile?: (customer: Customer) => void;
  customers: Customer[];
}

export const PartsInvoicesTab: React.FC<PartsInvoicesTabProps> = ({
  onOpenCustomerProfile,
  customers,
}) => {
  const { t, i18n } = useTranslation();
  const partsTransactions = usePartsCartStore(state => state.invoices);
  const fetchInvoices = usePartsCartStore(state => state.fetchInvoices);
  const isLoadingInvoices = usePartsCartStore(state => state.isLoadingInvoices);
  const invoicesError = usePartsCartStore(state => state.invoicesError);
  const user = useAuthStore(state => state.user);

  React.useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);
  const [searchQuery, setSearchQuery] = useState('');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'paid_full' | 'charged_to_account' | 'partial_payment'>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<SaleTransaction | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [txToEdit, setTxToEdit] = useState<SaleTransaction | null>(null);
  const [txToRefund, setTxToRefund] = useState<SaleTransaction | null>(null);
  const [txRequiringUnlock, setTxRequiringUnlock] = useState<{ tx: SaleTransaction; purpose: 'edit' | 'refund' } | null>(null);

  const canEditDirectly = (t: SaleTransaction) => {
    if (t.status === 'refunded') return false;
    // Strict admin security: non-admins must always be unlocked by an admin
    return user?.role === 'admin';
  };

  const handleEditClick = (t: SaleTransaction) => {
    if (t.status === 'refunded') return;
    if (canEditDirectly(t)) {
      setTxToEdit(t);
    } else {
      setTxRequiringUnlock({ tx: t, purpose: 'edit' });
    }
  };

  const handleRefundClick = (t: SaleTransaction) => {
    if (t.status === 'refunded') return;
    if (canEditDirectly(t)) {
      setTxToRefund(t);
    } else {
      setTxRequiringUnlock({ tx: t, purpose: 'refund' });
    }
  };

  const handleUnlockSuccess = () => {
    if (!txRequiringUnlock) return;
    const { tx, purpose } = txRequiringUnlock;
    setTxRequiringUnlock(null);
    if (purpose === 'refund') setTxToRefund(tx);
    else setTxToEdit(tx);
  };



  // Derived metrics
  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalChargedToLedger = 0;
    let totalPaidCash = 0;

    for (const tx of partsTransactions) {
      if (tx.status === 'refunded') continue;
      totalRevenue += tx.total;
      if (tx.accountSettlement) {
        totalChargedToLedger += tx.accountSettlement.chargedAmount || 0;
        totalPaidCash += tx.accountSettlement.paidAmount || 0;
      } else {
        totalPaidCash += tx.total;
      }
    }

    return {
      count: partsTransactions.length,
      totalRevenue,
      totalChargedToLedger,
      totalPaidCash,
    };
  }, [partsTransactions]);

  const filteredInvoices = useMemo(() => {
    return partsTransactions.filter(tx => {
      // Settlement filter
      if (settlementFilter !== 'all') {
        const type = tx.accountSettlement?.type || 'paid_full';
        if (type !== settlementFilter) return false;
      }

      // Search query
      if (!searchQuery.trim()) return true;
      const q = normalizeArabic(searchQuery);

      const numMatch = normalizeArabic(tx.invoiceNumber || tx.id).includes(q);
      const custMatch = normalizeArabic(tx.customerName).includes(q);
      const shopMatch = normalizeArabic(tx.shopName).includes(q);
      const itemMatch = tx.items.some(i =>
        normalizeArabic([i?.product?.name, i?.product?.model, i?.product?.sku].filter(Boolean).join(' ')).includes(q)
      );

      return numMatch || custMatch || shopMatch || itemMatch;
    });
  }, [partsTransactions, settlementFilter, searchQuery]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(
      (i18n.language || 'en').startsWith('fr') ? 'fr-FR' : (i18n.language || 'en').startsWith('ar') ? 'ar-DZ' : 'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }
    );

  return (
    <div className={styles.container}>
      {/* Metrics Summary Strip */}
      <div className={styles.metrics}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('parts.invoices.totalOrders')}</span>
          <p className={styles.metricValue}>{metrics.count}</p>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('parts.invoices.grossVolume')}</span>
          <p className={`${styles.metricValue} ${styles.metricRevenue}`}>{formatCurrency(metrics.totalRevenue)}</p>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('parts.invoices.chargedToLedgers')}</span>
          <p className={`${styles.metricValue} ${styles.metricCharged}`}>{formatCurrency(metrics.totalChargedToLedger)}</p>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('parts.invoices.collectedUpfront')}</span>
          <p className={`${styles.metricValue} ${styles.metricCollected}`}>{formatCurrency(metrics.totalPaidCash)}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className={styles.toolbar}>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('parts.invoices.searchPlaceholder')}
          aria-label={t('parts.invoices.searchPlaceholder')}
          className={styles.search}
        />

        <div className={styles.filters}>
          {([
            { id: 'all', label: t('parts.invoices.filterAll') },
            { id: 'paid_full', label: t('parts.invoices.filterPaidFull') },
            { id: 'charged_to_account', label: t('parts.invoices.filterCharged') },
            { id: 'partial_payment', label: t('parts.invoices.filterPartial') },
          ] as const).map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`${styles.filterButton} ${settlementFilter === tab.id ? styles.filterActive : ''}`}
              aria-pressed={settlementFilter === tab.id}
              onClick={() => setSettlementFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.actionButton} ${styles.refreshButton}`}
          onClick={() => fetchInvoices({ force: true })}
          disabled={isLoadingInvoices}
          aria-busy={isLoadingInvoices}
        >
          <RefreshCw size={15} className={isLoadingInvoices ? styles.spinning : undefined} aria-hidden="true" />
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      {isLoadingInvoices && (
        <div className={styles.loadingStatus} role="status">
          <RefreshCw size={16} className={styles.spinning} aria-hidden="true" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {invoicesError && (
        <div className={styles.errorAlert} role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <p className={styles.errorMessage}>{invoicesError}</p>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.retryButton}`}
            onClick={() => fetchInvoices({ force: true })}
            disabled={isLoadingInvoices}
          >
            {t('parts.retry')}
          </button>
        </div>
      )}

      {/* Invoices List */}
      <div className={styles.invoiceList} aria-busy={isLoadingInvoices}>
        {filteredInvoices.length === 0 && !isLoadingInvoices && !invoicesError && (
          <div className={styles.emptyState}>
            <FileText size={48} className={styles.emptyIcon} aria-hidden="true" />
            <h3 className={styles.emptyTitle}>{t('parts.invoices.emptyTitle')}</h3>
            <p className={styles.emptyDescription}>
              {searchQuery || settlementFilter !== 'all' ? t('parts.invoices.emptyFiltered') : t('parts.invoices.emptyDefault')}
            </p>
          </div>
        )}
          {filteredInvoices.map(tx => {
            const isRefunded = tx.status === 'refunded';
            const settlement = tx.accountSettlement;
            const buyerName = tx.shopName || tx.customerName || t('parts.walkInCustomer');
            const isB2B = Boolean(tx.shopName || (tx.accountSettlement && tx.accountSettlement.type !== 'paid_full'));
            const matchedCust = tx.customerId ? customers.find(c => c.id === tx.customerId) : undefined;

            return (
              <div key={tx.id} className={styles.invoiceCard}>
                {/* Header Row: Invoice # + Date + Total */}
                <div className={styles.invoiceHeader}>
                  <div className={styles.invoiceMeta}>
                    <span className={styles.invoiceNumber}>
                      #{tx.invoiceNumber || tx.id.slice(-8).toUpperCase()}
                    </span>
                    <span className={styles.invoiceDate}>
                      <Calendar size={13} aria-hidden="true" /> {formatDate(tx.date)}
                    </span>
                    {tx.processedByName && (
                      <span className={styles.processedBy}>
                        {t('common.by')} <strong>{tx.processedByName}</strong>
                      </span>
                    )}
                  </div>

                  <div className={styles.invoiceAmount}>
                    <span className={styles.invoiceTotal}>{formatCurrency(tx.total)}</span>
                    {discountsGivenOf(tx) > 0 && (
                      <div className={styles.discount}>
                        {t('parts.invoices.discount', { amount: formatCurrency(discountsGivenOf(tx)) })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Buyer & Settlement Info Row */}
                <div className={styles.buyerRow}>
                  <div className={styles.buyer}>
                    <div className={`${styles.buyerIcon} ${isB2B ? styles.buyerIconB2B : ''}`}>
                      {isB2B ? <Store size={18} aria-hidden="true" /> : <User size={18} aria-hidden="true" />}
                    </div>
                    <div className={styles.buyerDetails}>
                      <div className={styles.buyerHeading}>
                        <span className={styles.buyerName}>{buyerName}</span>
                        {matchedCust && (
                          <div className={styles.accountActions}>
                            <button
                              type="button"
                              className={styles.accountLink}
                              onClick={() => onOpenCustomerProfile && onOpenCustomerProfile(matchedCust)}
                            >
                              {t('parts.invoices.viewAccount')}
                            </button>
                            <button
                              type="button"
                              className={styles.statementButton}
                              onClick={() => setStatementCustomer(matchedCust)}
                              title={t('parts.invoices.statementTooltip')}
                            >
                              {t('parts.invoices.statementButton')}
                            </button>
                          </div>
                        )}
                      </div>
                      {tx.shopName && tx.customerName && (
                        <span className={styles.contact}>{t('parts.invoices.contact', { name: tx.customerName })}</span>
                      )}
                    </div>
                  </div>

                  {/* Settlement Pill */}
                  <div className={styles.settlement}>
                    {!settlement || settlement.type === 'paid_full' ? (
                      <span className={`${styles.settlementPill} ${styles.settlementPaid}`}>
                        <CheckCircle2 size={13} aria-hidden="true" /> {t('parts.invoices.paidFull', { methods: tx.payments.map(p => p.method.toUpperCase()).join('+') || t('parts.invoices.cash') })}
                      </span>
                    ) : settlement.type === 'charged_to_account' ? (
                      <span className={`${styles.settlementPill} ${styles.settlementCharged}`}>
                        <AlertCircle size={13} aria-hidden="true" /> {t('parts.invoices.chargedToAccount', { amount: formatCurrency(settlement.chargedAmount) })}
                      </span>
                    ) : (
                      <span className={`${styles.settlementPill} ${styles.settlementPartial}`}>
                        <Clock size={13} aria-hidden="true" /> {t('parts.invoices.partialSplit', { paid: formatCurrency(settlement.paidAmount), charged: formatCurrency(settlement.chargedAmount) })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Items List & Actions Row */}
                <div className={styles.invoiceFooter}>
                  <div className={styles.items}>
                    {tx.items.map((item, idx) => {
                      const returned = Boolean(item.isReturn);
                      return (
                        <span
                          key={idx}
                          title={returned ? t('parts.invoices.returnedTooltip') : undefined}
                          className={`${styles.itemChip} ${returned ? styles.itemReturned : ''}`}
                        >
                          {returned ? '−' : ''}
                          {Math.trunc(Number(item.quantity) || 0)}× {item.product?.name} {item.product?.model}
                        </span>
                      );
                    })}
                  </div>

                  <div className={styles.invoiceActions}>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.printButton}`}
                      onClick={() => setSelectedInvoice(tx)}
                      title={t('parts.invoices.printTooltip')}
                    >
                      <Printer size={14} aria-hidden="true" />
                      <span>{t('common.print')}</span>
                    </button>

                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.editButton}`}
                      onClick={() => handleEditClick(tx)}
                      disabled={isRefunded}
                      title={isRefunded ? t('parts.invoices.refundedTooltip') : !canEditDirectly(tx) ? t('parts.invoices.requiresAdminEdit') : t('parts.invoices.editTooltip')}
                    >
                      <FileEdit size={14} aria-hidden="true" />
                      <span>{t('common.edit')}</span>
                      {!canEditDirectly(tx) && !isRefunded && <LockKeyhole size={10} aria-hidden="true" />}
                    </button>

                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.refundButton}`}
                      onClick={() => handleRefundClick(tx)}
                      disabled={isRefunded}
                      title={isRefunded ? t('parts.invoices.alreadyRefunded') : !canEditDirectly(tx) ? t('parts.invoices.requiresAdminRefund') : t('parts.invoices.refundTooltip')}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      <span>{t('parts.invoices.refund')}</span>
                      {!canEditDirectly(tx) && !isRefunded && <LockKeyhole size={10} aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Invoice Modal */}
      <PartsInvoiceModal
        transaction={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
      />

      {/* Edit Invoice Modal */}
      <EditTransactionModal
        isOpen={!!txToEdit}
        onClose={() => {
          setTxToEdit(null);
          fetchInvoices({ force: true });
        }}
        transaction={txToEdit}
      />

      {/* Refund Invoice Modal */}
      <RefundModal
        isOpen={!!txToRefund}
        onClose={() => {
          setTxToRefund(null);
          fetchInvoices({ force: true });
        }}
        transaction={txToRefund}
      />

      {/* Admin Unlock Modal */}
      <AdminUnlockModal
        isOpen={!!txRequiringUnlock}
        onClose={() => setTxRequiringUnlock(null)}
        onSuccess={handleUnlockSuccess}
        actionName={txRequiringUnlock?.purpose === 'edit' ? t('parts.invoices.unlockEditAction') : t('parts.invoices.unlockRefundAction')}
      />

      {/* Account Statement & Ledger Modal */}
      <AccountStatementModal
        customer={statementCustomer}
        isOpen={!!statementCustomer}
        onClose={() => setStatementCustomer(null)}
      />
    </div>
  );
};
