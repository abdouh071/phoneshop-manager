import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCK_IDLE_MS, biometricLockAvailable, lockDueAfterPause } from './deviceLock.ts';

const START = 1_700_000_000_000;

test('a pause under five minutes keeps the work open', () => {
  assert.equal(lockDueAfterPause(START, START + 4 * 60 * 1000), false);
  assert.equal(lockDueAfterPause(START, START + 4 * 60 * 1000 + 59_000), false);
});

test('a pause of five minutes or more asks who is holding the phone', () => {
  assert.equal(lockDueAfterPause(START, START + LOCK_IDLE_MS), true);
  assert.equal(lockDueAfterPause(START, START + LOCK_IDLE_MS + 1), true);
});

test('a first launch and a missing timestamp do not lock', () => {
  assert.equal(lockDueAfterPause(null, START), false);
  assert.equal(lockDueAfterPause(undefined, START), false);
  assert.equal(lockDueAfterPause(Number.NaN, START), false);
});

test('a clock that moved backwards is treated as a pause, not as a pass', () => {
  assert.equal(lockDueAfterPause(START + 10_000, START), true);
});

test('the opt-in is only offered where the phone can honour it', () => {
  assert.equal(biometricLockAvailable(true, true), true);
  assert.equal(biometricLockAvailable(false, true), false);
  assert.equal(biometricLockAvailable(true, false), false);
  assert.equal(biometricLockAvailable(false, false), false);
});
