import React from 'react';
import { Printer, FileText, Eye, X } from 'lucide-react';
import { BarcodePreview } from './BarcodePreview';
import { getComputedFontSize } from './ticketPrintUtils';
import type { CustomTicketData, TicketFormat } from './customTicketTypes';

interface UniversalPrintPreviewModalProps {
  ticket: CustomTicketData;
  setTicket: React.Dispatch<React.SetStateAction<CustomTicketData>>;
  storeName: string;
  currencySymbol: string;
  isOnline: boolean;
  printer?: string;
  labelPrinter?: string;
  isPrinting: boolean;
  setShowPrintPreview: React.Dispatch<React.SetStateAction<boolean>>;
  handleBrowserPrint: () => void;
  handleConfirmPrint: () => Promise<void>;
}

export const UniversalPrintPreviewModal: React.FC<UniversalPrintPreviewModalProps> = (props) => {
  const {
    ticket,
    setTicket,
    storeName,
    currencySymbol,
    isOnline,
    printer,
    labelPrinter,
    isPrinting,
    setShowPrintPreview,
    handleBrowserPrint,
    handleConfirmPrint,
  } = props;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      <div style={{
        background: '#1e293b', borderRadius: '20px', padding: '24px 28px',
        maxWidth: '480px', width: '100%', maxHeight: '92vh',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: 38, height: 38, borderRadius: '10px',
              background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Eye size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>
                {ticket.mode === 'free_text'
                  ? 'Blank Centered Sticker Preview'
                  : ticket.format === 'sticker'
                  ? 'Sticker Print Preview'
                  : ticket.format === '58mm'
                  ? '58mm Compact Receipt Preview'
                  : '80mm Thermal Receipt Preview'}
              </div>
              <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                {ticket.format === 'sticker'
                  ? `${(ticket.stickerSize || '50x20').replace('x', ' × ')}mm label · Centered H & V · Xprinter XP-420B (TSPL)`
                  : ticket.format === '58mm'
                  ? '58mm Mini Roll · ESC/POS 32 chars'
                  : 'Standard Roll (XP-T80Q) · ESC/POS 42 chars'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPrintPreview(false)}
            style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#94a3b8', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* In-Modal Format Quick-Switcher Tabs */}
        <div style={{
          display: 'flex', gap: '6px', background: 'rgba(15,23,42,0.6)',
          padding: '4px', borderRadius: '10px', marginBottom: '16px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {(['80mm', '58mm', 'sticker'] as TicketFormat[]).map(fmt => (
            <button
              key={fmt}
              type="button"
              onClick={() => setTicket(prev => ({ ...prev, format: fmt }))}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: '7px', border: 'none',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                background: ticket.format === fmt ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
                color: ticket.format === fmt ? '#ffffff' : '#94a3b8',
                transition: 'all 0.15s ease',
              }}
            >
              {fmt === '80mm' ? '🧾 80mm Receipt' : fmt === '58mm' ? '🧾 58mm Compact' : `🏷️ Sticker (${ticket.stickerSize || '50x20'})`}
            </button>
          ))}
        </div>

        {/* Scrollable Preview Stage */}
        <div style={{
          overflowY: 'auto', maxHeight: '56vh', background: '#090d16',
          borderRadius: '12px', padding: '20px 14px', border: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          marginBottom: '16px',
        }}>
          {/* FORMAT 1: 50x20mm (standard), 50x25mm or 50x30mm STICKER */}
          {ticket.format === 'sticker' && (
            ticket.mode === 'free_text' ? (
              <div style={{
                width: '320px',
                height: (ticket.stickerSize || '50x20') === '50x30' ? '192px' : (ticket.stickerSize || '50x20') === '50x25' ? '160px' : '135px',
                background: '#fffef0',
                borderRadius: '6px',
                border: '1.5px dashed #c8b400',
                padding: '8px 12px',
                fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                boxSizing: 'border-box',
              }}>
                {ticket.showStoreNameOnSticker && (
                  <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '10px', letterSpacing: '0.5px', borderBottom: '1px solid #c8b400', paddingBottom: '2px', marginBottom: '3px', color: '#555', textTransform: 'uppercase' }}>
                    {(storeName || 'PhoneShop Pro').substring(0, 24)}
                  </div>
                )}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  textAlign: ticket.textAlign || 'center',
                  width: '100%',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, true),
                    fontWeight: ticket.isBold !== false ? 900 : 500,
                    lineHeight: 1.25,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#111',
                    width: '100%',
                  }}>
                    {ticket.freeText || '(Empty Blank Sticker)'}
                  </div>
                </div>
                {ticket.includeBarcode && ticket.barcodeValue && (
                  <div style={{ borderTop: '1px solid #c8b400', marginTop: '2px', paddingTop: '2px' }}>
                    <BarcodePreview
                      value={ticket.barcodeValue}
                      isQr={ticket.barcodeType === 'qr'}
                      isCompact={true}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                width: '320px',
                minHeight: (ticket.stickerSize || '50x20') === '50x30' ? '192px' : (ticket.stickerSize || '50x20') === '50x25' ? '160px' : '135px',
                maxHeight: (ticket.stickerSize || '50x20') === '50x30' ? '240px' : (ticket.stickerSize || '50x20') === '50x25' ? '200px' : '170px',
                background: '#fffef0',
                borderRadius: '6px',
                border: '1.5px dashed #c8b400',
                padding: '8px 12px',
                fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                fontSize: '9.5px',
                lineHeight: 1.25,
                color: '#111',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}>
                {/* Shop name */}
                <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px', borderBottom: '1.5px solid #333', paddingBottom: '3px', marginBottom: '3px' }}>
                  {(storeName || 'PhoneShop Pro').substring(0, 24)}
                </div>
                {/* Device name */}
                {(ticket.deviceModel || ticket.title) && (
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '10.5px', borderBottom: '1px solid #555', paddingBottom: '2px', marginBottom: '3px' }}>
                    {(ticket.deviceModel || ticket.title || '').substring(0, 24)}
                  </div>
                )}
                {/* Spec rows with 2-column paired layout WYSIWYG matching server.js */}
                {(() => {
                  const mSpecs: { label: string; value: string }[] = [];
                  if (ticket.storage)       mSpecs.push({ label: 'Stockage', value: ticket.storage });
                  if (ticket.ram)           mSpecs.push({ label: 'RAM',      value: ticket.ram });
                  if (ticket.batteryHealth) mSpecs.push({ label: 'Batterie', value: ticket.batteryHealth });
                  if (ticket.condition)     mSpecs.push({ label: 'Etat',     value: ticket.condition });
                  if (ticket.warranty)      mSpecs.push({ label: 'Garantie', value: ticket.warranty });
                  if (ticket.color)         mSpecs.push({ label: 'Couleur',  value: ticket.color });
                  if (ticket.imei)          mSpecs.push({ label: 'IMEI',     value: ticket.imei });
                  ticket.specs.filter(s => s.label && s.value).forEach(s => {
                    mSpecs.push({ label: s.label.substring(0, 10), value: s.value.substring(0, 16) });
                  });

                  const is30mm = ticket.stickerSize === '50x30';
                  const is25mm = ticket.stickerSize === '50x25';
                  const maxSpecRows = is30mm ? 8 : is25mm ? 6 : (ticket.includeBarcode && ticket.barcodeValue ? 3 : 5);

                  if (mSpecs.length <= maxSpecRows) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        {mSpecs.map((s, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8.5px' }}>
                            <span style={{ color: '#555' }}>{s.label} :</span>
                            <strong style={{ color: '#000' }}>{s.value}</strong>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      {Array.from({ length: Math.ceil(mSpecs.length / 2) }).map((_, idx) => {
                        const s1 = mSpecs[idx * 2];
                        const s2 = mSpecs[idx * 2 + 1];
                        return (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7.5px', lineHeight: 1.15 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48%' }}>
                              <span style={{ color: '#555' }}>{s1.label}:</span> <strong>{s1.value}</strong>
                            </span>
                            {s2 && (
                              <>
                                <span style={{ color: '#bbb', margin: '0 2px' }}>|</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48%' }}>
                                  <span style={{ color: '#555' }}>{s2.label}:</span> <strong>{s2.value}</strong>
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* Price */}
                {ticket.price && (
                  <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '11px', borderTop: '1.5px solid #333', marginTop: '4px', paddingTop: '3px', letterSpacing: '0.5px' }}>
                    PRICE : {(ticket.price || '').replace(/\s*(DA|DZD|USD|EUR|GBP|\$|€|£)\s*$/i, '').trim()} {currencySymbol}
                  </div>
                )}
                {/* Barcode / QR */}
                {ticket.includeBarcode && ticket.barcodeValue && (
                  <div style={{ borderTop: '1px solid #aaa', marginTop: '6px', paddingTop: '4px' }}>
                    <BarcodePreview
                      value={ticket.barcodeValue}
                      isQr={ticket.barcodeType === 'qr'}
                      isCompact={true}
                    />
                  </div>
                )}
                {/* Notes */}
                {ticket.notes && (
                  <div style={{ borderTop: '1px dashed #777', marginTop: '5px', paddingTop: '4px', fontSize: '9px', color: '#333', whiteSpace: 'pre-wrap' }}>
                    {ticket.notes}
                  </div>
                )}
              </div>
            )
          )}

          {/* FORMAT 2: 80mm RECEIPT (Standard Roll XP-T80Q) */}
          {ticket.format === '80mm' && (
            <div style={{
              width: '360px',
              background: '#ffffff',
              borderRadius: '4px',
              padding: '24px 22px 28px',
              fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
              fontSize: '11.5px',
              lineHeight: 1.45,
              color: '#111827',
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
              position: 'relative',
            }}>
              {/* Store Header */}
              {ticket.showStoreHeader && (
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '16px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {storeName || 'PhoneShop Pro'}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                    Specialized Phone Sales & Services
                  </div>
                  <div style={{ borderTop: '1px dashed #64748b', margin: '8px 0' }} />
                </div>
              )}

              {/* Title & Date */}
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {ticket.title || '*** SPECIFICATION SLIP ***'}
                </div>
                {ticket.subtitle && (
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
                    {ticket.subtitle}
                  </div>
                )}
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                  {new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
                <div style={{ borderTop: '1.5px solid #1e293b', margin: '8px 0' }} />
              </div>

              {/* Device Model Highlight or Centered Free Text */}
              {ticket.mode === 'free_text' ? (
                <div style={{
                  minHeight: '140px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  textAlign: ticket.textAlign || 'center',
                  padding: '24px 12px',
                  borderTop: '1.5px dashed #1e293b',
                  borderBottom: '1.5px dashed #1e293b',
                  margin: '14px 0',
                }}>
                  <div style={{
                    fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, false),
                    fontWeight: ticket.isBold !== false ? 900 : 500,
                    lineHeight: 1.4,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#0f172a',
                    width: '100%',
                  }}>
                    {ticket.freeText || '(Empty Blank Slip)'}
                  </div>
                </div>
              ) : (
                <>
                  {ticket.deviceModel && (
                    <div style={{
                      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px',
                      padding: '8px 10px', textAlign: 'center', marginBottom: '10px',
                    }}>
                      <div style={{ fontSize: '9.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.5px' }}>
                        Device Model
                      </div>
                      <div style={{ fontSize: '14.5px', fontWeight: 900, color: '#0f172a', marginTop: '2px' }}>
                        {ticket.deviceModel}
                      </div>
                    </div>
                  )}

                  {/* Specs Two-Column Rows (42 cols ESC/POS style) */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 800, textTransform: 'uppercase', borderBottom: '1px solid #94a3b8', paddingBottom: '3px', marginBottom: '6px', color: '#334155' }}>
                      Technical Specifications
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {ticket.condition     && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Condition:</span><span style={{ fontWeight: 700 }}>{ticket.condition}</span></div>}
                      {ticket.storage       && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Storage:</span><span style={{ fontWeight: 700 }}>{ticket.storage}</span></div>}
                      {ticket.ram           && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>RAM:</span><span style={{ fontWeight: 700 }}>{ticket.ram}</span></div>}
                      {ticket.color         && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Color:</span><span style={{ fontWeight: 700 }}>{ticket.color}</span></div>}
                      {ticket.batteryHealth && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Battery:</span><span style={{ fontWeight: 700 }}>{ticket.batteryHealth}</span></div>}
                      {ticket.warranty      && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Warranty:</span><span style={{ fontWeight: 700 }}>{ticket.warranty}</span></div>}
                      {ticket.imei          && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>IMEI/SN:</span><span style={{ fontWeight: 700 }}>{ticket.imei}</span></div>}
                      {ticket.specs.filter(s => s.label && s.value).map(s => (
                        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}>
                          <span style={{ color: '#64748b' }}>{s.label.endsWith(':') ? s.label : `${s.label}:`}</span>
                          <span style={{ fontWeight: 700 }}>{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Price Banner */}
                  {ticket.price && (
                    <div style={{
                      border: '1.5px solid #0f172a', borderRadius: '6px',
                      padding: '8px 12px', margin: '10px 0',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: '#f8fafc',
                    }}>
                      <span style={{ fontSize: '12px', fontWeight: 800 }}>PRICE:</span>
                      <span style={{ fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
                        {ticket.price} {currencySymbol}
                      </span>
                    </div>
                  )}

                  {/* Notes */}
                  {ticket.notes && (
                    <div style={{ borderTop: '1px dashed #94a3b8', paddingTop: '6px', marginTop: '10px' }}>
                      <div style={{ fontSize: '9.5px', fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: '2px' }}>
                        Notes & Observations:
                      </div>
                      <div style={{ fontSize: '10.5px', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                        {ticket.notes}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Barcode / QR */}
              {ticket.includeBarcode && ticket.barcodeValue && (
                <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '10px', paddingTop: '6px', textAlign: 'center' }}>
                  <BarcodePreview
                    value={ticket.barcodeValue}
                    isQr={ticket.barcodeType === 'qr'}
                    isCompact={false}
                  />
                </div>
              )}

              {/* Footer */}
              {ticket.showStoreFooter && (
                <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '10px', paddingTop: '6px', textAlign: 'center', fontSize: '10px', color: '#64748b' }}>
                  {ticket.customFooter || 'Thank you for choosing PhoneShop Pro!'}
                </div>
              )}

              {/* Perforated cut line at bottom */}
              <div style={{
                marginTop: '16px', borderTop: '1px dashed #cbd5e1', paddingTop: '6px',
                textAlign: 'center', fontSize: '9px', color: '#94a3b8', letterSpacing: '1px',
              }}>
                ✂ ---------------------------------------- ✂
              </div>
            </div>
          )}

          {/* FORMAT 3: 58mm COMPACT (Mini Roll) */}
          {ticket.format === '58mm' && (
            <div style={{
              width: '270px',
              background: '#ffffff',
              borderRadius: '4px',
              padding: '18px 16px 22px',
              fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
              fontSize: '10.5px',
              lineHeight: 1.4,
              color: '#111827',
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
            }}>
              {/* Store Header */}
              {ticket.showStoreHeader && (
                <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase' }}>
                    {storeName || 'PhoneShop Pro'}
                  </div>
                  <div style={{ borderTop: '1px dashed #64748b', margin: '6px 0' }} />
                </div>
              )}

              {/* Title & Date */}
              <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 800, textTransform: 'uppercase' }}>
                  {ticket.title || 'SPECIFICATION SLIP'}
                </div>
                {ticket.subtitle && (
                  <div style={{ fontSize: '9.5px', color: '#475569', marginTop: '1px' }}>
                    {ticket.subtitle}
                  </div>
                )}
                <div style={{ fontSize: '9px', color: '#64748b', marginTop: '1px' }}>
                  {new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <div style={{ borderTop: '1.5px solid #1e293b', margin: '6px 0' }} />
              </div>

              {/* Device Model Highlight or Centered Free Text */}
              {ticket.mode === 'free_text' ? (
                <div style={{
                  minHeight: '100px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  textAlign: ticket.textAlign || 'center',
                  padding: '16px 8px',
                  borderTop: '1.5px dashed #1e293b',
                  borderBottom: '1.5px dashed #1e293b',
                  margin: '10px 0',
                }}>
                  <div style={{
                    fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, false),
                    fontWeight: ticket.isBold !== false ? 900 : 500,
                    lineHeight: 1.35,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#0f172a',
                    width: '100%',
                  }}>
                    {ticket.freeText || '(Empty Blank Slip)'}
                  </div>
                </div>
              ) : (
                <>
                  {ticket.deviceModel && (
                    <div style={{
                      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px',
                      padding: '6px 8px', textAlign: 'center', marginBottom: '8px',
                    }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                        {ticket.deviceModel}
                      </div>
                    </div>
                  )}

                  {/* Specs Two-Column Rows (32 cols ESC/POS style) */}
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5px', fontSize: '10px' }}>
                      {ticket.condition     && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Cond:</span><span style={{ fontWeight: 700 }}>{ticket.condition}</span></div>}
                      {ticket.storage       && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Storage:</span><span style={{ fontWeight: 700 }}>{ticket.storage}</span></div>}
                      {ticket.ram           && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>RAM:</span><span style={{ fontWeight: 700 }}>{ticket.ram}</span></div>}
                      {ticket.color         && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Color:</span><span style={{ fontWeight: 700 }}>{ticket.color}</span></div>}
                      {ticket.batteryHealth && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Battery:</span><span style={{ fontWeight: 700 }}>{ticket.batteryHealth}</span></div>}
                      {ticket.warranty      && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Warranty:</span><span style={{ fontWeight: 700 }}>{ticket.warranty}</span></div>}
                      {ticket.imei          && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>IMEI/SN:</span><span style={{ fontWeight: 700 }}>{ticket.imei}</span></div>}
                      {ticket.specs.filter(s => s.label && s.value).map(s => (
                        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>{s.label.substring(0, 10)}:</span>
                          <span style={{ fontWeight: 700 }}>{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Price */}
                  {ticket.price && (
                    <div style={{
                      border: '1px solid #0f172a', borderRadius: '4px',
                      padding: '6px 8px', margin: '8px 0',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: '#f8fafc',
                    }}>
                      <span style={{ fontSize: '11px', fontWeight: 800 }}>PRICE:</span>
                      <span style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a' }}>
                        {ticket.price} {currencySymbol}
                      </span>
                    </div>
                  )}

                  {/* Notes */}
                  {ticket.notes && (
                    <div style={{ borderTop: '1px dashed #94a3b8', paddingTop: '4px', marginTop: '6px', fontSize: '9.5px', color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                      {ticket.notes}
                    </div>
                  )}
                </>
              )}

              {/* Barcode / QR */}
              {ticket.includeBarcode && ticket.barcodeValue && (
                <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '6px', paddingTop: '4px', textAlign: 'center' }}>
                  <BarcodePreview
                    value={ticket.barcodeValue}
                    isQr={ticket.barcodeType === 'qr'}
                    isCompact={true}
                  />
                </div>
              )}

              {/* Footer */}
              {ticket.showStoreFooter && (
                <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '8px', paddingTop: '4px', textAlign: 'center', fontSize: '9px', color: '#64748b' }}>
                  {ticket.customFooter || 'Thank you!'}
                </div>
              )}

              {/* Perforated cut line at bottom */}
              <div style={{
                marginTop: '12px', borderTop: '1px dashed #cbd5e1', paddingTop: '4px',
                textAlign: 'center', fontSize: '8.5px', color: '#94a3b8', letterSpacing: '1px',
              }}>
                ✂ --------------------------- ✂
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>
            {isOnline
              ? (ticket.format === 'sticker'
                ? `🏷️ ${labelPrinter || 'Xprinter_XP_420B'} (TSPL)`
                : `🖨️ ${printer || 'Printer_POS_80'} (ESC/POS)`)
              : '🟡 Print server offline — Use "Print via Browser" below'}
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowPrintPreview(false)}
              style={{
                padding: '9px 16px', borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)',
                color: '#94a3b8', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBrowserPrint}
              style={{
                padding: '9px 16px', borderRadius: '10px',
                border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(255,255,255,0.06)',
                color: '#a5b4fc', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
              title="Print using your browser's built-in print dialog (works without print server)"
            >
              <FileText size={14} />
              Browser / PDF
            </button>
            <button
              type="button"
              onClick={handleConfirmPrint}
              disabled={isPrinting || !isOnline}
              style={{
                padding: '9px 20px', borderRadius: '10px',
                border: 'none', background: isOnline ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#475569',
                color: '#fff', fontWeight: 700, fontSize: '13px',
                cursor: isOnline ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                opacity: isPrinting || !isOnline ? 0.6 : 1,
                boxShadow: isOnline ? '0 4px 14px rgba(99,102,241,0.4)' : 'none',
              }}
              title={isOnline ? 'Print directly via thermal/label print server' : 'Print server must be running for direct printing'}
            >
              <Printer size={16} />
              {isPrinting ? 'Printing...' : !isOnline ? 'Server Offline' : `Direct Print ${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
