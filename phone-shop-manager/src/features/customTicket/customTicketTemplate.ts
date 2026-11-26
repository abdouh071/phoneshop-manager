import JsBarcode from 'jsbarcode';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import type { CustomTicketData } from './customTicketTypes';
import { escapeHtml } from '../../utils/escapeHtml';
import { computeFreeTextStickerLayout } from '../../utils/customLabelWrap';

export function buildCustomTicketHTML(
  data: CustomTicketData,
  storeName: string,
  currency: string = 'DZD',
  storeAddress?: string,
  storePhone?: string
): string {
  const isSticker = data.format === 'sticker';
  const is58mm = data.format === '58mm';
  const widthStyle = isSticker ? 'width:50mm;max-width:50mm;' : is58mm ? 'width:54mm;max-width:54mm;' : 'width:76mm;max-width:76mm;';

  // Strip trailing currency symbols/words from price to prevent duplication ("8500 DA DA")
  const cleanPrice = (data.price || '').replace(/\s*(DA|DZD|USD|EUR|GBP|\$|€|£)\s*$/i, '').trim();

  // Generate Barcode / QR Code SVG
  let barcodeHtml = '';
  if (data.includeBarcode && data.barcodeValue.trim()) {
    const val = data.barcodeValue.trim();
    if (data.barcodeType === 'qr') {
      try {
        const qrSvg = renderToString(React.createElement(QRCodeSVG, {
          value: val,
          size: isSticker ? 60 : 80,
          level: 'M',
        }));
        barcodeHtml = `
          <div style="text-align:center;margin:8px 0;">
            ${qrSvg}
            <div style="font-size:9.5px;font-family:monospace;color:#333;margin-top:2px;">${escapeHtml(val)}</div>
          </div>
        `;
      } catch (err) {
        console.error('Error rendering QR:', err);
      }
    } else {
      try {
        const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        JsBarcode(svgNode, val, {
          format: 'CODE128',
          width: isSticker ? 1.1 : 1.4,
          height: isSticker ? 22 : 30,
          displayValue: true,
          fontSize: isSticker ? 9 : 11,
          font: 'Arial',
          fontOptions: 'bold',
          margin: 0,
          textMargin: 2,
        });
        const barcodeSvg = new XMLSerializer().serializeToString(svgNode);
        barcodeHtml = `
          <div style="text-align:center;margin:6px 0;">
            ${barcodeSvg}
          </div>
        `;
      } catch (err) {
        console.error('Error rendering barcode:', err);
      }
    }
  }

  // Collect active spec items
  // In sticker format, use French labels to match physical TSPL label printer (Stockage, RAM, Batterie, Etat, etc.)
  const allSpecs: { label: string; value: string }[] = [];
  if (data.storage) allSpecs.push({ label: isSticker ? 'Stockage' : 'Storage', value: data.storage });
  if (data.ram) allSpecs.push({ label: 'RAM', value: data.ram });
  if (data.batteryHealth) allSpecs.push({ label: isSticker ? 'Batterie' : 'Battery Health', value: data.batteryHealth });
  if (data.condition) allSpecs.push({ label: isSticker ? 'Etat' : 'Condition', value: data.condition });
  if (data.warranty) allSpecs.push({ label: isSticker ? 'Garantie' : 'Warranty', value: data.warranty });
  if (data.color) allSpecs.push({ label: isSticker ? 'Couleur' : 'Color', value: data.color });
  if (data.imei) allSpecs.push({ label: isSticker ? 'IMEI' : 'IMEI / Serial', value: data.imei });

  // Custom added specs
  if (data.specs && data.specs.length > 0) {
    for (const s of data.specs) {
      if (s.label.trim() && s.value.trim()) {
        allSpecs.push({ label: s.label.trim(), value: s.value.trim() });
      }
    }
  }

  // Format date
  const nowStr = new Date().toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // ── FREE TEXT / BLANK STICKER (Centered Horizontally & Vertically) ──
  if (data.mode === 'free_text') {
    const text = data.freeText || '';
    const align = data.textAlign || 'center';
    const isBold = data.isBold !== false;
    const is30mm = data.stickerSize === '50x30';
    const is25mm = data.stickerSize === '50x25';
    const stickerHeight = is30mm ? '30mm' : is25mm ? '25mm' : '20mm';
    const layout = computeFreeTextStickerLayout(data, storeName);
    const wrappedText = text ? layout.wrappedLines.join('\n') : '';
    const fontSizeMap: Record<string, string> = {
      auto: wrappedText.length > 60 ? '9px' : wrappedText.length > 30 ? '11px' : wrappedText.length > 15 ? '13px' : '15px',
      normal: '10px',
      large: '12px',
      huge: '15px',
      giant: '18px',
    };
    const fSize = fontSizeMap[data.fontSize || 'auto'] || '13px';

    if (isSticker) {
      return `
        <div style="width:50mm;height:${stickerHeight};max-height:${stickerHeight};margin:0 auto;box-sizing:border-box;padding:1mm 1.5mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:${align};background:#fffef0;border:1.5px dashed #c8b400;border-radius:4px;overflow:hidden;font-family:ui-monospace,SFMono-Regular,monospace;">
          ${data.showStoreNameOnSticker ? `<div style="font-size:9px;font-weight:900;text-transform:uppercase;color:#555;margin-bottom:2px;border-bottom:1px solid #ccc;width:100%;text-align:center;">${escapeHtml((storeName || 'PhoneShop Pro').substring(0, 24))}</div>` : ''}
          <div style="flex:1;display:flex;justify-content:center;align-items:center;width:100%;">
            <div style="font-size:${fSize};font-weight:${isBold ? '900' : 'normal'};color:#111;white-space:pre-wrap;word-break:break-word;line-height:1.25;width:100%;">
              ${wrappedText ? escapeHtml(wrappedText) : '<span style="color:#aaa;font-size:10px;font-style:italic;">Type on keyboard to print here...</span>'}
            </div>
          </div>
          ${barcodeHtml ? `<div style="margin-top:2px;width:100%;">${barcodeHtml}</div>` : ''}
        </div>
      `;
    }

    return `
      <div style="${widthStyle}margin:0 auto;font-family:ui-monospace,SFMono-Regular,monospace;color:#000;padding:4mm 2mm;box-sizing:border-box;text-align:${align};">
        ${data.showStoreNameOnSticker ? `
          <div style="text-align:center;font-size:13px;font-weight:bold;text-transform:uppercase;margin-bottom:6px;border-bottom:1px dashed #666;padding-bottom:4px;">
            ${escapeHtml(storeName || 'PhoneShop Pro')}
          </div>
        ` : ''}
        <div style="padding:20px 0;display:flex;justify-content:center;align-items:center;min-height:80px;">
          <div style="font-size:${fSize};font-weight:${isBold ? '900' : 'normal'};white-space:pre-wrap;word-break:break-word;line-height:1.35;width:100%;">
            ${text ? escapeHtml(text) : '<span style="color:#aaa;font-size:11px;font-style:italic;">Type on keyboard to print here...</span>'}
          </div>
        </div>
        ${barcodeHtml ? `<div style="margin-top:6px;border-top:1px dashed #aaa;padding-top:4px;">${barcodeHtml}</div>` : ''}
      </div>
    `;
  }

  // ── STICKER (50x20mm standard roll, or 50x25mm / 50x30mm) FORMAT ──
  if (isSticker) {
    const is30mm = data.stickerSize === '50x30';
    const is25mm = data.stickerSize === '50x25';
    const stickerHeight = is30mm ? '30mm' : is25mm ? '25mm' : '20mm';
    const maxSpecCount = is30mm ? 8 : is25mm ? 6 : (data.includeBarcode && data.barcodeValue ? 3 : 5);
    return `
      <div style="${widthStyle}min-height:${stickerHeight};max-height:${stickerHeight};margin:0 auto;font-family:Arial,sans-serif;color:#000;font-size:8.5px;line-height:1.15;padding:1mm 1.5mm;box-sizing:border-box;overflow:hidden;background:#fffef0;border:1.5px dashed #c8b400;border-radius:3px;">
        <div style="text-align:center;border-bottom:1px solid #000;padding-bottom:1px;margin-bottom:1px;">
          <strong style="font-size:9.5px;text-transform:uppercase;">${escapeHtml(storeName || 'PhoneShop')}</strong>
          ${data.title ? `<div style="font-size:8px;font-weight:bold;color:#444;">${escapeHtml(data.title)}</div>` : ''}
        </div>

        ${data.deviceModel ? `
          <div style="font-size:9px;font-weight:bold;text-align:center;margin:1px 0;">
            ${escapeHtml(data.deviceModel)}
          </div>
        ` : ''}

        <div style="display:flex;flex-direction:column;gap:1px;font-size:8px;margin:1px 0;">
          ${allSpecs.length <= maxSpecCount ? (
            allSpecs.map(s => `
              <div style="display:flex;justify-content:space-between;width:100%;">
                <span style="color:#555;">${escapeHtml(s.label)} :</span>
                <strong>${escapeHtml(s.value)}</strong>
              </div>
            `).join('')
          ) : (
            Array.from({ length: Math.ceil(allSpecs.length / 2) }).map((_, idx) => {
              const s1 = allSpecs[idx * 2];
              const s2 = allSpecs[idx * 2 + 1];
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;width:100%;font-size:7px;line-height:1.1;">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%;"><span style="color:#666;">${escapeHtml(s1.label)}:</span> <strong>${escapeHtml(s1.value)}</strong></span>
                  ${s2 ? `<span style="color:#bbb;margin:0 2px;">|</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%;"><span style="color:#666;">${escapeHtml(s2.label)}:</span> <strong>${escapeHtml(s2.value)}</strong></span>` : ''}
                </div>
              `;
            }).join('')
          )}
        </div>

        ${cleanPrice ? `
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #000;padding-top:1px;margin-top:1px;">
            <span style="font-size:8px;font-weight:bold;">PRICE :</span>
            <span style="font-size:10px;font-weight:bold;">${escapeHtml(cleanPrice)} ${escapeHtml(currency)}</span>
          </div>
        ` : ''}

        ${barcodeHtml}

        ${data.notes ? `
          <div style="font-size:7.5px;border-top:0.5px dashed #666;padding-top:1px;margin-top:1px;color:#333;">
            ${escapeHtml(data.notes)}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── RECEIPT SLIP (80mm or 58mm) FORMAT ──
  return `
    <div style="${widthStyle}margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:11px;line-height:1.35;padding:2mm;box-sizing:border-box;">
      
      {/* Store Header */}
      ${data.showStoreHeader ? `
        <div style="text-align:center;margin-bottom:8px;">
          <h2 style="font-size:16px;font-weight:800;margin:0 0 2px;letter-spacing:0.5px;">${escapeHtml(storeName || 'PhoneShop Pro')}</h2>
          ${storePhone ? `<p style="font-size:10.5px;color:#444;margin:1px 0;">📞 ${escapeHtml(storePhone)}</p>` : ''}
          ${storeAddress ? `<p style="font-size:10px;color:#666;margin:1px 0;">📍 ${escapeHtml(storeAddress)}</p>` : ''}
          <div style="border-top:1px dashed #888;margin:6px 0;"></div>
        </div>
      ` : ''}

      {/* Ticket Title & Meta */}
      <div style="text-align:center;margin-bottom:6px;">
        <h3 style="font-size:13px;font-weight:800;text-transform:uppercase;margin:0 0 2px;letter-spacing:0.4px;">
          ${data.title ? escapeHtml(data.title) : 'DEVICE SPECIFICATIONS'}
        </h3>
        ${data.subtitle ? `<p style="font-size:10.5px;color:#555;margin:1px 0;">${escapeHtml(data.subtitle)}</p>` : ''}
        <p style="font-size:10px;color:#777;margin:2px 0 4px;">Date: ${nowStr}</p>
        <div style="border-top:1.5px solid #000;margin:4px 0;"></div>
      </div>

      {/* Device Highlight Banner */}
      ${data.deviceModel ? `
        <div style="background:#f4f4f5;border:1px solid #ddd;border-radius:4px;padding:6px 8px;margin-bottom:8px;text-align:center;">
          <div style="font-size:9.5px;text-transform:uppercase;color:#666;font-weight:700;letter-spacing:0.5px;">Device Model</div>
          <div style="font-size:14px;font-weight:800;color:#000;margin-top:1px;">${escapeHtml(data.deviceModel)}</div>
        </div>
      ` : ''}

      {/* Specifications Table */}
      ${allSpecs.length > 0 ? `
        <div style="margin-bottom:8px;">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #aaa;padding-bottom:2px;margin-bottom:4px;color:#333;">
            Technical Specifications
          </div>
          ${allSpecs.map((s, idx) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:2.5px 0;${idx < allSpecs.length - 1 ? 'border-bottom:1px dashed #eee;' : ''}">
              <span style="color:#555;font-size:10.5px;">${escapeHtml(s.label)}</span>
              <span style="font-weight:700;font-size:11px;text-align:right;">${escapeHtml(s.value)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      {/* Price Block */}
      ${cleanPrice ? `
        <div style="border:1.5px solid #000;border-radius:6px;padding:6px 10px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;background:#fafafa;">
          <span style="font-size:12px;font-weight:800;letter-spacing:0.5px;">PRICE:</span>
          <span style="font-size:16px;font-weight:900;">${escapeHtml(cleanPrice)} ${escapeHtml(currency)}</span>
        </div>
      ` : ''}

      {/* Notes / Diagnostic details */}
      ${data.notes ? `
        <div style="border-top:1px dashed #999;padding-top:5px;margin:8px 0;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#444;margin-bottom:2px;">Notes & Observations:</div>
          <p style="font-size:10.5px;color:#111;margin:0;white-space:pre-wrap;line-height:1.35;">${escapeHtml(data.notes)}</p>
        </div>
      ` : ''}

      {/* Barcode / QR */}
      ${barcodeHtml}

      {/* Footer Message */}
      ${data.showStoreFooter ? `
        <div style="border-top:1px dashed #999;margin-top:10px;padding-top:6px;text-align:center;font-size:10px;color:#555;">
          <p style="margin:0 0 2px;font-weight:600;">${data.customFooter ? escapeHtml(data.customFooter) : 'Thank you for choosing PhoneShop Pro!'}</p>
          <p style="font-size:9px;color:#888;margin:0;">Tested & Verified by Technical Team</p>
        </div>
      ` : ''}

    </div>
  `;
}
