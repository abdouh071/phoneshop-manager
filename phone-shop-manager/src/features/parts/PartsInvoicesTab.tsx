import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchInput } from '../../components/ui/Input';
import { Printer, Store, User, FileText, Calendar, CheckCircle2, Clock, AlertCircle, FileEdit, RotateCcw } from 'lucide-react';
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
import './B2BParts.module.css';

interface PartsInvoicesTabProps {
  onOpenCustomerProfile?: (customer: Customer) => void;
  customers: Customer[];
}

export const PartsInvoicesTab: React.FC<PartsInvoicesTabProps> = ({
  onOpenCustomerProfile,
  customers,
}) => {
  const { t, i18n } = useTranslation();
  const { invoices: partsTransactions, fetchInvoices } = usePartsCartStore();
  const { user } = useAuthStore();

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Metrics Summary Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <div style={{ background: '#ffffff', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('parts.invoices.totalOrders')}</span>
          <p style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '4px 0 0 0' }}>{metrics.count}</p>
        </div>
        <div style={{ background: '#ffffff', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('parts.invoices.grossVolume')}</span>
          <p style={{ fontSize: '20px', fontWeight: 800, color: '#2563eb', margin: '4px 0 0 0' }}>{formatCurrency(metrics.totalRevenue)}</p>
        </div>
        <div style={{ background: '#ffffff', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('parts.invoices.chargedToLedgers')}</span>
          <p style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', margin: '4px 0 0 0' }}>{formatCurrency(metrics.totalChargedToLedger)}</p>
        </div>
        <div style={{ background: '#ffffff', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('parts.invoices.collectedUpfront')}</span>
          <p style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', margin: '4px 0 0 0' }}>{formatCurrency(metrics.totalPaidCash)}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#ffffff', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('parts.invoices.searchPlaceholder')}
          style={{ flex: 1 }}
        />

        <div style={{ display: 'flex', gap: '6px' }}>
          {([
            { id: 'all', label: t('parts.invoices.filterAll') },
            { id: 'paid_full', label: t('parts.invoices.filterPaidFull') },
            { id: 'charged_to_account', label: t('parts.invoices.filterCharged') },
            { id: 'partial_payment', label: t('parts.invoices.filterPartial') },
          ] as const).map(tab => (
            <button
              key={tab.id}
              type="button"
              style={{
                padding: '7px 12px',
                borderRadius: '8px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                border: settlementFilter === tab.id ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                background: settlementFilter === tab.id ? '#eff6ff' : '#f8fafc',
                color: settlementFilter === tab.id ? '#1d4ed8' : '#64748b',
                transition: 'all 0.15s ease',
              }}
              onClick={() => setSettlementFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <FileText size={48} style={{ color: '#cbd5e1', margin: '0 auto 12px auto' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#334155' }}>{t('parts.invoices.emptyTitle')}</h3>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
            {searchQuery || settlementFilter !== 'all' ? t('parts.invoices.emptyFiltered') : t('parts.invoices.emptyDefault')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredInvoices.map(tx => {
            const isRefunded = tx.status === 'refunded';
            const settlement = tx.accountSettlement;
            const buyerName = tx.shopName || tx.customerName || t('parts.walkInCustomer');
            const isB2B = Boolean(tx.shopName || (tx.accountSettlement && tx.accountSettlement.type !== 'paid_full'));
            const matchedCust = customers.find(c => c.id === tx.customerId || (c.name ?? '').toLowerCase().trim() === (tx.customerName || '').toLowerCase().trim());

            return (
              <div
                key={tx.id}
                style={{
                  background: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'border-color 0.15s ease',
                }}
              >
                {/* Header Row: Invoice # + Date + Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '14px', color: '#0f172a', background: '#f1f5f9', padding: '3px 8px', borderRadius: '6px' }}>
                      #{tx.invoiceNumber || tx.id.slice(-8).toUpperCase()}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={13} /> {formatDate(tx.date)}
                    </span>
                    {tx.processedByName && (
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        {t('common.by')} <strong>{tx.processedByName}</strong>
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>{formatCurrency(tx.total)}</span>
                      {discountsGivenOf(tx) > 0 && (
                        <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                          {t('parts.invoices.discount', { amount: formatCurrency(discountsGivenOf(tx)) })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Buyer & Settlement Info Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: isB2B ? '#eff6ff' : '#f1f5f9',
                      color: isB2B ? '#2563eb' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {isB2B ? <Store size={18} /> : <User size={18} />}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#1e293b' }}>{buyerName}</span>
                        {matchedCust && (
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              style={{
                                fontSize: '11px',
                                color: '#2563eb',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 600,
                                textDecoration: 'underline'
                              }}
                              onClick={() => onOpenCustomerProfile && onOpenCustomerProfile(matchedCust)}
                            >
                              {t('parts.invoices.viewAccount')}
                            </button>
                            <button
                              type="button"
                              style={{
                                fontSize: '11px',
                                color: '#0f172a',
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '1px 6px',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                              onClick={() => setStatementCustomer(matchedCust)}
                              title={t('parts.invoices.statementTooltip')}
                            >
                              {t('parts.invoices.statementButton')}
                            </button>
                          </div>
                        )}
                      </div>
                      {tx.shopName && tx.customerName && (
                        <span style={{ fontSize: '11.5px', color: '#64748b' }}>{t('parts.invoices.contact', { name: tx.customerName })}</span>
                      )}
                    </div>
                  </div>

                  {/* Settlement Pill */}
                  <div>
                    {!settlement || settlement.type === 'paid_full' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '4px 10px', borderRadius: '20px' }}>
                        <CheckCircle2 size={13} /> {t('parts.invoices.paidFull', { methods: tx.payments.map(p => p.method.toUpperCase()).join('+') || t('parts.invoices.cash') })}
                      </span>
                    ) : settlement.type === 'charged_to_account' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '4px 10px', borderRadius: '20px' }}>
                        <AlertCircle size={13} /> {t('parts.invoices.chargedToAccount', { amount: formatCurrency(settlement.chargedAmount) })}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, color: '#d97706', background: '#fef3c7', padding: '4px 10px', borderRadius: '20px' }}>
                        <Clock size={13} /> {t('parts.invoices.partialSplit', { paid: formatCurrency(settlement.paidAmount), charged: formatCurrency(settlement.chargedAmount) })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Items List & Actions Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {tx.items.map((item, idx) => {
                      const returned = Boolean(item.isReturn);
                      return (
                        <span
                          key={idx}
                          title={returned ? t('parts.invoices.returnedTooltip') : undefined}
                          style={{
                            fontSize: '11.5px',
                            background: returned ? '#fee2e2' : '#f1f5f9',
                            color: returned ? '#b91c1c' : '#334155',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontWeight: 600,
                          }}
                        >
                          {returned ? '−' : ''}
                          {Math.trunc(Number(item.quantity) || 0)}× {item.product?.name} {item.product?.model}
                        </span>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#eff6ff',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                        padding: '6px 14px',
                        borderRadius: '8px',
                        fontSize: '12.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => setSelectedInvoice(tx)}
                      title={t('parts.invoices.printTooltip')}
                    >
                      <Printer size={14} />
                      <span>{t('common.print')}</span>
                    </button>

                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: '#f8fafc',
                        color: isRefunded ? '#94a3b8' : '#334155',
                        border: '1px solid #cbd5e1',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: isRefunded ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => handleEditClick(tx)}
                      disabled={isRefunded}
                      title={isRefunded ? t('parts.invoices.refundedTooltip') : !canEditDirectly(tx) ? t('parts.invoices.requiresAdminEdit') : t('parts.invoices.editTooltip')}
                    >
                      <FileEdit size={14} />
                      <span>{t('common.edit')}</span>
                      {!canEditDirectly(tx) && !isRefunded && <span style={{ fontSize: '10px' }}>🔒</span>}
                    </button>

                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: '#fff1f2',
                        color: isRefunded ? '#fda4af' : '#e11d48',
                        border: '1px solid #fecdd3',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: isRefunded ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => handleRefundClick(tx)}
                      disabled={isRefunded}
                      title={isRefunded ? t('parts.invoices.alreadyRefunded') : !canEditDirectly(tx) ? t('parts.invoices.requiresAdminRefund') : t('parts.invoices.refundTooltip')}
                    >
                      <RotateCcw size={13} />
                      <span>{t('parts.invoices.refund')}</span>
                      {!canEditDirectly(tx) && !isRefunded && <span style={{ fontSize: '10px' }}>🔒</span>}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
          fetchInvoices();
        }}
        transaction={txToEdit}
      />

      {/* Refund Invoice Modal */}
      <RefundModal
        isOpen={!!txToRefund}
        onClose={() => {
          setTxToRefund(null);
          fetchInvoices();
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
