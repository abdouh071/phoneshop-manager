import { app } from '../lib/firebase';
import { errorCode, errorMessage } from '../utils/errorUtils';
import type { Functions } from 'firebase/functions';
import type { EndOfDayRecord } from './endOfDayService';

/**
 * The till's way of asking the server to decide a money-path question.
 *
 * Everything here is optional by design: an undeployed project, a network failure or a
 * disabled function must leave the shop running exactly as it did before. So each call
 * answers one of three things and the caller decides what to do:
 *
 *   'ok'          - the server ran the rule and agreed
 *   'rejected'    - the server ran the rule and said no (wrong PIN, day already closed)
 *   'unavailable' - there is no answer, so the caller falls back to the local path
 *
 * A refusal is never turned into a silent local success: that would make the enforcement
 * decorative. Only the absence of a server degrades.
 */

export interface ApprovalPinAnswer {
  verified: boolean;
  adminId: string;
  adminName: string;
  legacyVerifierUpgraded: boolean;
}

export interface SealAnswer {
  status: 'sealed' | 'already_sealed';
  sealId: string;
  date: string;
}

export type ServerCall<T> =
  | { status: 'ok'; data: T }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'unavailable'; message: string };

let functionsInstance: Functions | null = null;

/** Set once the deploy is known to be missing, so later approvals do not pay for a dead call. */
let callablesMissing = false;

async function loadFunctions(): Promise<Functions | null> {
  if (callablesMissing) return null;
  if (functionsInstance) return functionsInstance;
  try {
    const { getFunctions } = await import('firebase/functions');
    functionsInstance = getFunctions(app);
    return functionsInstance;
  } catch {
    return null;
  }
}

async function call<T>(name: string, data: unknown): Promise<ServerCall<T>> {
  const functions = await loadFunctions();
  if (!functions) return { status: 'unavailable', message: 'functions SDK unavailable' };

  try {
    const { httpsCallable } = await import('firebase/functions');
    const result = await httpsCallable<unknown, T>(functions, name)(data);
    return { status: 'ok', data: result.data };
  } catch (err) {
    const code = errorCode(err) || '';
    const message = errorMessage(err) || 'call failed';
    // `functions/not-found` means the callables are not deployed: stop asking this session.
    if (code.includes('not-found')) {
      callablesMissing = true;
      return { status: 'unavailable', message };
    }
    // A rule the server refused is an answer, not a missing server.
    if (
      code === 'permission-denied' ||
      code === 'failed-precondition' ||
      code === 'invalid-argument' ||
      code === 'resource-exhausted'
    ) {
      return { status: 'rejected', code, message };
    }
    return { status: 'unavailable', message };
  }
}

export const serverEnforcement = {
  verifyApprovalPin: (pin: string, adminId?: string): Promise<ServerCall<ApprovalPinAnswer>> =>
    call<ApprovalPinAnswer>('verifyApprovalPin', adminId ? { pin, adminId } : { pin }),

  sealEndOfDay: (record: Omit<EndOfDayRecord, 'id'>): Promise<ServerCall<SealAnswer>> =>
    call<SealAnswer>('sealEndOfDay', { record }),
};
