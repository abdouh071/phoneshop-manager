/**
 * Inventory TSPL barcode label alignment tests (software-only — no printer involved).
 *
 * Verifies that non-part inventory labels shift ONLY the barcode and price
 * by 4mm up (-32 dots Y at 203 DPI) and 5mm left (-40 dots X at 203 DPI),
 * while keeping shop title, divider bar, and product description lines untouched.
 *
 *   npm test   (from print-server/)
 */
process.env.PORT = '3399';
process.env.PRINT_SERVER_TOKEN = 'unit-test-token-0123456789abcdef';
process.env.PRINTER_NAME = 'TestQueue_AAA';
process.env.LABEL_PRINTER_NAME = 'TestQueue_BBB';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { internals } = require('./server.js');
const { buildInventoryProductLabelTSPL, getCenteredX } = internals;

const baseCfg = { font: '1', mulX: 1, mulY: 1, lineHeight: 20 };

test('single-line inventory label shifts barcode and price 4mm up (-32 Y) and 5mm left (-40 X) while keeping other text fixed', () => {
  const shopX = 120;
  const barcodeX = 80;
  const priceText = '25000 DA';
  const line1 = 'iPhone 15 128GB';

  const tspl = buildInventoryProductLabelTSPL({
    shopX,
    shopTitle: 'PHONESHOP',
    textLines: [line1],
    fontType: '1',
    fontCfg: baseCfg,
    barcodeX,
    narrow: 2,
    wide: 4,
    sku: 'SKU123',
    priceText,
  });

  const expectedTextX = Math.max(0, getCenteredX(line1, '1') + 16);
  const expectedBarcodeX = barcodeX - 8; // was barcodeX + 32; -40 dots = 5mm left
  const expectedPriceX = Math.max(0, getCenteredX(priceText, '4') - 8); // was +32; -40 dots

  assert.match(tspl, new RegExp(`TEXT ${shopX},6,"2",0,1,1,"PHONESHOP"`));
  assert.match(tspl, /BAR 0,30,400,2/);
  assert.match(tspl, new RegExp(`TEXT ${expectedTextX},40,"1",0,1,1,"iPhone 15 128GB"`));
  assert.match(tspl, new RegExp(`BARCODE ${expectedBarcodeX},70,"128",28,0,0,2,4,"SKU123"`));
  assert.match(tspl, new RegExp(`TEXT ${expectedPriceX},108,"4",0,1,1,"25000 DA"`));
});

test('two-line inventory label shifts barcode and price 4mm up (-32 Y) and 5mm left (-40 X) while keeping both text lines fixed', () => {
  const shopX = 120;
  const barcodeX = 80;
  const priceText = '145000 DA';
  const lines = ['Samsung Galaxy S24', 'Ultra 256GB Black'];

  const tspl = buildInventoryProductLabelTSPL({
    shopX,
    shopTitle: 'PHONESHOP',
    textLines: lines,
    fontType: '1',
    fontCfg: baseCfg,
    barcodeX,
    narrow: 2,
    wide: 4,
    sku: 'SKU999',
    priceText,
  });

  const line1X = Math.max(0, getCenteredX(lines[0], '1') + 16);
  const line2X = Math.max(0, getCenteredX(lines[1], '1') + 16);
  const expectedPriceX = Math.max(0, getCenteredX(priceText, '4') - 8);

  assert.match(tspl, new RegExp(`TEXT ${line1X},40,"1",0,1,1,"Samsung Galaxy S24"`));
  assert.match(tspl, new RegExp(`TEXT ${line2X},60,"1",0,1,1,"Ultra 256GB Black"`));
  assert.match(tspl, /BARCODE 72,78,"128",24,0,0,2,4,"SKU999"/);
  assert.match(tspl, new RegExp(`TEXT ${expectedPriceX},108,"4",0,1,1,"145000 DA"`));
});

test('wide barcode at minimum center offset shifts full 5mm left without premature clamping at x=20', () => {
  const tspl = buildInventoryProductLabelTSPL({
    shopX: 120,
    shopTitle: 'PHONESHOP',
    textLines: ['Wide SKU Item'],
    fontType: '1',
    fontCfg: baseCfg,
    barcodeX: 20, // previously 20 + 32 = 52 -> 5mm left = 12
    narrow: 2,
    wide: 4,
    sku: 'VERY-LONG-SKU-12345',
    priceText: '500 DA',
  });

  assert.match(tspl, /BARCODE 12,70,"128",28,0,0,2,4,"VERY-LONG-SKU-12345"/);
});
