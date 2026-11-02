/**
 * Approval PIN verifiers.
 *
 * The two properties that matter here are that a stored verifier is expensive to attack
 * (random per-PIN salt, 210k PBKDF2 rounds) and that the v1 hashes already in Firestore
 * keep working — every admin would otherwise be locked out of the approval prompt on the
 * first PIN attempt after this change.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  APPROVAL_PIN_ITERATIONS,
  hashApprovalPin,
  verifyApprovalPin,
  isLegacyApprovalPinVerifier,
} from './security';

const LEGACY_SALT = 'phone-shop-admin-approval-v1-salt';

/** Exactly what the pre-hardening `hashApprovalPin` wrote to `users/{uid}.approvalPin`. */
const legacyHash = async (pin: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + LEGACY_SALT));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
};

const hex = (n: number) => 'a'.repeat(n);

/** The CommonJS library `functions/index.js` decides with; loaded so both sides are in one test. */
const loadServerInvariants = () => {
  const require = createRequire(import.meta.url);
  return require('../../functions/lib/invariants.js') as {
    verifyPinVerifier: (pin: string, verifier: string | null) => Promise<{ ok: boolean; isLegacy: boolean }>;
    buildPinVerifier: (pin: string) => Promise<string>;
  };
};

describe('hashApprovalPin', () => {
  it('writes the versioned strong form with a salt and a derived key', async () => {
    const verifier = await hashApprovalPin('2468');
    expect(verifier).toMatch(new RegExp(`^v2:${APPROVAL_PIN_ITERATIONS}:[0-9a-f]{32}:[0-9a-f]{64}$`));
  });

  it('draws a new salt per call so two admins sharing a PIN do not share a hash', async () => {
    const [a, b] = await Promise.all([hashApprovalPin('2468'), hashApprovalPin('2468')]);
    expect(a).not.toBe(b);
    expect(await verifyApprovalPin('2468', a)).toBe(true);
    expect(await verifyApprovalPin('2468', b)).toBe(true);
  });

  it('trims the PIN, matching how the set-PIN form validates it', async () => {
    const verifier = await hashApprovalPin('  13579  ');
    expect(await verifyApprovalPin('13579', verifier)).toBe(true);
  });

  it('does not store the PIN in any recoverable form', async () => {
    const verifier = await hashApprovalPin('98765432');
    expect(verifier).not.toContain('98765432');
  });
});

describe('verifyApprovalPin against a v2 verifier', () => {
  it('accepts the right PIN and rejects neighbours in the search space', async () => {
    const verifier = await hashApprovalPin('2468');
    expect(await verifyApprovalPin('2468', verifier)).toBe(true);
    expect(await verifyApprovalPin('2469', verifier)).toBe(false);
    expect(await verifyApprovalPin('24680', verifier)).toBe(false);
    expect(await verifyApprovalPin('4286', verifier)).toBe(false);
  });

  it('honours the iteration count carried by the verifier', async () => {
    const low = 'v2:1:' + hex(32) + ':' + hex(64);
    // Derivation still runs (so a raised cost later is not silently ignored), it simply
    // cannot match this made-up key.
    expect(await verifyApprovalPin('1234', low)).toBe(false);
  });
});

describe('verifyApprovalPin against a stored v1 verifier', () => {
  it('still accepts the legacy hash so nobody is locked out', async () => {
    const legacy = await legacyHash('2468');
    expect(isLegacyApprovalPinVerifier(legacy)).toBe(true);
    expect(await verifyApprovalPin('2468', legacy)).toBe(true);
    expect(await verifyApprovalPin('1111', legacy)).toBe(false);
  });

  it('accepts the uppercase form an older client may have written', async () => {
    const legacy = (await legacyHash('1357')).toUpperCase();
    expect(await verifyApprovalPin('1357', legacy)).toBe(true);
  });

  it('accepts both forms for the same PIN while the verifier is being migrated', async () => {
    const strong = await hashApprovalPin('24680');
    const legacy = await legacyHash('24680');
    expect(await verifyApprovalPin('24680', strong)).toBe(true);
    expect(await verifyApprovalPin('24680', legacy)).toBe(true);
  });
});

describe('verifyApprovalPin rejects unusable stored values instead of throwing', () => {
  it.each([
    ['empty verifier', ''],
    ['whitespace only', '   '],
    ['plaintext PIN', '2468'],
    ['truncated legacy hash', 'abcdef'],
    ['non-hex 64 chars', 'z'.repeat(64)],
    ['unknown version', 'v3:210000:' + hex(32) + ':' + hex(64)],
    ['missing fields', 'v2:210000:' + hex(32)],
    ['non-numeric iterations', 'v2:many:' + hex(32) + ':' + hex(64)],
    ['zero iterations', 'v2:0:' + hex(32) + ':' + hex(64)],
    ['absurd iterations (cost cap)', 'v2:50000000:' + hex(32) + ':' + hex(64)],
    ['short salt', 'v2:210000:' + hex(8) + ':' + hex(64)],
    ['non-hex salt', 'v2:210000:' + 'g'.repeat(32) + ':' + hex(64)],
    ['short derived key', 'v2:210000:' + hex(32) + ':' + hex(40)],
    ['undefined verifier', undefined],
    ['null verifier', null],
  ])('%s', async (_label, stored) => {
    await expect(verifyApprovalPin('2468', stored as string | null | undefined)).resolves.toBe(false);
  });

  it('never matches an empty candidate PIN', async () => {
    const verifier = await hashApprovalPin('');
    expect(await verifyApprovalPin('', verifier)).toBe(false);
    expect(await verifyApprovalPin('   ', verifier)).toBe(false);
  });
});

describe('isLegacyApprovalPinVerifier', () => {
  it('flags only the 64-hex v1 shape', () => {
    expect(isLegacyApprovalPinVerifier('a'.repeat(64))).toBe(true);
    expect(isLegacyApprovalPinVerifier('  ' + 'A'.repeat(64) + ' ')).toBe(true);
    expect(isLegacyApprovalPinVerifier('a'.repeat(63))).toBe(false);
    expect(isLegacyApprovalPinVerifier('v2:210000:' + hex(32) + ':' + hex(64))).toBe(false);
    expect(isLegacyApprovalPinVerifier('')).toBe(false);
    expect(isLegacyApprovalPinVerifier(undefined)).toBe(false);
  });
});

/**
 * The same verifier string has to answer two different runtimes: the till derives it with
 * WebCrypto, `functions/lib/invariants.js` derives it with node's crypto. If the format ever
 * stops agreeing, approvals break the moment the callables are deployed, so the contract is
 * tested in both directions rather than assumed.
 */
describe('PIN verifier interoperability with the Cloud Function', () => {
  const serverLib = loadServerInvariants();

  it('accepts a verifier the till wrote', async () => {
    const verifier = await hashApprovalPin('2468');
    const match = await serverLib.verifyPinVerifier('2468', verifier);
    expect(match).toMatchObject({ ok: true, isLegacy: false });
    expect((await serverLib.verifyPinVerifier('2469', verifier)).ok).toBe(false);
  });

  it('verifies a legacy v1 hash the same way the till does', async () => {
    const legacy = await legacyHash('1357');
    const match = await serverLib.verifyPinVerifier('1357', legacy);
    expect(match).toMatchObject({ ok: true, isLegacy: true });
    expect(await verifyApprovalPin('1357', legacy)).toBe(true);
  });

  it('accepts the stronger verifier the function writes on an upgrade', async () => {
    // The callable rewrites a v1 verifier; the till has to keep authorizing the same PIN.
    const verifier = await serverLib.buildPinVerifier('24680');
    expect(await verifyApprovalPin('24680', verifier)).toBe(true);
    expect(await verifyApprovalPin('24681', verifier)).toBe(false);
  });
});
