import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  deleteField,
  query,
  orderBy,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { User } from '../store/authStore';

const COLLECTION = 'users';

/**
 * Staff lists are read constantly (settings, approvals, offline caches), so the PIN
 * verifier never travels with them. The verifier lives in `users/{uid}/secrets/approvalPin`,
 * which the rules open only to the owner and admins — a 4–8 digit PIN is brute-forceable
 * offline, so a staffer must never be able to read one with the SDK. Only the approval
 * prompt reads verifiers, and it keeps them in memory for one session rather than on disk.
 */
const APPROVAL_PIN_CACHE_MS = 60_000;

const secretRef = (uid: string) => doc(db, COLLECTION, uid, 'secrets', 'approvalPin');

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
  const safe: DocumentData = {
    ...data,
    id,
    hasApprovalPin: data.hasApprovalPin === true || Boolean(data.approvalPin),
  };
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
   * The rules let only the owner and admins read the secrets subcollection, so on a staff
   * till this call is denied and the prompt points at remote approval (or the server
   * callable answers instead). Offline tills fall back to the copy held in memory from
   * earlier in this session.
   */
  getApprovalPinVerifiers: async (): Promise<ApprovalPinHolder[]> => {
    if (approvalPinCache && Date.now() - approvalPinCache.at < APPROVAL_PIN_CACHE_MS) {
      return approvalPinCache.holders;
    }
    try {
      const q = query(collection(db, COLLECTION), orderBy('name'));
      const snapshot = await getDocs(q);
      const candidates = snapshot.docs.filter(docSnap => {
        const data = docSnap.data();
        return (data.role === 'admin' || data.isSuperAdmin === true) && data.status !== 'revoked';
      });
      const holders: ApprovalPinHolder[] = [];
      for (const docSnap of candidates) {
        const data = docSnap.data();
        const secret = await getDoc(secretRef(docSnap.id));
        const secretData = secret.exists() ? secret.data() : undefined;
        // Pre-migration profiles still carry the verifier on the users doc; an admin
        // reader may use it until the legacy field is moved into the subcollection.
        const verifier = typeof secretData?.verifier === 'string' && secretData.verifier.trim() !== ''
          ? secretData.verifier.trim()
          : typeof data.approvalPin === 'string' ? data.approvalPin.trim() : '';
        if (verifier !== '') {
          holders.push({
            id: docSnap.id,
            name: typeof data.name === 'string' ? data.name : '',
            approvalPin: verifier,
          });
        }
      }
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
    await setDoc(secretRef(uid), { verifier: hashedPin, updatedAt: serverTimestamp() });
    await setDoc(doc(db, COLLECTION, uid), { hasApprovalPin: true, approvalPin: deleteField() }, { merge: true });
    invalidateApprovalPinVerifiers();
  },

  clearApprovalPinVerifier: async (uid: string): Promise<void> => {
    await deleteDoc(secretRef(uid));
    await setDoc(doc(db, COLLECTION, uid), { hasApprovalPin: false, approvalPin: deleteField() }, { merge: true });
    invalidateApprovalPinVerifiers();
  },

  /**
   * Moves any legacy `users/{uid}.approvalPin` verifier into the secrets subcollection and
   * deletes the exposed field. Best-effort per profile: the rules allow self-writes and
   * admins managing non-super profiles, so a staff session migrates only itself and an
   * admin session migrates the team. Runs when the staff settings tab opens.
   */
  migrateLegacyApprovalPins: async (): Promise<number> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return 0;
    const snapshot = await getDocs(query(collection(db, COLLECTION), orderBy('name')));
    const mine = snapshot.docs.find(d => d.id === uid)?.data();
    const iAmAdmin = mine?.role === 'admin' || mine?.isSuperAdmin === true;
    const iAmSuper = mine?.isSuperAdmin === true;
    let moved = 0;
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const legacy = typeof data.approvalPin === 'string' ? data.approvalPin.trim() : '';
      if (legacy === '') continue;
      const isSelf = docSnap.id === uid;
      if (!isSelf && (!iAmAdmin || (data.isSuperAdmin === true && !iAmSuper))) continue;
      try {
        await setDoc(secretRef(docSnap.id), { verifier: legacy, updatedAt: serverTimestamp() });
        await setDoc(doc(db, COLLECTION, docSnap.id), { hasApprovalPin: true, approvalPin: deleteField() }, { merge: true });
        moved += 1;
      } catch {
        // A profile the rules will not let this session move stays as it was; the next
        // admin visit retries it. Never block the staff page on a migration write.
      }
    }
    if (moved > 0) invalidateApprovalPinVerifiers();
    return moved;
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
