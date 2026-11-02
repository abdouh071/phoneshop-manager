import React from 'react';
import { Smartphone, Plus, Wrench, Edit2, Trash2 } from 'lucide-react';
import type { RepairTicket } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import type { CustomerDeviceStat } from './customerDeviceStats';
import styles from './CustomerProfile.module.css';

interface CustomerDeviceFleetSectionProps {
  deviceStats: Array<readonly [string, CustomerDeviceStat]>;
  setTicketPrefillDevice: React.Dispatch<React.SetStateAction<string | undefined>>;
  setTicketToEdit: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  setIsNewTicketOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDeviceToEdit: React.Dispatch<React.SetStateAction<{ id?: string; oldBrand: string; oldModel: string; brand: string; model: string; imei?: string; notes?: string } | null>>;
  setDeleteDeviceRepairsToo: React.Dispatch<React.SetStateAction<boolean>>;
  setDeviceToDelete: React.Dispatch<React.SetStateAction<{ device: string; brand: string; model: string; tickets: RepairTicket[] } | null>>;
  setNewPhoneBrand: React.Dispatch<React.SetStateAction<string>>;
  setNewPhoneModel: React.Dispatch<React.SetStateAction<string>>;
  setNewPhoneImei: React.Dispatch<React.SetStateAction<string>>;
  setNewPhoneNotes: React.Dispatch<React.SetStateAction<string>>;
  setCreateTicketForNewPhone: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAddPhoneOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const CustomerDeviceFleetSection: React.FC<CustomerDeviceFleetSectionProps> = ({
  deviceStats,
  setTicketPrefillDevice,
  setTicketToEdit,
  setIsNewTicketOpen,
  setDeviceToEdit,
  setDeleteDeviceRepairsToo,
  setDeviceToDelete,
  setNewPhoneBrand,
  setNewPhoneModel,
  setNewPhoneImei,
  setNewPhoneNotes,
  setCreateTicketForNewPhone,
  setIsAddPhoneOpen,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();

  // Registered Phones Section — Clean, Compact Fleet
  return (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Smartphone size={15} /> {t('common.registeredPhones', 'Registered Phones')} ({deviceStats.length})
              </h3>
              <button
                type="button"
                onClick={() => {
                  setNewPhoneBrand('');
                  setNewPhoneModel('');
                  setNewPhoneImei('');
                  setNewPhoneNotes('');
                  setCreateTicketForNewPhone(false);
                  setIsAddPhoneOpen(true);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 9px',
                  borderRadius: '6px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#1d4ed8',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Register a new phone for this customer"
              >
                <Plus size={12} /> {t('customers.addPhone', 'Add Phone')}
              </button>
            </div>

            {deviceStats.length === 0 ? (
              <div style={{
                padding: '12px 16px',
                background: 'var(--color-surface-container-low, #f8fafc)',
                border: '1px dashed #cbd5e1',
                borderRadius: '8px',
                textAlign: 'center',
                fontSize: '12px',
                color: '#64748b'
              }}>
                {t('customers.noPhonesRegistered', 'No phones registered yet.')}
              </div>
            ) : (
              <div className={styles.deviceGrid}>
                {deviceStats.map(([device, data]) => (
                  <div key={device} className={styles.deviceCard}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: '#eff6ff',
                          color: '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Smartphone size={16} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p className={styles.deviceName} style={{ fontSize: '13px', margin: 0 }}>
                            {device || 'Unknown Device'}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                              {data.count > 0 ? t('common.broughtTimes', { count: data.count, defaultValue: `${data.count} repairs` }) : t('customers.registeredPhone', 'Registered phone')}
                            </span>
                            {data.imei && (
                              <span style={{ fontSize: '10px', color: '#4f46e5', background: '#eef2ff', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                                IMEI: {data.imei}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Compact Quick Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        {permissions.repairs && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTicketPrefillDevice(device);
                              setTicketToEdit(null);
                              setIsNewTicketOpen(true);
                            }}
                            title={`New repair ticket for ${device}`}
                            className={styles.compactDeviceBtn}
                          >
                            <Wrench size={11} />
                            <span>{t('common.ticket', 'Ticket')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeviceToEdit({
                              id: data.id,
                              oldBrand: data.brand || device.split(' ')[0] || '',
                              oldModel: data.model || device.split(' ').slice(1).join(' ') || '',
                              brand: data.brand || device.split(' ')[0] || '',
                              model: data.model || device.split(' ').slice(1).join(' ') || '',
                              imei: data.imei || '',
                              notes: data.notes || '',
                            });
                          }}
                          title={`${t('common.edit', 'Edit')} ${device}`}
                          className={styles.compactIconBtn}
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const ticketCount = data.tickets.length;
                            setDeleteDeviceRepairsToo(ticketCount > 0);
                            setDeviceToDelete({
                              device,
                              brand: data.brand || device.split(' ')[0] || '',
                              model: data.model || device.split(' ').slice(1).join(' ') || '',
                              tickets: data.tickets,
                            });
                          }}
                          title={`${t('common.delete', 'Delete')} ${device}`}
                          className={styles.compactIconBtnDanger}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {data.notes && (
                      <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0', fontStyle: 'italic' }}>
                        📝 {data.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
  );
};
