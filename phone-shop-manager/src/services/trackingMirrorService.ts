import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  TRACKING_MIRROR_COLLECTION,
  buildTrackingMirror,
  mirrorIdOf,
  type TrackingMirrorPayload,
  type TrackingMirrorSource,
} from '../utils/trackingMirror';

// Mirror maintenance is best-effort by design: the repair write is the shop's
// source of truth and must never fail because a derived public copy could not
// be written. A missed refresh is healed by the next mutation of that ticket
// or by the admin rebuild (backfillTrackingMirrors).

export const writeTrackingMirror = async (ticket: TrackingMirrorSource): Promise<void> => {
  try {
    const mirror = await buildTrackingMirror(ticket);
    if (!mirror) return;
    await setDoc(doc(db, TRACKING_MIRROR_COLLECTION, mirror.id), mirror.payload);
  } catch (err) {
    console.warn('[TrackingMirror] Public copy not written (rebuild heals it):', err);
  }
};

export const deleteTrackingMirrorFor = async (ticket: TrackingMirrorSource): Promise<void> => {
  try {
    const id = await mirrorIdOf(ticket);
    if (!id) return;
    await deleteDoc(doc(db, TRACKING_MIRROR_COLLECTION, id));
  } catch (err) {
    console.warn('[TrackingMirror] Public copy not deleted (rebuild heals it):', err);
  }
};

/**
 * Re-read the live ticket after a mutation and rewrite its public copy. When the
 * pre-write ticket is known and its mirror id changed (the phone behind a legacy
 * last-4 PIN was edited), the old id is deleted so the old PIN stops answering.
 */
export const refreshTrackingMirrorById = async (
  ticketId: string,
  previous?: TrackingMirrorSource
): Promise<void> => {
  try {
    const snap = await getDoc(doc(db, 'repairs', ticketId));
    if (!snap.exists()) {
      if (previous) await deleteTrackingMirrorFor(previous);
      return;
    }
    const live = snap.data() as TrackingMirrorSource;
    if (previous) {
      const oldId = await mirrorIdOf(previous);
      const newId = await mirrorIdOf(live);
      if (oldId && oldId !== newId) {
        await deleteDoc(doc(db, TRACKING_MIRROR_COLLECTION, oldId));
      }
    }
    await writeTrackingMirror(live);
  } catch (err) {
    console.warn('[TrackingMirror] Public copy not refreshed (rebuild heals it):', err);
  }
};

export interface TrackingBackfillResult {
  mirrored: number;
  removed: number;
  skipped: number;
}

/**
 * Admin-gated rebuild: rewrite every trackable ticket's public copy, then delete
 * mirror documents whose ticket is gone or whose PIN changed. Idempotent — run
 * it right after the rules deploy, after a backup restore, and after the phones
 * have taken the update that writes mirrors.
 */
export const backfillTrackingMirrors = async (): Promise<TrackingBackfillResult> => {
  const ticketsSnap = await getDocs(collection(db, 'repairs'));
  const expected = new Map<string, { id: string; payload: TrackingMirrorPayload }>();
  let skipped = 0;
  for (const d of ticketsSnap.docs) {
    const mirror = await buildTrackingMirror(d.data() as TrackingMirrorSource);
    if (!mirror) {
      skipped++;
      continue;
    }
    expected.set(mirror.id, mirror);
  }

  let mirrored = 0;
  const entries = Array.from(expected.values());
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    for (const mirror of entries.slice(i, i + 400)) {
      batch.set(doc(db, TRACKING_MIRROR_COLLECTION, mirror.id), mirror.payload);
    }
    await batch.commit();
    mirrored += Math.min(400, entries.length - i);
  }

  const mirrorsSnap = await getDocs(collection(db, TRACKING_MIRROR_COLLECTION));
  const orphans = mirrorsSnap.docs.filter((d) => !expected.has(d.id));
  let removed = 0;
  for (let i = 0; i < orphans.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of orphans.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
    removed += Math.min(400, orphans.length - i);
  }

  return { mirrored, removed, skipped };
};