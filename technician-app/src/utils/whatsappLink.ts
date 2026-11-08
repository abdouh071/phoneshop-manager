/**
 * A WhatsApp chat link the phone can actually open.
 * ===============================================
 * `wa.me` accepts a full international number and nothing else. Every Algerian
 * client is stored in the local form — `0770123456` — so the share buttons used to
 * hand WhatsApp a number it rejects, and the button opened an error page for the
 * whole customer list. This is the counter's rule (`phoneUtils.formatWhatsAppUrl`):
 * reduce the line to the key both apps already compare on, then put the country
 * code back.
 *
 * Arabic-Indic digits are folded first, as everywhere else on the phone: a number
 * typed on an Arabic keyboard is the same number, and stripping `\D` before
 * folding reads it as having no digits at all.
 *
 * `null` means no chat can be addressed from this value; the caller decides what
 * that means for its screen. Nothing here opens a URL, and nothing here matches or
 * links a customer — identity stays with `isSamePhone`.
 */
import { foldDigitsToAscii, isRealPhone, phoneKey } from './phone.ts';

export const whatsAppUrl = (value: unknown, message?: string): string | null => {
  const text = foldDigitsToAscii(value).trim();
  if (!text || !isRealPhone(text)) return null;

  const digits = phoneKey(text);
  // The counter's floor: below this the line is not dialable, dummy or not.
  if (digits.length < 8) return null;

  let intl = digits;
  if (digits.startsWith('00')) {
    // The international access code typed in place of `+` (0033…, 0086…). `00213`
    // never reaches here: phoneKey already reduced it to the local Algerian key.
    intl = digits.slice(2);
  } else if (/^0\d{8,9}$/.test(digits)) {
    // The Algerian local form: trunk `0`, then a nine-digit mobile or eight-digit
    // landline subscriber number.
    intl = `213${digits.slice(1)}`;
  }

  // Anything else is taken to carry its country code already, as the counter takes
  // it. A surviving leading zero means it does not: wa.me rejects those, and
  // guessing a country for a malformed line would address a stranger's chat.
  if (!intl || intl.startsWith('0')) return null;

  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${intl}${query}`;
};