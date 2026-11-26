// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildLabelsHTML } from './printWindow';

describe('inventory ticket HTML layout alignment', () => {
  it('shifts inventory barcode and price 4mm up and 5mm left while preserving header text position', () => {
    const html = buildLabelsHTML(
      [{ sku: 'SKU123', name: 'iPhone 15', price: 120000 }],
      'My Shop'
    );

    // Shop title stays at translateX(-2mm)
    expect(html).toContain('transform:translateX(-2mm);');
    expect(html).toContain('My Shop');

    // Barcode wrapper moved 4mm up (5.4mm -> 1.4mm) and 5mm left (4mm -> -1mm)
    expect(html).toContain('margin-top:1.4mm;transform:translateX(-1mm);display:flex;');
    expect(html).not.toContain('margin-top:5.4mm;transform:translateX(4mm);');

    // Price moved 5mm left (4mm -> -1mm) and follows lifted barcode 4mm higher
    expect(html).toContain('height:4mm;line-height:4mm;margin-top:0.6mm;letter-spacing:0.3px;transform:translateX(-1mm);');
  });

  it('shifts non-part inventory barcode even when price is omitted and leaves hidePrice on part layout untouched', () => {
    const htmlNoPrice = buildLabelsHTML(
      [{ sku: 'ACC-1', name: 'USB Cable' }],
      'My Shop'
    );
    expect(htmlNoPrice).toContain('margin-top:1.4mm;transform:translateX(-1mm);display:flex;');
    expect(htmlNoPrice).not.toContain('margin-top:5.4mm;transform:translateX(4mm);');

    const htmlHiddenPrice = buildLabelsHTML(
      [{ sku: 'SKU123', name: 'USB Cable', hidePrice: true }],
      'My Shop'
    );
    expect(htmlHiddenPrice).toContain('position:absolute;bottom:0.8mm;left:0;right:0;transform:translateX(1mm);');
  });

  it('keeps repair-part sticker layout untouched', () => {
    const html = buildLabelsHTML(
      [{ sku: 'PRT-10', name: 'OLED Screen', price: 8500, category: 'repair_part' }],
      'My Shop'
    );

    expect(html).toContain('position:absolute;bottom:0.8mm;left:0;right:0;transform:translateX(1mm);');
    expect(html).not.toContain('margin-top:1.4mm;transform:translateX(-1mm);');
  });
});
