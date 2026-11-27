/**
 * One phone line, written many ways.
 *
 * The counter stores `0550 12 34 56`, the technician types `+213550123456`, and an
 * Arabic keyboard produces `٠٥٥٠١٢٣٤٥٦`. Comparing those strings raw either finds
 * nothing or — worse — finds somebody else. These helpers reduce a number to the
 * same key the desktop app uses, and only ever answer "same line" on an exact key.
 *
 * A suffix match is deliberately not offered: two different people can share the
 * last eight digits of a number, and attaching a sale or a ticket to the wrong
 * account is the one mistake the shop cannot undo from the screen.
 */

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
};

/** Arabic-Indic and Eastern Arabic-Indic digits folded to ASCII. */
export const foldDigitsToAscii = (value: unknown): string =>
  asText(value).replace(ARABIC_DIGITS, (ch) =>
    String(ch.charCodeAt(0) - (ch.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660))
  );

/**
 * Every digit in the value, with Arabic-Indic digits folded first: `\D` is
 * ASCII-only, so stripping before folding read an Arabic-keyboard number as
 * having no digits at all.
 */
export const phoneDigits = (value: unknown): string => foldDigitsToAscii(value).replace(/\D/g, '');

/**
 * The canonical Algerian key: country code removed, leading zero restored on the
 * nine-digit mobile and eight-digit landline forms. Mirrors the desktop's
 * normalizePhoneDigits so both apps agree on what one line is.
 */
export const phoneKey = (value: unknown): string => {
  let digits = phoneDigits(value);

  if (digits.startsWith('002130') && digits.length >= 13) {
    digits = digits.slice(5);
  } else if (digits.startsWith('00213') && digits.length >= 12) {
    digits = digits.slice(5);
  } else if (digits.startsWith('2130') && digits.length >= 12) {
    digits = digits.slice(3);
  } else if (digits.startsWith('213') && digits.length >= 11) {
    digits = digits.slice(3);
  }

  if (digits.length === 9 && /^[567]/.test(digits)) digits = `0${digits}`;
  if (digits.length === 8 && /^[234]/.test(digits)) digits = `0${digits}`;

  return digits;
};

/** A placeholder (`00000000`, `11111111`, `00000001`) is not a phone line. */
export const isRealPhone = (value: unknown): boolean => {
  const digits = phoneKey(value);
  if (digits.length < 7) return false;
  if (new Set(digits.split('')).size === 1) return false;
  return digits.replace(/0/g, '').length >= 3;
};

/** True only when both are real lines and reduce to the same key. */
export const isSamePhone = (a: unknown, b: unknown): boolean => {
  if (!isRealPhone(a) || !isRealPhone(b)) return false;
  const keyA = phoneKey(a);
  const keyB = phoneKey(b);
  return keyA.length >= 8 && keyB.length >= 8 && keyA === keyB;
};