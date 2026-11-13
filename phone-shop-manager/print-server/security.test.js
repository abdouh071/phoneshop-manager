/**
 * Print server guard tests.
 *
 * The printer itself cannot be rehearsed on a dev machine, so these assert on the
 * layers in front of it: who may ask, what text may reach the command stream, and
 * what a queue overflow or a bad request looks like.
 *
 * Nothing here sends a valid print payload — every request uses a body the handler
 * rejects before touching CUPS, so no test can put paper in a real printer.
 *
 *   npm test   (from print-server/)
 */
process.env.PORT = '3399';
process.env.PRINT_SERVER_TOKEN = 'unit-test-token-0123456789abcdef';
process.env.PRINT_SERVER_RATE_MAX_JOBS = '5';
// Deliberately not matching isLabelPrinter(), and not a queue any shop owns.
process.env.PRINTER_NAME = 'TestQueue_AAA';
process.env.LABEL_PRINTER_NAME = 'TestQueue_BBB';
process.env.PRINT_SERVER_LAN_MODE = '';
process.env.PRINT_SERVER_ALLOW_UNAUTHENTICATED = '';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const server = require('./server.js');
const { internals, getPrintServerToken, startServer } = server;
const TOKEN = getPrintServerToken();

const INVALID_RECEIPT = { storeName: 'Test', transaction: null };
const TEST_ORIGIN = 'http://localhost:5173';
const RATE_ORIGIN = 'http://127.0.0.1:4173'; // used only by the rate-limit test
const EVIL_ORIGIN = 'https://evil.example';

let handle;
const base = 'http://127.0.0.1:3399';

async function postJson(path, body, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

before(async () => {
  handle = await startServer(3399);
});

after(async () => {
  if (handle) await new Promise((resolve) => handle.close(resolve));
});

test('binds to loopback unless LAN mode is asked for', () => {
  assert.equal(handle.address().address, '127.0.0.1');
});

test('a TSPL payload cannot open a new command line', () => {
  const injected = 'iPhone 13"\r\nPRINT 999,1\r\nGAPDETECT\r\n';
  const safe = internals.tsplText(injected, 60);
  // What matters is that nothing can end the quoted field or start a new command:
  // the leftover words print as label text on one line.
  assert.equal(/["\\\r\n]/.test(safe), false, safe);
  assert.match(safe, /^iPhone 13/);
  assert.doesNotMatch(safe, /\r\n/);
});

test('tsplText keeps ordinary label text and bounds length', () => {
  assert.equal(internals.tsplText('iPhone 13 Pro 256GB', 60), 'iPhone 13 Pro 256GB');
  assert.equal(internals.tsplText('   spaced   out   ', 60), 'spaced out');
  assert.equal(internals.tsplText(null, 20), '');
  assert.equal(internals.tsplText('x'.repeat(100), 24).length, 24);
});

test('tsplField keeps the column padding that lays out a two-column row', () => {
  const row = 'RAM : 6GB'.padEnd(20, ' ') + '| IMEI : 356';
  assert.equal(internals.tsplField(row, 42), row);
  assert.equal(internals.tsplField('a"b\\c\r\nd', 42), 'abc d');
});

test('ESC/POS text loses command bytes but keeps its own line breaks', () => {
  const withEscapes = `Store\u001B\u0040Name\u001Dv0\u0000\nSecond line\ttab`;
  const clean = internals.stripControlChars(withEscapes, 200);
  assert.equal(clean.includes('\u001B'), false);
  assert.equal(clean.includes('\u001D'), false);
  assert.equal(clean.includes('\u0000'), false);
  assert.equal(clean.includes('\n'), true);
  assert.equal(clean.includes('\t'), true);
});

test('sanitizePayload cleans nested fields and leaves the logo bytes alone', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg\u0000';
  const clean = internals.sanitizePayload({
    storeName: 'Shop\u001BCut',
    transaction: { customerName: 'A\u0000B', total: 1999.5, paid: true, items: [{ name: 'Case\u001D' }] },
    logo,
  }, 'body');
  assert.equal(clean.storeName, 'ShopCut');
  assert.equal(clean.transaction.customerName, 'AB');
  assert.equal(clean.transaction.items[0].name, 'Case');
  assert.equal(clean.transaction.total, 1999.5);
  assert.equal(clean.transaction.paid, true);
  assert.equal(clean.logo, logo); // untouched: the raster code validates it
});

test('copies is a finite number inside the configured ceiling', () => {
  assert.equal(internals.clampCopies(3), 3);
  assert.equal(internals.clampCopies('7'), 7);
  assert.equal(internals.clampCopies(1e9), internals.limits.MAX_COPIES);
  assert.equal(internals.clampCopies('1e9'), internals.limits.MAX_COPIES);
  assert.equal(internals.clampCopies('abc'), 1);
  assert.equal(internals.clampCopies(0), 1);
  assert.equal(internals.clampCopies(-5), 1);
  assert.equal(internals.clampCopies(undefined), 1);
  assert.equal(internals.clampCopies(null), 1);
  assert.equal(internals.clampCopies(Infinity), 1);
});

test('tsplInt never produces NaN in a command parameter', () => {
  assert.equal(internals.tsplInt(undefined, 8, 1, 100), 8);
  assert.equal(internals.tsplInt('12.9', 8, 1, 100), 12);
  assert.equal(internals.tsplInt('-99', 8, 1, 100), 1);
});

test('a part name wraps to the width, keeping the model line then the remainder', () => {
  assert.deepEqual(
    internals.wrapTsplToWidth('AF REDMI NOTE 8 PRO CHINE REDMI', 12, 288),
    ['AF REDMI NOTE 8 PRO', 'CHINE REDMI']
  );
});

test('every wrapped line stays inside the safe dot width', () => {
  const long = 'AFFICHEUR IPHONE 14 PRO MAX ORIGINAL CHINE REDMI NOTE 8 PRO';
  for (const line of internals.wrapTsplToWidth(long, 12, 288)) {
    assert.ok(line.length * 12 <= 288, line);
  }
});

test('wrapping keeps every word of a long name instead of cutting the tail', () => {
  const long = 'AFFICHEUR IPHONE 14 PRO MAX ORIGINAL CHINE REDMI NOTE 8 PRO';
  const lines = internals.wrapTsplToWidth(long, 12, 288);
  assert.equal(lines.join(' '), long);
});

test('a single word wider than the line is split across lines, never dropped', () => {
  const word = 'A'.repeat(50);
  const lines = internals.wrapTsplToWidth(word, 12, 288);
  assert.deepEqual(lines, ['A'.repeat(24), 'A'.repeat(24), 'A'.repeat(2)]);
  assert.equal(lines.join(''), word);
});

test('a short name stays on one line and an empty name yields one blank line', () => {
  assert.deepEqual(internals.wrapTsplToWidth('CABLE', 12, 288), ['CABLE']);
  assert.deepEqual(internals.wrapTsplToWidth('', 12, 288), ['']);
});

test('a ticket line that fits keeps the larger font 2', () => {
  assert.deepEqual(internals.fitTsplLine('CABLE', 336), { font: '2', text: 'CABLE' });
  assert.deepEqual(internals.fitTsplLine('', 336), { font: '2', text: '' });
  // 28 chars x 12 dots = 336, exactly the safe extent of the phone-name line.
  const edge = 'A'.repeat(28);
  assert.deepEqual(internals.fitTsplLine(edge, 336), { font: '2', text: edge });
});

test('a ticket line too wide for font 2 drops to font 1 and keeps every letter', () => {
  const name = 'A'.repeat(29); // 29 x 12 = 348 > 336, but 29 x 8 = 232 fits
  const fitted = internals.fitTsplLine(name, 336);
  assert.equal(fitted.font, '1');
  assert.equal(fitted.text, name);
});

test('a very long ticket line is capped so no glyph reaches the right edge', () => {
  const fitted = internals.fitTsplLine('A'.repeat(50), 336);
  assert.equal(fitted.font, '1');
  assert.equal(fitted.text, 'A'.repeat(42)); // floor(336 / 8)
  assert.ok(fitted.text.length * 8 <= 336);
});

test('every fitted ticket line stays inside the safe dot width at its own font', () => {
  for (let len = 0; len <= 60; len++) {
    const fitted = internals.fitTsplLine('X'.repeat(len), 336);
    const charWidth = fitted.font === '2' ? 12 : 8;
    assert.ok(fitted.text.length * charWidth <= 336, `len ${len}`);
  }
});

test('an oversized PNG is refused before it is decoded', () => {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(0x89504e47, 0);
  header.writeUInt32BE(internals.limits.MAX_LOGO_PIXELS + 1, 16);
  header.writeUInt32BE(1, 20);
  assert.deepEqual(internals.pngDimensions(header), { width: internals.limits.MAX_LOGO_PIXELS + 1, height: 1 });
  assert.equal(internals.pngDimensions(Buffer.from('not a png')), null);
});

test('the till and the desktop app may ask; a stranger may not', () => {
  assert.equal(internals.originAllowed(TEST_ORIGIN), true);
  assert.equal(internals.originAllowed('http://127.0.0.1:3355'), true);
  assert.equal(internals.originAllowed('https://phoneshop-mgr-pro-2026.web.app'), true);
  assert.equal(internals.originAllowed(EVIL_ORIGIN), false);
  assert.equal(internals.originAllowed('https://phoneshop-mgr-pro-2026.web.app.evil.test'), false);
  assert.equal(internals.originAllowed('null'), false);
  assert.equal(internals.originAllowed('file:///tmp/x.html'), false);
  // A private address is only a friend when the operator opened the server to the LAN.
  assert.equal(internals.originAllowed('http://192.168.1.40:8080'), false);
});

test('a caller with neither an allowed Origin nor the token is turned away', () => {
  assert.deepEqual(internals.authorize({ headers: {} }), {
    allowed: false, status: 401, code: 'token_required', error: 'Missing X-Print-Token header.',
  });
  const evil = internals.authorize({ headers: { origin: EVIL_ORIGIN } });
  assert.equal(evil.allowed, false);
  assert.equal(evil.status, 403);
  assert.equal(internals.authorize({ headers: { 'x-print-token': `${TOKEN}x` } }).allowed, false);
  assert.equal(internals.authorize({ headers: { 'x-print-token': TOKEN } }).allowed, true);
});

test('a substitute queue has to be the configured printer', () => {
  const printers = ['Printer_POS_80', 'HP_LaserJet_80', 'Xprinter_XP_420B'];
  // The old rule accepted any queue whose name contained "80" — that is the office LaserJet.
  assert.equal(internals.chooseSubstitutePrinter('Printer_POS_80', printers, false), null);
  assert.equal(internals.chooseSubstitutePrinter('POS_80', printers, false), 'Printer_POS_80');
  assert.equal(internals.chooseSubstitutePrinter('80', printers, false), null);
  // A configured short name still resolves its real queue, and TSPL only goes to a label queue.
  assert.equal(internals.chooseSubstitutePrinter('XP-420B', printers, true), 'Xprinter_XP_420B');
  assert.equal(internals.chooseSubstitutePrinter('XP-420B', ['Printer_POS_80'], true), null);
});

test('GET /status answers but hides queue names from an unauthenticated caller', async () => {
  const res = await fetch(`${base}/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, 'phone-shop-print-server');
  assert.equal(body.printer, null);
  assert.equal(body.labelPrinter, null);
  assert.equal(body.authenticated, false);

  const withOrigin = await fetch(`${base}/status`, { headers: { Origin: TEST_ORIGIN } });
  const trustedBody = await withOrigin.json();
  assert.equal(trustedBody.printer, 'TestQueue_AAA');
  assert.equal(trustedBody.authVia, 'origin');
});

test('a foreign Origin cannot reach a print route', async () => {
  const res = await postJson('/print-receipt', INVALID_RECEIPT, EVIL_ORIGIN);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'origin_not_allowed');
});

test('a non-browser caller without the token cannot reach a print route', async () => {
  const res = await fetch(`${base}/print-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(INVALID_RECEIPT),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'token_required');
});

test('an allowed Origin gets to the handler, and so does the token', async () => {
  const fromBrowser = await postJson('/print-receipt', INVALID_RECEIPT, TEST_ORIGIN);
  assert.equal(fromBrowser.status, 400);
  assert.equal((await fromBrowser.json()).error, 'Missing transaction data');

  const fromScript = await fetch(`${base}/print-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Print-Token': TOKEN },
    body: JSON.stringify(INVALID_RECEIPT),
  });
  assert.equal(fromScript.status, 400);
  assert.equal((await fromScript.json()).error, 'Missing transaction data');
});

test('a receipt whose lines never arrived is refused instead of printed blank', async () => {
  const empty = await postJson(
    '/print-receipt',
    { storeName: 'Test', transaction: { id: 'INV-1', date: '2026-11-08', items: [], total: 1500 } },
    TEST_ORIGIN
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'Receipt has no item lines');

  const notLines = await postJson(
    '/print-receipt',
    { storeName: 'Test', transaction: { id: 'INV-2', date: '2026-11-08', items: 'corrupted', total: 1500 } },
    TEST_ORIGIN
  );
  assert.equal(notLines.status, 400);
  assert.equal((await notLines.json()).error, 'Missing transaction data');
});

test('calibration refuses a printer that is not a label printer', async () => {
  const res = await postJson('/calibrate-labels', {}, TEST_ORIGIN);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not a label printer/);
});

test('the preflight only answers our own origins', async () => {
  const mine = await fetch(`${base}/print-receipt`, {
    method: 'OPTIONS',
    headers: { Origin: TEST_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type', 'Access-Control-Request-Private-Network': 'true' },
  });
  assert.equal(mine.status, 204);
  assert.equal(mine.headers.get('access-control-allow-origin'), TEST_ORIGIN);
  assert.equal(mine.headers.get('access-control-allow-private-network'), 'true');
  assert.match(mine.headers.get('access-control-allow-headers') || '', /X-Print-Token/);

  const stranger = await fetch(`${base}/print-receipt`, {
    method: 'OPTIONS',
    headers: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.headers.get('access-control-allow-origin'), null);
});

test('unknown routes and malformed bodies answer in JSON', async () => {
  const notFound = await fetch(`${base}/print-anything`, { method: 'POST', headers: { Origin: TEST_ORIGIN } });
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).code, 'not_found');

  const badJson = await fetch(`${base}/print-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
    body: '{"total": ',
  });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).code, 'invalid_json');
});

test('one client gets a bounded number of jobs per window', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 8; i++) {
    const res = await postJson('/print-receipt', INVALID_RECEIPT, RATE_ORIGIN);
    lastStatus = res.status;
    if (res.status === 429) {
      assert.match((await res.json()).error, /Too many print jobs/);
      assert.ok(res.headers.get('retry-after'));
      break;
    }
  }
  assert.equal(lastStatus, 429);
});
