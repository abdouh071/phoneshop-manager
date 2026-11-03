/**
 * A Firestore listener is billed for every document it re-sends, so two live
 * listeners on the same query silently double the read cost of every write in the
 * shop. Screens mount and unmount constantly, and an app-wide subscription plus a
 * screen subscription easily end up coexisting; this keeps exactly one stream open
 * for as long as at least one holder wants it.
 */
export interface RefCountedSubscription {
  /** Opens the stream if nothing holds it yet. Returns the matching release. */
  acquire: () => () => void;
  /** Close and re-open the stream so the server sends a full fresh copy. No-op when nothing holds it. */
  restart: () => void;
  /** Holders currently asking for the stream to stay open. */
  holders: () => number;
  isLive: () => boolean;
}

export const createRefCountedSubscription = (attach: () => () => void): RefCountedSubscription => {
  let refcount = 0;
  let unsubscribe: (() => void) | null = null;

  const release = () => {
    refcount = Math.max(0, refcount - 1);
    if (refcount === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  return {
    acquire: () => {
      refcount += 1;
      if (!unsubscribe) unsubscribe = attach();
      return release;
    },
    restart: () => {
      if (!unsubscribe) return;
      unsubscribe();
      unsubscribe = attach();
    },
    holders: () => refcount,
    isLive: () => unsubscribe !== null,
  };
};
