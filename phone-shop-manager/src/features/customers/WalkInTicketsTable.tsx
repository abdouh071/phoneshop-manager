import React from 'react';
import { AlertTriangle, User, Printer, Edit, Eye, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { RepairStatusBadge } from '../../components/ui/Badge';
import { useTranslation } from 'react-i18next';
import type { RepairTicket } from '../../types';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { detectIssueTag, getBrandIcon } from '../repairs/repairConstants';
import { formatDate, formatTimeAgo } from './customersPageUtils';
import styles from './Customers.module.css';

interface WalkInTicketsTableProps {
  sortedWalkInTickets: RepairTicket[];
  pagedWalkInTickets: RepairTicket[];
  walkInSearch: string;
  setWalkInSearch: React.Dispatch<React.SetStateAction<string>>;
  walkInPage: number;
  setWalkInPage: React.Dispatch<React.SetStateAction<number>>;
  totalWalkInPages: number;
  walkInItemsPerPage: number;
  setSelectedWalkInTicket: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setPrintingWalkInTicket: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setTicketToEdit: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setIsNewTicketOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const WalkInTicketsTable: React.FC<WalkInTicketsTableProps> = ({
  sortedWalkInTickets,
  pagedWalkInTickets,
  walkInSearch,
  setWalkInSearch,
  walkInPage,
  setWalkInPage,
  totalWalkInPages,
  walkInItemsPerPage,
  setSelectedWalkInTicket,
  setPrintingWalkInTicket,
  setTicketToEdit,
  setIsNewTicketOpen,
}) => {
  const { t } = useTranslation();

  return (
    <>
          {/* Walk-in Repair Records Table Card */}
          <div className={styles.catalogCard}>
            <div className={styles.tableHeader}>
              <div className={styles.headerLeft}>
                <h2 className={styles.tableTitle}>{t('customers.walkinRepairDirectory', 'Walk-in Repair Directory')}</h2>
                <span className={styles.itemCountBadge}>
                  {t('customers.repairCount', '{{count}} Repair(s)', { count: sortedWalkInTickets.length })}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SearchInput
                  value={walkInSearch}
                  onChange={(v) => { setWalkInSearch(v); setWalkInPage(1); }}
                  onClear={() => { setWalkInSearch(''); setWalkInPage(1); }}
                  placeholder={t('customers.walkinSearchPlaceholder', 'Search by client, device, problem, technician, ticket #…')}
                  className={styles.search}
                />
              </div>
            </div>

            <div className={styles.tableWrapper}>
              {sortedWalkInTickets.length === 0 ? (
                <div style={{ padding: '48px 20px' }}>
                  <EmptyState
                    title={walkInSearch ? t('customers.noMatchingWalkIn', 'No matching walk-in repairs') : t('customers.noWalkInFound', 'No walk-in repairs found')}
                    description={
                      walkInSearch
                        ? `No walk-in repairs matched "${walkInSearch}". Try searching with a different term.`
                        : 'All repair tickets have registered customer accounts with phone numbers. When a repair is created without a phone number, it will automatically appear here as a walk-in record.'
                    }
                    action={
                      walkInSearch ? (
                        <Button variant="secondary" size="sm" onClick={() => setWalkInSearch('')}>
                          {t('customers.clearSearch', 'Clear Search')}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>{t('customers.thTicketDate', 'Ticket / Date')}</th>
                      <th className={styles.th}>{t('customers.thWalkInCustomer', 'Walk-in Customer')}</th>
                      <th className={styles.th}>{t('customers.thDeviceProblem', 'Device & Problem')}</th>
                      <th className={styles.th}>{t('customers.thStatusTech', 'Status & Tech')}</th>
                      <th className={styles.th}>{t('customers.thCostBalance', 'Cost & Balance')}</th>
                      <th className={styles.th} style={{ textAlign: 'right', minWidth: '180px' }}>{t('common.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWalkInTickets.map((ticket) => {
                      const issueTag = detectIssueTag(ticket.issueDescription || '');
                      const brandIcon = getBrandIcon(ticket.deviceModel || '');
                      const cost = ticket.actualCost != null && ticket.actualCost > 0 ? ticket.actualCost : (ticket.estimatedCost || 0);
                      const paid = ticket.paidAmount || 0;
                      const balance = Math.max(0, cost - paid);

                      return (
                        <tr
                          key={ticket.id}
                          className={styles.tr}
                          onClick={() => setSelectedWalkInTicket(ticket)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <span className={styles.ticketBadge}>
                                {ticket.ticketNumber || `#${ticket.id.slice(-6)}`}
                              </span>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {ticket.createdAt ? formatDate(ticket.createdAt) : '—'}
                              </span>
                              {ticket.createdAt && (
                                <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                                  {formatTimeAgo(ticket.createdAt)}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div className={styles.customerCell}>
                              <div
                                className={styles.customerAvatar}
                                style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}
                              >
                                {ticket.customerName ? ticket.customerName.charAt(0).toUpperCase() : '?'}
                              </div>
                              <div className={styles.customerInfoGroup}>
                                <div className={styles.customerNameRow}>
                                  <p className={styles.customerName}>{ticket.customerName || t('customers.anonymousWalkIn', 'Anonymous Walk-in')}</p>
                                  <span className={styles.walkinTag}>Walk-in</span>
                                </div>
                                <span style={{ fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                                  <AlertTriangle size={11} /> {t('customers.noPhoneAlert', 'No phone registered')}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '260px' }}>
                              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span>{brandIcon}</span>
                                <span>{ticket.deviceModel || t('customers.unknownDevice', 'Unknown Device')}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: '11px',
                                  background: '#f1f5f9',
                                  color: '#475569',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}>
                                  <span>{issueTag.icon}</span>
                                  <span>{issueTag.label}</span>
                                </span>
                                {ticket.issueDescription && (
                                  <span
                                    style={{
                                      fontSize: '11.5px',
                                      color: '#64748b',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      maxWidth: '170px'
                                    }}
                                    title={ticket.issueDescription}
                                  >
                                    {ticket.issueDescription}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <RepairStatusBadge status={ticket.status} />
                              <span style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <User size={12} />
                                {ticket.assignedTechnician || t('customers.unassigned', 'Unassigned')}
                              </span>
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span className={styles.spentValue}>
                                {formatPrivateCurrency(cost)}
                              </span>
                              {balance > 0 ? (
                                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 700 }}>
                                  {t('customers.dueBalance', 'Due: {{amount}}', { amount: formatPrivateCurrency(balance) })}
                                </span>
                              ) : (
                                <span className={styles.settledBadge}>
                                  <CheckCircle2 size={11} /> {t('customers.settledBadge', '✓ Settled')}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className={styles.td}>
                            <div className={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={styles.quickActionBtn}
                                title={t('customers.printTicketTooltip', 'Print Ticket Label / Receipt')}
                                onClick={() => setPrintingWalkInTicket(ticket)}
                              >
                                <Printer size={14} />
                              </button>
                              <button
                                type="button"
                                className={styles.quickActionBtn}
                                title={t('customers.editWalkInTooltip', 'Edit Repair / Add Phone Number (Converts to Account)')}
                                onClick={() => {
                                  setTicketToEdit(ticket);
                                  setIsNewTicketOpen(true);
                                }}
                              >
                                <Edit size={14} />
                              </button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setSelectedWalkInTicket(ticket)}
                                title="Open Sidebar Details Widget"
                              >
                                <Eye size={14} /> {t('customers.details', 'Details')}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {sortedWalkInTickets.length > 0 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0' }}>
                <Pagination
                  currentPage={walkInPage}
                  totalPages={totalWalkInPages}
                  onPageChange={setWalkInPage}
                  itemsPerPage={walkInItemsPerPage}
                  totalItems={sortedWalkInTickets.length}
                />
              </div>
            )}
          </div>
    </>
  );
};
