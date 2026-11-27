import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  TRACKING_MIRROR_COLLECTION,
  buildTrackingMirror,
  type TrackingMirrorSource,
} from '../utils/trackingMirror';

// Best-effort by design: the repair write is the shop's source of truth and must
// never fail because a derived public copy could not be written. A missed refresh
// is healed by the next mutation of that ticket or by the desktop admin rebuild.

export const writeTrackingMirror = async (ticket: TrackingMirrorSource): Promise<void> => {
  try {
    const mirror = await buildTrackingMirror(ticket);
    if (!mirror) return;
    await setDoc(doc(db, TRACKING_MIRROR_COLLECTION, mirror.id), mirror.payload);
  } catch (err) {
    console.warn('[TrackingMirror] Public copy not written (desktop rebuild heals it):', err);
  }
};

/** For write points that did not read the live document first (remarks). */
export const refreshTrackingMirrorForTicket = async (ticketId: string): Promise<void> => {
  try {
    const snap = await getDoc(doc(db, 'repairs', ticketId));
    if (!snap.exists()) return;
    await writeTrackingMirror(snap.data() as TrackingMirrorSource);
  } catch (err) {
    console.warn('[TrackingMirror] Public copy not refreshed (desktop rebuild heals it):', err);
  }
};