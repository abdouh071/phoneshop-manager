import React from 'react';
import { Copy, RotateCcw, Sparkles, Eye, Target } from 'lucide-react';
import { BarcodePreview } from './BarcodePreview';
import { getComputedFontSize } from './ticketPrintUtils';
import { useToast } from '../../components/ui/Toast';
import styles from './CustomTicket.module.css';
import type { CustomTicketData } from './customTicketTypes';

interface LivePreviewPanelProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
  storeName: string;
  currencySymbol: string;
  livePreviewHtml: string;
  isOnline: boolean;
  printer?: string;
  labelPrinter?: string;
  isPrinting: boolean;
  isCalibrating: boolean;
  handleCalibrateSensor: () => Promise<void>;
  handlePrintAction: () => void;
  handleSelectPreset: (presetId: string) => void;
  toast: ReturnType<typeof useToast>;
}

export const LivePreviewPanel: React.FC<LivePreviewPanelProps> = (props) => {
  const {
    ticket,
    setTicket,
    storeName,
    currencySymbol,
    livePreviewHtml,
    isOnline,
    printer,
    labelPrinter,
    isPrinting,
    isCalibrating,
    handleCalibrateSensor,
    handlePrintAction,
    handleSelectPreset,
    toast,
  } = props;

  return (
    <div className={styles.previewSection}>
      <div className={styles.previewHeader}>
        <div className={styles.previewTitle}>
          <Sparkles size={16} style={{ color: 'var(--color-primary, #4f46e5)' }} />
          <span>
            {ticket.mode === 'free_text' ? 'Live Blank Sticker Preview' : 'Live Thermal Slip Preview'}
          </span>
        </div>
        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
          {ticket.mode === 'free_text'
            ? `Centered (${(ticket.stickerSize || '50x20') === '50x30' ? '50x30mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50x25mm' : '50x20mm'})`
            : ticket.format === 'sticker'
            ? ((ticket.stickerSize || '50x20') === '50x30' ? '50x30mm Sticker' : (ticket.stickerSize || '50x20') === '50x25' ? '50x25mm Sticker' : '50x20mm Sticker')
            : ticket.format === '58mm'
            ? '58mm Mini'
            : '80mm Roll'}
        </span>
      </div>

      {ticket.mode === 'free_text' ? (
        <div
          className={styles.blankStickerPreviewBox}
          style={{
            aspectRatio: (ticket.stickerSize || '50x20') === '50x30' ? '5 / 3' : (ticket.stickerSize || '50x20') === '50x25' ? '5 / 2.5' : '5 / 2',
            minHeight: (ticket.stickerSize || '50x20') === '50x30' ? '216px' : (ticket.stickerSize || '50x20') === '50x25' ? '180px' : '150px',
          }}
        >
          {ticket.showStoreNameOnSticker && (
            <div style={{
              textAlign: 'center',
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              borderBottom: '1.5px solid #d4c84a',
              paddingBottom: '3px',
              marginBottom: '6px',
              color: '#555',
            }}>
              {(storeName || 'PhoneShop Pro').substring(0, 24)}
            </div>
          )}

          <div className={styles.blankStickerCenterStage}>
            <div
              className={styles.blankStickerText}
              style={{
                fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, false),
                fontWeight: ticket.isBold !== false ? 900 : 500,
                textAlign: ticket.textAlign || 'center',
                color: '#111827',
                width: '100%',
              }}
            >
              {ticket.freeText ? (
                ticket.freeText
              ) : (
                <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 400, fontSize: '14px' }}>
                  (Sticker is blank. Type anything in the keyboard input on the left to see it centered here)
                </span>
              )}
            </div>
          </div>

          {ticket.includeBarcode && ticket.barcodeValue && (
            <div style={{ borderTop: '1px solid #d4c84a', paddingTop: '4px', marginTop: '6px' }}>
              <BarcodePreview
                value={ticket.barcodeValue}
                isQr={ticket.barcodeType === 'qr'}
                isCompact={true}
              />
            </div>
          )}
        </div>
      ) : (
        /* Photorealistic Slip Preview Card */
        <div className={styles.thermalPaper}>
          <div dangerouslySetInnerHTML={{ __html: livePreviewHtml }} />
          <div className={styles.paperPerforated} />
        </div>
      )}

      {/* Print Controls Bar */}
      <div className={styles.printActionsBar}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Copies:</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {[1, 2, 5, 10, 20].map(cnt => (
              <button
                key={cnt}
                type="button"
                style={{
                  padding: '3px 9px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: (ticket.copies || 1) === cnt ? '#4f46e5' : '#ffffff',
                  color: (ticket.copies || 1) === cnt ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
                onClick={() => setTicket(prev => ({ ...prev, copies: cnt }))}
              >
                {cnt}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={50}
              value={ticket.copies || 1}
              onChange={e => {
                const v = Math.max(1, Math.min(50, parseInt(e.target.value) || 1));
                setTicket(prev => ({ ...prev, copies: v }));
              }}
              style={{
                width: '42px', padding: '3px 4px', borderRadius: '6px',
                border: '1px solid #cbd5e1', textAlign: 'center',
                fontWeight: 700, fontSize: '11px', color: '#334155',
              }}
              title="Custom copies count (1-50)"
            />
          </div>
        </div>

        <button
          type="button"
          className={styles.primaryPrintBtn}
          onClick={handlePrintAction}
          disabled={isPrinting}
          title={isOnline ? 'Preview slip and print via local print server' : 'Preview slip and print via browser (print server offline)'}
        >
          <Eye size={18} />
          <span>
            {isPrinting
              ? 'Sending to Printer...'
              : ticket.mode === 'free_text'
              ? `Preview & Print Blank Sticker (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`
              : ticket.format === 'sticker'
              ? `Preview & Print Sticker (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`
              : ticket.format === '58mm'
              ? `Preview & Print 58mm (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`
              : `Preview & Print 80mm (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`}
          </span>
        </button>

        <div className={styles.secondaryActionsRow}>
          {ticket.format === 'sticker' && (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleCalibrateSensor}
              disabled={isCalibrating || !isOnline}
              style={{ color: '#4f46e5', borderColor: 'rgba(99,102,241,0.3)', fontWeight: 700 }}
              title="Calibrate and synchronize the printer's optical gap sensor"
            >
              <Target size={14} />
              <span>{isCalibrating ? 'Calibrating...' : '🎯 Calibrate Sensor'}</span>
            </button>
          )}

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => {
              const textToCopy = ticket.mode === 'free_text'
                ? (ticket.freeText || '')
                : `${ticket.deviceModel}\nStorage: ${ticket.storage}\nColor: ${ticket.color}\nBattery: ${ticket.batteryHealth}\nPrice: ${ticket.price} ${currencySymbol}\n${ticket.notes}`;
              navigator.clipboard.writeText(textToCopy);
              toast.success('Copied to Clipboard', 'Text copied.');
            }}
            title="Copy text to clipboard"
          >
            <Copy size={14} />
            <span>{ticket.mode === 'free_text' ? 'Copy Text' : 'Copy Specs'}</span>
          </button>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => {
              if (ticket.mode === 'free_text') {
                setTicket(prev => ({ ...prev, freeText: '' }));
                toast.info('Sticker Cleared', 'Text input cleared.');
              } else {
                handleSelectPreset('phone_specs');
              }
            }}
            title={ticket.mode === 'free_text' ? 'Clear sticker text' : 'Reset slip to Phone Specs template'}
          >
            <RotateCcw size={14} />
            <span>{ticket.mode === 'free_text' ? 'Clear Text' : 'Reset Slip'}</span>
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 500, color: isOnline ? '#059669' : '#f59e0b' }}>
            {isOnline
              ? `🟢 Server Connected (Port 3355) · Target: ${ticket.format === 'sticker' ? labelPrinter || 'Label Printer' : printer || 'POS Thermal 80mm'}`
              : '🟡 Print Server Offline · Browser Print Available'}
          </span>
        </div>
      </div>
    </div>
  );
};
