import React from 'react';
import { Smartphone, Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import styles from './CustomTicket.module.css';
import type { CustomTicketData } from './customTicketTypes';

interface DeviceDetailsCardProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
  currencySymbol: string;
  setIsInventoryModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const DeviceDetailsCard: React.FC<DeviceDetailsCardProps> = (props) => {
  const {
    ticket,
    setTicket,
    currencySymbol,
    setIsInventoryModalOpen,
  } = props;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <Smartphone size={16} />
          <span>2. Device & Hardware Details</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsInventoryModalOpen(true)}
          leftIcon={<Search size={13} />}
        >
          Auto-fill from Stock
        </Button>
      </div>

      <div className={styles.grid2} style={{ marginBottom: '14px' }}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Device / Product Name</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.deviceModel}
            onChange={e => setTicket(prev => ({ ...prev, deviceModel: e.target.value }))}
            placeholder="e.g. Apple iPhone 15 Pro Max"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Condition / Grade</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.condition}
            onChange={e => setTicket(prev => ({ ...prev, condition: e.target.value }))}
            placeholder="e.g. Grade A+ (Like New)"
          />
        </div>
      </div>

      <div className={styles.grid3} style={{ marginBottom: '14px' }}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Storage</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.storage}
            onChange={e => setTicket(prev => ({ ...prev, storage: e.target.value }))}
            placeholder="e.g. 256GB"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>RAM</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.ram || ''}
            onChange={e => setTicket(prev => ({ ...prev, ram: e.target.value }))}
            placeholder="e.g. 8GB"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Color</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.color}
            onChange={e => setTicket(prev => ({ ...prev, color: e.target.value }))}
            placeholder="e.g. Natural Titanium"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Battery Health</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.batteryHealth}
            onChange={e => setTicket(prev => ({ ...prev, batteryHealth: e.target.value }))}
            placeholder="e.g. 94% or New"
          />
        </div>
      </div>

      <div className={styles.grid3} style={{ marginBottom: '14px' }}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Price ({currencySymbol})</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.price}
            onChange={e => setTicket(prev => ({ ...prev, price: e.target.value }))}
            placeholder="e.g. 8500"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Shop Warranty</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.warranty}
            onChange={e => setTicket(prev => ({ ...prev, warranty: e.target.value }))}
            placeholder="e.g. 3 Months Shop"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>IMEI / Serial Number</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.imei}
            onChange={e => {
              const v = e.target.value;
              setTicket(prev => ({
                ...prev,
                imei: v,
                barcodeValue: prev.includeBarcode && !prev.barcodeValue ? v : prev.barcodeValue,
              }));
            }}
            placeholder="e.g. 359871..."
          />
        </div>
      </div>
    </div>
  );
};
