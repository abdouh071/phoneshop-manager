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
const { wrapFreeTextLines } = internals;

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
