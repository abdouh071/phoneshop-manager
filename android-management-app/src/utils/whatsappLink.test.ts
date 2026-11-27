import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsAppUrl } from './whatsappLink.ts';

test('an Algerian mobile is addressed with its country code, not its trunk zero', () => {
  assert.equal(whatsAppUrl('0550 12 34 56'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl('0661123456'), 'https://wa.me/213661123456');
  assert.equal(whatsAppUrl('0770-12-34-56'), 'https://wa.me/213770123456');
  assert.equal(whatsAppUrl('550123456'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl(550123456), 'https://wa.me/213550123456');
});

test('a landline keeps its area code and loses only the trunk zero', () => {
  assert.equal(whatsAppUrl('021 12 34 56'), 'https://wa.me/21321123456');
  assert.equal(whatsAppUrl('041123456'), 'https://wa.me/21341123456');
  assert.equal(whatsAppUrl('21123456'), 'https://wa.me/21321123456');
});

test('a number already written internationally is not prefixed twice', () => {
  assert.equal(whatsAppUrl('+213 550 12 34 56'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl('00213550123456'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl('213550123456'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl('+2130550123456'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl('002130550123456'), 'https://wa.me/213550123456');
});

test('an Arabic or Persian keypad dials the same client', () => {
  assert.equal(whatsAppUrl('٠٧٧٠١٢٣٤٥٦'), 'https://wa.me/213770123456');
  assert.equal(whatsAppUrl('۰۷۷۰۱۲۳۴۵۶'), 'https://wa.me/213770123456');
  assert.equal(whatsAppUrl('＋٢١٣ ٥٥٠ ١٢ ٣٤ ٥٦'), 'https://wa.me/213550123456');
});

test('a foreign number keeps the country its own caller wrote', () => {
  assert.equal(whatsAppUrl('+33 6 12 34 56 78'), 'https://wa.me/33612345678');
  assert.equal(whatsAppUrl('+86 138 1234 5678'), 'https://wa.me/8613812345678');
  assert.equal(whatsAppUrl('0033612345678'), 'https://wa.me/33612345678');
  assert.equal(whatsAppUrl('008613812345678'), 'https://wa.me/8613812345678');
});

test('the message rides as one encoded query parameter', () => {
  assert.equal(
    whatsAppUrl('0550 12 34 56', 'Salam Amine! Your phone is ready.'),
    'https://wa.me/213550123456?text=Salam%20Amine!%20Your%20phone%20is%20ready.'
  );
  const message = 'Total: 1 200 DA & merci #12\nà bientôt';
  const url = whatsAppUrl('0550123456', message)!;
  assert.equal(url, `https://wa.me/213550123456?text=${encodeURIComponent(message)}`);
  assert.equal(url.split('?').length, 2);
  assert.ok(!url.includes('\n'));
});

test('no message means no query, and an empty one is not a message', () => {
  assert.equal(whatsAppUrl('0550123456'), 'https://wa.me/213550123456');
  assert.equal(whatsAppUrl('0550123456', ''), 'https://wa.me/213550123456');
});

test('only digits reach the addressed number, whatever the field held', () => {
  const url = whatsAppUrl('0550/12*34#56')!;
  assert.equal(url, 'https://wa.me/213550123456');
  assert.match(url, /^https:\/\/wa\.me\/\d+$/);
});

test('a placeholder or a line too short to dial addresses nobody', () => {
  for (const value of ['', '   ', '00000000', '11111111', '00000001', '123', '1234567', null, undefined, {}, NaN, Infinity]) {
    assert.equal(whatsAppUrl(value), null, `${String(value)} must not address a chat`);
  }
});

test('a malformed local number is refused rather than guessed at', () => {
  // Too long to be an Algerian line and still wearing its trunk zero: no country
  // can be inferred, and a wrong guess opens a stranger's chat.
  assert.equal(whatsAppUrl('0550123456789'), null);
  assert.equal(whatsAppUrl('00033612345678'), null);
});