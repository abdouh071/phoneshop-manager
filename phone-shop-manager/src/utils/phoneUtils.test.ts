/**
 * Unit tests for phoneUtils.ts
 *
 * Phone matching is the primary de-duplication key for customers.
 * A bug here silently creates duplicate customer profiles, splits spending
 * history, or wrongly merges two different customers.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePhoneDigits,
  formatStandardPhone,
  getPhoneSearchVariants,
  isDummyPhone,
  isPhoneMatch,
  isMoreDescriptiveName,
  isValidNameForDeduplication,
  isRegisteredAccount,
  walkInCustomerId,
  formatWhatsAppUrl,
} from './phoneUtils';

// ─── normalizePhoneDigits ─────────────────────────────────────────────────────

describe('normalizePhoneDigits', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(normalizePhoneDigits(null)).toBe('');
    expect(normalizePhoneDigits(undefined)).toBe('');
    expect(normalizePhoneDigits('')).toBe('');
  });

  it('strips spaces and dashes from a standard number', () => {
    expect(normalizePhoneDigits('0550 12 34 56')).toBe('0550123456');
    expect(normalizePhoneDigits('0550-12-34-56')).toBe('0550123456');
  });

  it('strips +213 international prefix, restoring leading 0', () => {
    expect(normalizePhoneDigits('+213550123456')).toBe('0550123456');
    expect(normalizePhoneDigits('+213 550 12 34 56')).toBe('0550123456');
  });

  it('strips 00213 international prefix', () => {
    expect(normalizePhoneDigits('00213550123456')).toBe('0550123456');
  });

  it('strips 2130 prefix (typo variant — 213 without + sign)', () => {
    // "2130" = country code 213 followed by local number without leading 0
    // e.g. someone types 2130550123456 (13 digits) instead of +213550123456
    expect(normalizePhoneDigits('2130550123456')).toBe('0550123456');
  });

  it('adds leading 0 to 9-digit Algerian mobile', () => {
    expect(normalizePhoneDigits('550123456')).toBe('0550123456');
    expect(normalizePhoneDigits('660999888')).toBe('0660999888');
  });

  it('adds leading 0 to 8-digit Algerian landline', () => {
    expect(normalizePhoneDigits('21123456')).toBe('021123456');
  });

  it('leaves an already-clean number untouched', () => {
    expect(normalizePhoneDigits('0550123456')).toBe('0550123456');
  });
});

// ─── formatStandardPhone ──────────────────────────────────────────────────────

describe('formatStandardPhone', () => {
  it('formats 10-digit Algerian mobile into 4-2-2-2 blocks', () => {
    expect(formatStandardPhone('0550123456')).toBe('0550 12 34 56');
  });

  it('formats an international number back to standard', () => {
    expect(formatStandardPhone('+213550123456')).toBe('0550 12 34 56');
  });

  it('formats 9-digit landline into 3-2-2-2 blocks', () => {
    expect(formatStandardPhone('021123456')).toBe('021 12 34 56');
  });

  it('returns empty string for null', () => {
    expect(formatStandardPhone(null)).toBe('');
  });
});

// ─── getPhoneSearchVariants ───────────────────────────────────────────────────

describe('getPhoneSearchVariants', () => {
  it('returns empty array for null/empty', () => {
    expect(getPhoneSearchVariants(null)).toEqual([]);
    expect(getPhoneSearchVariants('')).toEqual([]);
  });

  it('includes the normalized digits', () => {
    const variants = getPhoneSearchVariants('0550123456');
    expect(variants).toContain('0550123456');
  });

  it('includes international +213 variant', () => {
    const variants = getPhoneSearchVariants('0550123456');
    expect(variants).toContain('+213550123456');
  });

  it('includes 00213 variant', () => {
    const variants = getPhoneSearchVariants('0550123456');
    expect(variants).toContain('00213550123456');
  });

  it('includes spaced 4-block format', () => {
    const variants = getPhoneSearchVariants('0550123456');
    expect(variants).toContain('0550 12 34 56');
  });

  it('returns unique values (no duplicates)', () => {
    const variants = getPhoneSearchVariants('0550 12 34 56');
    const unique = new Set(variants);
    expect(unique.size).toBe(variants.length);
  });
});

// ─── isDummyPhone ─────────────────────────────────────────────────────────────

describe('isDummyPhone', () => {
  it('returns true for null/undefined/empty', () => {
    expect(isDummyPhone(null)).toBe(true);
    expect(isDummyPhone(undefined)).toBe(true);
    expect(isDummyPhone('')).toBe(true);
  });

  it('returns true for all-same-digit numbers', () => {
    expect(isDummyPhone('0000000000')).toBe(true);
    expect(isDummyPhone('1111111111')).toBe(true);
    expect(isDummyPhone('9999999999')).toBe(true);
  });

  it('returns true for near-zero numbers', () => {
    expect(isDummyPhone('00000001')).toBe(true); // only 1 non-zero digit
  });

  it('returns true for numbers shorter than 7 digits', () => {
    expect(isDummyPhone('0550')).toBe(true);
  });

  it('returns false for valid Algerian mobile', () => {
    expect(isDummyPhone('0550123456')).toBe(false);
    expect(isDummyPhone('0660987654')).toBe(false);
  });
});

// ─── isPhoneMatch ─────────────────────────────────────────────────────────────

describe('isPhoneMatch', () => {
  it('matches identical numbers', () => {
    expect(isPhoneMatch('0550123456', '0550123456')).toBe(true);
  });

  it('matches number with and without leading 0', () => {
    expect(isPhoneMatch('0550123456', '550123456')).toBe(true);
  });

  it('matches +213 and 0xxx formats', () => {
    expect(isPhoneMatch('+213550123456', '0550123456')).toBe(true);
  });

  it('matches 00213 and 0xxx formats', () => {
    expect(isPhoneMatch('00213550123456', '0550123456')).toBe(true);
  });

  it('matches with spaces in one of the numbers', () => {
    expect(isPhoneMatch('0550 12 34 56', '0550123456')).toBe(true);
  });

  it('does NOT match two different numbers', () => {
    expect(isPhoneMatch('0550123456', '0660999888')).toBe(false);
  });

  it('returns false when either number is a dummy placeholder', () => {
    expect(isPhoneMatch('0000000000', '0550123456')).toBe(false);
    expect(isPhoneMatch('0550123456', '0000000000')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPhoneMatch(null, '0550123456')).toBe(false);
    expect(isPhoneMatch('0550123456', undefined)).toBe(false);
    expect(isPhoneMatch(null, null)).toBe(false);
  });

  it('does not match numbers shorter than 7 digits', () => {
    expect(isPhoneMatch('12345', '12345')).toBe(false);
  });
});

// ─── isValidNameForDeduplication ─────────────────────────────────────────────

describe('isValidNameForDeduplication', () => {
  it('returns false for null/empty/whitespace', () => {
    expect(isValidNameForDeduplication(null)).toBe(false);
    expect(isValidNameForDeduplication('')).toBe(false);
    expect(isValidNameForDeduplication('  ')).toBe(false);
  });

  it('returns false for generic placeholder names', () => {
    expect(isValidNameForDeduplication('client')).toBe(false);
    expect(isValidNameForDeduplication('unknown')).toBe(false);
    expect(isValidNameForDeduplication('pos')).toBe(false);
  });

  it('returns false for names shorter than 3 alphanumeric chars', () => {
    expect(isValidNameForDeduplication('Al')).toBe(false);
    expect(isValidNameForDeduplication('...')).toBe(false);
  });

  it('returns true for real customer names', () => {
    expect(isValidNameForDeduplication('Amine Benali')).toBe(true);
    expect(isValidNameForDeduplication('Samir')).toBe(true);
  });

  it('returns true for names written in Arabic', () => {
    expect(isValidNameForDeduplication('أحمد')).toBe(true);
    expect(isValidNameForDeduplication('محمود بن علي')).toBe(true);
  });
});

// ─── isRegisteredAccount ──────────────────────────────────────────────────────

describe('isRegisteredAccount', () => {
  it('accepts a real name on a real phone line', () => {
    expect(isRegisteredAccount({ name: 'Karim Benali', phone: '0550 12 34 56' })).toBe(true);
    expect(isRegisteredAccount({ name: 'أحمد', phone: '0770123456' })).toBe(true);
  });

  it('rejects a dummy or missing phone, whatever the name', () => {
    expect(isRegisteredAccount({ name: 'Karim Benali', phone: '00000000' })).toBe(false);
    expect(isRegisteredAccount({ name: 'Karim Benali', phone: '' })).toBe(false);
    expect(isRegisteredAccount({ name: 'Karim Benali' })).toBe(false);
  });

  it('rejects a generic or missing name, whatever the phone', () => {
    expect(isRegisteredAccount({ name: 'Client', phone: '0550 12 34 56' })).toBe(false);
    expect(isRegisteredAccount({ name: 'passager', phone: '0550 12 34 56' })).toBe(false);
    expect(isRegisteredAccount({ phone: '0550 12 34 56' })).toBe(false);
  });
});

// ─── walkInCustomerId ─────────────────────────────────────────────────────────

describe('walkInCustomerId', () => {
  it('is unique per ticket even when two passengers share one phone line', () => {
    const first = walkInCustomerId('0550 12 34 56', 'tkt-a');
    const second = walkInCustomerId('0550 12 34 56', 'tkt-b');

    expect(first).not.toBe(second);
    expect(first).toContain('0550123456');
    expect(second).toContain('tkt-b');
  });

  it('is stable for the same ticket, so the audit and the profile view agree', () => {
    expect(walkInCustomerId('+213 550 12 34 56', 'tkt-a')).toBe(walkInCustomerId('0550123456', 'tkt-a'));
  });
});

// ─── isMoreDescriptiveName ────────────────────────────────────────────────────

describe('isMoreDescriptiveName', () => {
  it('returns false when new name is empty', () => {
    expect(isMoreDescriptiveName('', 'Amine')).toBe(false);
    expect(isMoreDescriptiveName(null, 'Amine')).toBe(false);
  });

  it('returns true when existing is empty', () => {
    expect(isMoreDescriptiveName('Amine', '')).toBe(true);
    expect(isMoreDescriptiveName('Amine', null)).toBe(true);
  });

  it('returns false when names are identical (case-insensitive)', () => {
    expect(isMoreDescriptiveName('Amine', 'amine')).toBe(false);
    expect(isMoreDescriptiveName('Amine Benali', 'Amine Benali')).toBe(false);
  });

  it('returns true when existing name is a generic placeholder', () => {
    expect(isMoreDescriptiveName('Amine', 'Client')).toBe(true);
    expect(isMoreDescriptiveName('Samir Khelil', 'Unknown')).toBe(true);
  });

  it('returns true when new name extends existing name (first+last vs first)', () => {
    expect(isMoreDescriptiveName('Amine Benali', 'Amine')).toBe(true);
  });

  it('returns false when new name is a shorter version', () => {
    expect(isMoreDescriptiveName('Amine', 'Amine Benali')).toBe(false);
  });

  it('returns true for a multi-word name vs single-word existing', () => {
    expect(isMoreDescriptiveName('Samir Khelil', 'Samir')).toBe(true);
  });
});

// ─── formatWhatsAppUrl ────────────────────────────────────────────────────────

describe('formatWhatsAppUrl', () => {
  it('formats standard 10-digit Algerian mobile (05xx, 06xx, 07xx) with 213 country code', () => {
    expect(formatWhatsAppUrl('0550 12 34 56')).toBe('https://wa.me/213550123456');
    expect(formatWhatsAppUrl('0661123456')).toBe('https://wa.me/213661123456');
    expect(formatWhatsAppUrl('0770-12-34-56')).toBe('https://wa.me/213770123456');
  });

  it('formats already prefixed Algerian numbers (+213, 00213)', () => {
    expect(formatWhatsAppUrl('+213 550 12 34 56')).toBe('https://wa.me/213550123456');
    expect(formatWhatsAppUrl('00213550123456')).toBe('https://wa.me/213550123456');
    expect(formatWhatsAppUrl('213550123456')).toBe('https://wa.me/213550123456');
  });

  it('formats 9-digit Algerian mobile missing leading 0', () => {
    expect(formatWhatsAppUrl('550123456')).toBe('https://wa.me/213550123456');
  });

  it('appends url-encoded message query parameter when provided', () => {
    const url = formatWhatsAppUrl('0550 12 34 56', 'Salam Amine! Your phone is ready.');
    expect(url).toBe('https://wa.me/213550123456?text=Salam%20Amine!%20Your%20phone%20is%20ready.');
  });

  it('returns null for missing, empty, or dummy numbers', () => {
    expect(formatWhatsAppUrl(null)).toBeNull();
    expect(formatWhatsAppUrl('')).toBeNull();
    expect(formatWhatsAppUrl('   ')).toBeNull();
    expect(formatWhatsAppUrl('00000000')).toBeNull();
    expect(formatWhatsAppUrl('123')).toBeNull();
  });
});

