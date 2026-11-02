/**
 * Idempotent replay of records created while offline.
 * ====================================================
 * Ported from the desktop app's helper of the same name so both clients write the
 * same `idempotencyKey` stamp and the same duplicate rule.
 *
 * A device that created a sale offline uploads it with `addDoc`, then rewrites its
 * local queue. If the app is killed in that window the record is still queued with
 * its `offline_tx_…` id and the next sync posts a SECOND sale — and deducts stock
 * twice. Stamping the minted id and looking it up first turns a replay into an
 * adoption of the document that already exists.
 *
 * A failed lookup propagates rather than being treated as "not found": the caller
 * leaves the record queued, so the worst case is a retry, never a duplicate.
 */
import { addDoc, collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

/** Looks a replayed record up by its key. Returns null only when the lookup succeeded and found nothing. */
export const findExistingDocId = async (
  collectionName: string,
  field: string,
  value: string | undefined | null
): Promise<string | null> => {
  if (!value) return null;
  const snap = await getDocs(
    query(collection(db, collectionName), where(field, '==', value), limit(1))
  );
  return snap.empty ? null : snap.docs[0].id;
};

/**
 * Adds `data` under `collectionName` unless a document carrying the same key
 * already exists — in which case that document's id is returned and nothing is
 * written.
 *
 * `created` is part of the result because the caller often has a follow-up side
 * effect that must happen exactly once — a replayed sale that adopts an existing
 * document must NOT deduct stock a second time.
 */
export const addIdempotently = async (
  collectionName: string,
  idempotencyKey: string,
  data: Record<string, unknown>
): Promise<{ id: string; created: boolean }> => {
  const existingId = await findExistingDocId(collectionName, 'idempotencyKey', idempotencyKey);
  if (existingId) return { id: existingId, created: false };

  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    idempotencyKey,
    syncedAt: new Date().toISOString(),
  });
  return { id: docRef.id, created: true };
};

/**
 * `addIdempotently` writes a `syncedAt` the caller may want to override (a replay
 * of a sale dated three days ago must keep its own date), so it is exposed here
 * rather than hard-coded at the call site.
 */
export const buildReplayPayload = (
  record: Record<string, unknown>,
  idempotencyKey: string
): Record<string, unknown> => {
  const { id: _localId, ...rest } = record;
  return { ...rest, idempotencyKey };
};
