/**
 * Approval PIN verifiers.
 *
 * An approval PIN is only 4-8 digits, so the search space is at most 10^8 and a plain
 * SHA-256 of it falls in seconds. A verifier is therefore PBKDF2-SHA256 over a random
 * per-PIN salt, and the iteration count travels inside the stored string so it can be
 * raised later without invalidating anything already stored.
 *
 * Legacy ("v1") verifiers are the bare 64-hex SHA-256 of `pin + fixed salt`. Because the
 * salt was global, two admins who reused a PIN had the same hash, and any reader of the
 * users collection could crack them in bulk. They are still accepted so no one is locked
 * out of an approval prompt, and they are upgraded on the next write the till is allowed
 * to make.
 */

const LEGACY_PIN_SALT = 'phone-shop-admin-approval-v1-salt';
const LEGACY_HEX_RE = /^[0-9a-f]{64}$/i;

export const APPROVAL_PIN_ITERATIONS = 210_000;
const VERIFIER_PREFIX = 'v2';
const SALT_BYTES = 16;
const KEY_BITS = 256;
/** Guards against a hand-edited verifier string asking for a million-round derivation. */
const MAX_ACCEPTED_ITERATIONS = 2_000_000;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Compares equal-length byte strings without leaking which byte differed through timing. */
const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

const derivePinKey = async (
  pin: string,
  saltHex: string,
  iterations: number,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
};

/** A v1 verifier is 64 hex chars; a v2 verifier is `v2:<iterations>:<salt>:<key>`. */
export const isLegacyApprovalPinVerifier = (verifier?: string | null): boolean => {
  const value = (verifier || '').trim();
  return LEGACY_HEX_RE.test(value);
};

/**
 * Produces the strong form of `pin`. Every call draws a new salt, so the same PIN chosen
 * by two admins yields two unrelated strings.
 */
export async function hashApprovalPin(pin: string): Promise<string> {
  const normalized = (pin || '').trim();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const saltHex = bytesToHex(salt);
  const derived = await derivePinKey(normalized, saltHex, APPROVAL_PIN_ITERATIONS);
  return `${VERIFIER_PREFIX}:${APPROVAL_PIN_ITERATIONS}:${saltHex}:${bytesToHex(derived)}`;
}

/**
 * `false` for anything unrecognised, so a corrupted or hand-edited verifier can never be
 * treated as "no PIN configured" nor crash the approval prompt.
 */
export async function verifyApprovalPin(
  pin: string,
  hashedPin?: string | null,
): Promise<boolean> {
  const candidate = (pin || '').trim();
  const verifier = (hashedPin || '').trim();
  if (!candidate || !verifier) return false;

  if (LEGACY_HEX_RE.test(verifier)) {
    return timingSafeEqual(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate + LEGACY_PIN_SALT))),
      hexToBytes(verifier),
    );
  }

  const parts = verifier.split(':');
  if (parts.length !== 4 || parts[0] !== VERIFIER_PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ACCEPTED_ITERATIONS) return false;
  if (!/^[0-9a-f]*$/i.test(parts[2]) || parts[2].length !== SALT_BYTES * 2) return false;
  if (!LEGACY_HEX_RE.test(parts[3])) return false;

  const derived = await derivePinKey(candidate, parts[2], iterations);
  return timingSafeEqual(derived, hexToBytes(parts[3]));
}
