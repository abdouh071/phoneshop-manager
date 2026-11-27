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
  /**
   * How many times this action has been put back because the ticket it waits on has
   * not uploaded yet. Absent on actions queued before this was counted: 0.
   */
  deferrals?: number;
}

export interface DeadLetterEntry<T = unknown> {
  id: string;
  kind: QueueKind;
  payload: T;
  attempts: number;
  deferrals?: number;
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

/**
 * The ticket a status, a remark or a part-line waits on may never arrive: it can
 * dead-letter after its own six attempts, or the id map that joined them can be
 * cleared. An unbounded wait looks identical from inside the queue — the action is
 * re-armed every pass, the banner keeps claiming work is pending, and every pass
 * reads the collections again for it. Sixty deferrals is about an hour of passes,
 * longer than the ticket's own retry budget, so a wait that ends here was never
 * going to be answered.
 */
export const MAX_DEFERRALS = 60;

/** Re-arm a waiting action, and say whether its patience has run out. */
export const recordDeferral = <T>(
  action: QueueAction<T>,
  nowMs: number,
  deferMs: number,
  message: string
): { action: QueueAction<T>; exhausted: boolean } => {
  const deferrals = (action.deferrals ?? 0) + 1;
  return {
    action: {
      ...action,
      deferrals,
      lastError: message.slice(0, 400),
      nextAttemptAt: nowMs + deferMs,
    },
    exhausted: deferrals >= MAX_DEFERRALS,
  };
};

export const toDeadLetter = <T>(
  action: QueueAction<T>,
  nowIso: string
): DeadLetterEntry<T> => ({
  id: action.id,
  kind: action.kind,
  payload: action.payload,
  attempts: action.attempts,
  deferrals: action.deferrals,
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

  // Never let a stale queue entry clear who owns the repair. The id travels with
  // the name so a claim or a preserved owner is never left name-only.
  const incomingTech = patch.assignedTechnician;
  if (incomingTech === undefined || incomingTech === null || incomingTech === '') {
    if (current?.assignedTechnician) {
      patch.assignedTechnician = current.assignedTechnician;
      patch.assignedTechnicianId = current.assignedTechnicianId ?? null;
    } else if (input.status === 'in_progress' || input.status === 'ready') {
      patch.assignedTechnician = input.actorName || null;
      patch.assignedTechnicianId = input.actorId || null;
    }
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

/**
 * A settle is retried by re-tapping the same numbers after a failure, and the ticket
 * document is the anchor for whether its money side-effects already ran. Once the
 * document carries this exact settlement, re-running them would open a second debt
 * row and spend the money twice. The debt link must also be present whenever money
 * is owed: the ticket write can land while the debt write is still pending, and that
 * retry still has work to do.
 */
export const isSettleAlreadyRecorded = (
  ticket: { status?: unknown; paidAmount?: unknown; debtEntryId?: unknown },
  effectiveTotalPaid: number,
  remainingDebt: number
): boolean =>
  ticket.status === 'completed' &&
  ticket.paidAmount === effectiveTotalPaid &&
  (!!ticket.debtEntryId || remainingDebt === 0);

/** An id that only exists in this phone's cache, never on the server. */
export const isOfflineCustomerId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith('offline_');

/** Swap one cached row's temp id for the server id its upload was given. */
export const replaceCachedCustomer = <T extends { id: string }>(
  cached: T[],
  offlineId: string,
  serverId: string
): T[] => cached.map(c => (c.id === offlineId ? { ...c, id: serverId } : c));

export const deriveStockStatus = (stock: number, thresholdRaw: unknown): 'out_of_stock' | 'low_stock' | 'in_stock' => {
  const threshold = clampStock(thresholdRaw);
  if (stock <= 0) return 'out_of_stock';
  if (stock <= Math.max(1, threshold)) return 'low_stock';
  return 'in_stock';
};

/**
 * What one sale adds to the customer's own record: a visit, the money that changed
 * hands, and the money the shop is now owed. Both writers of those numbers use this —
 * the till that sold online and the sync pass that uploads a sale made offline — so a
 * profile cannot gain two different answers depending on which device reached the
 * server first. Whole cents, never negative: a return is its own document.
 */
export const saleProfileDeltas = (
  paid: unknown,
  charged: unknown
): { visits: number; spent: number; debt: number } => {
  const money = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) / 100 : 0;
  };
  return { visits: 1, spent: money(paid), debt: money(charged) };
};

/**
 * The profile's totals after one sale, for a writer that holds the document inside a
 * transaction and so must write the value rather than ask the server to add to it.
 * A field the profile never had counts as zero, not as NaN — a legacy customer with no
 * `totalSpent` must still gain what this sale took in.
 */
export const profileTotalsAfter = (
  current: { totalPurchases?: unknown; totalSpent?: unknown; totalDebt?: unknown },
  deltas: { visits: number; spent: number; debt: number }
): { totalPurchases: number; totalSpent: number; totalDebt: number } => {
  const count = (value: unknown): number => Math.max(0, Math.trunc(Number(value) || 0));
  const money = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) / 100 : 0;
  };
  return {
    totalPurchases: count(current?.totalPurchases) + deltas.visits,
    totalSpent: money(money(current?.totalSpent) + deltas.spent),
    totalDebt: money(money(current?.totalDebt) + deltas.debt),
  };
};

/** The shape a queued sale carries when the counter could not be reached at the till. */
export interface NumberedInvoice {
  invoiceNumber?: unknown;
  invoiceNumberProvisional?: unknown;
  provisionalInvoiceNumber?: unknown;
}

/**
 * What an unfinished invoice still owes the shelf and the customer, derived from the
 * document alone so the sweep and the upload agree on the same numbers.
 *
 * The phone's commit is deduct-only: a return line needs the net of both signs, which only
 * the counter's sweep computes, so an invoice carrying one is `deferred` and left to it.
 * The customer's own numbers are the phone's to move only when it stamped `profileApplied`
 * false itself — a counter sale carries no such stamp and recomputes its totals from
 * history, so moving them here would count the customer's money twice.
 */
export const unfinishedSaleEffects = (data: {
  items?: unknown;
  customerId?: unknown;
  total?: unknown;
  accountSettlement?: { chargedAmount?: unknown } | null;
  profileApplied?: unknown;
}): {
  lines: { productId: string; name: string; quantity: number }[];
  profile?: { customerId: string; paid: number; charged: number };
  deferred: boolean;
} => {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.some((item) => (item as { isReturn?: unknown } | null)?.isReturn)) {
    return { lines: [], deferred: true };
  }

  const lines: { productId: string; name: string; quantity: number }[] = [];
  for (const raw of items) {
    const item = raw as { product?: { id?: unknown; name?: unknown } | null; quantity?: unknown } | null;
    const productId = String(item?.product?.id || '');
    if (!productId) continue;
    lines.push({
      productId,
      name: String(item?.product?.name || ''),
      quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
    });
  }

  const customerId = String(data.customerId || '');
  const charged = Math.max(0, Number(data.accountSettlement?.chargedAmount) || 0);
  const profile =
    data.profileApplied === false && customerId
      ? { customerId, paid: Math.max(0, (Number(data.total) || 0) - charged), charged }
      : undefined;

  return { lines, profile, deferred: false };
};

/**
 * True when this queued sale still owes the counter a number. Once a claim has been
 * remembered on the action the answer is no, so a sale the server took while the
 * phone saw a timeout is replayed under the number already claimed for it instead
 * of spending a second one and leaving the first unheld by any document.
 */
export const needsInvoiceNumber = (sale: NumberedInvoice): boolean =>
  sale.invoiceNumberProvisional === true && !sale.provisionalInvoiceNumber;

/**
 * The fields a sale carries once the counter has replaced the clock's guess. The
 * guess is kept rather than overwritten: it is the reference printed on the paper
 * the customer left with, and the only one a debt written before the rename can be
 * found by.
 */
export const renumberedInvoice = (
  guess: unknown,
  real: string
): { invoiceNumber: string; invoiceNumberProvisional: false; provisionalInvoiceNumber: string } => ({
  invoiceNumber: real,
  invoiceNumberProvisional: false,
  provisionalInvoiceNumber: String(guess ?? ''),
});

/**
 * The day a replayed sale joins the sequence for. An invoice sold on Tuesday and
 * uploaded on Friday belongs in Tuesday's book — claiming against the upload day
 * files it under a date the receipt does not carry and spends a number from a
 * sequence the shop is still writing into.
 */
export const invoiceClaimDate = (dateValue: unknown, uploadDay: Date): Date => {
  // Only the ISO string the queue stores is trusted: `new Date('42')` reads as a year,
  // so a corrupt figure would file the invoice decades from the day it was sold.
  if (typeof dateValue !== 'string' || !dateValue.trim()) return uploadDay;
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? uploadDay : parsed;
};

/**
 * A debt raised against the guess follows its invoice to the real number, and gains
 * the transaction id the offline till could not know yet — the strongest of the keys
 * both apps match a sale to its debt on.
 *
 * Only an entry naming that exact guess is touched, and one already pointing at a
 * different invoice is left alone: a clock guess can repeat, and re-pointing a debt
 * that belongs to another sale would move money onto the wrong account.
 */
export const debtFollowsInvoice = (
  debt: Record<string, unknown>,
  guess: string,
  real: string,
  saleId: string
): Record<string, unknown> | null => {
  if (!guess || !real || guess === real) return null;
  if (String(debt.invoiceNumber ?? '') !== guess) return null;
  const linked = String(debt.transactionId ?? '');
  if (linked && linked !== saleId) return null;
  return { ...debt, invoiceNumber: real, transactionId: saleId };
};
