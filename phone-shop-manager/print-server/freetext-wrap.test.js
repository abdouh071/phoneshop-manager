/**
 * Free-text wrap parity tests (software-only — no printer involved).
 *
 * The on-screen preview wraps free text with `word-break: break-word`, so a long
 * unbroken string wraps where the line ends. The TSPL renderer used to split on
 * spaces only, so the same text printed one over-long line and clipped at the
 * label's right edge. These pin the wrap helper to the preview's behavior.
 *
 *   npm test   (from print-server/)
 */
process.env.PORT = '3398';
process.env.PRINT_SERVER_TOKEN = 'unit-test-token-0123456789abcdef';
process.env.PRINTER_NAME = 'TestQueue_AAA';
process.env.LABEL_PRINTER_NAME = 'TestQueue_BBB';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { internals } = require('./server.js');
const { wrapFreeTextLines, buildCustomFreeTextTSPL } = internals;

test('wraps by words under the line limit', () => {
  assert.deepEqual(
    wrapFreeTextLines('one two three', 10),
    ['one two', 'three']
  );
});

test('keeps words that fit on one line together', () => {
  assert.deepEqual(
    wrapFreeTextLines('hello world', 11),
    ['hello world']
  );
});

test('splits a word longer than a whole line at the line end, like the preview', () => {
  assert.deepEqual(
    wrapFreeTextLines('ABCDEFGHIJ', 4),
    ['ABCD', 'EFGH', 'IJ']
  );
});

test('splits an over-long word without swallowing the words around it', () => {
  assert.deepEqual(
    wrapFreeTextLines('go AAAAAAAAAAAA stop', 6),
    ['go', 'AAAAAA', 'AAAAAA', 'stop']
  );
});

test('a word exactly the line width is not split', () => {
  assert.deepEqual(
    wrapFreeTextLines('ABCD', 4),
    ['ABCD']
  );
});

test('preserves explicit newlines and blank lines', () => {
  assert.deepEqual(
    wrapFreeTextLines('one\ntwo\n\nthree', 20),
    ['one', 'two', '', 'three']
  );
});

test('no line it returns is longer than the limit, so nothing can clip', () => {
  const lines = wrapFreeTextLines(
    'short words and a supercalifragilisticexpialidocious word in the middle of it',
    12
  );
  for (const line of lines) {
    assert.ok(line.length <= 12, `line too long: "${line}"`);
  }
});

test('buildCustomFreeTextTSPL handles empty text without overflow warning', () => {
  const res = buildCustomFreeTextTSPL({
    storeName: 'PhoneShop Pro',
    ticketData: { mode: 'free_text', format: 'sticker', stickerSize: '50x20', freeText: '' },
    copies: 1,
  });
  assert.match(res.tspl, /SIZE 50 mm, 20 mm/);
  assert.equal(res.clippedLines, 0);
  assert.equal(res.warning, undefined);
});

test('buildCustomFreeTextTSPL preserves chosen giant font and emits split TEXT commands + warning when height overflows', () => {
  const res = buildCustomFreeTextTSPL({
    storeName: 'PhoneShop Pro',
    ticketData: {
      mode: 'free_text',
      format: 'sticker',
      stickerSize: '50x20',
      freeText: 'X'.repeat(60),
      fontSize: 'giant',
      showStoreNameOnSticker: true,
      includeBarcode: true,
      barcodeValue: '998877',
      barcodeType: 'qr',
    },
    copies: 1,
  });
  assert.ok(res.clippedLines > 0);
  assert.match(res.warning || '', /did not fit/);
  // Preserves giant font ("4"), never auto-shrinks to "1"
  assert.match(res.tspl, /TEXT \d+,\d+,"4",0,1,1,"X{15}"/);
  assert.match(res.tspl, /QRCODE /);
});

test('buildCustomFreeTextTSPL fits more lines on 50x30mm than 50x20mm with Code128 barcode', () => {
  const multi = ['LINE ONE', 'LINE TWO', 'LINE THREE', 'LINE FOUR', 'LINE FIVE', 'LINE SIX'].join('\n');
  const small = buildCustomFreeTextTSPL({
    storeName: 'PhoneShop Pro',
    ticketData: {
      mode: 'free_text', format: 'sticker', stickerSize: '50x20', freeText: multi,
      fontSize: 'normal', includeBarcode: true, barcodeValue: '12345', barcodeType: 'code128',
    },
    copies: 1,
  });
  const tall = buildCustomFreeTextTSPL({
    storeName: 'PhoneShop Pro',
    ticketData: {
      mode: 'free_text', format: 'sticker', stickerSize: '50x30', freeText: multi,
      fontSize: 'normal', includeBarcode: true, barcodeValue: '12345', barcodeType: 'code128',
    },
    copies: 1,
  });
  assert.ok(small.clippedLines === 0 || tall.clippedLines <= small.clippedLines);
  assert.equal(tall.clippedLines, 0);
  assert.match(tall.tspl, /SIZE 50 mm, 30 mm/);
  assert.match(tall.tspl, /BARCODE /);
});
