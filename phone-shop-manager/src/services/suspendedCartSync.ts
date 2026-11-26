import {
  collection,
  doc,
  getDocsFromServer,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { SuspendedCart } from '../types';

const cleanForFirestore = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

export type SuspendedMutation =
  | { type: 'upsert'; id: string; cart: SuspendedCart }
  | { type: 'delete'; id: string };

interface SuspendedSyncState {
  pending: SuspendedMutation[];
  observedIds: string[];
  mirror: SuspendedCart[];
}

export interface SuspendedCartSyncOptions {
  collectionName: string;
  syncStorageKey: string;
  localStorageKey: string;
  invalidJournalMessage?: string;
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;
const isCart = (value: unknown): value is SuspendedCart =>
  Boolean(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string');

export const sortSuspendedCarts = (carts: SuspendedCart[]): SuspendedCart[] =>
  [...carts].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

/**
 * Shared durable journal + server reconciliation for suspended carts across both
 * Retail POS and Parts POS so offline holds, resumptions, and multi-till deletes
 * never resurrect deleted baskets or drop in-flight local changes.
 */
export const createSuspendedCartSync = ({
  collectionName,
  syncStorageKey,
  localStorageKey,
  invalidJournalMessage = 'Invalid suspended cart sync journal',
}: SuspendedCartSyncOptions) => {
  let suspendedSyncState: SuspendedSyncState | undefined;
  let suspendedOperations: Promise<void> = Promise.resolve();

  const getSuspendedSyncState = (): SuspendedSyncState => {
    if (suspendedSyncState) return suspendedSyncState;
    const raw = localStorage.getItem(syncStorageKey);
    if (!raw) {
      suspendedSyncState = { pending: [], observedIds: [], mirror: [] };
    } else {
      const parsed = JSON.parse(raw) as SuspendedSyncState;
      if (
        !parsed
        || !Array.isArray(parsed.pending)
        || !Array.isArray(parsed.observedIds)
        || !Array.isArray(parsed.mirror)
        || !parsed.mirror.every(isCart)
        || !parsed.observedIds.every(id => typeof id === 'string')
        || !parsed.pending.every(mutation =>
          mutation
          && typeof mutation.id === 'string'
          && (mutation.type === 'delete'
            || (mutation.type === 'upsert' && isCart(mutation.cart) && mutation.cart.id === mutation.id))
        )
      ) {
        throw new Error(invalidJournalMessage);
      }
      suspendedSyncState = parsed;
    }
    return suspendedSyncState;
  };

  const persistSuspendedSyncState = (state: SuspendedSyncState) => {
    localStorage.setItem(syncStorageKey, JSON.stringify(state));
  };

  const serializeSuspendedOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = suspendedOperations.then(operation);
    suspendedOperations = result.then(() => undefined, () => undefined);
    return result;
  };

  const readLocalSuspendedCarts = (): SuspendedCart[] => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(localStorageKey) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isCart) : [];
    } catch (error) {
      console.error(`Failed to read local suspended carts (${localStorageKey})`, error);
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
      persistSuspendedSyncState(getSuspendedSyncState());
      const ref = doc(db, collectionName, mutation.id);
      if (mutation.type === 'upsert') await setDoc(ref, mutation.cart);
      else await deleteDoc(ref);

      const state = getSuspendedSyncState();
      const acknowledged: SuspendedSyncState = {
        ...state,
        pending: state.pending.filter(pending => pending !== mutation),
        observedIds: [...new Set([...state.observedIds, mutation.id])],
      };
      persistSuspendedSyncState(acknowledged);
      suspendedSyncState = acknowledged;
    } catch (error) {
      console.error(`Failed to sync suspended cart (${collectionName}); retained for retry`, error);
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
    persistSuspendedSyncState(suspendedSyncState);
    return serializeSuspendedOperation(() => syncSuspendedMutation(mutation));
  };

  return {
    getAllSuspendedCarts: async (localCarts?: SuspendedCart[]): Promise<SuspendedCart[]> => {
      const local = localCarts ?? readLocalSuspendedCarts();
      return serializeSuspendedOperation(async () => {
        try {
          const pending = [...getSuspendedSyncState().pending];
          for (const mutation of pending) await syncSuspendedMutation(mutation);

          let remote: SuspendedCart[] | undefined;
          if (isOnline()) {
            try {
              const snap = await getDocsFromServer(collection(db, collectionName));
              remote = snap.docs.map(d => ({ ...d.data(), id: d.id } as SuspendedCart));
            } catch (error) {
              console.error(`Failed to get suspended carts (${collectionName}); using local carts`, error);
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
            console.error(`Failed to persist suspended cart mirror (${collectionName})`, error);
          }
          return carts;
        } catch (error) {
          console.error(`Failed to read suspended cart sync journal (${collectionName})`, error);
          return sortSuspendedCarts([...local]);
        }
      });
    },

    saveSuspendedCart: async (cart: SuspendedCart): Promise<void> => {
      const payload = cleanForFirestore(cart);
      return stageSuspendedMutation({ type: 'upsert', id: payload.id, cart: payload });
    },

    deleteSuspendedCart: async (id: string): Promise<void> => {
      return stageSuspendedMutation({ type: 'delete', id });
    },
  };
};

/**
 * Merges an authoritative fetched list with concurrent holds/removals made in
 * store state while the network read was in flight.
 */
export const mergeSuspendedFetchResult = (
  fetched: SuspendedCart[],
  before: SuspendedCart[],
  current: SuspendedCart[],
  removedDuringFetch: ReadonlySet<string>
): SuspendedCart[] => {
  const merged = new Map(fetched.map(cart => [cart.id, cart]));
  if (current !== before) {
    for (const cart of current) merged.set(cart.id, cart);
  }
  for (const id of removedDuringFetch) merged.delete(id);
  return sortSuspendedCarts([...merged.values()]);
};
