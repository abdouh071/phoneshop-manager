import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';

// Barcode / QR Preview Renderer for Print Modal
export const BarcodePreview: React.FC<{ value: string; isQr: boolean; isCompact?: boolean }> = ({ value, isQr, isCompact }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!isQr && svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: isCompact ? 1.1 : 1.35,
          height: isCompact ? 28 : 36,
          displayValue: true,
          fontSize: isCompact ? 9 : 10.5,
          font: 'monospace',
          margin: 0,
        });
      } catch (e) {
        console.warn('Barcode preview error:', e);
      }
    }
  }, [value, isQr, isCompact]);

  if (!value) return null;

  if (isQr) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0' }}>
        <QRCodeSVG value={value} size={isCompact ? 56 : 76} level="M" />
        <div style={{ fontSize: isCompact ? '9px' : '10px', fontFamily: 'monospace', color: '#444', marginTop: '3px' }}>
          {value}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0', overflow: 'hidden' }}>
      <svg ref={svgRef} style={{ maxWidth: '100%' }} />
    </div>
  );
};
