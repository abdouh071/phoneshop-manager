import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CartItem } from '../types';
import { createSuspendedCartSync } from './suspendedCartSync';

const PARTS_SUSPENDED_COLLECTION = 'parts_suspended_carts';
const PARTS_ACTIVE_CART_DOC = 'parts_active_cart';
const CARTS_COLLECTION = 'carts';

// Helper to remove any undefined properties which cause Firestore setDoc/addDoc to throw errors
const cleanForFirestore = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

const suspendedSync = createSuspendedCartSync({
  collectionName: PARTS_SUSPENDED_COLLECTION,
  syncStorageKey: 'parts_suspended_carts_sync_v1',
  localStorageKey: PARTS_SUSPENDED_COLLECTION,
  invalidJournalMessage: 'Invalid parts suspended cart sync journal',
});

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

  getAllSuspendedCarts: suspendedSync.getAllSuspendedCarts,
  saveSuspendedCart: suspendedSync.saveSuspendedCart,
  deleteSuspendedCart: suspendedSync.deleteSuspendedCart,
};
