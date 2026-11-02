import React from 'react';
import { Keyboard, AlertTriangle } from 'lucide-react';
import styles from './CustomTicket.module.css';
import type { CustomTicketData } from './customTicketTypes';
import type { StickerOverflowWarning } from './ticketPrintTypes';

interface StickerTextInputCardProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
  blankStickerOverflowWarning: StickerOverflowWarning | null;
}

export const StickerTextInputCard: React.FC<StickerTextInputCardProps> = (props) => {
  const {
    ticket,
    setTicket,
    blankStickerOverflowWarning,
  } = props;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <Keyboard size={16} />
          <span>1. Type Sticker Text (Centered Horizontally & Vertically)</span>
        </div>
        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
          {(ticket.freeText || '').split('\n').filter(Boolean).length} lines · {(ticket.freeText || '').length} chars
        </span>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
          Keyboard Input (Appears in center of sticker horizontally & vertically):
        </label>
        <textarea
          rows={5}
          className={styles.input}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
            fontSize: '14px',
            lineHeight: '1.5',
            padding: '12px 14px',
            resize: 'vertical',
            width: '100%',
            boxSizing: 'border-box',
          }}
          value={ticket.freeText || ''}
          onChange={e => setTicket(prev => ({ ...prev, freeText: e.target.value }))}
          placeholder="Type whatever you want to print on the blank sticker...&#10;&#10;e.g.&#10;RESERVED FOR SOUFIANE&#10;IPHONE 13 PRO MAX&#10;BATTERY 89% · 128GB"
          autoFocus
        />
        {blankStickerOverflowWarning && (
          <div style={{
            marginTop: '8px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            color: '#d97706',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
              <strong>Height Alert:</strong> Text has {blankStickerOverflowWarning.lineCount} lines, exceeding the safe height for a {blankStickerOverflowWarning.stickerSize}mm roll (~{blankStickerOverflowWarning.maxEstimatedLines} lines max at this font size). Switch font to "Normal" or use 50x25mm / 50x30mm to prevent text truncation on the physical printer.
            </span>
          </div>
        )}
      </div>

      {/* Quick Snippets */}
      <div>
        <label className={styles.label} style={{ fontSize: '11px', color: '#64748b' }}>
          Quick Insert Chips (Click to insert):
        </label>
        <div className={styles.snippetRow}>
          {[
            '🏷️ RESERVED',
            '🔧 FOR REPAIR',
            '⚠️ DEFECTIVE / PARTS',
            '✅ TESTED & PASSED',
            '⭐ GRADE A+ LIKE NEW',
            '🔋 BATTERY 100%',
            '📦 SCREEN REPLACED',
            '🚫 ICLOUD LOCKED',
            '💰 SPECIAL OFFER',
          ].map(snippet => (
            <button
              key={snippet}
              type="button"
              className={styles.snippetChip}
              onClick={() => {
                setTicket(prev => ({
                  ...prev,
                  freeText: prev.freeText ? `${prev.freeText}\n${snippet}` : snippet,
                }));
              }}
            >
              {snippet}
            </button>
          ))}
          <button
            type="button"
            className={styles.snippetChip}
            style={{ color: '#ef4444', borderColor: '#fca5a5' }}
            onClick={() => setTicket(prev => ({ ...prev, freeText: '' }))}
          >
            Clear Text
          </button>
        </div>
      </div>
    </div>
  );
};
