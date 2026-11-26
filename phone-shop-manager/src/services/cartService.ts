import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CartItem } from '../types';
import { createSuspendedCartSync } from './suspendedCartSync';

const SUSPENDED_COLLECTION = 'suspended_carts';
const ACTIVE_CART_DOC = 'active_cart';
const CARTS_COLLECTION = 'carts';

// Helper to remove any undefined properties which cause Firestore setDoc/addDoc to throw errors
const cleanForFirestore = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

const suspendedSync = createSuspendedCartSync({
  collectionName: SUSPENDED_COLLECTION,
  syncStorageKey: 'pos_suspended_carts_sync_v1',
  localStorageKey: 'pos_suspended_carts',
  invalidJournalMessage: 'Invalid retail suspended cart sync journal',
});

export const cartService = {
  // ==========================================
  // ACTIVE CART
  // ==========================================

  getActiveCart: async (): Promise<{ items: CartItem[], customerName: string } | null> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    try {
      const snap = await getDoc(doc(db, CARTS_COLLECTION, ACTIVE_CART_DOC));
      if (!snap.exists()) return null;
      return snap.data() as { items: CartItem[], customerName: string };
    } catch (e) {
      console.error('Failed to get active cart', e);
      return null;
    }
  },

  saveActiveCart: async (items: CartItem[], customerName: string): Promise<void> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const payload = cleanForFirestore({ items, customerName: customerName || '' });
      await setDoc(doc(db, CARTS_COLLECTION, ACTIVE_CART_DOC), payload);
    } catch (e) {
      console.error('Failed to save active cart', e);
    }
  },

  clearActiveCart: async (): Promise<void> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      await deleteDoc(doc(db, CARTS_COLLECTION, ACTIVE_CART_DOC));
    } catch (e) {
      console.error('Failed to clear active cart', e);
    }
  },

  // ==========================================
  // SUSPENDED CARTS
  // ==========================================

  getAllSuspendedCarts: suspendedSync.getAllSuspendedCarts,
  saveSuspendedCart: suspendedSync.saveSuspendedCart,
  deleteSuspendedCart: suspendedSync.deleteSuspendedCart,
};
