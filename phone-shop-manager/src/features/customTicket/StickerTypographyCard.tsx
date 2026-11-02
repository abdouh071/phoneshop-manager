import React from 'react';
import { AlignCenter, AlignLeft, AlignRight, Type, AlertTriangle } from 'lucide-react';
import styles from './CustomTicket.module.css';
import type { CustomTicketData, TextFontSize } from './customTicketTypes';

interface StickerTypographyCardProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
  storeName: string;
}

export const StickerTypographyCard: React.FC<StickerTypographyCardProps> = (props) => {
  const {
    ticket,
    setTicket,
    storeName,
  } = props;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <Type size={16} />
          <span>2. Sticker Format & Typography</span>
        </div>
      </div>

      {/* Paper Format Selector */}
      <div style={{ marginBottom: '14px' }}>
        <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
          Paper Size:
        </label>
        <div className={styles.formatSelector}>
          <div
            className={[styles.formatCard, ticket.format === 'sticker' && styles.formatCardActive].filter(Boolean).join(' ')}
            onClick={() => setTicket(prev => ({ ...prev, format: 'sticker' }))}
          >
            <span className={styles.formatTitle}>🏷️ Sticker Label</span>
            <span className={styles.formatSub}>{(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm'}</span>
          </div>
          <div
            className={[styles.formatCard, ticket.format === '80mm' && styles.formatCardActive].filter(Boolean).join(' ')}
            onClick={() => setTicket(prev => ({ ...prev, format: '80mm' }))}
          >
            <span className={styles.formatTitle}>80mm Receipt</span>
            <span className={styles.formatSub}>Standard Roll</span>
          </div>
          <div
            className={[styles.formatCard, ticket.format === '58mm' && styles.formatCardActive].filter(Boolean).join(' ')}
            onClick={() => setTicket(prev => ({ ...prev, format: '58mm' }))}
          >
            <span className={styles.formatTitle}>58mm Compact</span>
            <span className={styles.formatSub}>Mini Roll</span>
          </div>
        </div>

        {ticket.format === 'sticker' && (
          <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                🏷️ Sticker Roll Dimensions:
              </label>
              <span style={{ fontSize: '11px', color: '#6366f1', fontWeight: 600 }}>
                {(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm (Standard Inventory Roll)'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                style={{
                  padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                  border: (ticket.stickerSize || '50x20') === '50x20' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                  background: (ticket.stickerSize || '50x20') === '50x20' ? '#6366f1' : '#ffffff',
                  color: (ticket.stickerSize || '50x20') === '50x20' ? '#ffffff' : '#334155',
                }}
                onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x20' }))}
              >
                50 × 20 mm (Std)
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                  border: ticket.stickerSize === '50x25' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                  background: ticket.stickerSize === '50x25' ? '#6366f1' : '#ffffff',
                  color: ticket.stickerSize === '50x25' ? '#ffffff' : '#334155',
                }}
                onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x25' }))}
              >
                50 × 25 mm
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                  border: ticket.stickerSize === '50x30' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                  background: ticket.stickerSize === '50x30' ? '#6366f1' : '#ffffff',
                  color: ticket.stickerSize === '50x30' ? '#ffffff' : '#334155',
                }}
                onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x30' }))}
              >
                50 × 30 mm
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Font Size Selector */}
      <div style={{ marginBottom: '14px' }}>
        <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
          Font Size on Sticker:
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {(['auto', 'normal', 'large', 'huge', 'giant'] as TextFontSize[]).map(sz => (
            <button
              key={sz}
              type="button"
              onClick={() => setTicket(prev => ({ ...prev, fontSize: sz }))}
              style={{
                padding: '7px 4px',
                borderRadius: '8px',
                border: (ticket.fontSize || 'auto') === sz ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                background: (ticket.fontSize || 'auto') === sz ? '#eef2ff' : '#ffffff',
                color: (ticket.fontSize || 'auto') === sz ? '#4f46e5' : '#334155',
                fontWeight: 700,
                fontSize: '11px',
                textTransform: 'capitalize',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {sz === 'auto' ? '⚡ Auto Fit' : sz}
            </button>
          ))}
        </div>
      </div>

      {/* Alignment Selector & Bold Toggle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
        <div>
          <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
            Text Alignment:
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setTicket(prev => ({ ...prev, textAlign: 'center' }))}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: '8px',
                border: (ticket.textAlign || 'center') === 'center' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                background: (ticket.textAlign || 'center') === 'center' ? '#eef2ff' : '#ffffff',
                color: (ticket.textAlign || 'center') === 'center' ? '#4f46e5' : '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <AlignCenter size={14} /> Center
            </button>
            <button
              type="button"
              onClick={() => setTicket(prev => ({ ...prev, textAlign: 'left' }))}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: '8px',
                border: ticket.textAlign === 'left' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                background: ticket.textAlign === 'left' ? '#eef2ff' : '#ffffff',
                color: ticket.textAlign === 'left' ? '#4f46e5' : '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <AlignLeft size={14} /> Left
            </button>
            <button
              type="button"
              onClick={() => setTicket(prev => ({ ...prev, textAlign: 'right' }))}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: '8px',
                border: ticket.textAlign === 'right' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                background: ticket.textAlign === 'right' ? '#eef2ff' : '#ffffff',
                color: ticket.textAlign === 'right' ? '#4f46e5' : '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <AlignRight size={14} /> Right
            </button>
          </div>
        </div>

        <div>
          <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
            Typography Weight:
          </label>
          <label className={styles.toggleRow} style={{ marginTop: '6px' }}>
            <input
              type="checkbox"
              className={styles.toggleCheckbox}
              checked={ticket.isBold !== false}
              onChange={e => setTicket(prev => ({ ...prev, isBold: e.target.checked }))}
            />
            <span style={{ fontSize: '12px', fontWeight: 600 }}>Bold Font (Darker Thermal Print)</span>
          </label>
        </div>
      </div>

      {/* Extra Options: Store Name Header & Barcode */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            className={styles.toggleCheckbox}
            checked={Boolean(ticket.showStoreNameOnSticker)}
            onChange={e => setTicket(prev => ({ ...prev, showStoreNameOnSticker: e.target.checked }))}
          />
          <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
            Include Store Header: &quot;{storeName || 'PhoneShop Pro'}&quot;
          </span>
        </label>

        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            className={styles.toggleCheckbox}
            checked={Boolean(ticket.includeBarcode)}
            onChange={e => setTicket(prev => ({ ...prev, includeBarcode: e.target.checked }))}
          />
          <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
            Include Barcode / QR Code at bottom
          </span>
        </label>

        {ticket.includeBarcode && (
          <div style={{ paddingLeft: '24px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className={styles.input}
                style={{ flex: 1, fontSize: '12px' }}
                value={ticket.barcodeValue || ''}
                onChange={e => setTicket(prev => ({ ...prev, barcodeValue: e.target.value }))}
                placeholder="Barcode / IMEI / Number value"
              />
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="freeTextBarcodeType"
                    checked={ticket.barcodeType !== 'qr'}
                    onChange={() => setTicket(prev => ({ ...prev, barcodeType: 'barcode' }))}
                  />
                  1D Barcode
                </label>
                <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="freeTextBarcodeType"
                    checked={ticket.barcodeType === 'qr'}
                    onChange={() => setTicket(prev => ({ ...prev, barcodeType: 'qr' }))}
                  />
                  QR Code
                </label>
              </div>
            </div>
            {ticket.barcodeType !== 'qr' && ticket.barcodeValue && /[^\x00-\x7F]/.test(ticket.barcodeValue) && (
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                <span>Code 128 barcode only supports ASCII alphanumeric characters.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
