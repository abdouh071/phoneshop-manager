import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { User } from '../store/authStore';

const COLLECTION = 'users';

export const userService = {
  getAllUsers: async (): Promise<User[]> => {
    const q = query(collection(db, COLLECTION), orderBy('name'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as User[];
  },

  getUserById: async (uid: string): Promise<User | null> => {
    const docRef = doc(db, COLLECTION, uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as User;
    }
    return null;
  },

  createUserProfile: async (uid: string, data: Omit<User, 'id'>) => {
    const docRef = doc(db, COLLECTION, uid);
    await setDoc(docRef, {
      ...data,
      status: 'active', // default status
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
    });
  },

  updateUserProfile: async (uid: string, data: Partial<User>) => {
    const docRef = doc(db, COLLECTION, uid);
    await setDoc(docRef, data, { merge: true });
  },
  
  updateLastActive: async (uid: string) => {
    const docRef = doc(db, COLLECTION, uid);
    await setDoc(docRef, {
      lastActive: serverTimestamp(),
    }, { merge: true });
  }
};
