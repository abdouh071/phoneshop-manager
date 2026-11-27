/**
 * Cross-app parity for the public tracking mirror (A2).
 *
 * The id vectors and the expected payload are shared VERBATIM with the desktop's
 * trackingMirror.test.ts. The phone writes mirrors the desktop's /track page
 * reads (and vice versa), so a drift in either half makes tickets untrackable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKING_MIRROR_COLLECTION,
  buildTrackingMirror,
  effectiveTrackingPin,
  mirrorIdOf,
  trackingMirrorId,
  type TrackingMirrorSource,
} from './trackingMirror.ts';

const VECTOR_1 = 'TKT-0001_bd980ec3cd87d20e6da51bb1f2db8aa3f3a8425699959793587b45bd80d5dbc5';
const VECTOR_2 = 'TKT-0042_c8f809562a1d01c2bdf6c5c85d0f198566baca3441fdc2faf9ed3ef9f2e1906d';
const VECTOR_3 = 'TKT-123456_413d19ce1343731f67cf28010b84b1ba80c427080ead122c565ad46cd2602768';

test('the phone derives the identical mirror id (js-sha256 parity vectors)', async () => {
  assert.equal(await trackingMirrorId('TKT-0001', 'AB12'), VECTOR_1);
  assert.equal(await trackingMirrorId('TKT-0042', '0550'), VECTOR_2);
  assert.equal(await trackingMirrorId('TKT-123456', '9X7Q'), VECTOR_3);
});

test('case and whitespace normalize the same way on both apps', async () => {
  assert.equal(await trackingMirrorId(' tkt-0001 ', ' ab12 '), VECTOR_1);
  assert.equal(TRACKING_MIRROR_COLLECTION, 'repair_tracking');
});

test('the PIN rule matches the legacy reader: printed PIN, else phone last 4', () => {
  assert.equal(effectiveTrackingPin({ trackingPin: '9X7Q', customerPhone: '0550120550' }), '9X7Q');
  assert.equal(effectiveTrackingPin({ trackingPin: ' ab12 ' }), 'AB12');
  assert.equal(effectiveTrackingPin({ customerPhone: '0550120550' }), '0550');
  assert.equal(effectiveTrackingPin({ trackingPin: '   ', customerPhone: '0550120550' }), '0550');
  assert.equal(effectiveTrackingPin({}), '');
});

test('untrackable tickets mint no id', async () => {
  assert.equal(await mirrorIdOf({ trackingPin: 'AB12' }), null);
  assert.equal(await mirrorIdOf({ ticketNumber: 'TKT-PENDING', trackingPin: 'AB12' }), null);
  assert.equal(await mirrorIdOf({ ticketNumber: 'tkt-pending', trackingPin: 'AB12' }), null);
  assert.equal(await mirrorIdOf({ ticketNumber: 'TKT-0001', ticketNumberProvisional: true, trackingPin: 'AB12' }), null);
  assert.equal(await mirrorIdOf({ ticketNumber: 'TKT-0001' }), null);
  assert.equal(await mirrorIdOf({ ticketNumber: 'TKT-0042', customerPhone: '0550120550' }), VECTOR_2);
});

test('the payload is byte-identical to the desktop whitelist', async () => {
  const dirtySource = {
    ticketNumber: 'TKT-0042',
    trackingPin: '0550',
    customerName: 'Yacine Secret',
    customerPhone: '0550120550',
    lockValue: '1234',
    status: 'in_progress',
    statusHistory: [
      { status: 'pending', changedById: 'u1', changedByName: 'Rania Admin', at: '2026-11-01T09:00:00.000Z' },
      { status: 'in_progress', changedById: 'u2', changedByName: 'Samir Tech', at: '2026-11-02T10:00:00.000Z' },
    ],
    assignedTechnician: 'Samir Tech',
    partsUsed: [{ partId: 'p1', name: 'OLED panel', cost: 3000 }],
    deviceBrand: 'Samsung',
    deviceModel: 'A54',
    createdAt: '2026-11-01T09:00:00.000Z',
    issueDescription: 'Screen cracked',
    actualCost: 4500,
    estimatedCost: 5000,
    depositAmount: 1000,
    remark: 'Customer called',
    estimatedCompletionDate: '2026-11-05',
  } as unknown as TrackingMirrorSource;

  const mirror = await buildTrackingMirror(dirtySource);
  assert.ok(mirror);
  assert.equal(mirror.id, VECTOR_2);
  assert.deepEqual(mirror.payload, {
    ticketNumber: 'TKT-0042',
    status: 'in_progress',
    deviceBrand: 'Samsung',
    deviceModel: 'A54',
    createdAt: '2026-11-01T09:00:00.000Z',
    issueDescription: 'Screen cracked',
    statusTimestamps: {
      pending: '2026-11-01T09:00:00.000Z',
      in_progress: '2026-11-02T10:00:00.000Z',
    },
    estimatedCompletionDate: '2026-11-05',
    remark: 'Customer called',
    actualCost: 4500,
    estimatedCost: 5000,
    depositAmount: 1000,
  });
  const serialized = JSON.stringify(mirror.payload);
  for (const secret of ['Yacine', '0550120550', '1234', 'Rania', 'Samir', 'OLED']) {
    assert.ok(!serialized.includes(secret), `payload leaks ${secret}`);
  }
});

test('history keeps the first timestamp per status, at wins over timestamp', async () => {
  const mirror = await buildTrackingMirror({
    ticketNumber: 'TKT-0001',
    trackingPin: 'AB12',
    statusHistory: [
      { status: 'pending', at: '2026-11-01T09:00:00.000Z' },
      { status: 'pending', at: '2026-11-01T11:00:00.000Z' },
      { status: 'ready', timestamp: '2026-11-03T09:00:00.000Z' },
      { status: 'completed' },
      { at: '2026-11-05T09:00:00.000Z' },
    ],
  });
  assert.deepEqual(mirror?.payload.statusTimestamps, {
    pending: '2026-11-01T09:00:00.000Z',
    ready: '2026-11-03T09:00:00.000Z',
  });
});

test('zero money is kept, empty optionals are dropped, sparse tickets default', async () => {
  const mirror = await buildTrackingMirror({
    ticketNumber: ' tkt-0001 ',
    trackingPin: 'AB12',
    actualCost: 0,
    depositAmount: 0,
    remark: '',
    returnReason: '',
    estimatedCompletionDate: '',
  });
  assert.ok(mirror);
  assert.equal(mirror.payload.actualCost, 0);
  assert.equal(mirror.payload.depositAmount, 0);
  assert.equal(mirror.payload.ticketNumber, 'TKT-0001');
  assert.equal(mirror.payload.status, 'pending');
  assert.deepEqual(mirror.payload.statusTimestamps, {});
  for (const key of ['estimatedCost', 'remark', 'returnReason', 'estimatedCompletionDate']) {
    assert.ok(!(key in mirror.payload), `empty optional ${key} should be omitted`);
  }
  assert.equal(await buildTrackingMirror({ ticketNumber: 'TKT-PENDING', trackingPin: 'AB12' }), null);
  assert.equal(await buildTrackingMirror({ ticketNumber: 'TKT-0001' }), null);
});