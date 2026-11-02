import React from 'react';
import { FileText } from 'lucide-react';
import styles from './CustomTicket.module.css';
import type { CustomTicketData } from './customTicketTypes';

interface SlipHeaderCardProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
}

export const SlipHeaderCard: React.FC<SlipHeaderCardProps> = (props) => {
  const {
    ticket,
    setTicket,
  } = props;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <FileText size={16} />
          <span>1. Slip Header & Paper Format</span>
        </div>
      </div>

      {/* Paper Format Selector */}
      <div style={{ marginBottom: '14px' }}>
        <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
          Print Format:
        </label>
        <div className={styles.formatSelector}>
          <div
            className={[styles.formatCard, ticket.format === '80mm' && styles.formatCardActive].filter(Boolean).join(' ')}
            onClick={() => setTicket(prev => ({ ...prev, format: '80mm' }))}
          >
            <span className={styles.formatTitle}>80mm Receipt</span>
            <span className={styles.formatSub}>Standard Roll (XP-T80Q)</span>
          </div>
          <div
            className={[styles.formatCard, ticket.format === '58mm' && styles.formatCardActive].filter(Boolean).join(' ')}
            onClick={() => setTicket(prev => ({ ...prev, format: '58mm' }))}
          >
            <span className={styles.formatTitle}>58mm Compact</span>
            <span className={styles.formatSub}>Mini Receipt Roll</span>
          </div>
          <div
            className={[styles.formatCard, ticket.format === 'sticker' && styles.formatCardActive].filter(Boolean).join(' ')}
            onClick={() => setTicket(prev => ({ ...prev, format: 'sticker' }))}
          >
            <span className={styles.formatTitle}>🏷️ Sticker Label</span>
            <span className={styles.formatSub}>{(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm'}</span>
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

      <div className={styles.grid2}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Ticket Title</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.title}
            onChange={e => setTicket(prev => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. PHONE SPECIFICATIONS"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Subtitle / Tagline</label>
          <input
            type="text"
            className={styles.input}
            value={ticket.subtitle}
            onChange={e => setTicket(prev => ({ ...prev, subtitle: e.target.value }))}
            placeholder="e.g. Tested & Certified"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            className={styles.toggleCheckbox}
            checked={ticket.showStoreHeader}
            onChange={e => setTicket(prev => ({ ...prev, showStoreHeader: e.target.checked }))}
          />
          <span>Include Store Name & Header</span>
        </label>

        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            className={styles.toggleCheckbox}
            checked={ticket.showStoreFooter}
            onChange={e => setTicket(prev => ({ ...prev, showStoreFooter: e.target.checked }))}
          />
          <span>Include Store Footer & Verification</span>
        </label>
      </div>
    </div>
  );
};
