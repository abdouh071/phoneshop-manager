import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CartItem, SuspendedCart } from '../types';

const SUSPENDED_COLLECTION = 'suspended_carts';
const ACTIVE_CART_DOC = 'active_cart';
const CARTS_COLLECTION = 'carts';

// Helper to remove any undefined properties which cause Firestore setDoc/addDoc to throw errors
const cleanForFirestore = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

export const cartService = {
  // ==========================================
  // ACTIVE CART
  // ==========================================
  
  getActiveCart: async (): Promise<{ items: CartItem[], customerName: string } | null> => {
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
    try {
      const payload = cleanForFirestore({ items, customerName: customerName || '' });
      await setDoc(doc(db, CARTS_COLLECTION, ACTIVE_CART_DOC), payload);
    } catch (e) {
      console.error('Failed to save active cart', e);
    }
  },

  clearActiveCart: async (): Promise<void> => {
    try {
      await deleteDoc(doc(db, CARTS_COLLECTION, ACTIVE_CART_DOC));
    } catch (e) {
      console.error('Failed to clear active cart', e);
    }
  },

  // ==========================================
  // SUSPENDED CARTS
  // ==========================================

  getAllSuspendedCarts: async (): Promise<SuspendedCart[]> => {
    try {
      const snap = await getDocs(collection(db, SUSPENDED_COLLECTION));
      const carts = snap.docs.map(d => ({ ...d.data(), id: d.id } as SuspendedCart));
      carts.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      return carts;
    } catch (e) {
      console.error('Failed to get suspended carts', e);
      return [];
    }
  },

  saveSuspendedCart: async (cart: SuspendedCart): Promise<void> => {
    try {
      const payload = cleanForFirestore(cart);
      await setDoc(doc(db, SUSPENDED_COLLECTION, cart.id), payload);
    } catch (e) {
      console.error('Failed to save suspended cart', e);
    }
  },

  deleteSuspendedCart: async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, SUSPENDED_COLLECTION, id));
    } catch (e) {
      console.error('Failed to delete suspended cart', e);
    }
  }
};
