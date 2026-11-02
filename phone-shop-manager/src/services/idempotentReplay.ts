/**
 * Idempotent replay of records created while offline.
 * ====================================================
 * Every document written during replay is stamped with `idempotencyKey`, the temporary
 * id the device minted when the record was created offline (offline_tx_…, offline_tkt_…).
 *
 * Without it the replay is a bare addDoc followed by a localStorage rewrite, so a crash
 * (or a killed app) in that window leaves the record still carrying its offline_ id and
 * the next sync posts a second copy of the same sale, debt or log. With it, a re-run
 * finds the document by its key and adopts the real id instead of adding a duplicate.
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
