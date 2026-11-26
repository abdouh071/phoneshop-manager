import React from 'react';
import { Phone, Eye, Edit, MessageCircle, Wrench, ShoppingCart, FileText, Store, User, GitMerge, Trash2, Send, Smartphone } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../../hooks/usePermissions';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui/Toast';
import type { Customer, CustomerDebtEntry, RepairTicket } from '../../types';
import { isShopCustomer } from '../../types';
import type { User as AuthUser } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { getCustomerOverdueInfo, buildWhatsAppDebtReminderUrl } from '../../utils/debtAlerts';
import { normalizePhoneDigits, formatWhatsAppUrl } from '../../utils/phoneUtils';
import { formatDate } from './customersPageUtils';
import styles from './Customers.module.css';

interface CustomerLoyaltyBadgeProps {
  customer: Customer;
}

const CustomerLoyaltyBadge: React.FC<CustomerLoyaltyBadgeProps> = ({ customer }) => {
  const { t } = useTranslation();

  if (customer.accountType === 'shop_repairer' || customer.accountType === 'b2b' || customer.shopName) {
    return <span className={`${styles.loyaltyBadge} ${styles.loyaltyB2B}`}>{t('customers.tierB2B', '🏪 B2B Shop')}</span>;
  }
  if (customer.totalSpent >= 1000) {
    return <span className={`${styles.loyaltyBadge} ${styles.loyaltyVIP}`}>{t('customers.tierVIP', '⭐ VIP Tier')}</span>;
  }
  if (customer.totalPurchases >= 2) {
    return <span className={`${styles.loyaltyBadge} ${styles.loyaltyRepeat}`}>{t('customers.tierRepeat', '🔄 Repeat')}</span>;
  }
  return <span className={`${styles.loyaltyBadge} ${styles.loyaltyNew}`}>{t('customers.tierNew', '🌱 New')}</span>;
};

interface CustomerTableRowProps {
  customer: Customer;
  debts: CustomerDebtEntry[];
  customerTicketsMap: Map<string, RepairTicket[]>;
  customerDeviceCountMap: Map<string, number>;
  userRole?: AuthUser['role'];
  setSelectedCustomer: React.Dispatch<React.SetStateAction<Customer | null>>;
  setRepairPrefill: React.Dispatch<React.SetStateAction<{ name: string; phone: string; lastDevice?: string } | null>>;
  setTicketToEdit: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setIsNewTicketOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStatementCustomer: React.Dispatch<React.SetStateAction<Customer | null>>;
  setCustomerToSwitch: React.Dispatch<React.SetStateAction<Customer | null>>;
  setMergeInitialA: React.Dispatch<React.SetStateAction<Customer | null>>;
  setMergeInitialB: React.Dispatch<React.SetStateAction<Customer | null>>;
  setIsMergeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  handleDeleteCustomerClick: (customer: Customer) => void;
  handleEditCustomerClick: (customer: Customer) => void;
}

export const CustomerTableRow: React.FC<CustomerTableRowProps> = ({
  customer,
  debts,
  customerTicketsMap,
  customerDeviceCountMap,
  userRole,
  setSelectedCustomer,
  setRepairPrefill,
  setTicketToEdit,
  setIsNewTicketOpen,
  setStatementCustomer,
  setCustomerToSwitch,
  setMergeInitialA,
  setMergeInitialB,
  setIsMergeOpen,
  setCustomerName,
  setCustomerPhone,
  handleDeleteCustomerClick,
  handleEditCustomerClick,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const debt = customer.totalDebt || 0;
  const overdueInfo = getCustomerOverdueInfo(debts, customer.id);
  const cTickets = customerTicketsMap.get(customer.id) || [];
  const cRepairsCount = cTickets.length;
  // Use pre-computed device count map (no per-row Set rebuild)
  const distinctPhonesCount = customerDeviceCountMap.get(customer.id) || 0;

  return (
                    <tr
                      className={styles.tr}
                      onClick={() => setSelectedCustomer(customer)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className={styles.td}>
                        <div className={styles.customerCell}>
                          <div
                            className={[
                              styles.customerAvatar,
                              overdueInfo.hasOverdue
                                ? styles.customerAvatarOverdue
                                : customer.shopName
                                  ? styles.customerAvatarB2B
                                  : ''
                            ].filter(Boolean).join(' ')}
                          >
                            {customer.shopName ? '🏪' : customer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className={styles.customerInfoGroup}>
                            <div className={styles.customerNameRow}>
                              <p className={styles.customerName}>{customer.shopName || customer.name}</p>
                              {customer.shopName && (
                                <span className={styles.customerB2BTag}>B2B</span>
                              )}
                              {customer.id.startsWith('offline_') && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    background: '#fef3c7',
                                    color: '#b45309',
                                    border: '1px solid #fde68a',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title={t('customers.offlineQueuedTitle', 'Created offline. Queued to sync to Firestore automatically when online.')}
                                >
                                  {t('customers.offlineQueuedBadge', '☁️ Offline (Queued)')}
                                </span>
                              )}
                            </div>
                            {customer.shopName && (
                              <span className={styles.customerContactSub}>{t('customers.contactPrefix', 'Contact: {{name}}', { name: customer.name })}</span>
                            )}
                            <span className={styles.customerJoinDate}>
                              {t('customers.sinceDate', 'Since {{date}}', { date: formatDate(customer.joinDate) })}
                            </span>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                              {distinctPhonesCount > 0 && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    background: '#e0f2fe',
                                    color: '#0369a1',
                                    border: '1px solid #bae6fd',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title={`${distinctPhonesCount} distinct device(s) tracked`}
                                >
                                  <Smartphone size={11} /> {t('customers.deviceCount', '{{count}} Device(s)', { count: distinctPhonesCount })}
                                </span>
                              )}
                              {cRepairsCount > 0 && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    background: '#f3e8ff',
                                    color: '#7e22ce',
                                    border: '1px solid #e9d5ff',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title={`${cRepairsCount} repair ticket(s) recorded`}
                                >
                                  🛠️ {t('customers.repairCount', '{{count}} Repair(s)', { count: cRepairsCount })}
                                </span>
                              )}
                            </div>
                            {permissions.customers_debt && (overdueInfo.hasOverdue ? (
                              <div>
                                <span className={styles.overdueBadgeTag}>
                                  {t('customers.overdueBadgeText', '🔴 OVERDUE: {{amount}} ({{days}}d late)', {
                                    amount: formatPrivateCurrency(overdueInfo.totalOverdueAmount),
                                    days: overdueInfo.maxDaysOverdue
                                  })}
                                </span>
                              </div>
                            ) : debt > 0 ? (
                              <div>
                                <span className={styles.debtBadgeTag}>
                                  {t('customers.debtBadgeText', '🚨 Debt: {{amount}}', { amount: formatPrivateCurrency(debt) })}
                                </span>
                              </div>
                            ) : null)}
                          </div>
                        </div>
                      </td>
                      <td className={styles.td}>
                        <div className={styles.contactInfo}>
                          {customer.phone ? (
                            <a
                              href={`tel:${customer.phone}`}
                              className={styles.contactPhone}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={12} /> {customer.phone}
                            </a>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>{t('customers.noPhone', 'No phone')}</span>
                          )}
                          {customer.email && (
                            <a
                              href={`mailto:${customer.email}`}
                              className={styles.contactEmail}
                              title={customer.email}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {customer.email}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className={styles.td}>
                        <CustomerLoyaltyBadge customer={customer} />
                      </td>
                      <td className={styles.td} style={{ textAlign: 'center' }}>
                        <span className={styles.ordersCount}>{customer.totalPurchases}</span>
                        {cRepairsCount > 0 && (
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#6b7280', fontWeight: 600, marginTop: '2px' }}>
                            {t('customers.moreRepairs', '+ {{count}} repair(s)', { count: cRepairsCount })}
                          </span>
                        )}
                      </td>
                      <td className={styles.td} data-col="spent">
                        <span className={styles.spentValue}>{formatPrivateCurrency(customer.totalSpent)}</span>
                      </td>
                      {permissions.customers_debt && (
                        <td className={styles.td} data-col="debt">
                          {overdueInfo.hasOverdue ? (
                            <div>
                              <span style={{ fontWeight: 800, color: '#dc2626', display: 'block', fontSize: '13.5px' }}>
                                {formatPrivateCurrency(debt)}
                              </span>
                              <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 700 }}>
                                🔴 {overdueInfo.count} Overdue ({overdueInfo.maxDaysOverdue}d)
                              </span>
                            </div>
                          ) : debt > 0 ? (
                            <div>
                              <span style={{ fontWeight: 800, color: '#d97706', display: 'block', fontSize: '13.5px' }}>
                                {formatPrivateCurrency(debt)}
                              </span>
                              <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
                                {t('customers.activeTabBadge', 'Active Tab')}
                              </span>
                            </div>
                          ) : (
                            <span className={styles.settledBadge}>
                              {t('customers.settledBadge', '✓ Settled')}
                            </span>
                          )}
                          {(customer.storeCredit || 0) > 0 && (
                            <span style={{ fontSize: '10.5px', color: '#047857', fontWeight: 700, background: '#d1fae5', border: '1px solid #a7f3d0', borderRadius: '4px', padding: '1px 5px', display: 'inline-block', marginTop: '3px' }}>
                              {t('customers.storeCreditBadge', '🎟️ Avoir: {{amount}}', { amount: formatPrivateCurrency(customer.storeCredit || 0) })}
                            </span>
                          )}
                        </td>
                      )}
                      <td className={styles.td}>
                        <span className={styles.lastVisitText}>{formatDate(customer.lastVisitDate)}</span>
                      </td>
                      <td className={styles.td} style={{ textAlign: 'right' }}>
                        <div className={styles.actionButtons}>
                          {/* WhatsApp Reminder (Pre-filled Debt Notice) */}
                          {permissions.customers_debt && debt > 0 && (() => {
                            const reminderUrl = buildWhatsAppDebtReminderUrl({
                              customerName: customer.name,
                              customerPhone: customer.phone,
                              amountOwed: debt,
                              dueDate: overdueInfo.oldestDueDate,
                              daysOverdue: overdueInfo.maxDaysOverdue,
                            });
                            return reminderUrl ? (
                              <a
                                href={reminderUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${styles.quickActionBtn} ${styles.reminderBtn}`}
                                title={overdueInfo.hasOverdue ? t('customers.sendOverdueReminder', 'Send WhatsApp Overdue Reminder ({{days}}d late)', { days: overdueInfo.maxDaysOverdue }) : t('customers.sendDebtReminder', 'Send WhatsApp Debt Balance Reminder')}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Send size={13} />
                              </a>
                            ) : null;
                          })()}
                          {/* 1-Click Regular WhatsApp */}
                          {(() => {
                            const waUrl = formatWhatsAppUrl(customer.phone);
                            return waUrl ? (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${styles.quickActionBtn} ${styles.whatsappBtn}`}
                                title={t('customers.whatsappChat', 'WhatsApp Chat')}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageCircle size={14} />
                              </a>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className={`${styles.quickActionBtn} ${styles.disabledActionBtn}`}
                                title={t('customers.noPhoneTooltip', 'No phone number registered')}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageCircle size={14} />
                              </button>
                            );
                          })()}
                          {/* 1-Click Call */}
                          {customer.phone && normalizePhoneDigits(customer.phone).length >= 7 ? (
                            <a
                              href={`tel:${customer.phone.replace(/\s+/g, '')}`}
                              className={`${styles.quickActionBtn} ${styles.phoneBtn}`}
                              title={t('customers.callCustomer', 'Call {{phone}}', { phone: customer.phone })}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={14} />
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className={`${styles.quickActionBtn} ${styles.disabledActionBtn}`}
                              title={t('customers.noPhoneTooltip', 'No phone number registered')}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone size={14} />
                            </button>
                          )}
                          {/* New Repair Quick Action */}
                          {permissions.repairs && (
                            <button
                              type="button"
                              className={`${styles.quickActionBtn} ${styles.repairBtn}`}
                              title={t('customers.newRepairTicket', 'New Repair Ticket')}
                              onClick={(e) => {
                                e.stopPropagation();
                                const cTickets = customerTicketsMap.get(customer.id) || [];
                                let lastDevice: string | undefined;
                                if (customer.registeredDevices && customer.registeredDevices.length > 0) {
                                  const d = customer.registeredDevices[0];
                                  lastDevice = `${d.brand} ${d.model}`.trim();
                                } else if (cTickets.length > 0) {
                                  const sortedTickets = [...cTickets].sort(
                                    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
                                  );
                                  lastDevice = `${sortedTickets[0].deviceBrand || ''} ${sortedTickets[0].deviceModel || ''}`.trim() || undefined;
                                }
                                setRepairPrefill({ name: customer.name, phone: customer.phone || '', lastDevice });
                                setTicketToEdit(null);
                                setIsNewTicketOpen(true);
                              }}
                            >
                              <Wrench size={14} />
                            </button>
                          )}
                          {/* New Sale Quick Action */}
                          <button
                            type="button"
                            className={`${styles.quickActionBtn} ${styles.posBtn}`}
                            title={t('customers.newPosSale', 'New POS Sale')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomerName(customer.name);
                              setCustomerPhone(customer.phone || '');
                              useCartStore.getState().setCustomerId(customer.id);
                              toast.success(t('customers.customerAttachedToast', 'Customer Attached'), t('customers.customerAttachedDesc', '{{name}} attached to ticket / POS sale.', { name: customer.name }));
                              navigate('/pos');
                            }}
                          >
                            <ShoppingCart size={14} />
                          </button>
                          {/* Account Statement Quick Action */}
                          {permissions.customers_debt && (
                            <button
                              type="button"
                              className={`${styles.quickActionBtn} ${styles.statementBtn}`}
                              title={t('customers.accountStatement', 'Account Statement')}
                              onClick={(e) => {
                                e.stopPropagation();
                                setStatementCustomer(customer);
                              }}
                            >
                              <FileText size={14} />
                            </button>
                          )}
                          {/* Switch Account Type Quick Action */}
                          <button
                            type="button"
                            className={styles.quickActionBtn}
                            title={isShopCustomer(customer) ? t('customers.switchToRetail', 'Switch to Retail Client') : t('customers.switchToShop', 'Switch to B2B Shop')}
                            style={{
                              background: isShopCustomer(customer) ? '#eff6ff' : '#fef3c7',
                              color: isShopCustomer(customer) ? '#1e40af' : '#b45309',
                              borderColor: isShopCustomer(customer) ? '#bfdbfe' : '#fde68a',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomerToSwitch(customer);
                            }}
                          >
                            {isShopCustomer(customer) ? <User size={14} /> : <Store size={14} />}
                          </button>
                          {/* Merge Account Quick Action */}
                          <button
                            type="button"
                            className={styles.quickActionBtn}
                            title={t('customers.mergeAccount', 'Merge with another account')}
                            style={{
                              background: '#f8fafc',
                              color: '#475569',
                              borderColor: '#cbd5e1',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMergeInitialA(customer);
                              setMergeInitialB(null);
                              setIsMergeOpen(true);
                            }}
                          >
                            <GitMerge size={14} />
                          </button>
                          {/* Delete Customer Quick Action */}
                          <button
                            type="button"
                            className={styles.quickActionBtn}
                            title={userRole === 'admin' ? t('customers.deleteCustomer', 'Delete customer account') : `${t('customers.deleteCustomer', 'Delete customer account')} (Requires Admin Password)`}
                            style={{
                              background: '#fff5f5',
                              color: '#dc2626',
                              borderColor: '#fca5a5',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomerClick(customer);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditCustomerClick(customer);
                            }}
                            title={userRole === 'admin' ? t('customers.editCustomer', 'Edit Customer Details') : `${t('customers.editCustomer', 'Edit Customer Details')} (Requires Admin Password)`}
                          >
                            <Edit size={14} />
                            {userRole !== 'admin' && <span style={{ fontSize: '9px', marginLeft: '2px' }}>🔒</span>}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCustomer(customer);
                            }}
                            title={t('customers.openProfile', 'View Customer 360° Profile')}
                          >
                            <Eye size={14} /> {t('common.view', 'View')}
                          </Button>
                        </div>
                      </td>
                    </tr>
  );
};
