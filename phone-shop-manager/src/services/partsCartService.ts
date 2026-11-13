import {
  collection,
  doc,
  getDocsFromServer,
  getDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CartItem, SuspendedCart } from '../types';

const PARTS_SUSPENDED_COLLECTION = 'parts_suspended_carts';
const PARTS_ACTIVE_CART_DOC = 'parts_active_cart';
const CARTS_COLLECTION = 'carts';

// Helper to remove any undefined properties which cause Firestore setDoc/addDoc to throw errors
const cleanForFirestore = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

const SUSPENDED_SYNC_KEY = 'parts_suspended_carts_sync_v1';

type SuspendedMutation =
  | { type: 'upsert'; id: string; cart: SuspendedCart }
  | { type: 'delete'; id: string };

interface SuspendedSyncState {
  pending: SuspendedMutation[];
  observedIds: string[];
  mirror: SuspendedCart[];
}

let suspendedSyncState: SuspendedSyncState | undefined;
let suspendedOperations: Promise<void> = Promise.resolve();

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;
const isCart = (value: unknown): value is SuspendedCart =>
  !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string';

const getSuspendedSyncState = (): SuspendedSyncState => {
  if (suspendedSyncState) return suspendedSyncState;
  const raw = localStorage.getItem(SUSPENDED_SYNC_KEY);
  if (!raw) {
    suspendedSyncState = { pending: [], observedIds: [], mirror: [] };
  } else {
    const parsed = JSON.parse(raw) as SuspendedSyncState;
    // A broken journal must not be silently replaced with an empty one.
    if (!parsed || !Array.isArray(parsed.pending) || !Array.isArray(parsed.observedIds)
      || !Array.isArray(parsed.mirror) || !parsed.mirror.every(isCart)
      || !parsed.observedIds.every(id => typeof id === 'string')
      || !parsed.pending.every(mutation => mutation && typeof mutation.id === 'string'
        && (mutation.type === 'delete' || (mutation.type === 'upsert'
          && isCart(mutation.cart) && mutation.cart.id === mutation.id)))) {
      throw new Error('Invalid parts suspended cart sync journal');
    }
    suspendedSyncState = parsed;
  }
  return suspendedSyncState;
};

const persistSuspendedSyncState = (state: SuspendedSyncState) => {
  localStorage.setItem(SUSPENDED_SYNC_KEY, JSON.stringify(state));
};

const serializeSuspendedOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = suspendedOperations.then(operation);
  // A caller's rejected operation must not poison replay or create a detached rejection.
  suspendedOperations = result.then(() => undefined, () => undefined);
  return result;
};

const sortSuspendedCarts = (carts: SuspendedCart[]) => carts.sort(
  (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
);

const readLocalSuspendedCarts = (): SuspendedCart[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PARTS_SUSPENDED_COLLECTION) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isCart) : [];
  } catch (error) {
    console.error('Failed to read local parts suspended carts', error);
    return [];
  }
};

const reconcileSuspendedCarts = (
  state: SuspendedSyncState,
  localCarts: SuspendedCart[],
  remoteCarts?: SuspendedCart[]
): SuspendedCart[] => {
  const observed = new Set(state.observedIds);
  const merged = new Map<string, SuspendedCart>();
  // Unknown legacy carts survive locally, but are never inferred to be pending uploads.
  for (const cart of [...state.mirror, ...localCarts]) {
    if (!observed.has(cart.id)) merged.set(cart.id, cart);
  }
  for (const cart of remoteCarts ?? state.mirror) merged.set(cart.id, cart);
  for (const mutation of state.pending) {
    if (mutation.type === 'delete') merged.delete(mutation.id);
    else merged.set(mutation.id, mutation.cart);
  }
  return sortSuspendedCarts([...merged.values()]);
};

const syncSuspendedMutation = async (mutation: SuspendedMutation): Promise<void> => {
  if (!isOnline() || !getSuspendedSyncState().pending.includes(mutation)) return;
  try {
    // Persist the latest intent, including a delete staged while an earlier save was in flight.
    persistSuspendedSyncState(getSuspendedSyncState());
    const ref = doc(db, PARTS_SUSPENDED_COLLECTION, mutation.id);
    if (mutation.type === 'upsert') await setDoc(ref, mutation.cart);
    else await deleteDoc(ref);

    const state = getSuspendedSyncState();
    const acknowledged: SuspendedSyncState = {
      ...state,
      pending: state.pending.filter(pending => pending !== mutation),
      // Keep provenance even after removal, so an old caller mirror cannot resurrect it.
      observedIds: [...new Set([...state.observedIds, mutation.id])],
    };
    persistSuspendedSyncState(acknowledged);
    suspendedSyncState = acknowledged;
  } catch (error) {
    console.error('Failed to sync parts suspended cart; retained for retry', error);
  }
};

const stageSuspendedMutation = (mutation: SuspendedMutation): Promise<void> => {
  const state = getSuspendedSyncState();
  suspendedSyncState = {
    ...state,
    pending: [...state.pending.filter(pending => pending.id !== mutation.id), mutation],
    mirror: mutation.type === 'delete'
      ? state.mirror.filter(cart => cart.id !== mutation.id)
      : [...state.mirror.filter(cart => cart.id !== mutation.id), mutation.cart],
  };
  // Stage synchronously, not behind network I/O. A failed disk write blocks remote mutation.
  persistSuspendedSyncState(suspendedSyncState);
  return serializeSuspendedOperation(() => syncSuspendedMutation(mutation));
};

export const partsCartService = {
  // ==========================================
  // ACTIVE PARTS CART
  // ==========================================
  
  getActiveCart: async (): Promise<{ items: CartItem[]; customerName: string; customerId?: string; shopName?: string } | null> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    try {
      const snap = await getDoc(doc(db, CARTS_COLLECTION, PARTS_ACTIVE_CART_DOC));
      if (!snap.exists()) return null;
      return snap.data() as { items: CartItem[]; customerName: string; customerId?: string; shopName?: string };
    } catch (e) {
      console.error('Failed to get parts active cart', e);
      return null;
    }
  },

  saveActiveCart: async (items: CartItem[], customerName: string, customerId?: string, shopName?: string): Promise<void> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const payload = cleanForFirestore({
        items,
        customerName: customerName || '',
        customerId: customerId || '',
        shopName: shopName || '',
      });
      await setDoc(doc(db, CARTS_COLLECTION, PARTS_ACTIVE_CART_DOC), payload);
    } catch (e) {
      console.error('Failed to save parts active cart', e);
    }
  },

  clearActiveCart: async (): Promise<void> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      await deleteDoc(doc(db, CARTS_COLLECTION, PARTS_ACTIVE_CART_DOC));
    } catch (e) {
      console.error('Failed to clear parts active cart', e);
    }
  },

  // ==========================================
  // SUSPENDED PARTS CARTS
  // ==========================================

  getAllSuspendedCarts: async (localCarts?: SuspendedCart[]): Promise<SuspendedCart[]> => {
    const local = localCarts ?? readLocalSuspendedCarts();
    return serializeSuspendedOperation(async () => {
      try {
        const pending = [...getSuspendedSyncState().pending];
        for (const mutation of pending) await syncSuspendedMutation(mutation);

        let remote: SuspendedCart[] | undefined;
        if (isOnline()) {
          try {
            // Cache-only snapshots are not evidence that another terminal deleted a cart.
            const snap = await getDocsFromServer(collection(db, PARTS_SUSPENDED_COLLECTION));
            remote = snap.docs.map(d => ({ ...d.data(), id: d.id } as SuspendedCart));
          } catch (error) {
            console.error('Failed to get parts suspended carts; using local carts', error);
          }
        }

        const state = getSuspendedSyncState();
        const carts = reconcileSuspendedCarts(state, local, remote);
        suspendedSyncState = {
          ...state,
          mirror: carts,
          observedIds: [...new Set([...state.observedIds, ...(remote ?? []).map(cart => cart.id)])],
        };
        try {
          persistSuspendedSyncState(suspendedSyncState);
        } catch (error) {
          console.error('Failed to persist parts suspended cart mirror', error);
        }
        return carts;
      } catch (error) {
        console.error('Failed to read parts suspended cart sync journal', error);
        return sortSuspendedCarts([...local]);
      }
    });
  },

  // Resolves after acknowledgement or durable queuing; rejects if local durability fails.
  saveSuspendedCart: async (cart: SuspendedCart): Promise<void> => {
    const payload = cleanForFirestore(cart);
    return stageSuspendedMutation({ type: 'upsert', id: payload.id, cart: payload });
  },

  deleteSuspendedCart: async (id: string): Promise<void> => {
    return stageSuspendedMutation({ type: 'delete', id });
  }
};
