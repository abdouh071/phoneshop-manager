/**
 * Phone number normalization, formatting, and Firestore search variant utilities.
 * Handles Algerian mobile numbers (05xx, 06xx, 07xx), international prefixes (+213, 00213),
 * spacing, and formatting differences.
 */

/**
 * Extracts normalized digits from a phone string.
 * Automatically resolves Algerian international codes (00213, +213, 213)
 * and missing leading zeros (e.g. 550123456 -> 0550123456).
 */
export const normalizePhoneDigits = (phone?: string | null): string => {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');

  // Strip international prefixes (00213, +213, with or without extra 0)
  if (digits.startsWith('002130') && digits.length >= 13) {
    digits = digits.slice(5); // leaves leading 0, e.g. 0550123456
  } else if (digits.startsWith('00213') && digits.length >= 12) {
    digits = digits.slice(5);
  } else if (digits.startsWith('2130') && digits.length >= 12) {
    digits = digits.slice(3); // leaves leading 0, e.g. 0550123456
  } else if (digits.startsWith('213') && digits.length >= 11) {
    digits = digits.slice(3);
  }

  // If user entered 9 digits starting with 5, 6, 7 (Algerian mobile missing leading 0), add 0
  if (digits.length === 9 && (digits.startsWith('5') || digits.startsWith('6') || digits.startsWith('7'))) {
    digits = '0' + digits;
  }

  // If user entered 8 digits starting with 2, 3, 4 (Algerian landline missing leading 0), add 0
  if (digits.length === 8 && (digits.startsWith('2') || digits.startsWith('3') || digits.startsWith('4'))) {
    digits = '0' + digits;
  }

  return digits;
};

/**
 * Formats an Algerian phone number into a standard, clean display format.
 * - Mobile: 0550 12 34 56
 * - Landline: 021 12 34 56
 * - International / other: Trimmed clean spacing
 */
export const formatStandardPhone = (phone?: string | null): string => {
  if (!phone) return '';
  const clean = normalizePhoneDigits(phone);

  // Algerian 10-digit mobile number: 05xx, 06xx, 07xx
  if (clean.length === 10 && clean.startsWith('0')) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)}`;
  }

  // Algerian 9-digit landline: 02x, 03x, 04x
  if (clean.length === 9 && clean.startsWith('0')) {
    return `${clean.slice(0, 3)} ${clean.slice(3, 5)} ${clean.slice(5, 7)} ${clean.slice(7, 9)}`;
  }

  // Fallback: trim and collapse excess whitespace
  return phone.trim().replace(/\s+/g, ' ');
};

/**
 * Generates all search variations of a phone number to match against Firestore documents
 * where phone numbers might have been saved in different historical formats
 * (e.g., "0550 12 34 56", "0550123456", "+213550123456", "+213 550 12 34 56", "550123456").
 */
export const getPhoneSearchVariants = (phone?: string | null): string[] => {
  if (!phone || !phone.trim()) return [];
  const rawTrimmed = phone.trim();
  const digits = normalizePhoneDigits(phone);
  const rawDigits = phone.replace(/\D/g, '');
  const variants = new Set<string>();

  // 1. Raw trimmed input
  variants.add(rawTrimmed);

  if (digits) {
    // 2. Normalized digits
    variants.add(digits);

    if (digits.length === 10 && digits.startsWith('0')) {
      // 3. Standard 4-block formatted: "0550 12 34 56"
      variants.add(`${digits.slice(0, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`);
      // 4. 2-by-2 formatted: "05 50 12 34 56"
      variants.add(`${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`);
      // 5. Hyphenated: "0550-12-34-56"
      variants.add(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`);
      // 6. International variations
      const without0 = digits.slice(1);
      variants.add(`+213${without0}`);
      variants.add(`+213 ${digits.slice(1, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`);
      variants.add(`00213${without0}`);
      variants.add(without0);
    }
  }

  if (rawDigits && rawDigits !== digits) {
    variants.add(rawDigits);
  }

  return Array.from(variants).filter(v => v.length > 0);
};

/**
 * Checks whether two phone numbers represent the same phone line.
 * Handles formats like:
 * - "0550 12 34 56" vs "0550123456"
 * - "+213 550 12 34 56" vs "0550123456"
 * - "00213 550 123 456" vs "0550123456"
 * - "550123456" vs "0550123456"
 */
/**
 * Checks whether a phone string is a dummy/placeholder number (e.g. "00000000", "0000", "11111111")
 * which should NEVER be used for deduplication or matching.
 */
export const isDummyPhone = (phone?: string | null): boolean => {
  if (!phone) return true;
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return true;
  const unique = new Set(digits.split(''));
  if (unique.size === 1) return true; // e.g. 00000000, 11111111
  if (digits.replace(/0/g, '').length < 3) return true; // e.g. 00000001, 00000020
  return false;
};

/**
 * Checks whether two phone numbers represent the same phone line.
 * Handles formats like:
 * - "0550 12 34 56" vs "0550123456"
 * - "+213 550 12 34 56" vs "0550123456"
 * - "00213 550 123 456" vs "0550123456"
 * - "550123456" vs "0550123456"
 */
export const isPhoneMatch = (phoneA?: string | null, phoneB?: string | null): boolean => {
  if (isDummyPhone(phoneA) || isDummyPhone(phoneB)) return false;

  const digitsA = normalizePhoneDigits(phoneA);
  const digitsB = normalizePhoneDigits(phoneB);

  if (!digitsA || !digitsB) return false;

  // A phone number must have at least 7 digits for a reliable match
  if (digitsA.length < 7 || digitsB.length < 7) return false;

  // Exact digits match
  if (digitsA === digitsB) return true;

  // Suffix comparison (handles leading 0 vs country code 213 vs raw 9-digit numbers)
  if (digitsA.length >= 8 && digitsB.length >= 8) {
    const compareLen = Math.min(digitsA.length, digitsB.length, 9);
    return digitsA.slice(-compareLen) === digitsB.slice(-compareLen);
  }

  return false;
};

export const GENERIC_NAMES = new Set([
  'client',
  'client pos',
  'customer',
  'passager',
  'inconnu',
  'unknown',
  'walk-in',
  'pos',
  'comptoir',
  '...',
  ',,',
  '---',
  '???',
  'none',
  'n/a',
  'no name',
]);

export const isValidNameForDeduplication = (name?: string | null): boolean => {
  if (!name) return false;
  const clean = name.trim().toLowerCase();
  if (GENERIC_NAMES.has(clean)) return false;
  // Latin and Arabic letters both count — a name typed in Arabic is a name, and
  // stripping its letters used to make every Arabic-named client invisible to the
  // duplicate suggestions and the ticket form's customer list.
  const alphaNum = clean.replace(/[^a-z0-9\u0600-\u06FF]/gi, '');
  if (alphaNum.length < 3) return false;
  return true;
};

/**
 * A profile worth offering in the new-ticket form: a real name on a real phone
 * line. Walk-ins never live in the customer list, and placeholder rows (a generic
 * name or a dummy number) must not be suggested as accounts — only a client
 * registered with both belongs in the dropdown.
 */
export const isRegisteredAccount = (c: {
  name?: string | null;
  phone?: string | null;
}): boolean => isValidNameForDeduplication(c.name) && !isDummyPhone(c.phone);

/**
 * The id of a synthesized walk-in profile. A walk-in is never stored as a customer
 * document, but the profile view and the audit trail still need a key for it — and
 * that key must be unique per ticket, because two passengers sharing one phone line
 * are two clients. The old phone-only id made their histories share one key, and a
 * key derived from anything but the ticket could collide under normal shop life.
 */
export const walkInCustomerId = (phone?: string | null, ticketId?: string): string => {
  const digits = normalizePhoneDigits(phone);
  const unique = ticketId || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `walkin_${digits || 'nophone'}_${unique}`;
};

/**
 * Determines whether a newly provided name is more complete or descriptive
 * than the existing saved name (e.g. "Amine Benali" vs "Amine", or replacing "Client" with "Amine").
 */
export const isMoreDescriptiveName = (newName?: string | null, existingName?: string | null): boolean => {
  const cleanNew = (newName || '').trim();
  const cleanExisting = (existingName || '').trim();

  if (!cleanNew) return false;
  if (!cleanExisting) return true;

  const lowerExisting = cleanExisting.toLowerCase();
  const lowerNew = cleanNew.toLowerCase();

  // If existing is identical, no update needed
  if (lowerExisting === lowerNew) return false;

  // If existing is a generic placeholder, always replace
  if (GENERIC_NAMES.has(lowerExisting)) return true;

  // If new name is longer and includes existing name (e.g. "Amine Benali" vs "Amine")
  if (cleanNew.length > cleanExisting.length && lowerNew.includes(lowerExisting)) {
    return true;
  }

  // If new name has more words (e.g. contains space indicating first + last name) and existing does not
  const newWordCount = cleanNew.split(/\s+/).length;
  const existingWordCount = cleanExisting.split(/\s+/).length;
  if (newWordCount > existingWordCount && cleanNew.length > cleanExisting.length) {
    return true;
  }

  return false;
};

/**
 * Formats a phone number into an authoritative WhatsApp chat URL.
 * Handles Algerian numbers: strips leading 0 and adds country code 213
 * (e.g. 0550 12 34 56 -> https://wa.me/213550123456).
 * Handles numbers with existing international prefixes (+213, 00213).
 * Returns null if the phone is missing, dummy, or invalid (< 8 digits).
 */
export const formatWhatsAppUrl = (phone?: string | null, message?: string): string | null => {
  if (!phone || isDummyPhone(phone)) return null;

  const rawClean = phone.replace(/[^\d+]/g, '');
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 8) return null;

  let intlDigits = digits;

  // Algerian mobile (05, 06, 07) or landline (02, 03, 04) starting with 0
  if (digits.startsWith('0') && (digits.length === 10 || digits.length === 9)) {
    intlDigits = `213${digits.slice(1)}`;
  } else if (rawClean.startsWith('+') && !rawClean.startsWith('+213')) {
    // Non-Algerian foreign number with international plus prefix (e.g. +33...)
    intlDigits = rawClean.slice(1);
  } else if (!digits.startsWith('213')) {
    // 9-digit Algerian mobile missing leading zero
    if (digits.length === 9 && (digits.startsWith('5') || digits.startsWith('6') || digits.startsWith('7'))) {
      intlDigits = `213${digits}`;
    }
  }

  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${intlDigits}${query}`;
};
