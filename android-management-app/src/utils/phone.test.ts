import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldDigitsToAscii, isRealPhone, isSamePhone, phoneDigits, phoneKey } from './phone.ts';

test('folds Arabic-Indic digits before stripping separators', () => {
  assert.equal(foldDigitsToAscii('٠٧٧٠-١٢٣٤٥٦'), '0770-123456');
  assert.equal(phoneDigits('٠٧٧٠ ١٢ ٣٤ ٥٦'), '0770123456');
  assert.equal(phoneDigits('۰۷۷۰۱۲۳۴۵۶'), '0770123456');
});

test('one line written four ways reduces to one key', () => {
  for (const written of ['0770 12 34 56', '0770123456', '+213 770 12 34 56', '00213770123456', '770123456']) {
    assert.equal(phoneKey(written), '0770123456', written);
  }
});

test('a landline missing its leading zero still keys the same', () => {
  assert.equal(phoneKey('21 12 34 56'), '021123456');
  assert.equal(phoneKey('021123456'), '021123456');
});

test('placeholders are not phone lines', () => {
  assert.equal(isRealPhone('00000000'), false);
  assert.equal(isRealPhone('11111111'), false);
  assert.equal(isRealPhone('00000001'), false);
  assert.equal(isRealPhone('12345'), false);
  assert.equal(isRealPhone(undefined), false);
  assert.equal(isRealPhone('0770123456'), true);
});

test('the same line matches across formats and keyboards', () => {
  assert.equal(isSamePhone('0770123456', '+213770123456'), true);
  assert.equal(isSamePhone('٠٧٧٠١٢٣٤٥٦', '0770 12 34 56'), true);
});

test('a shared suffix is not the same line', () => {
  // Both end in 50123456: the old suffix match would have called them one client.
  assert.equal(isSamePhone('0550123456', '0750123456'), false);
  assert.equal(isSamePhone('0770123456', '0550123456'), false);
  assert.equal(isSamePhone('00000000', '00000000'), false);
  assert.equal(isSamePhone('0770123456', ''), false);
});

test('a scanned code with no digits is nobody\'s phone line', () => {
  // The ticket scanner used to strip both sides with \D and compare: a barcode
  // like this reduced to '' and so did a phone field holding 'N/A', which opened
  // a stranger's ticket. Neither side may be empty for a match.
  for (const stored of ['N/A', '-', '٠٠٠٠٠٠٠٠', '', undefined, null]) {
    assert.equal(isSamePhone(stored, 'SAMSUNG-COVER-BLK'), false);
    assert.equal(isSamePhone(stored, ''), false);
  }
  assert.equal(isSamePhone('0770123456', 'SAMSUNG-COVER-BLK'), false);
  assert.equal(isSamePhone('0770123456', 'A54'), false);
});

test('a scanned phone resolves across keyboards and country codes', () => {
  assert.equal(isSamePhone('0770 12 34 56', '٠٧٧٠١٢٣٤٥٦'), true);
  assert.equal(isSamePhone('٠٧٧٠١٢٣٤٥٦', '+213 770 12 34 56'), true);
  assert.equal(isSamePhone('0770123456', '00213770123456'), true);
});