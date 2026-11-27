import { create } from 'zustand';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { offlineSyncService } from '../services/offlineSyncService';
import { notificationService } from '../services/notificationService';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  error: string | null;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  staff: User[];
  fetchStaff: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Listen to Auth State globally
  onAuthStateChanged(auth, async (firebaseUser) => {
    // The offline queue is owned by whoever is signed in. Setting it before any
    // other work also folds in records left by the pre-namespacing build.
    await offlineSyncService.setQueueOwner(firebaseUser?.uid ?? null);

    if (firebaseUser) {
      try {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const profile = { id: userDoc.id, ...userDoc.data() } as User;
          
          if (profile.status === 'revoked') {
            await signOut(auth);
            set({ user: null, isAuthenticated: false, isInitializing: false });
            return;
          }

          // Allow repair_agent, sales_agent and admin
          if (profile.role !== 'repair_agent' && profile.role !== 'sales_agent' && profile.role !== 'admin') {
            await signOut(auth);
            set({ 
              user: null, 
              isAuthenticated: false, 
              isInitializing: false,
              error: 'Access Denied: Only staff members can use this app.'
            });
            return;
          }

          set({ 
            user: profile, 
            isAuthenticated: true, 
            isInitializing: false 
          });
        } else {
          await signOut(auth);
          set({ user: null, isAuthenticated: false, isInitializing: false });
        }
      } catch (err) {
        console.error("Auth state validation error:", err);
        set({ isInitializing: false });
      }
    } else {
      set({ user: null, isAuthenticated: false, isInitializing: false });
    }
  });

  return {
    user: null,
    isAuthenticated: false,
    isInitializing: true,
    error: null,
    staff: [],

    fetchStaff: async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        const staffList: User[] = [];
        querySnapshot.forEach((d) => {
          const profile = { id: d.id, ...d.data() } as User;
          if (profile.role === 'repair_agent' || profile.role === 'admin' || profile.role === 'sales_agent') {
            staffList.push(profile);
          }
        });
        set({ staff: staffList });
      } catch (err) {
        console.error("Failed to fetch staff:", err);
      }
    },

    login: async (email, pass) => {
      set({ error: null });
      try {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
        
        if (!userDoc.exists()) {
          await signOut(auth);
          throw new Error('User profile not found.');
        }

        const profile = { id: userDoc.id, ...userDoc.data() } as User;
        if (profile.status === 'revoked') {
          await signOut(auth);
          throw new Error('Your account has been revoked.');
        }
        
        if (profile.role !== 'repair_agent' && profile.role !== 'sales_agent' && profile.role !== 'admin') {
          await signOut(auth);
          throw new Error('Access Denied: Only staff members can use this app.');
        }
      } catch (error: any) {
        set({ error: error.message });
        throw error;
      }
    },

    logout: async () => {
      const signingOut = get().user?.id;
      // Unsent work stays on the device under this account's queue — it belongs to
      // them and syncs when they sign in again — but the push token must stop
      // pointing at whoever signs in next on this tablet.
      await notificationService.clearDevicePushToken(signingOut).catch(() => undefined);
      await signOut(auth);
      await offlineSyncService.setQueueOwner(null);
      set({ user: null, isAuthenticated: false, staff: [] });
    },

    clearError: () => set({ error: null })
  };
});
