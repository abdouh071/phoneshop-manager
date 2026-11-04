import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  MAX_DEFERRALS,
  backoffDelayMs,
  isDue,
  recordDeferral,
  recordFailure,
  shouldDeadLetter,
  toDeadLetter,
  dedupeById,
  resolveRef,
  rebaseActions,
  replayKeyOf,
  newIdempotencyKey,
  appendHistory,
  buildStatusPatch,
  nextTicketNumber,
  counterValueAfter,
  needsTicketNumber,
  queueKey,
  unownedKey,
  isOwnerKey,
  clampStock,
  deriveStockStatus,
  type QueueAction,
} from './offlineQueuePolicy.ts';

const NOW = 1_700_000_000_000;
const iso = new Date(NOW).toISOString();

const action = (over: Partial<QueueAction> = {}): QueueAction => ({
  id: 'act_1',
  kind: 'sale',
  payload: {},
  createdAt: iso,
  attempts: 0,
  nextAttemptAt: 0,
  ...over,
});

test('backoff grows exponentially and is capped', () => {
  assert.equal(backoffDelayMs(1), 15_000);
  assert.equal(backoffDelayMs(2), 30_000);
  assert.equal(backoffDelayMs(3), 60_000);
  assert.equal(backoffDelayMs(MAX_ATTEMPTS), 480_000);
  assert.ok(backoffDelayMs(200) <= MAX_BACKOFF_MS, 'never exceeds the cap');
  assert.ok(Number.isFinite(backoffDelayMs(10_000)), 'absurd attempt counts do not overflow');
});

test('an action is due until its backoff elapses', () => {
  assert.equal(isDue(action(), NOW), true, 'never tried = due');
  assert.equal(isDue(action({ attempts: 1, nextAttemptAt: NOW + 15_000 }), NOW), false);
  assert.equal(isDue(action({ attempts: 1, nextAttemptAt: NOW }), NOW), true, 'exactly at the deadline');
});

test('a failure schedules a retry, then parks the action', () => {
  let a = action();
  for (let i = 0; i < MAX_ATTEMPTS; i++) a = recordFailure(a, NOW, 'unavailable');
  assert.equal(a.attempts, MAX_ATTEMPTS);
  assert.equal(shouldDeadLetter(a), true);
  assert.equal(a.nextAttemptAt, 0, 'parked, not scheduled forever');
  assert.equal(a.lastError, 'unavailable');
});

test('a long error message is trimmed rather than bloating storage', () => {
  const failed = recordFailure(action({ kind: 'ticket' }), NOW, 'x'.repeat(5000));
  assert.ok((failed.lastError || '').length <= 400);
});

test('the dead-letter entry keeps everything an admin needs to redo the write', () => {
  const parked = toDeadLetter(
    recordFailure(action({ ticketRef: 'offline_tkt_9', deferrals: 12 }), NOW, 'boom'),
    iso
  );
  assert.equal(parked.kind, 'sale');
  assert.equal(parked.attempts, 1);
  assert.equal(parked.deferrals, 12, 'an admin must be able to tell a wait from a failure');
  assert.equal(parked.lastError, 'boom');
  assert.equal(parked.ticketRef, 'offline_tkt_9');
});

test('waiting for a ticket is rearmed, not failed', () => {
  const { action: waited, exhausted } = recordDeferral(
    action({ kind: 'status', ticketRef: 'offline_tkt_9', attempts: 2, lastError: 'an old failure' }),
    NOW,
    20_000,
    'Waiting for the ticket to upload'
  );
  assert.equal(exhausted, false);
  assert.equal(waited.deferrals, 1);
  assert.equal(waited.attempts, 2, 'a pass that only waited is not a failed write');
  assert.equal(waited.nextAttemptAt, NOW + 20_000);
  assert.equal(waited.lastError, 'Waiting for the ticket to upload');
});

test('an action queued before waits were counted starts at zero', () => {
  const { action: waited, exhausted } = recordDeferral(action({ kind: 'status' }), NOW, 20_000, 'Waiting');
  assert.equal(waited.deferrals, 1, 'absent is 0, not NaN');
  assert.equal(exhausted, false);
});

test('a wait that never ends is parked instead of re-armed forever', () => {
  let a = action({ kind: 'status', ticketRef: 'offline_tkt_9' });
  for (let pass = 1; pass <= MAX_DEFERRALS; pass++) {
    const { action: next, exhausted } = recordDeferral(a, NOW, 20_000, 'Waiting for the ticket to upload');
    a = next;
    assert.equal(exhausted, pass === MAX_DEFERRALS, `pass ${pass} of ${MAX_DEFERRALS}`);
  }
  assert.equal(a.deferrals, MAX_DEFERRALS);
  // The reason a park happened is the reason of the wait, not a generic failure.
  assert.equal(toDeadLetter(a, iso).lastError, 'Waiting for the ticket to upload');
});

test('a wait reason is trimmed like any other error', () => {
  const { action: waited } = recordDeferral(action(), NOW, 20_000, 'y'.repeat(5000));
  assert.ok((waited.lastError || '').length <= 400);
});

test('duplicate queue entries collapse to one replay', () => {
  const dupes = [action({ id: 'a' }), action({ id: 'b' }), action({ id: 'a' })];
  assert.deepEqual(dedupeById(dupes).map((d) => d.id), ['a', 'b']);
});

test('a temp ticket id resolves through the whole remap chain', () => {
  const map = { 'offline_tkt_1': 'srv_aaa', 'srv_aaa': 'srv_bbb' };
  assert.equal(resolveRef(map, 'offline_tkt_1'), 'srv_bbb');
  assert.equal(resolveRef(map, 'unknown'), 'unknown', 'unknown ids pass through');
  assert.equal(resolveRef(map, undefined), undefined);
  assert.equal(resolveRef({ a: 'a' }, 'a'), 'a', 'a self-referencing map must not spin');
  // A cycle would spin forever without the hop cap.
  assert.equal(resolveRef({ a: 'b', b: 'a' }, 'a'), 'a');
});

test('rebasing a queue after upload re-points the ref and the payload ids', () => {
  const acts = [
    action({ id: '1', kind: 'status', ticketRef: 'offline_tkt_1', payload: { ticketId: 'offline_tkt_1', status: 'ready' }, attempts: 4, nextAttemptAt: NOW + 999_999 }),
    action({ id: '2', kind: 'sale', payload: { ticketId: 'srv_other' } }),
  ];
  const out = rebaseActions(acts, 'offline_tkt_1', 'srv_abc');
  assert.equal(out[0].ticketRef, 'srv_abc');
  assert.deepEqual((out[0].payload as any).ticketId, 'srv_abc');
  assert.equal(out[0].nextAttemptAt, 0, 'a re-based action is immediately retryable');
  assert.equal(out[1].ticketRef, undefined, 'unrelated actions are untouched');
  assert.deepEqual((out[1].payload as any).ticketId, 'srv_other');
});

test('status history appends idempotently', () => {
  const entry = { status: 'ready', at: iso };
  const once = appendHistory([entry], entry);
  assert.equal(once.length, 1, 'the same entry is never added twice');
  const twice = appendHistory(once, { status: 'ready', at: iso });
  assert.equal(twice.length, 1);
  const newer = appendHistory(twice, { status: 'completed', at: 'later' });
  assert.equal(newer.length, 2);
});

test('a replayed status update keeps audit data another device added', () => {
  const serverDoc = {
    status: 'in_progress',
    assignedTechnician: 'Karim',
    remark: 'Screen backlight dead',
    statusHistory: [{ status: 'in_progress', at: 'earlier' }],
  };
  const patch = buildStatusPatch(serverDoc, {
    status: 'ready',
    timestamp: iso,
    actorId: 'u1',
    actorName: 'Yacine',
    additionalUpdates: { actualCost: 4500 },
  });

  assert.equal(patch.status, 'ready');
  assert.equal((patch.actualCost as number), 4500);
  // The two destructive behaviours this replaces:
  assert.equal((patch.statusHistory as any[]).length, 2, 'history grows, never resets');
  assert.equal(patch.assignedTechnician, 'Karim', 'ownership is not cleared');
  assert.equal('remark' in patch, false, 'a patch that says nothing about the remark leaves it alone');
  assert.equal(patch.repairedAt, iso, 'ready stamps repairedAt');
});

test('an empty remark from a stale queue entry cannot erase the real one', () => {
  const patch = buildStatusPatch({ remark: 'Real finding' }, { status: 'ready', timestamp: iso, additionalUpdates: { remark: '  ' } });
  assert.equal('remark' in patch, false, 'the field is simply not written');
});

test('a ready transition with no owner on the doc claims it for the actor', () => {
  const patch = buildStatusPatch(null, { status: 'ready', timestamp: iso, actorName: 'Yacine' });
  assert.equal(patch.assignedTechnician, 'Yacine');
});

test('a completed transition stamps completedAt but not repairedAt', () => {
  const patch = buildStatusPatch({}, { status: 'completed', timestamp: iso, actorName: 'A' });
  assert.equal(patch.completedAt, iso);
  assert.equal('repairedAt' in patch, false);
});

test('ticket numbers continue the shared counter', () => {
  assert.equal(nextTicketNumber(41), 'TKT-0042');
  assert.equal(nextTicketNumber(0), 'TKT-0001');
  assert.equal(nextTicketNumber(undefined), 'TKT-0001');
  assert.equal(nextTicketNumber(null), 'TKT-0001');
  assert.equal(nextTicketNumber(-5), 'TKT-0001', 'a corrupt counter cannot go backwards');
  assert.equal(nextTicketNumber(12345), 'TKT-12346', 'wide numbers are not truncated');
  assert.equal(counterValueAfter(41), 42);
});

test('a provisional offline number is recognised, a real counter number is not', () => {
  assert.equal(needsTicketNumber({ ticketNumberProvisional: true, ticketNumber: 'TKT-0042' }), true, 'the flag wins');
  assert.equal(needsTicketNumber({ ticketNumberProvisional: true }), true);
  assert.equal(needsTicketNumber({ ticketNumber: 'TKT-0042' }), false);
  assert.equal(needsTicketNumber({ ticketNumber: 'TKT-12345' }), false, 'a shop past 9999 keeps its number');
  assert.equal(needsTicketNumber({}), true, 'a missing number needs one');
  assert.equal(needsTicketNumber({ ticketNumber: 'draft-7' }), true);
});

test('queues are owned per user and the legacy global key is distinguishable', () => {
  assert.equal(queueKey('@offline_sales', 'u123'), '@offline_sales::u123');
  assert.equal(unownedKey('@offline_sales'), '@offline_sales::__unowned__');
  assert.equal(isOwnerKey('@offline_sales::u123', '@offline_sales'), true);
  assert.equal(isOwnerKey('@offline_sales', '@offline_sales'), false, 'the legacy key is not an owner key');
  assert.equal(isOwnerKey('@offline_debts::u1', '@offline_sales'), false, 'a different base never matches');
});

test('stock is floored at zero and the status threshold is honoured', () => {
  assert.equal(clampStock(5), 5);
  assert.equal(clampStock(-3), 0);
  assert.equal(clampStock('7'), 7);
  assert.equal(clampStock('abc'), 0);
  assert.equal(clampStock(undefined), 0);
  assert.equal(clampStock(3.9), 3);
  assert.equal(deriveStockStatus(0, 2), 'out_of_stock');
  assert.equal(deriveStockStatus(2, 2), 'low_stock');
  assert.equal(deriveStockStatus(3, 2), 'in_stock');
  assert.equal(deriveStockStatus(1, undefined), 'low_stock', 'a missing threshold still flags the last unit');
});

test('a queued sale replays under the key it was written with', () => {
  // The whole point: the document the server committed while the phone saw a
  // timeout carries this key, so the replay finds it and adopts it instead of
  // posting the invoice — and the stock delta — a second time.
  assert.equal(replayKeyOf({ idempotencyKey: 'sale_abc_1' }, 'sale_xyz_9'), 'sale_abc_1');
});

test('a record parked before the stamp existed still replays, on the weaker rule', () => {
  assert.equal(replayKeyOf({}, 'sale_xyz_9'), 'sale_xyz_9');
  assert.equal(replayKeyOf({ idempotencyKey: '' }, 'sale_xyz_9'), 'sale_xyz_9', 'an empty stamp is no stamp');
  assert.equal(replayKeyOf({ idempotencyKey: 42 }, 'sale_xyz_9'), 'sale_xyz_9', 'a foreign shape cannot become a key');
});

test('two sales checked out in the same millisecond still get different keys', () => {
  const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey('sale')));
  assert.equal(keys.size, 50);
  for (const key of keys) assert.match(key, /^sale_[a-z0-9]+_[a-z0-9]+$/);
});
