import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Edit, Trash2, Wrench } from 'lucide-react';
import type { RepairTicket } from '../../types';
import { useTranslation } from 'react-i18next';
import { RepairStatusBadge } from '../../components/ui/Badge';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { isTicketActiveReturnPending } from '../../utils/phoneLifecycle';
import styles from './CustomerProfile.module.css';

interface CustomerRepairsTabProps {
  customerTickets: RepairTicket[];
  tickets: RepairTicket[];
  mostRecentDevice: string | undefined;
  onClose: () => void;
  formatDate: (iso: string) => string;
  setTicketPrefillDevice: React.Dispatch<React.SetStateAction<string | undefined>>;
  setTicketToEdit: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setIsNewTicketOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPrintingTicket: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setTicketToDelete: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
}

export const CustomerRepairsTab: React.FC<CustomerRepairsTabProps> = ({
  customerTickets,
  tickets,
  mostRecentDevice,
  onClose,
  formatDate,
  setTicketPrefillDevice,
  setTicketToEdit,
  setIsNewTicketOpen,
  setPrintingTicket,
  setTicketToDelete,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    {t('customers.ticketsLinkedToCustomer', '{{count}} ticket(s) linked to this customer', { count: customerTickets.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTicketPrefillDevice(mostRecentDevice);
                      setTicketToEdit(null);
                      setIsNewTicketOpen(true);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={12} /> {t('customers.newTicket', 'New Ticket')}
                  </button>
                </div>

                {customerTickets.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t('customers.noRepairsLogged', 'No repair tickets logged for this customer yet.')}
                  </div>
                ) : (
                  customerTickets.map(tk => {
                    const isActivelyReturned = isTicketActiveReturnPending(tk, tickets);
                    const effectiveStatus = (tk.status === 'returned' && !isActivelyReturned) ? 'completed' : tk.status;
                    const totalCost = tk.actualCost ?? tk.estimatedCost ?? 0;
                    const deposit = tk.depositAmount || 0;
                    const paid = tk.paidAmount ?? deposit;
                    const debt = Math.max(0, totalCost - paid);

                    return (
                    <div
                      key={tk.id}
                      className={styles.ticketCard}
                      onClick={() => {
                        onClose();
                        navigate(`/repairs?focusId=${tk.ticketNumber}`);
                      }}
                      style={{ cursor: 'pointer', transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}
                      title={t('customers.viewFullTicketOnBoard', 'Click to view full repair ticket details on Workshop Board')}
                    >
                      <div className={styles.ticketCardHeader}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className={styles.ticketNumber}>#{tk.ticketNumber}</span>
                          {tk.isReturn && (
                            <span style={{ background: '#fef08a', color: '#854d0e', fontSize: '10px', padding: '2px 5px', borderRadius: '4px', fontWeight: 600 }}>
                              🔁 {t('customers.returnBadge', 'RETURN')}
                            </span>
                          )}
                          {tk.status === 'returned' && !isActivelyReturned && (
                            <span style={{ background: '#dcfce7', color: '#166534', fontSize: '10px', padding: '2px 5px', borderRadius: '4px', fontWeight: 600 }}>
                              ✅ {t('customers.returnResolvedBadge', 'RETURN RESOLVED')}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <RepairStatusBadge status={effectiveStatus} />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrintingTicket(tk);
                            }}
                            title={t('customers.printLabelReceipt', 'Print label / intake receipt')}
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              cursor: 'pointer',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                            }}
                          >
                            <Printer size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketToEdit(tk);
                              setIsNewTicketOpen(true);
                            }}
                            title="Edit this repair ticket"
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              cursor: 'pointer',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                            }}
                          >
                            <Edit size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketToDelete(tk);
                            }}
                            title="Delete this repair ticket"
                            style={{
                              background: '#fee2e2',
                              border: '1px solid #fca5a5',
                              color: '#dc2626',
                              cursor: 'pointer',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <p className={styles.ticketDevice}>{tk.deviceBrand} {tk.deviceModel}</p>
                      <p className={styles.ticketIssue}>{tk.issueDescription}</p>

                      {/* Technician Remark / Findings */}
                      {tk.remark && (
                        <div style={{
                          fontSize: '11px',
                          color: '#475569',
                          background: '#f8fafc',
                          border: '1px dashed #cbd5e1',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          margin: '4px 0',
                        }}>
                          <strong>{t('customers.techNote', 'Tech Note / Findings:')}</strong> "{tk.remark}"
                        </div>
                      )}

                      {/* Spare Parts Installed on this device */}
                      {tk.partsUsed && tk.partsUsed.length > 0 && (
                        <div style={{
                          fontSize: '11px',
                          color: '#0369a1',
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          margin: '4px 0',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '4px',
                          alignItems: 'center',
                        }}>
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Wrench size={10} /> {t('customers.sparePartsUsed', 'Spare Parts Used:')}
                          </strong>
                          {tk.partsUsed.map((p, i: number) => (
                            <span key={i} style={{ background: '#ffffff', padding: '1px 5px', borderRadius: '3px', border: '1px solid #e0f2fe' }}>
                              {p.quantity}× {p.name} ({formatPrivateCurrency(p.cost)})
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Return reason banner if returned */}
                      {tk.returnReason && (
                        <div style={{
                          fontSize: '11.5px',
                          color: '#9a3412',
                          background: '#fff7ed',
                          border: '1px solid #ffedd5',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          margin: '4px 0',
                          fontStyle: 'italic',
                        }}>
                          <strong>{t('customers.returnReason', 'Return Reason:')}</strong> "{tk.returnReason}"
                        </div>
                      )}

                      <div className={styles.ticketFooter}>
                        <span className={styles.ticketDate}>
                          {t('customers.broughtDate', 'Brought: {{date}}', { date: formatDate(tk.createdAt) })}
                          {tk.completedAt && (
                            <span style={{ color: '#059669', marginLeft: '5px' }}>
                              · {t('customers.takenDate', 'Taken: {{date}}', { date: formatDate(tk.completedAt) })}
                            </span>
                          )}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                          <span className={styles.ticketCost}>
                            {tk.actualCost ? formatPrivateCurrency(tk.actualCost) : `Est. ${formatPrivateCurrency(tk.estimatedCost)}`}
                          </span>
                          {deposit > 0 && (
                            <span style={{ fontSize: '10.5px', color: '#16a34a' }}>
                              {t('customers.depositAmount', 'Deposit: {{amount}}', { amount: formatPrivateCurrency(deposit) })}
                            </span>
                          )}
                          {tk.handoverAmountPaid && tk.handoverAmountPaid > 0 ? (
                            <span style={{ fontSize: '10.5px', color: '#059669', fontWeight: 600 }}>
                              {t('customers.handoverPaidAmount', 'Handover Paid: {{amount}}', { amount: formatPrivateCurrency(tk.handoverAmountPaid) })}
                            </span>
                          ) : null}
                          {debt > 0 ? (
                            <span style={{ fontSize: '10.5px', color: '#dc2626', fontWeight: 600 }}>
                              {t('customers.debtRemaining', '⚠️ Debt: {{amount}}', { amount: formatPrivateCurrency(debt) })}
                            </span>
                          ) : (effectiveStatus === 'completed' || tk.paymentStatus === 'paid') ? (
                            <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 700 }}>
                              {t('customers.paidInFull', '✅ Paid in Full')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div style={{
                        marginTop: '8px',
                        paddingTop: '6px',
                        borderTop: '1px dashed #f1f5f9',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '11px',
                        color: '#64748b'
                      }}>
                        <span>{tk.assignedTechnician ? t('customers.techAssigned', 'Tech: {{name}}', { name: tk.assignedTechnician }) : t('customers.unassigned', 'Unassigned')}</span>
                        <span style={{ color: 'var(--color-primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          {t('customers.viewTicketOnBoard', 'View Ticket on Board →')}
                        </span>
                      </div>
                    </div>
                  );
                })
                )}
    </>
  );
};
