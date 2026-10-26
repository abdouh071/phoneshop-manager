/**
 * Security utilities for Admin Approval PIN hashing and verification
 * Uses standard Web Crypto API (SHA-256) with a fixed salt.
 */

const PIN_SALT = 'phone-shop-admin-approval-v1-salt';

export async function hashApprovalPin(pin: string): Promise<string> {
  const normalized = (pin || '').trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized + PIN_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyApprovalPin(pin: string, hashedPin: string): Promise<boolean> {
  if (!pin || !hashedPin) return false;
  const hash = await hashApprovalPin(pin);
  return hash === hashedPin;
}
