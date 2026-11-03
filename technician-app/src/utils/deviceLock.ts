/**
 * When a phone has to prove who is holding it.
 *
 * The signed-in session now survives a closed app, which is what the technicians
 * asked for — and what turns a handed-over phone into a till. So the lock opens
 * on a cold start and on any pause long enough that the phone may have changed
 * hands, while a screen of a notification or a two-second lookup keeps the work
 * open. Pure, so the window is a number under test rather than a guess.
 */

/** Five minutes away from the screen: long enough to be a different pair of hands. */
export const LOCK_IDLE_MS = 5 * 60 * 1000;

/**
 * True when the app is coming back from a pause that should have locked it.
 *
 * A clock that moved backwards (a technician changing the phone's date, a
 * timezone jump at midnight) is treated as a pause rather than a mistake, because
 * the safe answer to an unreadable timestamp is to ask.
 */
export const lockDueAfterPause = (
  lastLeftAt: number | null | undefined,
  now: number,
  idleMs: number = LOCK_IDLE_MS
): boolean => {
  if (typeof lastLeftAt !== 'number' || !Number.isFinite(lastLeftAt)) return false;
  if (now < lastLeftAt) return true;
  return now - lastLeftAt >= idleMs;
};

/**
 * The opt-in is only worth offering where it can actually be honoured: a sensor
 * present and a fingerprint or face enrolled. A phone that loses its enrolled
 * biometrics stops locking instead of locking everyone out. Whether there is a
 * session to protect is the caller's question, not this one.
 */
export const biometricLockAvailable = (hasSensor: boolean, hasEnrolled: boolean): boolean =>
  hasSensor && hasEnrolled;
