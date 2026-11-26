/**
 * Durable mirror for the offline sync queues
 * ==========================================
 * localStorage is and stays the synchronous source of truth for every queue read — no
 * call site in the POS money path becomes async because of this file. What it adds is a
 * second, checksummed copy of each queue in IndexedDB, whose quota is measured in tens of
 * megabytes instead of five, plus a boot-time restore that picks whichever copy is trustworthy.
 *
 * The failure this exists to prevent is quiet: localStorage.setItem throws once the bucket is
 * full, every queue save from that moment fails, the old copy keeps serving reads so nothing
 * looks broken, and the queued sales, stock deltas and customer syncs that "disappeared" are
 * never seen again. Restoring from the mirror recovers them.
 *
 * A copy is trusted only when its recorded checksum matches its own bytes and the bytes
 * parse. A trusted mirror is adopted only when localStorage is unusable or the mirror is
 * *strictly newer* — so a half-finished mirror write can never resurrect data that was
 * already synced away. restoreAll() resolves inside a bounded budget even if IndexedDB never
 * answers, and leaves every queue exactly as it found it when there is nothing to adopt.
 */

const DB_NAME = 'pshop_offline_queues';
const STORE_NAME = 'queues';
const DB_VERSION = 1;

/** localStorage key suffix holding `<checksum>|<savedAt>` for the queue beside it. */
const CHECKSUM_SUFFIX = '__sum';

/**
 * Upper bound on the boot restore. IndexedDB can stall on a locked or corrupt database,
 * and sync must not wait on it: past the budget the queues simply keep the localStorage
 * copy they already have.
 */
const RESTORE_BUDGET_MS = 2500;

export type MirroredQueueKey =
  | 'offline_action_queue'
  | 'offline_pending_products'
  | 'offline_pending_stock_adjustments'
  | 'offline_customer_sync_queue'
  | 'offline_dead_letters'
  | 'parts_checkout_journal'
  | 'retail_checkout_journal'
  | 'sale_refund_journal'
  | 'sale_edit_journal';

export const MIRRORED_QUEUE_KEYS: readonly MirroredQueueKey[] = [
  'offline_action_queue',
  'offline_pending_products',
  'offline_pending_stock_adjustments',
  'offline_customer_sync_queue',
  'offline_dead_letters',
  'parts_checkout_journal',
  'retail_checkout_journal',
  'sale_refund_journal',
  'sale_edit_journal',
];

export interface QueueCopy {
  raw: string;
  /** Checksum recorded when this copy was saved, not recomputed from the bytes. */
  checksum: string;
  /** ms epoch of the save, or null when no stamp was recorded alongside it. */
  savedAt: number | null;
  /** True only when the checksum matches these bytes AND the bytes parse as JSON. */
  verified: boolean;
}

export type AdoptReason = 'local_missing' | 'local_corrupt' | 'mirror_newer';

export type RestoreDecision =
  | { action: 'keep_local' }
  | { action: 'adopt_mirror'; reason: AdoptReason };

/**
 * Which copy of a queue survives boot.
 *
 * Mirrored data is only ever adopted when it is strictly newer, or when the localStorage
 * copy cannot be used at all. Ties go to localStorage: a healthy save stamps both copies
 * with the same instant, so treating ties as "keep local" is what stops an already-synced
 * queue from being refilled from an older mirror.
 */
export const decideWhichCopyWins = (
  local: QueueCopy | null,
  mirror: QueueCopy | null,
): RestoreDecision => {
  if (!mirror || !mirror.verified) return { action: 'keep_local' };
  if (!local) return { action: 'adopt_mirror', reason: 'local_missing' };
  if (!local.verified) return { action: 'adopt_mirror', reason: 'local_corrupt' };
  if (local.checksum === mirror.checksum) return { action: 'keep_local' };
  if (local.savedAt === null) return { action: 'keep_local' };
  if (mirror.savedAt !== null && mirror.savedAt > local.savedAt) {
    return { action: 'adopt_mirror', reason: 'mirror_newer' };
  }
  return { action: 'keep_local' };
};

/** FNV-1a, 32 bit. Cheap, dependency-free, and enough to spot a torn or truncated write. */
export const checksumOf = (raw: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const parsesAsJson = (raw: string): boolean => {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
};

interface MirrorRecord {
  key: string;
  raw: string;
  checksum: string;
  savedAt: number;
}

type RestoreListener = () => void;

const restoreListeners = new Set<RestoreListener>();

let dbPromise: Promise<IDBDatabase | null> | null = null;
let available = true;
let failures = 0;
let lastError: string | null = null;
let restoredCount = 0;
let adoptCountByReason: Record<AdoptReason, number> = {
  local_missing: 0,
  local_corrupt: 0,
  mirror_newer: 0,
};

function noteFailure(where: string, error?: unknown): void {
  failures++;
  lastError = error === undefined
    ? where
    : `${where}: ${error instanceof Error ? error.message : String(error)}`;
  console.warn(`[OfflineQueueMirror] ${lastError}`);
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        available = false;
        noteFailure('IndexedDB is unavailable in this browser');
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        available = false;
        noteFailure('Failed to open the queue mirror database', request.error);
        resolve(null);
      };
      request.onblocked = () => {
        available = false;
        noteFailure('Opening the queue mirror database was blocked');
        resolve(null);
      };
    } catch (e) {
      available = false;
      noteFailure('Failed to open the queue mirror database', e);
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * Each operation reports failure exactly once. IndexedDB fires `error` on the request,
 * bubbles it to the transaction and then aborts it, so watching both `onerror` and
 * `onabort` would count one broken transaction twice — `onabort` alone is the signal that
 * always arrives, and carries the error. A read that fails resolves null — "no mirror" and
 * "mirror unavailable" both mean there is nothing to adopt.
 */
const readMirrorRecord = async (key: MirroredQueueKey): Promise<MirrorRecord | null> => {
  const database = await openDb();
  if (!database) return null;
  return new Promise(resolve => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as MirrorRecord | undefined) ?? null);
      transaction.onabort = () => {
        noteFailure(`Mirror read of ${key} aborted`, transaction.error);
        resolve(null);
      };
    } catch (e) {
      noteFailure(`Mirror read of ${key} threw`, e);
      resolve(null);
    }
  });
};

const writeMirrorRecord = async (record: MirrorRecord): Promise<void> => {
  const database = await openDb();
  if (!database) return;
  await new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = finish;
      transaction.onabort = () => {
        noteFailure(`Failed to mirror ${record.key}`, transaction.error);
        finish();
      };
    } catch (e) {
      noteFailure(`Mirror write of ${record.key} threw`, e);
      finish();
    }
  });
};

const deleteMirrorRecord = async (key: MirroredQueueKey): Promise<void> => {
  const database = await openDb();
  if (!database) return;
  await new Promise<void>(resolve => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => {
        noteFailure(`Failed to delete mirrored ${key}`, transaction.error);
        resolve();
      };
    } catch (e) {
      noteFailure(`Mirror delete of ${key} threw`, e);
      resolve();
    }
  });
};

function safeReadItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    noteFailure(`Failed to read ${key} from localStorage`, e);
    return null;
  }
}

function readLocalCopy(key: MirroredQueueKey): QueueCopy | null {
  const raw = safeReadItem(key);
  if (raw === null) return null;

  let checksum = '';
  let savedAt: number | null = null;
  try {
    const stamp = localStorage.getItem(`${key}${CHECKSUM_SUFFIX}`);
    if (stamp) {
      const [sum, at] = stamp.split('|');
      checksum = sum ?? '';
      const parsedAt = Number(at);
      savedAt = Number.isFinite(parsedAt) ? parsedAt : null;
    }
  } catch {
    // A missing stamp only weakens the recency comparison; the bytes are still readable.
  }

  return {
    raw,
    checksum,
    savedAt,
    verified: checksum === checksumOf(raw) && parsesAsJson(raw),
  };
}

async function restoreOne(key: MirroredQueueKey): Promise<AdoptReason | null> {
  const local = readLocalCopy(key);
  const record = await readMirrorRecord(key);

  const mirror: QueueCopy | null = record
    ? {
        raw: record.raw,
        checksum: record.checksum,
        savedAt: typeof record.savedAt === 'number' ? record.savedAt : null,
        verified: record.checksum === checksumOf(record.raw) && parsesAsJson(record.raw),
      }
    : null;

  const decision = decideWhichCopyWins(local, mirror);
  if (decision.action === 'keep_local') return null;
  if (!mirror) return null;

  // The mirror read was awaited, so a queue can have been written while this restore was in
  // flight. Re-check the bytes actually in localStorage before overwriting them: anything that
  // changed under us is newer than the mirror can know about, and losing it is the bug here.
  const localRawBefore = local ? local.raw : null;
  if (safeReadItem(key) !== localRawBefore) return null;

  try {
    localStorage.setItem(key, mirror.raw);
    localStorage.setItem(`${key}${CHECKSUM_SUFFIX}`, `${mirror.checksum}|${mirror.savedAt ?? 0}`);
  } catch (e) {
    noteFailure(`Failed to restore ${key} into localStorage`, e);
    return null;
  }

  adoptCountByReason[decision.reason]++;
  restoredCount++;
  return decision.reason;
}

export interface MirrorRestoreReport {
  restored: Array<{ key: MirroredQueueKey; reason: AdoptReason }>;
  timedOut: boolean;
  elapsedMs: number;
}

export const offlineQueueMirror = {
  /**
   * Write-through for a queue the caller has just persisted to localStorage.
   *
   * Synchronous to the caller: it records the companion checksum inline and lets the
   * IndexedDB transaction run behind it. Never throws — a mirror that cannot be written
   * must not take the queue save (and therefore the offline sale) down with it.
   */
  write(key: MirroredQueueKey, raw: string): void {
    const savedAt = Date.now();
    const checksum = checksumOf(raw);
    try {
      localStorage.setItem(`${key}${CHECKSUM_SUFFIX}`, `${checksum}|${savedAt}`);
    } catch (e) {
      noteFailure(`Failed to stamp the checksum for ${key}`, e);
    }
    void writeMirrorRecord({ key, raw, checksum, savedAt });
  },

  /** Drops the mirror copy beside a queue the caller cleared from localStorage. */
  clear(key: MirroredQueueKey): void {
    try {
      localStorage.removeItem(`${key}${CHECKSUM_SUFFIX}`);
    } catch {
      // best effort
    }
    void deleteMirrorRecord(key);
  },

  /**
   * Adopts the mirror copy wherever localStorage lost or stale-aged a queue.
   * Always resolves within the restore budget, even if IndexedDB never answers.
   */
  restoreAll: async (): Promise<MirrorRestoreReport> => {
    const startedAt = Date.now();
    const report: MirrorRestoreReport = { restored: [], timedOut: false, elapsedMs: 0 };
    let timedOut = false;

    const work = (async () => {
      for (const key of MIRRORED_QUEUE_KEYS) {
        try {
          const reason = await restoreOne(key);
          if (reason) report.restored.push({ key, reason });
        } catch (e) {
          noteFailure(`Restore of ${key} failed`, e);
        }
      }
    })();

    const budget = new Promise<void>(resolve =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, RESTORE_BUDGET_MS),
    );

    await Promise.race([work, budget]);

    report.timedOut = timedOut;
    report.elapsedMs = Date.now() - startedAt;
    if (report.restored.length > 0) {
      restoreListeners.forEach(fn => {
        try {
          fn();
        } catch (e) {
          console.error('[OfflineQueueMirror] Restore listener error:', e);
        }
      });
    }
    return report;
  },

  /** Called by queue owners so their pending-count subscribers re-read after a restore. */
  onRestored(listener: RestoreListener): () => void {
    restoreListeners.add(listener);
    return () => {
      restoreListeners.delete(listener);
    };
  },

  /** Read by the admin surface: is the durable copy actually working, and did it save us? */
  stats(): {
    available: boolean;
    failures: number;
    lastError: string | null;
    restoredQueues: number;
    restoreByReason: Record<AdoptReason, number>;
  } {
    return {
      available,
      failures,
      lastError,
      restoredQueues: restoredCount,
      restoreByReason: { ...adoptCountByReason },
    };
  },
};
