import type { RepairStatus, RepairStatusHistoryEntry, RepairTicket } from '../types';

// The public tracking mirror (repair_tracking/{id}) carries ONLY what the /track
// page displays. The id embeds sha256(ticketNumber + ':' + pin), so holding the id
// is the proof of the PIN: rules allow a point get by id and no list at all for
// anonymous callers. Both apps must compute the identical id — the shared test
// vectors in trackingMirror.test.ts pin the contract.

export const TRACKING_MIRROR_COLLECTION = 'repair_tracking';

/** The fields a mirror is built from; a full RepairTicket satisfies this. */
export interface TrackingMirrorSource {
  ticketNumber?: string;
  ticketNumberProvisional?: boolean;
  trackingPin?: string;
  customerPhone?: string;
  status?: RepairStatus;
  statusHistory?: RepairStatusHistoryEntry[];
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

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/** Same rule the legacy tracking reader applied: the printed PIN, else phone last 4. */
export const effectiveTrackingPin = (source: TrackingMirrorSource): string => {
  const pin = (source.trackingPin || '').trim().toUpperCase();
  if (pin) return pin;
  return (source.customerPhone || '').slice(-4);
};

export const trackingMirrorId = async (ticketNumber: string, pin: string): Promise<string> => {
  const num = ticketNumber.trim().toUpperCase();
  return `${num}_${await sha256Hex(`${num}:${pin.trim().toUpperCase()}`)}`;
};

/** Null when the ticket cannot be tracked: no number yet, provisional, or no PIN. */
export const mirrorIdOf = async (source: TrackingMirrorSource): Promise<string | null> => {
  const num = (source.ticketNumber || '').trim().toUpperCase();
  if (!num || num === 'TKT-PENDING' || source.ticketNumberProvisional === true) return null;
  const pin = effectiveTrackingPin(source);
  if (!pin) return null;
  return trackingMirrorId(num, pin);
};

const firstTimestampPerStatus = (history: RepairStatusHistoryEntry[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of history || []) {
    if (!entry || typeof entry.status !== 'string') continue;
    const at = typeof entry.at === 'string' ? entry.at
      : typeof (entry as { timestamp?: unknown }).timestamp === 'string' ? (entry as { timestamp?: string }).timestamp
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

/**
 * Rebuild the shape the tracking page component already renders. Identity fields
 * are blanked on purpose: the mirror never held them, and the page never shows
 * them. History actors are empty strings for the same reason.
 */
export const mirrorToPublicTicket = (mirrorId: string, data: TrackingMirrorPayload): RepairTicket => ({
  id: mirrorId,
  ticketNumber: data.ticketNumber,
  customerName: '',
  customerPhone: '',
  deviceBrand: data.deviceBrand || '',
  deviceModel: data.deviceModel || '',
  issueDescription: data.issueDescription || '',
  estimatedCost: typeof data.estimatedCost === 'number' ? data.estimatedCost : 0,
  status: data.status,
  createdAt: data.createdAt,
  updatedAt: data.createdAt,
  statusHistory: Object.entries(data.statusTimestamps || {}).map(([status, at]) => ({
    status: status as RepairStatus,
    changedById: '',
    changedByName: '',
    at,
  })),
  ...(typeof data.estimatedCompletionDate === 'string' ? { estimatedCompletionDate: data.estimatedCompletionDate } : {}),
  ...(typeof data.remark === 'string' ? { remark: data.remark } : {}),
  ...(typeof data.returnReason === 'string' ? { returnReason: data.returnReason } : {}),
  ...(typeof data.actualCost === 'number' ? { actualCost: data.actualCost } : {}),
  ...(typeof data.depositAmount === 'number' ? { depositAmount: data.depositAmount } : {}),
});