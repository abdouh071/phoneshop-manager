#!/usr/bin/env node
/**
 * One-shot printer geometry probe.
 *
 * Prints a SINGLE measurement label on the configured label printer using the
 * exact production TSPL header (SIZE/GAP/REFERENCE/DIRECTION) and the same
 * lpr raw spool path as the print server, so the numbers measured with a real
 * ruler map 1:1 to production labels.
 *
 * The label carries:
 *   - a full 400-dot ruler bar with a tick every 50 dots (0..400),
 *   - a 30-char string at font "2" starting at x=0,
 *   - a 30-char string at font "1" starting at x=0,
 *   - a known Code 128 barcode (10 digits, narrow/wide = 2, like production),
 *   - a bottom ruler plus a marker block at the far right edge (x=380..400)
 *     to show whether that edge prints at all.
 *
 * Usage:
 *   node geometry-probe.js --tspl   print the TSPL stream to stdout (no spool)
 *   node geometry-probe.js          spool one label to LABEL_PRINTER_NAME (.env)
 */
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PRINTER = process.env.LABEL_PRINTER_NAME || 'Xprinter_XP_420B';

const sample = '012345678901234567890123456789'; // 30 chars, fixed-width fonts

const ticks = [];
for (let x = 0; x <= 400; x += 50) {
  const tall = x % 100 === 0;
  ticks.push(`BAR ${x},7,2,${tall ? 14 : 10}`);
}

let tspl = '';
tspl += 'SIZE 50 mm, 20 mm\r\n';
tspl += 'GAP 2 mm, 0 mm\r\n';
tspl += 'REFERENCE 0,0\r\n';
tspl += 'DIRECTION 1\r\n';
tspl += 'CLS\r\n';
tspl += 'BAR 0,4,400,3\r\n';
tspl += ticks.join('\r\n') + '\r\n';
tspl += `TEXT 0,26,"2",0,1,1,"${sample}"\r\n`;
tspl += `TEXT 0,54,"1",0,1,1,"${sample}"\r\n`;
tspl += 'BARCODE 0,76,"128",32,0,0,2,2,"1234567890"\r\n';
tspl += 'BAR 0,118,400,2\r\n';
tspl += 'BAR 0,124,20,10\r\n';
tspl += 'BAR 380,124,20,10\r\n';
tspl += 'PRINT 1,1\r\n';

if (process.argv.includes('--tspl')) {
  process.stdout.write(tspl);
  process.exit(0);
}

if (os.platform() === 'win32') {
  console.error('This probe is macOS-only (spools via lpr). Run it on the machine that owns the printer queue.');
  process.exit(1);
}

const tmp = path.join(os.tmpdir(), `geometry_probe_${Date.now()}.bin`);
fs.writeFileSync(tmp, Buffer.from(`\r\nCLS\r\n${tspl}CLS\r\n`, 'utf-8'), { mode: 0o600 });

execFile('lpr', ['-P', PRINTER, '-o', 'raw', tmp], { timeout: 15000 }, (err, stdout, stderr) => {
  try { fs.unlinkSync(tmp); } catch (_) {}
  if (err) {
    console.error(`lpr failed on "${PRINTER}": ${String(stderr || err.message).trim()}`);
    process.exit(1);
  }
  console.log(`Probe label spooled to "${PRINTER}".${stdout ? ` (${stdout.trim()})` : ''}`);
  console.log('');
  console.log('Now measure the printed label with a ruler and report these four things:');
  console.log('  1. Printed length of the 30-char BOLD (font 2) line in mm');
  console.log('  2. Printed length of the 30-char SMALL (font 1) line in mm');
  console.log('  3. The top ruler: which tick is the last one fully visible (0..400, every 50)?');
  console.log('  4. Is the small right-edge marker block (after tick 380) printed at all?');
});
