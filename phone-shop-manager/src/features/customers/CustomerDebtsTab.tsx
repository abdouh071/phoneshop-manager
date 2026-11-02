import React from 'react';
import type { Customer, CustomerDebtEntry } from '../../types';
import { FileText, Plus, Send, DollarSign, Edit2, Trash2 } from 'lucide-react';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { isDebtOverdue, getDaysOverdue, buildWhatsAppDebtReminderUrl } from '../../utils/debtAlerts';
import styles from './CustomerProfile.module.css';

interface CustomerDebtsTabProps {
  customer: Customer;
  customerDebts: CustomerDebtEntry[];
  totalDebtBalance: number;
  formatDate: (iso: string) => string;
  setIsStatementOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleAddDebtClick: () => void;
  handleRecordPaymentClick: (debt: CustomerDebtEntry) => void;
  handleEditDebtClick: (debt: CustomerDebtEntry) => void;
  handleDeleteDebt: (debt: CustomerDebtEntry) => void;
  editingDebtId: string | null;
  setEditingDebtId: React.Dispatch<React.SetStateAction<string | null>>;
  editDebtName: string;
  setEditDebtName: React.Dispatch<React.SetStateAction<string>>;
  editDebtAmount: string;
  setEditDebtAmount: React.Dispatch<React.SetStateAction<string>>;
}

export const CustomerDebtsTab: React.FC<CustomerDebtsTabProps> = ({
  customer,
  customerDebts,
  totalDebtBalance,
  formatDate,
  setIsStatementOpen,
  handleAddDebtClick,
  handleRecordPaymentClick,
  handleEditDebtClick,
  handleDeleteDebt,
  editingDebtId,
  setEditingDebtId,
  editDebtName,
  setEditDebtName,
  editDebtAmount,
  setEditDebtAmount,
}) => {
  const { updateDebtAmount } = useCustomerStore();
  const { user } = useAuthStore();
  const toast = useToast();
  const { t } = useTranslation();

  return (
    <>
                <div className={styles.debtSummaryBanner}>
                  <div className={styles.debtSummaryLeft}>
                    <span className={styles.debtSummaryLabel}>{t('customers.totalOutstandingDebt', 'Total Outstanding Debt')}</span>
                    <p className={styles.debtSummaryValue}>{formatPrivateCurrency(totalDebtBalance)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={styles.addDebtBtn}
                      onClick={() => setIsStatementOpen(true)}
                      style={{ background: '#ffffff', color: '#1e293b', border: '1px solid #cbd5e1' }}
                      title="Generate Full Account Statement & PDF"
                    >
                      <FileText size={13} /> {t('customers.statementPdf', 'Statement / PDF')}
                    </button>
                    <button
                      type="button"
                      className={styles.addDebtBtn}
                      onClick={() => handleAddDebtClick()}
                    >
                      <Plus size={14} /> {t('customers.addDebtRecord', '+ Add Debt Record')}
                    </button>
                  </div>
                </div>

                {customerDebts.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t('customers.noDebtsFound', 'No debt or credit records found for this customer. All settled!')}
                  </div>
                ) : (
                  customerDebts.map(debt => {
                    const pct = debt.totalAmount > 0 ? Math.min(100, (debt.amountPaid / debt.totalAmount) * 100) : 0;
                    const overdue = isDebtOverdue(debt);
                    const daysLate = getDaysOverdue(debt.dueDate);

                    return (
                      <div key={debt.id} className={styles.debtCard} data-privacy-client-financial="true" style={overdue ? { borderColor: '#fca5a5', background: '#fffafa' } : {}}>
                        {editingDebtId === debt.id ? (
                          /* ── Inline Edit Mode ── */
                          <div className={styles.debtEditForm}>
                            <div className={styles.debtEditField}>
                              <label className={styles.debtEditLabel}>{t('customers.itemOrPhoneName', 'Item / Phone Name')}</label>
                              <input
                                type="text"
                                className={styles.debtEditInput}
                                value={editDebtName}
                                onChange={e => setEditDebtName(e.target.value)}
                                placeholder="e.g. iPhone 14 Pro Max"
                                autoFocus
                              />
                            </div>
                            <div className={styles.debtEditField}>
                              <label className={styles.debtEditLabel}>{t('customers.totalAmountDH', 'Total Amount (DH)')}</label>
                              <input
                                type="number"
                                className={`${styles.debtEditInput} privacy-cost-input`}
                                value={editDebtAmount}
                                onChange={e => setEditDebtAmount(e.target.value)}
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                              />
                            </div>
                            <div className={styles.debtEditActions}>
                              <button
                                type="button"
                                className={styles.debtEditSaveBtn}
                                onClick={async () => {
                                  const newAmount = parseFloat(editDebtAmount);
                                  const newName = editDebtName.trim();
                                  if (!newName) { toast.error(t('customers.validationError', 'Validation error'), t('customers.specifyProductError', 'Item name cannot be empty.')); return; }
                                  if (isNaN(newAmount) || newAmount < 0) { toast.error(t('customers.validationError', 'Validation error'), 'Amount must be a valid positive number.'); return; }
                                  if (newAmount < debt.amountPaid) { toast.error(t('customers.validationError', 'Validation error'), `Amount cannot be less than already paid (${formatPrivateCurrency(debt.amountPaid)}).`); return; }
                                  try {
                                    await updateDebtAmount(debt.id, newAmount, newName);
                                    toast.success(t('customers.debtUpdated', 'Debt Updated'), `Updated to "${newName}" — ${formatPrivateCurrency(newAmount)}`);
                                    setEditingDebtId(null);
                                  } catch {
                                    toast.error(t('common.error', 'Error'), 'Failed to update debt record.');
                                  }
                                }}
                              >
                                {t('common.save', 'Save')}
                              </button>
                              <button
                                type="button"
                                className={styles.debtEditCancelBtn}
                                onClick={() => setEditingDebtId(null)}
                              >
                                {t('common.cancel', 'Cancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Normal View Mode ── */
                          <>
                        <div className={styles.debtCardHeader}>
                          <div>
                            <p className={styles.debtTitle}>{debt.productOrService}</p>
                            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                              {t('customers.takenOn', 'Taken on {{date}}', { date: formatDate(debt.date) })}
                              {debt.dueDate ? (
                                <strong style={{ color: overdue ? '#dc2626' : undefined }}>
                                  {t('customers.dueBy', ' · Due by {{date}}', { date: formatDate(debt.dueDate) })}
                                </strong>
                              ) : ''}
                            </span>
                          </div>
                          <div>
                            {debt.status === 'paid' ? (
                              <span className={styles.debtBadgePaid}>{t('customers.settledBadge', '✅ Settled')}</span>
                            ) : overdue ? (
                              <span className={styles.debtBadgeOverdue}>{t('customers.overdueBadge', '🔴 OVERDUE ({{days}}d late)', { days: daysLate })}</span>
                            ) : debt.status === 'partially_paid' ? (
                              <span className={styles.debtBadgePartial}>{t('customers.partialBadge', '🟡 Partial ({{amount}} left)', { amount: formatPrivateCurrency(debt.remainingBalance) })}</span>
                            ) : (
                              <span className={styles.debtBadgeUnpaid}>{t('customers.unpaidBadge', '🚨 Unpaid')}</span>
                            )}
                          </div>
                        </div>

                        {debt.notes && (
                          <p className={styles.debtNotes}>{debt.notes}</p>
                        )}

                        {/* Progress track */}
                        <div>
                          <div className={styles.debtProgressTrack}>
                            <div className={styles.debtProgressBar} style={{ width: `${pct}%`, background: overdue ? '#dc2626' : '#16a34a' }} />
                          </div>
                          <div className={styles.debtNumbersRow} style={{ marginTop: '4px' }}>
                            <span>{t('customers.paidAmountProgress', 'Paid: {{amount}} ({{pct}}%)', { amount: formatPrivateCurrency(debt.amountPaid), pct: Math.round(pct) })}</span>
                            <span style={{ fontWeight: 700, color: debt.remainingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                              {t('customers.balanceOwed', 'Balance Owed: {{amount}}', { amount: formatPrivateCurrency(debt.remainingBalance) })}
                            </span>
                          </div>
                        </div>

                        {/* Payment History Log */}
                        {debt.payments && debt.payments.length > 0 && (
                          <div className={styles.paymentHistoryList}>
                            <p className={styles.paymentHistoryTitle}>{t('customers.paymentHistoryCount', 'Payment History ({{count}})', { count: debt.payments.length })}</p>
                            {debt.payments.map(pay => (
                              <div key={pay.id} className={styles.paymentHistoryRow} data-privacy-client-financial="true">
                                <span>{formatDate(pay.date)} · {pay.method.toUpperCase()} {pay.note ? `(${pay.note})` : ''}</span>
                                <strong style={{ color: '#16a34a' }}>+{formatPrivateCurrency(pay.amount)}</strong>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className={styles.debtActionsRow}>
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                            Total: {formatPrivateCurrency(debt.totalAmount)}
                          </span>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {debt.remainingBalance > 0 && (
                              <a
                                href={buildWhatsAppDebtReminderUrl({
                                  customerName: customer.name,
                                  customerPhone: customer.phone,
                                  productOrService: debt.productOrService,
                                  amountOwed: debt.remainingBalance,
                                  dueDate: debt.dueDate,
                                  daysOverdue: daysLate,
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.payDebtBtn}
                                style={{ background: '#25D366', textDecoration: 'none' }}
                                title={overdue ? `Send WhatsApp Overdue Reminder (${daysLate}d late)` : 'Send WhatsApp Reminder'}
                              >
                                <Send size={12} /> {t('customers.whatsappReminder', 'WhatsApp Reminder')}
                              </a>
                            )}
                            {debt.remainingBalance > 0 && (
                              <button
                                type="button"
                                className={styles.payDebtBtn}
                                onClick={() => handleRecordPaymentClick(debt)}
                              >
                                <DollarSign size={13} /> {t('customers.recordPayment', 'Record Payment')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleEditDebtClick(debt)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#3b82f6',
                                cursor: 'pointer',
                              }}
                              title="Edit item name & amount"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDebt(debt)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#94a3b8',
                                cursor: 'pointer',
                              }}
                              title={user?.role === 'admin' ? "Delete record" : "Delete record (Requires Admin Password)"}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
    </>
  );
};
