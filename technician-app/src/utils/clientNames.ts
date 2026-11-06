/**
 * What counts as a real client name on the phone.
 *
 * The new-ticket screen used to offer every profile the phone lookup returned as a
 * "Known client" to link — including placeholder rows the shop created for
 * passengers. Only a client registered with a real name on a real phone line is
 * suggested; a generic or missing name is not, and the ticket never links to it.
 * Latin and Arabic letters both count, so a name typed in Arabic is a name.
 */
const GENERIC_CLIENT_NAMES = new Set([
  'client',
  'customer',
  'passager',
  'passenger',
  'inconnu',
  'unknown',
  'walk-in',
  'walk in',
  'pos',
  'comptoir',
  '...',
  ',,,',
  '---',
  '???',
  'none',
  'n/a',
  'no name',
]);

export const isValidClientName = (name: unknown): boolean => {
  if (typeof name !== 'string') return false;
  const clean = name.trim().toLowerCase();
  if (!clean || GENERIC_CLIENT_NAMES.has(clean)) return false;
  const lettersAndDigits = clean.replace(/[^a-z0-9\u0600-\u06FF]/gi, '');
  return lettersAndDigits.length >= 3;
};
