/**
 * The public tracking mirror contract (A2).
 *
 * The three id vectors below are shared VERBATIM with technician-app's
 * trackingMirror.test.ts: both apps must derive the identical document id or a
 * ticket written by one app becomes untrackable when the other refreshes it.
 * The whitelist test is the security boundary — anything not on the /track page
 * must never reach a document an anonymous stranger can point-get.
 */
import { describe, it, expect } from 'vitest';
import {
  TRACKING_MIRROR_COLLECTION,
  buildTrackingMirror,
  effectiveTrackingPin,
  mirrorIdOf,
  mirrorToPublicTicket,
  trackingMirrorId,
  type TrackingMirrorPayload,
  type TrackingMirrorSource,
} from './trackingMirror';

const VECTOR_1 = 'TKT-0001_bd980ec3cd87d20e6da51bb1f2db8aa3f3a8425699959793587b45bd80d5dbc5';
const VECTOR_2 = 'TKT-0042_c8f809562a1d01c2bdf6c5c85d0f198566baca3441fdc2faf9ed3ef9f2e1906d';
const VECTOR_3 = 'TKT-123456_413d19ce1343731f67cf28010b84b1ba80c427080ead122c565ad46cd2602768';

describe('mirror id derivation (cross-app parity vectors)', () => {
  it('pins sha256(ticketNumber + ":" + pin) for both apps', async () => {
    expect(await trackingMirrorId('TKT-0001', 'AB12')).toBe(VECTOR_1);
    expect(await trackingMirrorId('TKT-0042', '0550')).toBe(VECTOR_2);
    expect(await trackingMirrorId('TKT-123456', '9X7Q')).toBe(VECTOR_3);
  });

  it('normalizes case and surrounding whitespace on both halves', async () => {
    expect(await trackingMirrorId(' tkt-0001 ', ' ab12 ')).toBe(VECTOR_1);
  });

  it('lives in the repair_tracking collection', () => {
    expect(TRACKING_MIRROR_COLLECTION).toBe('repair_tracking');
  });
});

describe('effectiveTrackingPin (the legacy reader rule)', () => {
  it('prefers the printed PIN over the phone', () => {
    expect(effectiveTrackingPin({ trackingPin: '9X7Q', customerPhone: '0550120550' })).toBe('9X7Q');
  });

  it('trims and uppercases the printed PIN', () => {
    expect(effectiveTrackingPin({ trackingPin: ' ab12 ' })).toBe('AB12');
  });

  it('falls back to the phone last 4 when no PIN was printed', () => {
    expect(effectiveTrackingPin({ customerPhone: '0550120550' })).toBe('0550');
    expect(effectiveTrackingPin({ trackingPin: '   ', customerPhone: '0550120550' })).toBe('0550');
  });

  it('is empty when neither a PIN nor a phone exists', () => {
    expect(effectiveTrackingPin({})).toBe('');
  });
});

describe('mirrorIdOf guards', () => {
  it('refuses a ticket without a number', async () => {
    expect(await mirrorIdOf({ trackingPin: 'AB12' })).toBeNull();
    expect(await mirrorIdOf({ ticketNumber: '  ', trackingPin: 'AB12' })).toBeNull();
  });

  it('refuses the provisional placeholder number', async () => {
    expect(await mirrorIdOf({ ticketNumber: 'TKT-PENDING', trackingPin: 'AB12' })).toBeNull();
    expect(await mirrorIdOf({ ticketNumber: 'tkt-pending', trackingPin: 'AB12' })).toBeNull();
  });

  it('refuses a provisional ticket even with a real-looking number', async () => {
    expect(await mirrorIdOf({ ticketNumber: 'TKT-0001', ticketNumberProvisional: true, trackingPin: 'AB12' })).toBeNull();
  });

  it('refuses a ticket with no PIN and no phone', async () => {
    expect(await mirrorIdOf({ ticketNumber: 'TKT-0001' })).toBeNull();
    expect(await mirrorIdOf({ ticketNumber: 'TKT-0001', trackingPin: '  ', customerPhone: '' })).toBeNull();
  });

  it('derives the same id from the phone fallback as from the explicit last-4 PIN', async () => {
    expect(await mirrorIdOf({ ticketNumber: 'TKT-0042', customerPhone: '0550120550' })).toBe(VECTOR_2);
    expect(await mirrorIdOf({ ticketNumber: 'TKT-0042', trackingPin: '0550', customerPhone: '0770000000' })).toBe(VECTOR_2);
  });
});

describe('buildTrackingMirror payload whitelist', () => {
  const dirtySource = {
    ticketNumber: 'TKT-0042',
    trackingPin: '0550',
    customerName: 'Yacine Secret',
    customerPhone: '0550120550',
    lockValue: '1234',
    lockPattern: [0, 1, 2],
    status: 'in_progress',
    statusHistory: [
      { status: 'pending', changedById: 'u1', changedByName: 'Rania Admin', at: '2026-11-01T09:00:00.000Z' },
      { status: 'in_progress', changedById: 'u2', changedByName: 'Samir Tech', at: '2026-11-02T10:00:00.000Z' },
    ],
    assignedTechnician: 'Samir Tech',
    assignedTechnicianId: 'u2',
    partsUsed: [{ partId: 'p1', name: 'Screen', cost: 3000 }],
    internalNotes: 'wholesale supplier margin',
    deviceBrand: 'Samsung',
    deviceModel: 'A54',
    createdAt: '2026-11-01T09:00:00.000Z',
    issueDescription: 'Screen cracked',
    actualCost: 4500,
    estimatedCost: 5000,
    depositAmount: 1000,
    remark: 'Customer called',
    estimatedCompletionDate: '2026-11-05',
  } as TrackingMirrorSource;

  it('carries exactly the fields the /track page displays', async () => {
    const mirror = await buildTrackingMirror(dirtySource);
    expect(mirror).not.toBeNull();
    expect(mirror!.id).toBe(VECTOR_2);
    expect(Object.keys(mirror!.payload).sort()).toEqual([
      'actualCost',
      'createdAt',
      'depositAmount',
      'deviceBrand',
      'deviceModel',
      'estimatedCompletionDate',
      'estimatedCost',
      'issueDescription',
      'remark',
      'status',
      'statusTimestamps',
      'ticketNumber',
    ]);
  });

  it('never leaks identity, lock codes, staff, parts or the PIN itself', async () => {
    const { payload } = (await buildTrackingMirror(dirtySource))!;
    for (const forbidden of [
      'customerName', 'customerPhone', 'lockValue', 'lockPattern', 'trackingPin',
      'assignedTechnician', 'assignedTechnicianId', 'partsUsed', 'internalNotes', 'statusHistory',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(payload)).not.toContain('Yacine');
    expect(JSON.stringify(payload)).not.toContain('0550120550');
    expect(JSON.stringify(payload)).not.toContain('Rania');
    expect(JSON.stringify(payload)).not.toContain('Samir');
  });

  it('reduces history to the first timestamp per status, without actors', async () => {
    const source = {
      ticketNumber: 'TKT-0001',
      trackingPin: 'AB12',
      statusHistory: [
        { status: 'pending', changedById: 'u1', changedByName: 'Rania', at: '2026-11-01T09:00:00.000Z' },
        { status: 'pending', changedById: 'u1', changedByName: 'Rania', at: '2026-11-01T11:00:00.000Z' },
        { status: 'in_progress', changedById: 'u2', changedByName: 'Samir', at: '2026-11-02T10:00:00.000Z' },
      ],
    } as TrackingMirrorSource;
    const { payload } = (await buildTrackingMirror(source))!;
    expect(payload.statusTimestamps).toEqual({
      pending: '2026-11-01T09:00:00.000Z',
      in_progress: '2026-11-02T10:00:00.000Z',
    });
  });

  it('accepts the mobile-shaped timestamp fallback and skips broken entries', async () => {
    const source = {
      ticketNumber: 'TKT-0001',
      trackingPin: 'AB12',
      statusHistory: [
        { status: 'pending', timestamp: '2026-11-01T09:00:00.000Z' },
        { status: 'ready', at: '2026-11-03T09:00:00.000Z', timestamp: '2026-11-04T09:00:00.000Z' },
        { status: 'completed' },
        { at: '2026-11-05T09:00:00.000Z' },
        null,
      ],
    } as unknown as TrackingMirrorSource;
    const { payload } = (await buildTrackingMirror(source))!;
    expect(payload.statusTimestamps).toEqual({
      pending: '2026-11-01T09:00:00.000Z',
      ready: '2026-11-03T09:00:00.000Z',
    });
  });

  it('includes zero money but omits empty optionals', async () => {
    const { payload } = (await buildTrackingMirror({
      ticketNumber: 'TKT-0001',
      trackingPin: 'AB12',
      actualCost: 0,
      depositAmount: 0,
      remark: '',
      returnReason: '',
      estimatedCompletionDate: '',
    }))!;
    expect(payload.actualCost).toBe(0);
    expect(payload.depositAmount).toBe(0);
    expect(payload).not.toHaveProperty('estimatedCost');
    expect(payload).not.toHaveProperty('remark');
    expect(payload).not.toHaveProperty('returnReason');
    expect(payload).not.toHaveProperty('estimatedCompletionDate');
  });

  it('defaults the display fields a sparse ticket lacks', async () => {
    const { payload } = (await buildTrackingMirror({ ticketNumber: ' tkt-0001 ', trackingPin: 'AB12' }))!;
    expect(payload).toMatchObject({
      ticketNumber: 'TKT-0001',
      status: 'pending',
      deviceBrand: '',
      deviceModel: '',
      createdAt: '',
      issueDescription: '',
      statusTimestamps: {},
    });
  });

  it('returns null for an untrackable ticket instead of an empty mirror', async () => {
    expect(await buildTrackingMirror({ ticketNumber: 'TKT-PENDING', trackingPin: 'AB12' })).toBeNull();
    expect(await buildTrackingMirror({ ticketNumber: 'TKT-0001' })).toBeNull();
  });
});

describe('mirrorToPublicTicket', () => {
  const payload: TrackingMirrorPayload = {
    ticketNumber: 'TKT-0042',
    status: 'ready',
    deviceBrand: 'Samsung',
    deviceModel: 'A54',
    createdAt: '2026-11-01T09:00:00.000Z',
    issueDescription: 'Screen cracked',
    statusTimestamps: {
      pending: '2026-11-01T09:00:00.000Z',
      ready: '2026-11-03T09:00:00.000Z',
    },
    actualCost: 4500,
    depositAmount: 1000,
    remark: 'Customer called',
  };

  it('blanks the identity fields the page never shows', () => {
    const ticket = mirrorToPublicTicket(VECTOR_2, payload);
    expect(ticket.id).toBe(VECTOR_2);
    expect(ticket.customerName).toBe('');
    expect(ticket.customerPhone).toBe('');
    expect(ticket).not.toHaveProperty('lockValue');
    expect(ticket).not.toHaveProperty('trackingPin');
  });

  it('rebuilds the rendered history with empty actors', () => {
    const ticket = mirrorToPublicTicket(VECTOR_2, payload);
    expect(ticket.statusHistory).toEqual([
      { status: 'pending', changedById: '', changedByName: '', at: '2026-11-01T09:00:00.000Z' },
      { status: 'ready', changedById: '', changedByName: '', at: '2026-11-03T09:00:00.000Z' },
    ]);
  });

  it('keeps the display fields and defaults the estimate the page formats', () => {
    const ticket = mirrorToPublicTicket(VECTOR_2, payload);
    expect(ticket).toMatchObject({
      ticketNumber: 'TKT-0042',
      status: 'ready',
      deviceBrand: 'Samsung',
      deviceModel: 'A54',
      actualCost: 4500,
      depositAmount: 1000,
      remark: 'Customer called',
      estimatedCost: 0,
      updatedAt: '2026-11-01T09:00:00.000Z',
    });
  });
});