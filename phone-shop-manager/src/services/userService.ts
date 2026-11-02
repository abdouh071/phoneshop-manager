import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { User } from '../store/authStore';

const COLLECTION = 'users';

/**
 * Staff lists are read constantly (settings, approvals, offline caches), so the PIN
 * verifier never travels with them. Only the approval prompt reads verifiers, and it
 * keeps them in memory for one session rather than on disk.
 */
const APPROVAL_PIN_CACHE_MS = 60_000;

export interface ApprovalPinHolder {
  id: string;
  name: string;
  approvalPin: string;
}

let approvalPinCache: { at: number; holders: ApprovalPinHolder[] } | null = null;

const invalidateApprovalPinVerifiers = (): void => {
  approvalPinCache = null;
};

const toSafeUser = (id: string, data: DocumentData): User => {
  const safe: DocumentData = { ...data, id, hasApprovalPin: Boolean(data.approvalPin) };
  delete safe.approvalPin;
  return safe as User;
};

export const userService = {
  getAllUsers: async (): Promise<User[]> => {
    const q = query(collection(db, COLLECTION), orderBy('name'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => toSafeUser(docSnap.id, docSnap.data()));
  },

  getUserById: async (uid: string): Promise<User | null> => {
    const docRef = doc(db, COLLECTION, uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return toSafeUser(snap.id, snap.data());
    }
    return null;
  },

  /**
   * Admins and super admins that have configured an approval PIN. Read by the approval
   * prompt only: the PIN belongs to an admin who is standing at someone else's till, so
   * the verifier cannot live on the signed-in user's own profile.
   *
   * Offline tills fall back to the copy held in memory from earlier in this session; with
   * no copy at all the caller gets the error and can use a remote approval request instead.
   */
  getApprovalPinVerifiers: async (): Promise<ApprovalPinHolder[]> => {
    if (approvalPinCache && Date.now() - approvalPinCache.at < APPROVAL_PIN_CACHE_MS) {
      return approvalPinCache.holders;
    }
    try {
      const q = query(collection(db, COLLECTION), orderBy('name'));
      const snapshot = await getDocs(q);
      const holders = snapshot.docs
        .map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: typeof data.name === 'string' ? data.name : '',
            role: data.role,
            status: data.status,
            isSuperAdmin: data.isSuperAdmin === true,
            approvalPin: typeof data.approvalPin === 'string' ? data.approvalPin.trim() : '',
          };
        })
        .filter(h => h.approvalPin !== '' && (h.role === 'admin' || h.isSuperAdmin) && h.status !== 'revoked')
        .map(h => ({ id: h.id, name: h.name, approvalPin: h.approvalPin }));
      approvalPinCache = { at: Date.now(), holders };
      return holders;
    } catch (err) {
      if (approvalPinCache) {
        console.warn('Could not refresh approval PIN verifiers, using the copy from this session:', err);
        return approvalPinCache.holders;
      }
      throw err;
    }
  },

  setApprovalPinVerifier: async (uid: string, hashedPin: string): Promise<void> => {
    await setDoc(doc(db, COLLECTION, uid), { approvalPin: hashedPin }, { merge: true });
    invalidateApprovalPinVerifiers();
  },

  clearApprovalPinVerifier: async (uid: string): Promise<void> => {
    await setDoc(doc(db, COLLECTION, uid), { approvalPin: '' }, { merge: true });
    invalidateApprovalPinVerifiers();
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
