import {
  collection,
  doc,
  getDocs,
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

export const partsCartService = {
  // ==========================================
  // ACTIVE PARTS CART
  // ==========================================
  
  getActiveCart: async (): Promise<{ items: CartItem[]; customerName: string; customerId?: string; shopName?: string } | null> => {
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
    try {
      await deleteDoc(doc(db, CARTS_COLLECTION, PARTS_ACTIVE_CART_DOC));
    } catch (e) {
      console.error('Failed to clear parts active cart', e);
    }
  },

  // ==========================================
  // SUSPENDED PARTS CARTS
  // ==========================================

  getAllSuspendedCarts: async (): Promise<SuspendedCart[]> => {
    try {
      const snap = await getDocs(collection(db, PARTS_SUSPENDED_COLLECTION));
      const carts = snap.docs.map(d => ({ ...d.data(), id: d.id } as SuspendedCart));
      carts.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      return carts;
    } catch (e) {
      console.error('Failed to get parts suspended carts', e);
      return [];
    }
  },

  saveSuspendedCart: async (cart: SuspendedCart): Promise<void> => {
    try {
      const payload = cleanForFirestore(cart);
      await setDoc(doc(db, PARTS_SUSPENDED_COLLECTION, cart.id), payload);
    } catch (e) {
      console.error('Failed to save parts suspended cart', e);
    }
  },

  deleteSuspendedCart: async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, PARTS_SUSPENDED_COLLECTION, id));
    } catch (e) {
      console.error('Failed to delete parts suspended cart', e);
    }
  }
};
