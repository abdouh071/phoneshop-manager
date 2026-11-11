/**
 * Offline queue for the technician app.
 * ======================================
 * What this guarantees, and what the version before it did not:
 *
 *   • Owned per user. Keys are namespaced by the signed-in uid, so a shared tablet
 *     no longer replays user A's unsynced sale under user B's name. Legacy
 *     device-global entries are folded into the first account that signs in after
 *     the upgrade rather than dropped.
 *   • Replay-safe. A sale carries an `idempotencyKey` minted before its first write
 *     and stamped on the document it creates, so a crash — or a timeout on a write
 *     the server actually committed — is resolved by adopting the document that
 *     already exists instead of adding a second sale.
 *   • Bounded. Failures back off exponentially and park in the dead-letter store
 *     after MAX_ATTEMPTS, where the UI can show them. Previously a poisoned action
 *     retried every 15 seconds forever and a broken ticket reference could never
 *     succeed at all.
 *   • Non-destructive. A status replay is merged against the live document, so it
 *     cannot erase `statusHistory`, the owning technician, or a remark another
 *     device wrote while this phone was offline.
 *   • Ordered. Tickets upload before the status/remark/parts actions pointing at
 *     them, and the temp id → real id rewrite happens in the same pass.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { addIdempotently } from './idempotentReplay';
import { allocateTicketNumber } from './ticketCounter';
import { claimInvoiceNumber } from './invoiceCounter';
import { customerService } from './customerService';
import { commitPartsAllocation, commitSaleEffects, applyStockLines } from './stockService';
import { writeTrackingMirror, refreshTrackingMirrorForTicket } from './trackingMirrorService';
import type { TrackingMirrorSource } from '../utils/trackingMirror';
import {
  MAX_ATTEMPTS,
  buildStatusPatch,
  debtFollowsInvoice,
  dedupeById,
  invoiceClaimDate,
  isDue,
  isOfflineCustomerId,
  isOwnerKey,
  needsInvoiceNumber,
  needsTicketNumber,
  queueKey,
  recordDeferral,
  recordFailure,
  rebaseActions,
  renumberedInvoice,
  replayKeyOf,
  resolveRef,
  shouldDeadLetter,
  toDeadLetter,
  unfinishedSaleEffects,
  unownedKey,
  type DeadLetterEntry,
  type IdMap,
  type QueueAction,
  type QueueKind,
} from './offlineQueuePolicy';
import type { CartItem, CustomerDebtEntry, PhoneModel, RepairStatus, RepairTicket, SaleTransaction } from '../types';

/** Kept for callers that still describe a queued status change this way. */
export interface OfflineStatusAction {
  id: string;
  ticketId: string;
  status: RepairStatus;
  changerName?: string;
  additionalUpdates?: Record<string, unknown> | null;
  timestamp: string;
}

interface StatusPayload {
  ticketId: string;
  status: RepairStatus;
  changerId?: string;
  changerName?: string;
  additionalUpdates?: Record<string, unknown> | null;
  timestamp: string;
}

interface RemarkPayload {
  ticketId: string;
  remark: string;
  updatedAt: string;
}

interface AllocatedPart {
  productId?: string | null;
  name: string;
  cost: number;
  quantity: number;
}

interface PartsPayload {
  ticketId: string;
  parts: AllocatedPart[];
  actorId?: string;
  actorName?: string;
}

interface StockPayload {
  productId: string;
  name: string;
  /** Signed units: negative takes stock off the shelf. */
  delta: number;
  reason: string;
}

const KIND_BASE: Record<QueueKind, string> = {
  ticket: '@offline_tickets',
  sale: '@offline_sales',
  status: '@offline_status_updates',
  debt: '@offline_debts',
  remark: '@offline_remarks',
  parts: '@offline_parts',
  stock: '@offline_stock_deltas',
};

const KINDS = Object.keys(KIND_BASE) as QueueKind[];

const ID_MAP_BASE = '@offline_id_map';
const DEAD_LETTER_BASE = '@offline_dead_letters';
const CACHED_TICKETS_BASE = '@cached_tickets';
const CACHED_PRODUCTS_BASE = '@cached_products';
/** Queue items waiting on a ticket that has not uploaded yet are re-tried, not failed. */
const DEFER_MS = 20_000;

let ownerUid: string | null = null;
let isSyncing = false;
let isSweeping = false;
let seq = 0;

type SyncListener = (pendingCount: number, isSyncing: boolean, droppedCount: number) => void;
const listeners = new Set<SyncListener>();

const owner = () => ownerUid || '__unowned__';
const keyFor = (base: string) => queueKey(base, owner());

const nowMs = () => Date.now();
const nowIso = () => new Date().toISOString();

const newActionId = (kind: QueueKind): string => {
  seq = (seq + 1) % 1_000_000;
  return `${kind}_${nowMs().toString(36)}_${seq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
};

const notifyListeners = async () => {
  const [pending, dropped] = await Promise.all([
    countPending(),
    getDeadLetters().then((d) => d.length),
  ]);
  for (const fn of listeners) {
    try {
      fn(pending, isSyncing, dropped);
    } catch {
      // A broken subscriber must not abort the sync pass.
    }
  }
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err ?? 'Unknown sync failure');

// ─── Storage primitives ────────────────────────────────────────────────────────

const readRaw = async <T>(key: string): Promise<T[]> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const writeRaw = async (key: string, value: unknown): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[OfflineSync] Failed to persist ${key}:`, err);
    return false;
  }
};

const isEnvelope = (value: unknown): value is QueueAction => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.kind === 'string' && 'payload' in v;
};

/**
 * Records queued by the previous build are bare tickets/sales, not envelopes. They
 * are wrapped on read — keeping their offline id as the idempotency key — so an
 * upgrade mid-shift does not lose or duplicate a sale.
 */
const wrapLegacy = (kind: QueueKind, raw: Record<string, unknown>): QueueAction => {
  const recordId = typeof raw.id === 'string' ? raw.id : '';
  const id = recordId ? `act_${kind}_${recordId}` : newActionId(kind);
  const ticketRef =
    kind === 'status' || kind === 'remark' || kind === 'parts'
      ? typeof raw.ticketId === 'string'
        ? raw.ticketId
        : undefined
      : recordId && recordId.startsWith('offline_tkt_')
        ? recordId
        : undefined;

  return {
    id,
    kind,
    payload: raw,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
    attempts: 0,
    nextAttemptAt: 0,
    ticketRef,
  };
};

const loadQueue = async (kind: QueueKind): Promise<QueueAction[]> => {
  const base = KIND_BASE[kind];
  const stored = await readRaw<unknown>(keyFor(base));
  const wrapped = stored.map((item) => (isEnvelope(item) ? (item as QueueAction) : wrapLegacy(kind, item as Record<string, unknown>)));
  return dedupeById(wrapped);
};

const saveQueue = (kind: QueueKind, actions: QueueAction[]): Promise<boolean> =>
  writeRaw(keyFor(KIND_BASE[kind]), actions);

/**
 * Several queues in one bridge call. countPending() used to do a separate AsyncStorage round
 * trip and parse per kind, and it runs on every enqueue — the round trips, not the data, were
 * what made queuing an offline action feel slow. Same semantics as loadQueue(), including the
 * legacy-envelope wrapping and a corrupt entry degrading to an empty queue.
 */
const loadQueues = async (kinds: QueueKind[]): Promise<QueueAction[][]> => {
  const keys = kinds.map((kind) => keyFor(KIND_BASE[kind]));

  let entries: readonly (readonly [string, string | null])[];
  try {
    entries = await AsyncStorage.multiGet(keys);
  } catch (err) {
    console.warn('[OfflineSync] multiGet failed, reading queues individually:', err);
    return Promise.all(kinds.map((kind) => loadQueue(kind)));
  }

  return entries.map(([key, raw], index) => {
    const kind = kinds[index];
    let stored: unknown[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) stored = parsed;
    } catch {
      console.warn(`[OfflineSync] Corrupt queue at ${key}, treated as empty`);
      stored = [];
    }
    const wrapped = stored.map((item) =>
      isEnvelope(item) ? (item as QueueAction) : wrapLegacy(kind, item as Record<string, unknown>)
    );
    return dedupeById(wrapped);
  });
};

const loadAllQueues = (): Promise<QueueAction[][]> => loadQueues(KINDS);

const loadIdMap = async (): Promise<IdMap> => {
  try {
    const raw = await AsyncStorage.getItem(keyFor(ID_MAP_BASE));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as IdMap) : {};
  } catch {
    return {};
  }
};

const saveIdMap = (map: IdMap) => writeRaw(keyFor(ID_MAP_BASE), map);

const getDeadLetters = async (): Promise<DeadLetterEntry[]> =>
  readRaw<DeadLetterEntry>(keyFor(DEAD_LETTER_BASE));

const saveDeadLetters = (entries: DeadLetterEntry[]) =>
  writeRaw(keyFor(DEAD_LETTER_BASE), entries);

const countPending = async (): Promise<number> => {
  const lists = await loadAllQueues();
  return lists.reduce((sum, list) => sum + list.length, 0);
};

// ─── Ownership ─────────────────────────────────────────────────────────────────

/**
 * Moves everything stored under the old device-global keys (and under the bucket
 * used before an account was known) into the signed-in user's queue. The new key
 * is written before the old one is removed, so an interrupted migration leaves the
 * records readable from the legacy key rather than gone.
 */
const migrateLegacyQueues = async (uid: string) => {
  for (const kind of KINDS) {
    const base = KIND_BASE[kind];
    const ownerKey = queueKey(base, uid);
    const merged = dedupeById(await loadQueue(kind));

    for (const legacyKey of [base, unownedKey(base)]) {
      if (legacyKey === ownerKey) continue;
      const legacy = await readRaw<unknown>(legacyKey);
      if (!legacy.length) continue;
      merged.push(
        ...legacy.map((item) =>
          isEnvelope(item) ? (item as QueueAction) : wrapLegacy(kind, item as Record<string, unknown>)
        )
      );
    }

    const unique = dedupeById(merged);
    const wrote = await writeRaw(ownerKey, unique);
    if (!wrote) continue;
    for (const legacyKey of [base, unownedKey(base)]) {
      if (legacyKey !== ownerKey) await AsyncStorage.removeItem(legacyKey);
    }
  }

  // The read-only caches (tickets and the POS product list) are cosmetic, but an
  // offline technician opening the app right after an upgrade should still see the
  // catalogue they cached yesterday.
  for (const cacheBase of [CACHED_TICKETS_BASE, CACHED_PRODUCTS_BASE]) {
    const ownerKey = queueKey(cacheBase, uid);
    const existing = await AsyncStorage.getItem(ownerKey);
    if (existing) continue;
    const legacyValue = await AsyncStorage.getItem(cacheBase);
    if (legacyValue) await AsyncStorage.setItem(ownerKey, legacyValue);
  }
};

// ─── Enqueue ───────────────────────────────────────────────────────────────────

const enqueue = async (action: QueueAction) => {
  const list = await loadQueue(action.kind);
  list.unshift(action);
  await saveQueue(action.kind, dedupeById(list));
  await notifyListeners();
};

const removeActions = async (kind: QueueKind, ids: Set<string>) => {
  const list = await loadQueue(kind);
  await saveQueue(kind, list.filter((a) => !ids.has(a.id)));
};

// ─── Flush ─────────────────────────────────────────────────────────────────────

interface FlushResult {
  synced: number;
  failed: number;
  deferred: number;
  dropped: string[];
}

const emptyResult = (): FlushResult => ({ synced: 0, failed: 0, deferred: 0, dropped: [] });

const parkOrFail = async (
  kind: QueueKind,
  action: QueueAction,
  err: unknown
): Promise<{ result: 'failed' | 'dropped'; list: QueueAction[] }> => {
  const list = await loadQueue(kind);
  const idx = list.findIndex((a) => a.id === action.id);
  const failed = recordFailure(action, nowMs(), errorMessage(err));
  if (idx >= 0) list[idx] = failed;
  else list.push(failed);

  if (shouldDeadLetter(failed)) {
    const dead = await getDeadLetters();
    dead.unshift(toDeadLetter(failed, nowIso()));
    await saveDeadLetters(dedupeById(dead) as DeadLetterEntry[]);
    await saveQueue(kind, list.filter((a) => a.id !== failed.id));
    return { result: 'dropped', list };
  }

  await saveQueue(kind, list);
  return { result: 'failed', list };
};

const deferAction = async (
  kind: QueueKind,
  action: QueueAction,
  reason: string
): Promise<'deferred' | 'dropped'> => {
  const list = await loadQueue(kind);
  const idx = list.findIndex((a) => a.id === action.id);
  if (idx < 0) return 'deferred';

  const { action: deferred, exhausted } = recordDeferral(action, nowMs(), DEFER_MS, reason);
  if (!exhausted) {
    list[idx] = deferred;
    await saveQueue(kind, list);
    return 'deferred';
  }

  // The ticket this waited on is not coming back — it dead-lettered, or the map that joined
  // their ids was cleared. Re-arming it held the pending banner lit, and a billed read every
  // pass, for a change that could never be applied.
  const dead = await getDeadLetters();
  dead.unshift(toDeadLetter(deferred, nowIso()));
  await saveDeadLetters(dedupeById(dead) as DeadLetterEntry[]);
  await saveQueue(kind, list.filter((a) => a.id !== deferred.id));
  return 'dropped';
};

const record = (action: QueueAction): Record<string, unknown> =>
  action.payload && typeof action.payload === 'object'
    ? (action.payload as Record<string, unknown>)
    : {};

const isTicketStillQueued = (idMap: IdMap, ref: string | undefined, queuedTicketIds: Set<string>): boolean => {
  if (!ref) return false;
  const resolved = resolveRef(idMap, ref) as string;
  return queuedTicketIds.has(resolved) || queuedTicketIds.has(ref);
};

/** Tickets first: everything else may reference the id this step creates. */
const flushTickets = async (map: IdMap): Promise<FlushResult> => {
  const out = emptyResult();
  const queue = await loadQueue('ticket');
  const done = new Set<string>();

  for (const action of queue) {
    if (!isDue(action, nowMs())) continue;
    const payload = record(action);
    const tempId = typeof payload.id === 'string' ? payload.id : action.ticketRef || action.id;

    try {
      let body = { ...payload };
      // An offline check-in could not reach the shared counter, so it carries a
      // provisional number; claim a real one now instead of shipping the fallback.
      if (needsTicketNumber(body as { ticketNumber?: unknown; ticketNumberProvisional?: boolean })) {
        try {
          const claimed = await allocateTicketNumber();
          body = {
            ...body,
            ticketNumber: claimed,
            ticketNumberProvisional: false,
            provisionalTicketNumber: body.ticketNumber ?? null,
          };
        } catch (counterErr) {
          // Still upload the repair — a lost ticket is worse than a late number.
          console.warn('[OfflineSync] Could not claim a ticket number yet:', errorMessage(counterErr));
        }
      }

      const { id: _localId, ...dataToSave } = body;

      // A check-in written while the customer only existed on this phone carries a
      // phantom id. Resolve it before the ticket references it — the counter reads
      // the ticket's customer link to put the repair on the right account, and a
      // ticket pointing at a customer the server never had loses its profile. This
      // is the same rule the sale and debt queues run; tickets used to be the one
      // queue that shipped the reference anyway.
      const rawCustomerId = String(dataToSave.customerId || '');
      let resolvedCustomerId: string | undefined;
      if (isOfflineCustomerId(rawCustomerId)) {
        const resolved = await customerService.resolveOfflineCustomer(rawCustomerId);
        if (!resolved) throw new Error(`Customer ${rawCustomerId} not on the server yet`);
        dataToSave.customerId = resolved;
        resolvedCustomerId = resolved;
      }

      const { id: realId } = await addIdempotently('repairs', action.id, dataToSave);

      // Refresh from the live document: an adopted ticket (a previous attempt
      // already committed) may carry fields this queue entry never saw.
      void refreshTrackingMirrorForTicket(realId);

      done.add(action.id);
      out.synced++;

      map[tempId] = realId;
      await saveIdMap(map);
      await removeActions('ticket', new Set([action.id]));

      // Any status/remark/parts action waiting on this temp id is re-pointed now.
      // One multiGet instead of three sequential gets — this ran once per uploaded ticket.
      const dependentKinds: QueueKind[] = ['status', 'remark', 'parts'];
      const dependents = await loadQueues(dependentKinds);
      const rebases = dependentKinds.flatMap((kind, i) => {
        const list = dependents[i];
        const rebased = rebaseActions(list, tempId, realId);
        return rebased.some((a, j) => a !== list[j]) ? [saveQueue(kind, rebased)] : [];
      });
      if (rebases.length > 0) await Promise.all(rebases);

      const cached = await readRaw<RepairTicket>(keyFor(CACHED_TICKETS_BASE));
      if (cached.some((t) => t && t.id === tempId)) {
        await writeRaw(
          keyFor(CACHED_TICKETS_BASE),
          cached.map((t) =>
            t && t.id === tempId
              ? {
                  ...t,
                  id: realId,
                  ...(body.ticketNumber ? { ticketNumber: body.ticketNumber } : {}),
                  ...(resolvedCustomerId ? { customerId: resolvedCustomerId } : {}),
                }
              : t
          )
        );
      }
    } catch (err) {
      const { result } = await parkOrFail('ticket', action, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

const flushStatuses = async (map: IdMap, queuedTicketIds: Set<string>): Promise<FlushResult> => {
  const out = emptyResult();

  for (const action of await loadQueue('status')) {
    if (!isDue(action, nowMs())) {
      out.deferred++;
      continue;
    }
    const payload = record(action);
    const rawRef = typeof payload.ticketId === 'string' ? payload.ticketId : action.ticketRef || '';
    const ticketId = resolveRef(map, rawRef) as string;

    if (!ticketId || ticketId.startsWith('offline_') || isTicketStillQueued(map, rawRef, queuedTicketIds)) {
      const waited = await deferAction('status', action, 'Waiting for the ticket to upload');
      if (waited === 'dropped') out.dropped.push(action.id);
      else out.deferred++;
      continue;
    }

    try {
      const ref = doc(db, 'repairs', ticketId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const { result } = await parkOrFail('status', action, new Error(`Ticket ${ticketId} no longer exists`));
        if (result === 'dropped') out.dropped.push(action.id);
        else out.failed++;
        continue;
      }

      const current = snap.data() as Record<string, unknown>;
      const patch = buildStatusPatch(current, {
        status: (typeof payload.status === 'string' ? payload.status : 'pending') as RepairStatus,
        timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : nowIso(),
        actorId: typeof payload.changerId === 'string' ? payload.changerId : undefined,
        actorName: typeof payload.actorName === 'string' ? payload.actorName : (typeof payload.changerName === 'string' ? payload.changerName : undefined),
        additionalUpdates: (payload.additionalUpdates as Record<string, unknown> | null) ?? null,
      });

      await updateDoc(ref, patch);
      void writeTrackingMirror({ ...current, ...patch } as TrackingMirrorSource);
      await removeActions('status', new Set([action.id]));
      out.synced++;
    } catch (err) {
      const { result } = await parkOrFail('status', action, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

const flushParts = async (map: IdMap, queuedTicketIds: Set<string>): Promise<FlushResult> => {
  const out = emptyResult();

  for (const action of await loadQueue('parts')) {
    if (!isDue(action, nowMs())) {
      out.deferred++;
      continue;
    }
    const payload = record(action);
    const ticketId = resolveRef(map, (payload.ticketId as string) || action.ticketRef) as string;

    if (!ticketId || ticketId.startsWith('offline_') || isTicketStillQueued(map, payload.ticketId as string, queuedTicketIds)) {
      const waited = await deferAction('parts', action, 'Waiting for the ticket to upload');
      if (waited === 'dropped') out.dropped.push(action.id);
      else out.deferred++;
      continue;
    }

    try {
      const ref = doc(db, 'repairs', ticketId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const { result } = await parkOrFail('parts', action, new Error(`Ticket ${ticketId} no longer exists`));
        if (result === 'dropped') out.dropped.push(action.id);
        else out.failed++;
        continue;
      }

      const current = snap.data() as Record<string, unknown>;
      const parts = Array.isArray(payload.parts) ? (payload.parts as AllocatedPart[]) : [];
      const previous = Array.isArray(current.partsUsed)
        ? (current.partsUsed as AllocatedPart[])
        : [];

      // The shelf moves and the action-id stamp land in ONE transaction, so a
      // retry after a crash can neither deduct the same parts twice (delta-first
      // order) nor skip the movement (stamp-first order). A retry whose stamp is
      // already on the document adopts it and moves nothing.
      const { failed } = await commitPartsAllocation(ticketId, action.id, previous, {
        partsUsed: parts.map((p) => ({
          name: p.name,
          cost: Number(p.cost) || 0,
          quantity: Math.max(1, Math.trunc(Number(p.quantity) || 1)),
          productId: p.productId || 'custom-mobile-part',
        })),
        updatedAt: nowIso(),
      });

      if (failed.length) {
        // Park the shelf movement in its own queue; the allocation itself can
        // still land so the ticket is not blocked behind one unknown SKU.
        for (const f of failed) {
          await enqueue({
            id: newActionId('stock'),
            kind: 'stock',
            payload: { productId: f.delta.productId, name: f.delta.name, delta: -f.delta.delta, reason: `Repair ${ticketId} parts` } as StockPayload,
            createdAt: nowIso(),
            attempts: 0,
            nextAttemptAt: 0,
            ticketRef: ticketId,
          });
        }
      }

      await removeActions('parts', new Set([action.id]));
      out.synced++;
    } catch (err) {
      const { result } = await parkOrFail('parts', action, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

const flushRemarks = async (map: IdMap, queuedTicketIds: Set<string>): Promise<FlushResult> => {
  const out = emptyResult();

  for (const action of await loadQueue('remark')) {
    if (!isDue(action, nowMs())) {
      out.deferred++;
      continue;
    }
    const payload = record(action);
    const ticketId = resolveRef(map, (payload.ticketId as string) || action.ticketRef) as string;

    if (!ticketId || ticketId.startsWith('offline_') || isTicketStillQueued(map, payload.ticketId as string, queuedTicketIds)) {
      const waited = await deferAction('remark', action, 'Waiting for the ticket to upload');
      if (waited === 'dropped') out.dropped.push(action.id);
      else out.deferred++;
      continue;
    }

    try {
      const ref = doc(db, 'repairs', ticketId);
      if (!(await getDoc(ref)).exists()) {
        const { result } = await parkOrFail('remark', action, new Error(`Ticket ${ticketId} no longer exists`));
        if (result === 'dropped') out.dropped.push(action.id);
        else out.failed++;
        continue;
      }

      // Last write wins: the technician's note is the newest intent for this field.
      await updateDoc(ref, { remark: String(payload.remark ?? ''), updatedAt: nowIso() });
      void refreshTrackingMirrorForTicket(ticketId);
      await removeActions('remark', new Set([action.id]));
      out.synced++;
    } catch (err) {
      const { result } = await parkOrFail('remark', action, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

const flushStock = async (): Promise<FlushResult> => {
  const out = emptyResult();

  for (const action of await loadQueue('stock')) {
    if (!isDue(action, nowMs())) {
      out.deferred++;
      continue;
    }
    const payload = record(action) as unknown as StockPayload;
    const delta = Math.trunc(Number(payload.delta) || 0);

    if (!payload.productId || delta === 0) {
      await removeActions('stock', new Set([action.id]));
      out.synced++;
      continue;
    }

    try {
      const { failed } = await applyStockLines(
        [{ productId: payload.productId, name: payload.name || payload.productId, quantity: Math.abs(delta) }],
        delta < 0 ? -1 : 1
      );
      // applyStockLines reports per-line failure instead of throwing; a SKU the
      // server does not know must stay queued rather than be counted as synced.
      if (failed.length) {
        const { result } = await parkOrFail('stock', action, new Error(failed[0].error));
        if (result === 'dropped') out.dropped.push(action.id);
        else out.failed++;
        continue;
      }
      await removeActions('stock', new Set([action.id]));
      out.synced++;
    } catch (err) {
      const { result } = await parkOrFail('stock', action, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

/**
 * Carries a renamed invoice's debts with it. A credit sale written offline raises its
 * debt against the clock's guess, and that guess is the only reference either app has
 * to find the pair — renumbering the invoice on its own leaves the balance open on a
 * debt nothing can reach from the receipt. The entry is either still in this phone's
 * queue or already on the server, so both are told.
 */
const repointDebtsToInvoice = async (guess: string, real: string, saleId: string): Promise<void> => {
  const queued = await loadQueue('debt');
  let touched = false;
  const next = queued.map((action) => {
    const updated = debtFollowsInvoice(record(action), guess, real, saleId);
    if (!updated) return action;
    touched = true;
    return { ...action, payload: updated };
  });
  if (touched) await saveQueue('debt', next);

  const found = await getDocs(query(
    collection(db, 'customer_debts'),
    where('invoiceNumber', '==', guess),
    limit(10)
  ));
  for (const row of found.docs) {
    const updated = debtFollowsInvoice(row.data() as Record<string, unknown>, guess, real, saleId);
    if (updated) {
      await updateDoc(row.ref, {
        invoiceNumber: updated.invoiceNumber,
        transactionId: updated.transactionId,
      });
    }
  }
};

const flushSales = async (): Promise<FlushResult> => {
  const out = emptyResult();

  for (const action of await loadQueue('sale')) {
    if (!isDue(action, nowMs())) {
      out.deferred++;
      continue;
    }
    const payload = record(action) as Record<string, unknown>;
    const items = Array.isArray(payload.items) ? (payload.items as CartItem[]) : [];
    // The failure path parks the action it is handed, overwriting what is stored. A
    // number claimed below has to travel on that copy too, or a later step failing
    // would put the pre-claim payload back and the retry would spend a second one.
    let pending = action;

    try {
      const { id: _localId, ...dataToSave } = payload;
      // A sale written while the customer only existed on this phone carries a
      // phantom id. Resolve it to the real document before the invoice references
      // it; when the upload is not possible yet, retry rather than write the
      // reference — a sale pointing at a customer the server never had loses its
      // profile, and the counter reads the profile to know who owes it money.
      const rawCustomerId = String(dataToSave.customerId || '');
      if (isOfflineCustomerId(rawCustomerId)) {
        const resolved = await customerService.resolveOfflineCustomer(rawCustomerId);
        if (!resolved) throw new Error(`Customer ${rawCustomerId} not on the server yet`);
        dataToSave.customerId = resolved;
      }
      // An invoice number minted while offline is a clock-based placeholder, and two
      // overlapping offline sessions can produce the same one. The claim is made
      // against the sale's own day and remembered on the queued action, so a replay of
      // a sale the server already took reuses the number claimed for it instead of
      // spending a second one. An unreachable counter is not a reason to lose the sale:
      // the guess stays on the document, flagged as guessed.
      const guess = String(dataToSave.invoiceNumber || '');
      let claimedNow = false;
      if (needsInvoiceNumber(dataToSave)) {
        const { invoiceNumber: realNumber, provisional } = await claimInvoiceNumber(
          invoiceClaimDate(dataToSave.date, new Date())
        );
        if (!provisional && realNumber !== guess) {
          Object.assign(dataToSave, renumberedInvoice(guess, realNumber));
          claimedNow = true;
          pending = { ...action, payload: { ...payload, ...dataToSave } };
          const queue = await loadQueue('sale');
          await saveQueue('sale', queue.map((queued) => (queued.id === action.id ? pending : queued)));
        }
      }
      // Replayed under the key the sale was written with, not a fresh one: the
      // document this attempt is looking for is the one the till believes failed.
      const { id, created } = await addIdempotently('transactions', replayKeyOf(payload, action.id), {
        ...dataToSave,
        saleType: dataToSave.saleType || 'retail',
      });

      // An adopted document was written by an attempt that never heard back and still
      // carries the guess. Renumber it too, or the number just claimed is held by nothing.
      if (!created && claimedNow) {
        await updateDoc(doc(db, 'transactions', id), {
          invoiceNumber: dataToSave.invoiceNumber,
          invoiceNumberProvisional: false,
          provisionalInvoiceNumber: dataToSave.provisionalInvoiceNumber,
        });
      }

      // The debt follows the receipt it was raised against. This runs on a replay as
      // well as a first claim: an earlier attempt may have renamed the invoice and then
      // failed before the debt was told.
      const renamedFrom = String(dataToSave.provisionalInvoiceNumber || '');
      if (renamedFrom) {
        await repointDebtsToInvoice(renamedFrom, String(dataToSave.invoiceNumber || ''), id);
      }
      const settlement = dataToSave.accountSettlement as SaleTransaction['accountSettlement'];
      const customerId = String(dataToSave.customerId || '');
      const charged = Math.max(0, Number(settlement?.chargedAmount) || 0);

      const lines = items
        .map((item) => ({
          productId: String(item?.product?.id || ''),
          name: String(item?.product?.name || ''),
          quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
        }))
        .filter((l) => l.productId);

      // The shelf and the customer's own numbers move for an adopted invoice too. The
      // till can write the sale and never hear the answer, in which case the document
      // exists and nothing was ever deducted for it — gating this on `created` left
      // exactly those sales off the shelf and off the ledger for good. One transaction
      // reads the stamps it writes, so a pass that already did the work adopts and moves
      // nothing, and a second device cannot deduct the same units again.
      if (lines.length || customerId) {
        const { failed } = await commitSaleEffects(
          id,
          lines,
          customerId
            ? {
                customerId,
                paid: Math.max(0, (Number(dataToSave.total) || 0) - charged),
                charged,
              }
            : undefined
        );
        for (const f of failed) {
          await enqueue({
            id: newActionId('stock'),
            kind: 'stock',
            payload: { productId: f.line.productId, name: f.line.name, delta: -f.line.quantity, reason: `Sale ${id}` } as StockPayload,
            createdAt: nowIso(),
            attempts: 0,
            nextAttemptAt: 0,
          });
        }
      }

      await removeActions('sale', new Set([action.id]));
      out.synced++;
    } catch (err) {
      const { result } = await parkOrFail('sale', pending, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

const flushDebts = async (): Promise<FlushResult> => {
  const out = emptyResult();

  for (const action of await loadQueue('debt')) {
    if (!isDue(action, nowMs())) {
      out.deferred++;
      continue;
    }
    const payload = record(action) as Record<string, unknown>;

    try {
      const { id: _localId, ...dataToSave } = payload;
      const rawCustomerId = String(dataToSave.customerId || '');
      if (isOfflineCustomerId(rawCustomerId)) {
        const resolved = await customerService.resolveOfflineCustomer(rawCustomerId);
        if (!resolved) throw new Error(`Customer ${rawCustomerId} not on the server yet`);
        dataToSave.customerId = resolved;
      }
      await addIdempotently('customer_debts', replayKeyOf(payload, action.id), dataToSave);
      await removeActions('debt', new Set([action.id]));
      out.synced++;
    } catch (err) {
      const { result } = await parkOrFail('debt', action, err);
      if (result === 'dropped') out.dropped.push(action.id);
      else out.failed++;
    }
  }

  return out;
};

/**
 * Finish one invoice the shelf (or the customer's record) never answered for. The numbers
 * it still owes are derived by `unfinishedSaleEffects`, so the sweep and the offline upload
 * agree; a return-line invoice is deferred to the counter's signed sweep, and a failed line
 * is queued durably as the per-line path did.
 */
const finishUnfinishedSale = async (d: { id: string; data: () => Record<string, unknown> }): Promise<boolean> => {
  const { lines, profile, deferred } = unfinishedSaleEffects(d.data());
  if (deferred) return false;

  const { applied, failed, adopted } = await commitSaleEffects(d.id, lines, profile);
  for (const f of failed) {
    await enqueue({
      id: newActionId('stock'),
      kind: 'stock',
      payload: { productId: f.line.productId, name: f.line.name, delta: -f.line.quantity, reason: `Sale ${d.id}` } as StockPayload,
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
    });
  }
  return !adopted && (applied.length > 0 || !!profile);
};

// ─── Public service ────────────────────────────────────────────────────────────

export const offlineSyncService = {
  /**
   * Tells the queue whose device this currently is. Called from the auth listener.
   * Returns once any pre-namespacing data has been folded into this account.
   */
  setQueueOwner: async (uid: string | null): Promise<void> => {
    if (!uid) {
      ownerUid = null;
      await notifyListeners();
      return;
    }
    if (ownerUid === uid) return;
    ownerUid = uid;
    try {
      await migrateLegacyQueues(uid);
    } catch (err) {
      console.warn('[OfflineSync] Legacy queue migration failed:', errorMessage(err));
    }
    await notifyListeners();
  },

  getQueueOwner: (): string | null => ownerUid,

  subscribe: (listener: SyncListener): (() => void) => {
    listeners.add(listener);
    void notifyListeners();
    return () => {
      listeners.delete(listener);
    };
  },

  getPendingCount: async (): Promise<number> => countPending(),

  /** Pending writes belonging to accounts other than the one signed in. */
  getForeignPendingCount: async (): Promise<number> => {
    const keys = await AsyncStorage.getAllKeys();
    const foreign: string[] = [];
    for (const kind of KINDS) {
      const base = KIND_BASE[kind];
      for (const key of keys) {
        if (isOwnerKey(key, base) && key !== keyFor(base)) foreign.push(key);
      }
    }
    if (!foreign.length) return 0;
    const entries = await AsyncStorage.multiGet(foreign);
    return entries.reduce((sum, [, value]) => {
      try {
        const parsed = value ? JSON.parse(value) : [];
        return sum + (Array.isArray(parsed) ? parsed.length : 0);
      } catch {
        return sum;
      }
    }, 0);
  },

  getDroppedCount: async (): Promise<number> => (await getDeadLetters()).length,

  getDroppedActions: async (): Promise<DeadLetterEntry[]> => getDeadLetters(),

  /** Puts a parked action back at the front of its queue with the retry budget reset. */
  retryDroppedAction: async (id: string): Promise<boolean> => {
    const dead = await getDeadLetters();
    const entry = dead.find((d) => d.id === id);
    if (!entry) return false;
    await saveDeadLetters(dead.filter((d) => d.id !== id));
    await enqueue({
      id: entry.id,
      kind: entry.kind,
      payload: entry.payload,
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
      ticketRef: entry.ticketRef,
    });
    await notifyListeners();
    return true;
  },

  dismissDroppedAction: async (id: string): Promise<void> => {
    const dead = await getDeadLetters();
    await saveDeadLetters(dead.filter((d) => d.id !== id));
    await notifyListeners();
  },

  clearDroppedActions: async (): Promise<void> => {
    await saveDeadLetters([]);
    await notifyListeners();
  },

  saveOfflineTicket: async (ticket: RepairTicket): Promise<void> => {
    await enqueue({
      id: newActionId('ticket'),
      kind: 'ticket',
      payload: ticket,
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
      ticketRef: ticket.id,
    });
    const cached = await readRaw<RepairTicket>(keyFor(CACHED_TICKETS_BASE));
    await writeRaw(keyFor(CACHED_TICKETS_BASE), [ticket, ...cached]);
  },

  saveOfflineSale: async (sale: SaleTransaction): Promise<void> => {
    await enqueue({
      id: newActionId('sale'),
      kind: 'sale',
      payload: sale,
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
    });
  },

  saveOfflineDebt: async (debt: CustomerDebtEntry): Promise<void> => {
    await enqueue({
      id: newActionId('debt'),
      kind: 'debt',
      payload: debt,
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
    });
  },

  saveOfflineStatusUpdate: async (
    ticketId: string,
    status: RepairStatus,
    changerName?: string,
    additionalUpdates?: Record<string, unknown> | null,
    changerId?: string
  ): Promise<void> => {
    const payload: StatusPayload = {
      ticketId,
      status,
      changerName,
      changerId,
      additionalUpdates: additionalUpdates ?? null,
      timestamp: nowIso(),
    };
    await enqueue({
      id: newActionId('status'),
      kind: 'status',
      payload,
      createdAt: payload.timestamp,
      attempts: 0,
      nextAttemptAt: 0,
      ticketRef: ticketId,
    });
  },

  /** The remark queue existed in storage but nothing ever wrote to it. */
  saveOfflineRemark: async (ticketId: string, remark: string): Promise<void> => {
    const payload: RemarkPayload = { ticketId, remark, updatedAt: nowIso() };
    await enqueue({
      id: newActionId('remark'),
      kind: 'remark',
      payload,
      createdAt: payload.updatedAt,
      attempts: 0,
      nextAttemptAt: 0,
      ticketRef: ticketId,
    });
  },

  /** Parts that were saved while offline: the shelf count moves when they upload. */
  saveOfflineParts: async (
    ticketId: string,
    parts: AllocatedPart[],
    actor?: { id?: string; name?: string }
  ): Promise<void> => {
    const payload: PartsPayload = { ticketId, parts, actorId: actor?.id, actorName: actor?.name };
    await enqueue({
      id: newActionId('parts'),
      kind: 'parts',
      payload,
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
      ticketRef: ticketId,
    });
  },

  /**
   * A stock movement the server never saw. Unlike a sale there is no document to
   * stamp with an idempotency key, so the queue entry is deleted immediately after
   * the transaction commits — the window for a double apply is one await.
   */
  saveOfflineStockDelta: async (line: StockPayload): Promise<void> => {
    const delta = Math.trunc(Number(line.delta) || 0);
    if (!line.productId || delta === 0) return;
    await enqueue({
      id: newActionId('stock'),
      kind: 'stock',
      payload: { ...line, delta },
      createdAt: nowIso(),
      attempts: 0,
      nextAttemptAt: 0,
    });
  },

  setCachedTickets: async (tickets: RepairTicket[]): Promise<void> => {
    await writeRaw(keyFor(CACHED_TICKETS_BASE), tickets);
  },

  getCachedTickets: async (): Promise<RepairTicket[]> =>
    readRaw<RepairTicket>(keyFor(CACHED_TICKETS_BASE)),

  setCachedProducts: async (products: PhoneModel[]): Promise<void> => {
    await writeRaw(keyFor(CACHED_PRODUCTS_BASE), products);
  },

  getCachedProducts: async (): Promise<PhoneModel[]> =>
    readRaw<PhoneModel>(keyFor(CACHED_PRODUCTS_BASE)),

  /**
   * Master sync runner. The queue is checked locally FIRST: a device with nothing
   * pending makes no Firestore request at all, which is what keeps the heartbeat
   * affordable on the Spark plan's read quota.
   */
  /**
   * Finish invoices whose shelf movement was interrupted.
   * =====================================================
   * A sale written online and then crashed leaves `stockApplied:false` on the server and
   * NOTHING in the local queue, so the pending-count gate that drives syncAll would never
   * look at it. This sweep queries the stamps directly and completes each such invoice once,
   * through the same transaction that stamps it, so a second pass — or the counter's own
   * sweep — adopts instead of deducting again.
   *
   * Two single-field equality reads, no composite index: the stock stamp catches every
   * interrupted sale, and the profile stamp catches a phone sale whose shelf the counter
   * already finished, so its customer's own numbers are not left orphaned. Only documents
   * that carry a stamp and still say false are reached — invoices written before the stamps
   * existed have no field, so old history is never deducted twice. Bounded to keep one pass
   * cheap on the Spark plan, and run on load and foreground, never on the heartbeat.
   */
  sweepUnfinishedSales: async (): Promise<number> => {
    if (isSweeping) return 0;
    isSweeping = true;
    let healed = 0;
    try {
      const seen = new Set<string>();
      for (const stamp of ['stockApplied', 'profileApplied'] as const) {
        const snap = await getDocs(
          query(collection(db, 'transactions'), where(stamp, '==', false), limit(50))
        );
        for (const d of snap.docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          try {
            if (await finishUnfinishedSale(d)) healed++;
          } catch (err) {
            console.warn(`[OfflineSync] Could not finish sale ${d.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.warn('[OfflineSync] Unfinished-sale sweep failed:', err);
    } finally {
      isSweeping = false;
    }
    return healed;
  },

  syncAll: async (): Promise<{ syncedCount: number; errors: boolean; droppedCount: number }> => {
    if (isSyncing) return { syncedCount: 0, errors: false, droppedCount: 0 };

    const initialPending = await countPending();
    if (initialPending === 0) return { syncedCount: 0, errors: false, droppedCount: 0 };

    try {
      await getDocs(query(collection(db, 'repairs'), limit(1)));
    } catch {
      return { syncedCount: 0, errors: false, droppedCount: 0 };
    }

    isSyncing = true;
    await notifyListeners();

    let syncedCount = 0;
    let failedCount = 0;
    let droppedCount = 0;

    try {
      const map = await loadIdMap();
      const queuedTicketIds = new Set(
        (await loadQueue('ticket'))
          .map((a) => {
            const payload = record(a) as Record<string, unknown>;
            return typeof payload.id === 'string' ? payload.id : a.ticketRef;
          })
          .filter((id): id is string => !!id)
      );

      const results: Record<QueueKind, FlushResult> = {
        ticket: await flushTickets(map),
        status: emptyResult(),
        parts: emptyResult(),
        remark: emptyResult(),
        stock: emptyResult(),
        sale: emptyResult(),
        debt: emptyResult(),
      };

      results.status = await flushStatuses(map, queuedTicketIds);
      results.parts = await flushParts(map, queuedTicketIds);
      results.remark = await flushRemarks(map, queuedTicketIds);
      results.stock = await flushStock();
      results.sale = await flushSales();
      results.debt = await flushDebts();

      for (const kind of KINDS) {
        syncedCount += results[kind].synced;
        failedCount += results[kind].failed;
        droppedCount += results[kind].dropped.length;
      }

      if (syncedCount) console.log(`[OfflineSync] Uploaded ${syncedCount} queued item(s).`);
      if (droppedCount) {
        console.warn(
          `[OfflineSync] ${droppedCount} action(s) failed ${MAX_ATTEMPTS} times and are parked for an admin to redo.`
        );
      }
    } finally {
      isSyncing = false;
      await notifyListeners();
    }

    return { syncedCount, errors: failedCount > 0, droppedCount };
  },

  /**
   * Heartbeat. Slower than the previous 15s and paired with an app-foreground
   * trigger, because the queue is checked locally before any network call.
   */
  init: (): (() => void) => {
    void offlineSyncService.syncAll();
    // A crash since the last session may have left an invoice the shelf never answered for.
    // Nothing is queued for it, so sweep on load regardless of the pending count.
    void offlineSyncService.sweepUnfinishedSales();

    const intervalId = setInterval(() => {
      void offlineSyncService.syncAll();
    }, 60_000);

    const stateSubscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (status === 'active') {
          void offlineSyncService.syncAll();
          // Returning to the app is the moment to finish an interrupted online sale, which
          // the pending-count gate cannot see. Not on the heartbeat: that would spend reads
          // every minute on a query that is almost always empty.
          void offlineSyncService.sweepUnfinishedSales();
        }
      }
    );

    return () => {
      clearInterval(intervalId);
      stateSubscription.remove();
    };
  },
};
