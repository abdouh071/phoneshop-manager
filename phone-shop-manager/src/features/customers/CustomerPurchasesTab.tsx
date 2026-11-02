import React from 'react';
import type { SaleTransaction } from '../../types';
import { Receipt, FileText, FileEdit, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import styles from './CustomerProfile.module.css';

interface CustomerPurchasesTabProps {
  customerTxs: SaleTransaction[];
  formatDate: (iso: string) => string;
  setSelectedReceiptTx: React.Dispatch<React.SetStateAction<SaleTransaction | null>>;
  setSelectedInvoiceTx: React.Dispatch<React.SetStateAction<SaleTransaction | null>>;
  handleEditTx: (tx: SaleTransaction) => void;
  handleRefundTx: (tx: SaleTransaction) => void;
  canEditDirectly: (tx: SaleTransaction) => boolean;
}

export const CustomerPurchasesTab: React.FC<CustomerPurchasesTabProps> = ({
  customerTxs,
  formatDate,
  setSelectedReceiptTx,
  setSelectedInvoiceTx,
  handleEditTx,
  handleRefundTx,
  canEditDirectly,
}) => {
  const { t } = useTranslation();

  return (
              customerTxs.length === 0 ? (
                <div className={styles.emptyState}>
                  {t('customers.noPurchasesLogged', 'No POS sales transactions recorded for this customer yet.')}
                </div>
              ) : (
                customerTxs.map(tx => (
                  <div key={tx.id} className={styles.saleCard}>
                    <div className={styles.saleCardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.saleTitle}>
                          {t('customers.itemsPurchased', '{{count}} Item(s) Purchased', { count: tx.items.length })}
                        </span>
                        {tx.saleType === 'parts_b2b' && (
                          <span style={{ fontSize: '10.5px', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px' }}>
                            B2B Parts #{tx.invoiceNumber?.slice(-6) || ''}
                          </span>
                        )}
                      </div>
                      {tx.saleType === 'parts_b2b' ? (
                        <button
                          type="button"
                          className={styles.receiptBtn}
                          onClick={() => setSelectedInvoiceTx(tx)}
                          style={{ background: '#eff6ff', color: '#1e40af', borderColor: '#bfdbfe' }}
                        >
                          <FileText size={13} /> {t('customers.viewInvoice', 'View Invoice')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.receiptBtn}
                          onClick={() => setSelectedReceiptTx(tx)}
                        >
                          <Receipt size={13} /> {t('customers.viewReceipt', 'View Receipt')}
                        </button>
                      )}
                    </div>
                    <div className={styles.saleItemsList}>
                      {tx.items.map((item, idx) => (
                        <div key={idx} className={styles.saleItemRow}>
                          <span>{item.quantity}x {item.product.name} {item.product.model}</span>
                          <span>{formatPrivateCurrency(item.product.price * item.quantity)}</span>
                        </div>
                      ))}
                      {tx.discount && (typeof tx.discount === 'object' ? tx.discount.value > 0 : Number(tx.discount) > 0) && (
                        <div className={styles.saleItemRow} style={{ color: '#15803d', fontWeight: 600 }}>
                          <span>{t('customers.discountApplied', '🏷️ Discount Applied')}</span>
                          <span>-{formatPrivateCurrency(typeof tx.discount === 'object' ? (tx.discount.type === 'percent' ? ((tx.subtotal || tx.total) * tx.discount.value / 100) : tx.discount.value) : Number(tx.discount))}</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.ticketFooter} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={styles.ticketDate}>{formatDate(tx.date)}</span>
                        {tx.payments && tx.payments.length > 0 && (
                          <span style={{ fontSize: '10.5px', color: '#475569', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                            {t('statementModal.via', 'via')} {tx.payments.map(p => p.method.toUpperCase()).join('+')}
                          </span>
                        )}
                        {tx.status === 'refunded' && (
                          <span style={{ fontSize: '10.5px', color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            {t('customers.refundedBadge', 'Refunded')}
                          </span>
                        )}
                        {tx.status === 'partially_refunded' && (
                          <span style={{ fontSize: '10.5px', color: '#d97706', background: '#fef3c7', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            {t('customers.partialReturnBadge', 'Partial Return')}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className={styles.ticketCost} style={{ fontWeight: 800 }}>{formatPrivateCurrency(tx.total)}</span>

                        <button
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            fontSize: '11.5px',
                            color: tx.status === 'refunded' ? '#94a3b8' : '#334155',
                            cursor: tx.status === 'refunded' ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                          }}
                          onClick={() => handleEditTx(tx)}
                          disabled={tx.status === 'refunded'}
                          title={!canEditDirectly(tx) && tx.status !== 'refunded' ? t('customers.requiresAdminPasswordEdit', 'Requires Admin Password to Edit') : t('customers.editItemsPrices', 'Edit Items & Prices')}
                        >
                          <FileEdit size={12} />
                          <span>{t('common.edit', 'Edit')}</span>
                          {!canEditDirectly(tx) && tx.status !== 'refunded' && <span style={{ fontSize: '9px' }}>🔒</span>}
                        </button>

                        <button
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #fecdd3',
                            background: '#fff1f2',
                            fontSize: '11.5px',
                            color: tx.status === 'refunded' ? '#fda4af' : '#e11d48',
                            cursor: tx.status === 'refunded' ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                          }}
                          onClick={() => handleRefundTx(tx)}
                          disabled={tx.status === 'refunded'}
                          title={tx.status === 'refunded' ? t('customers.alreadyRefunded', 'Already refunded') : !canEditDirectly(tx) ? t('customers.requiresAdminPasswordRefund', 'Requires Admin Password to Refund') : t('customers.fullRefund', 'Full Refund')}
                        >
                          <RotateCcw size={12} />
                          <span>{t('customers.refund', 'Refund')}</span>
                          {!canEditDirectly(tx) && tx.status !== 'refunded' && <span style={{ fontSize: '9px' }}>🔒</span>}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
  );
};
