/**
 * Offline queue policy — pure functions, no Firebase, no React Native.
 * =====================================================================
 * Everything that decides *whether* a queued write is replayed, *how many
 * times*, and *what it must not destroy* lives here, so it can be run under
 * `node --test` instead of only on a phone. The service in
 * `offlineSyncService.ts` does storage and Firestore I/O; it never decides
 * policy on its own.
 *
 * Types are structural and local on purpose: this file must import nothing, so
 * the test runner can load it without resolving the RN/Firebase graph.
 */

export type QueueKind = 'ticket' | 'sale' | 'status' | 'debt' | 'remark' | 'parts' | 'stock';

export interface QueueAction<T = unknown> {
  /** Minted once, at enqueue time. Survives every retry; the replay key when the
   *  record carries no `idempotencyKey` of its own — see `replayKeyOf`. */
  id: string;
  kind: QueueKind;
  /** The record to write (a ticket, a sale, a debt) or the field patch to apply. */
  payload: T;
  createdAt: string;
  /** Times this action has been attempted. */
  attempts: number;
  lastError?: string;
  /** Epoch ms before which the action must not be retried. 0 means "due now". */
  nextAttemptAt: number;
  /**
   * The repair ticket this action targets. May be a local `offline_tkt_…` id that
   * only becomes a real Firestore doc id once the ticket itself has been uploaded.
   */
  ticketRef?: string;
}

export interface DeadLetterEntry<T = unknown> {
  id: string;
  kind: QueueKind;
  payload: T;
  attempts: number;
  lastError: string;
  movedAt: string;
  ticketRef?: string;
}

/**
 * Six attempts with the backoff below spans roughly an hour. Past that the
 * action is parked in the dead-letter store and shown to the user: a till that
 * has been offline all day must not silently keep a sale invisible forever.
 */
export const MAX_ATTEMPTS = 6;
export const BASE_BACKOFF_MS = 15_000;
export const MAX_BACKOFF_MS = 60 * 60_000;

/** Longest chain of temp-id rewrites we will follow when resolving a ticket ref. */
const MAX_REMAP_HOPS = 10;

export const backoffDelayMs = (attempts: number): number => {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  // 2 ** 40 overflows into Infinity for a queue that has been retried for weeks.
  const factor = Math.min(2 ** Math.min(safeAttempts - 1, 20), 2 ** 20);
  return Math.min(BASE_BACKOFF_MS * factor, MAX_BACKOFF_MS);
};

/** An action is due when it has never been tried or its backoff has elapsed. */
export const isDue = (action: Pick<QueueAction, 'attempts' | 'nextAttemptAt'>, nowMs: number): boolean =>
  action.nextAttemptAt <= 0 || action.nextAttemptAt <= nowMs;

/** Next allowed attempt, or 0 to park the action until the app is foregrounded again. */
export const recordFailure = <T>(
  action: QueueAction<T>,
  nowMs: number,
  message: string
): QueueAction<T> => {
  const attempts = action.attempts + 1;
  return {
    ...action,
    attempts,
    lastError: message.slice(0, 400),
    nextAttemptAt: attempts >= MAX_ATTEMPTS ? 0 : nowMs + backoffDelayMs(attempts),
  };
};

export const shouldDeadLetter = (action: Pick<QueueAction, 'attempts'>): boolean =>
  action.attempts >= MAX_ATTEMPTS;

export const toDeadLetter = <T>(
  action: QueueAction<T>,
  nowIso: string
): DeadLetterEntry<T> => ({
  id: action.id,
  kind: action.kind,
  payload: action.payload,
  attempts: action.attempts,
  lastError: action.lastError || 'Repeated sync failures',
  movedAt: nowIso,
  ticketRef: action.ticketRef,
});

/**
 * A crash between "the record was uploaded" and "the queue was rewritten" is the
 * whole reason for the idempotency key, but it can also leave the *same action*
 * stored twice. Replays must be unique by id regardless of how it got there.
 */
export const dedupeById = <T extends Pick<QueueAction, 'id'>>(actions: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    out.push(action);
  }
  return out;
};

/**
 * A dedupe key, minted once — before the record's first write, never at the replay.
 *
 * The till stamps it on the document it creates and keeps it on the local record it
 * queues. That is the only way a replay can tell "the server saved this sale and the
 * phone never heard" apart from "this sale never happened": a document written
 * without a key on it matches nothing, so the next sync posts the sale again.
 */
export const newIdempotencyKey = (kind: 'sale' | 'debt' | 'ticket'): string =>
  `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * The key a queued record actually replays under: its own stamp when it has one,
 * the queue's id when it does not. The fallback keeps records that were already
 * parked on a device before the stamp existed replaying at all — they just keep
 * the weaker rule, which can only duplicate, never drop.
 */
export const replayKeyOf = (record: { idempotencyKey?: unknown }, queueActionId: string): string =>
  typeof record.idempotencyKey === 'string' && record.idempotencyKey
    ? record.idempotencyKey
    : queueActionId;

export type IdMap = Record<string, string>;

/**
 * Follow `offline_tkt_123 → 9f3a…` so a status update queued while the ticket was
 * still local lands on the document that now exists. Without this the update is
 * retried against a non-existent id forever, which is the bug this replaces.
 */
export const resolveRef = (idMap: IdMap, ref: string | undefined): string | undefined => {
  if (!ref) return undefined;
  let current = ref;
  for (let hop = 0; hop < MAX_REMAP_HOPS; hop++) {
    const next = idMap[current];
    if (!next || next === current) return current;
    current = next;
  }
  return current;
};

/**
 * When a ticket uploads, every action waiting on its temp id is re-pointed at the
 * real doc id in the same pass the id map is written, so a later crash cannot
 * leave an action holding the stale id.
 */
export const rebaseActions = <T>(actions: QueueAction<T>[], oldId: string, newId: string): QueueAction<T>[] =>
  actions.map((action) => {
    if (action.ticketRef !== oldId) return action;
    return {
      ...action,
      ticketRef: newId,
      nextAttemptAt: 0,
      payload: rebasePayload(action.payload, oldId, newId),
    };
  });

const TICKET_ID_FIELDS = ['ticketId', 'id'] as const;

/** Rewrites the id fields inside a payload the same way the ref is rewritten. */
export const rebasePayload = <T>(payload: T, oldId: string, newId: string): T => {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map((item) => rebasePayload(item, oldId, newId)) as unknown as T;
  const out: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const field of TICKET_ID_FIELDS) {
    if (out[field] === oldId) out[field] = newId;
  }
  // ticketNumber is unrelated to doc ids; only the two id fields are rewritten.
  return out as unknown as T;
};

export interface HistoryEntryLike {
  status?: string;
  at?: string;
  timestamp?: string;
  changedById?: string;
  changedByName?: string;
  notes?: string;
  [key: string]: unknown;
}

const stampOf = (entry: HistoryEntryLike): string => String(entry.at || entry.timestamp || '');

/**
 * Status history is append-only audit data. A replay that re-runs an update must
 * not add the same entry twice, and a replay that predates another device's
 * change must not drop it. Keying on (status, at) makes appending idempotent.
 */
export const appendHistory = (
  existing: HistoryEntryLike[] | undefined,
  entry: HistoryEntryLike
): HistoryEntryLike[] => {
  const current = Array.isArray(existing) ? existing : [];
  const key = `${entry.status}|${stampOf(entry)}`;
  const already = current.some((e) => `${e.status}|${stampOf(e)}` === key);
  return already ? current : [...current, entry];
};

export interface StatusPatchInput {
  status: string;
  timestamp: string;
  actorId?: string;
  actorName?: string;
  notes?: string;
  additionalUpdates?: Record<string, unknown> | null;
}

/**
 * Builds the patch for a status change against whatever the document already
 * holds. The naive version of this wrote `{ status, updatedAt, ...extra }`, which
 * silently deleted `statusHistory` added on the desktop while the phone was
 * offline — so the merge is explicit about what may never be clobbered.
 */
export const buildStatusPatch = (
  current: Record<string, unknown> | null,
  input: StatusPatchInput
): Record<string, unknown> => {
  const extra = input.additionalUpdates && typeof input.additionalUpdates === 'object'
    ? input.additionalUpdates
    : {};

  const entry: HistoryEntryLike = {
    status: input.status,
    changedById: input.actorId,
    changedByName: input.actorName,
    at: input.timestamp,
    timestamp: input.timestamp,
    notes: typeof extra.notes === 'string' && extra.notes
      ? extra.notes
      : input.notes || `Status changed to ${input.status} via Technician App`,
  };

  const patch: Record<string, unknown> = {
    ...extra,
    status: input.status,
    updatedAt: input.timestamp,
    statusHistory: appendHistory(
      (current?.statusHistory as HistoryEntryLike[] | undefined) || [],
      entry
    ),
  };

  // Never let a stale queue entry clear who owns the repair.
  const incomingTech = patch.assignedTechnician;
  if (incomingTech === undefined || incomingTech === null || incomingTech === '') {
    if (current?.assignedTechnician) patch.assignedTechnician = current.assignedTechnician;
    else if (input.status === 'in_progress' || input.status === 'ready') patch.assignedTechnician = input.actorName || null;
  }

  // A technician's written remark must not be replaced by an empty one.
  if (patch.remark !== undefined && (patch.remark === null || String(patch.remark).trim() === '')) {
    if (current?.remark) delete patch.remark;
  }

  if (input.status === 'ready' && !patch.repairedAt && !current?.repairedAt) patch.repairedAt = input.timestamp;
  if (input.status === 'completed' && !patch.completedAt && !current?.completedAt) patch.completedAt = input.timestamp;

  return patch;
};

/**
 * Sequential ticket numbers come from the shared `counters/repairs` doc. A ticket
 * created offline could not reach the counter, so it carried a random
 * `TKT-482913` fallback that then lived forever. Replay renumbers it from the
 * counter, keeping the fallback in `offlineTicketNumber` for any receipt already
 * printed with it.
 */
export const nextTicketNumber = (lastNumber: number | undefined | null): string => {
  const current = Number.isFinite(lastNumber as number) ? Math.max(0, Math.floor(lastNumber as number)) : 0;
  return `TKT-${String(current + 1).padStart(4, '0')}`;
};

export const counterValueAfter = (lastNumber: number | undefined | null): number => {
  const current = Number.isFinite(lastNumber as number) ? Math.max(0, Math.floor(lastNumber as number)) : 0;
  return current + 1;
};

/** The shape `createTicket` writes when it could not reach the counter. */
export interface NumberedTicket {
  ticketNumber?: unknown;
  ticketNumberProvisional?: boolean;
}

/**
 * True when a queued ticket still needs its real sequential number. Inferred from
 * the flag the offline path now writes, with the `TKT-####` shape as the fallback
 * for records already sitting in a queue from an older build.
 */
export const needsTicketNumber = (ticket: NumberedTicket): boolean =>
  ticket.ticketNumberProvisional === true ||
  !/^TKT-\d{4,}$/.test(String(ticket.ticketNumber ?? ''));

/**
 * AsyncStorage keys are namespaced by uid. Two technicians sharing a tablet must
 * not inherit each other's pending sales, and the pre-namespacing keys are read
 * once and folded into the new owner's queue rather than discarded.
 */
export const queueKey = (baseKey: string, uid: string): string => `${baseKey}::${uid}`;

export const unownedKey = (baseKey: string): string => `${baseKey}::__unowned__`;

export const isOwnerKey = (key: string, baseKey: string): boolean =>
  key.startsWith(`${baseKey}::`) && key !== baseKey;

/** Stock must never go negative and never be written from a stale local value. */
export const clampStock = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

export const deriveStockStatus = (stock: number, thresholdRaw: unknown): 'out_of_stock' | 'low_stock' | 'in_stock' => {
  const threshold = clampStock(thresholdRaw);
  if (stock <= 0) return 'out_of_stock';
  if (stock <= Math.max(1, threshold)) return 'low_stock';
  return 'in_stock';
};
