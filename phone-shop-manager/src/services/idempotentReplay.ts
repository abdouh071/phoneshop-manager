/**
 * Idempotent replay of records created while offline.
 * ====================================================
 * Every document written during replay is stamped with `idempotencyKey` — the key the
 * record was created with, which for a sale, a debt, a customer log, a product or a
 * repair ticket is minted before its first write and falls back to the temporary id
 * (offline_tx_…, offline_debt_…, offline_log_…, offline_prod_…, offline_tkt_…) when a
 * record predates that rule.
 *
 * Without it the replay is a bare addDoc followed by a localStorage rewrite, so a crash
 * (or a killed app) in that window leaves the record still carrying its offline_ id and
 * the next sync posts a second copy of the same sale, debt or log. With it, a re-run
 * finds the document by its key and adopts the real id instead of adding a duplicate.
 *
 * The key has to exist on the document the *online* write produced. A 2.5-second race
 * can lose a write that the server actually committed, and the copy stored in that
 * case is otherwise unrecognisable: the replay would look for a key no document has.
 *
 * A failed lookup propagates rather than being treated as "not found": the caller leaves
 * the record queued, so the worst case is a retry, never a duplicate.
 */
import { addDoc, collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

/** Looks a replayed record up by a natural key. Returns null only when the lookup succeeded and found nothing. */
export const findExistingDocId = async (
  collectionName: string,
  field: string,
  value: string | undefined | null
): Promise<string | null> => {
  if (!value) return null;
  const snap = await getDocs(query(collection(db, collectionName), where(field, '==', value), limit(1)));
  return snap.empty ? null : snap.docs[0].id;
};

/**
 * A dedupe key, minted once — before the record's first write, never at the replay.
 *
 * The counter stamps it on the document it creates and keeps it on the local copy it
 * stores when the write appears to fail. That is the only way a replay can tell "the
 * server saved this sale and the counter never heard" apart from "this sale never
 * happened": a document written without a key on it matches nothing.
 */
export const newIdempotencyKey = (kind: 'tx' | 'debt' | 'log' | 'product' | 'ticket'): string =>
  `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * The key a record actually replays under: its own stamp when it carries one, the
 * temporary id when it does not. Records already sitting in localStorage from before
 * the stamp existed keep replaying on the old rule — which can duplicate, never drop.
 */
export const replayKeyOf = (record: { idempotencyKey?: unknown }, tempId: string): string =>
  typeof record.idempotencyKey === 'string' && record.idempotencyKey
    ? record.idempotencyKey
    : tempId;

/**
 * Adds `data` under `collectionName`, unless a document carrying the same idempotencyKey
 * already exists — in which case that document's id is returned and nothing is written.
 */
export const addIdempotently = async (
  collectionName: string,
  idempotencyKey: string,
  data: Record<string, unknown>
): Promise<string> => {
  const existingId = await findExistingDocId(collectionName, 'idempotencyKey', idempotencyKey);
  if (existingId) return existingId;

  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    idempotencyKey,
    syncedAt: new Date().toISOString(),
  });
  return docRef.id;
};
