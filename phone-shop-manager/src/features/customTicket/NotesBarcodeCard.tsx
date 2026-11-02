import React from 'react';
import { Barcode, AlertTriangle } from 'lucide-react';
import styles from './CustomTicket.module.css';
import type { CustomTicketData } from './customTicketTypes';

interface NotesBarcodeCardProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
}

export const NotesBarcodeCard: React.FC<NotesBarcodeCardProps> = (props) => {
  const {
    ticket,
    setTicket,
  } = props;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <Barcode size={16} />
          <span>4. Notes, Barcode & Footer</span>
        </div>
      </div>

      <div className={styles.fieldGroup} style={{ marginBottom: '14px' }}>
        <label className={styles.label}>Notes & Observations (Optional)</label>
        <textarea
          className={styles.textarea}
          value={ticket.notes}
          onChange={e => setTicket(prev => ({ ...prev, notes: e.target.value }))}
          placeholder="e.g. Never opened, comes with original charger and box, 100% clean iCloud..."
        />
      </div>

      <div className={styles.grid2} style={{ marginBottom: '14px' }}>
        <div className={styles.fieldGroup}>
          <label className={styles.toggleRow} style={{ marginBottom: '6px' }}>
            <input
              type="checkbox"
              className={styles.toggleCheckbox}
              checked={ticket.includeBarcode}
              onChange={e => setTicket(prev => ({
                ...prev,
                includeBarcode: e.target.checked,
                barcodeValue: e.target.checked && !prev.barcodeValue ? (prev.imei || '12345678') : prev.barcodeValue,
              }))}
            />
            <span>Print Barcode or QR Code</span>
          </label>

          {ticket.includeBarcode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  className={styles.select}
                  style={{ width: '110px' }}
                  value={ticket.barcodeType}
                  onChange={e => setTicket(prev => ({ ...prev, barcodeType: e.target.value as 'barcode' | 'qr' }))}
                >
                  <option value="barcode">Barcode</option>
                  <option value="qr">QR Code</option>
                </select>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Code text / IMEI / URL"
                  value={ticket.barcodeValue}
                  onChange={e => setTicket(prev => ({ ...prev, barcodeValue: e.target.value }))}
                />
              </div>
              {ticket.barcodeType !== 'qr' && ticket.barcodeValue && /[^\x00-\x7F]/.test(ticket.barcodeValue) && (
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span>Code 128 barcode only supports ASCII alphanumeric characters.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Custom Footer Note</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.customFooter}
            onChange={e => setTicket(prev => ({ ...prev, customFooter: e.target.value }))}
            placeholder="e.g. Thank you for visiting PhoneShop!"
          />
        </div>
      </div>
    </div>
  );
};
