import { sha256 } from 'js-sha256';
import type { RepairStatus } from '../types';

// The public tracking mirror (repair_tracking/{id}) carries ONLY what the /track
// page displays. The id embeds sha256(ticketNumber + ':' + pin), so holding the id
// is the proof of the PIN: rules allow a point get by id and no list at all for
// anonymous callers. Both apps must compute the identical id — the shared test
// vectors in trackingMirror.test.ts pin the contract. js-sha256 is pure JS (no
// native module), so this ships over OTA like the rest of the bundle.

export const TRACKING_MIRROR_COLLECTION = 'repair_tracking';

/** The fields a mirror is built from; a full RepairTicket satisfies this. */
export interface TrackingMirrorSource {
  ticketNumber?: string;
  ticketNumberProvisional?: boolean;
  trackingPin?: string;
  customerPhone?: string;
  status?: RepairStatus;
  statusHistory?: readonly { status?: string; at?: string; timestamp?: string }[];
  deviceBrand?: string;
  deviceModel?: string;
  createdAt?: string;
  estimatedCompletionDate?: string;
  issueDescription?: string;
  remark?: string;
  returnReason?: string;
  actualCost?: number;
  estimatedCost?: number;
  depositAmount?: number;
}

/** Exactly what a stranger with the ticket number and PIN may read. */
export interface TrackingMirrorPayload {
  ticketNumber: string;
  status: RepairStatus;
  deviceBrand: string;
  deviceModel: string;
  createdAt: string;
  issueDescription: string;
  statusTimestamps: Record<string, string>;
  estimatedCompletionDate?: string;
  remark?: string;
  returnReason?: string;
  actualCost?: number;
  estimatedCost?: number;
  depositAmount?: number;
}

/** Same rule the legacy tracking reader applied: the printed PIN, else phone last 4. */
export const effectiveTrackingPin = (source: TrackingMirrorSource): string => {
  const pin = (source.trackingPin || '').trim().toUpperCase();
  if (pin) return pin;
  return (source.customerPhone || '').slice(-4);
};

export const trackingMirrorId = async (ticketNumber: string, pin: string): Promise<string> => {
  const num = ticketNumber.trim().toUpperCase();
  return `${num}_${sha256(`${num}:${pin.trim().toUpperCase()}`)}`;
};

/** Null when the ticket cannot be tracked: no number yet, provisional, or no PIN. */
export const mirrorIdOf = async (source: TrackingMirrorSource): Promise<string | null> => {
  const num = (source.ticketNumber || '').trim().toUpperCase();
  if (!num || num === 'TKT-PENDING' || source.ticketNumberProvisional === true) return null;
  const pin = effectiveTrackingPin(source);
  if (!pin) return null;
  return trackingMirrorId(num, pin);
};

const firstTimestampPerStatus = (
  history: TrackingMirrorSource['statusHistory']
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of history || []) {
    if (!entry || typeof entry.status !== 'string') continue;
    const at = typeof entry.at === 'string' ? entry.at
      : typeof entry.timestamp === 'string' ? entry.timestamp
      : null;
    if (at && !(entry.status in out)) out[entry.status] = at;
  }
  return out;
};

export const buildTrackingMirror = async (
  source: TrackingMirrorSource
): Promise<{ id: string; payload: TrackingMirrorPayload } | null> => {
  const id = await mirrorIdOf(source);
  if (!id) return null;

  const num = (source.ticketNumber || '').trim().toUpperCase();
  const payload: TrackingMirrorPayload = {
    ticketNumber: num,
    status: (source.status || 'pending') as RepairStatus,
    deviceBrand: source.deviceBrand || '',
    deviceModel: source.deviceModel || '',
    createdAt: source.createdAt || '',
    issueDescription: source.issueDescription || '',
    statusTimestamps: firstTimestampPerStatus(source.statusHistory),
  };
  if (typeof source.estimatedCompletionDate === 'string' && source.estimatedCompletionDate) {
    payload.estimatedCompletionDate = source.estimatedCompletionDate;
  }
  if (typeof source.remark === 'string' && source.remark) payload.remark = source.remark;
  if (typeof source.returnReason === 'string' && source.returnReason) payload.returnReason = source.returnReason;
  if (typeof source.actualCost === 'number') payload.actualCost = source.actualCost;
  if (typeof source.estimatedCost === 'number') payload.estimatedCost = source.estimatedCost;
  if (typeof source.depositAmount === 'number') payload.depositAmount = source.depositAmount;
  return { id, payload };
};