import { create } from 'zustand';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail
} from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import type { UserCredential } from 'firebase/auth';
import type { Timestamp } from 'firebase/firestore';
import { auth, app } from '../lib/firebase';
import { userService } from '../services/userService';
import { settingsService } from '../services/settingsService';
import { activityLogService } from '../services/activityLogService';
import type { Permissions } from '../types/permissions';
import { FULL_PERMISSIONS, SALES_AGENT_PERMISSIONS, REPAIR_AGENT_PERMISSIONS } from '../types/permissions';

// Helper to fetch current public IP address with multiple fallbacks
export const fetchPublicIP = async (): Promise<string | null> => {
  const providers = [
    'https://api.ipify.org?format=json',
    'https://icanhazip.com',
    'https://checkip.amazonaws.com'
  ];
  for (const provider of providers) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(provider, { signal: controller.signal });
      clearTimeout(id);
      
      if (provider.includes('json')) {
        const data = await res.json();
        if (data.ip) return data.ip.trim();
      } else {
        const text = await res.text();
        if (text.trim()) return text.trim();
      }
    } catch {
      // try next provider
    }
  }
  return null;
};

// We no longer hardcode a single SUPER_ADMIN_EMAIL to enforce dynamic DB checks,
// but we allow configuring an initial super admin email via environment variable.
const LEGACY_OWNER_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL || '';

// Mimics `any`-style field access on caught errors without losing type safety
const errorMessage = (err: unknown): string | undefined =>
  err !== null && typeof err === 'object' && 'message' in err
    ? String((err as { message: unknown }).message)
    : undefined;

const errorCode = (err: unknown): string | undefined =>
  err !== null && typeof err === 'object' && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;

import { hashApprovalPin } from '../utils/security';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'sales_agent' | 'repair_agent';
  status?: 'active' | 'revoked';
  avatar?: string;
  lastActive?: Timestamp | string;
  createdAt?: Timestamp | string;
  permissions?: Permissions;
  isSuperAdmin?: boolean;
  /**
   * Whether this account has an approval PIN, without carrying the verifier itself.
   * `approvalPin` deliberately does not exist on this type: staff lists, the current
   * session and the localStorage session cache must never hold a crackable PIN hash.
   */
  hasApprovalPin?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  isSuperAdmin: boolean;
  isHistoryUnlocked: boolean;
  error: string | null;
  staff: User[];
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  fetchStaff: () => Promise<void>;
  createStaffMember: (name: string, email: string, pass: string, role: 'admin' | 'sales_agent' | 'repair_agent', permissions?: Permissions) => Promise<void>;
  updateStaffMember: (uid: string, data: Partial<Pick<User, 'name' | 'role' | 'status' | 'permissions' | 'isSuperAdmin'>>) => Promise<void>;
  setApprovalPin: (pin: string, targetUid?: string) => Promise<void>;
  removeApprovalPin: (targetUid?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  quickRoleLogin: (role: 'sales_agent' | 'repair_agent', adminPass: string) => Promise<void>;
  unlockHistory: (adminEmail: string, adminPass: string) => Promise<void>;
  lockHistory: () => void;
}

const CACHED_USER_KEY = 'cached_auth_user';

const getCachedUser = (): User | null => {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as User & { approvalPin?: string };
    // Tills that cached a session before verifiers were kept out of storage still have the
    // hash on disk. Keep the flag so the Settings badge stays correct offline, then drop the
    // hash so it cannot re-enter app state.
    const hasApprovalPin = cached.hasApprovalPin ?? Boolean(cached.approvalPin);
    delete cached.approvalPin;
    return { ...cached, hasApprovalPin };
  } catch {
    return null;
  }
};

const saveCachedUser = (user: User | null): void => {
  try {
    if (user) {
      const safe = { ...user } as User & { approvalPin?: string };
      delete safe.approvalPin;
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(safe));
    } else {
      localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch (e) {
    console.warn('Failed to save cached auth user:', e);
  }
};

// Guard flag to prevent onAuthStateChanged from interfering during login/bootstrap
let _isLoginInProgress = false;

export const useAuthStore = create<AuthState>((set, get) => {
  const initialCachedUser = getCachedUser();

  // Listen to Auth State globally
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        // Skip validation if login() is currently running (it handles its own bootstrap)
        if (_isLoginInProgress) return;

        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const cached = getCachedUser();

        // If offline and we have a cached user, retain session without attempting remote validation
        if (isOffline && cached) {
          const isSuper = cached.isSuperAdmin === true || cached.email === LEGACY_OWNER_EMAIL;
          set({
            user: cached,
            isAuthenticated: true,
            isInitializing: false,
            isSuperAdmin: isSuper,
            isHistoryUnlocked: cached.role === 'admin'
          });
          return;
        }

        let profile: User | null = null;
        try {
          profile = await userService.getUserById(firebaseUser.uid);
        } catch (fetchErr) {
          console.warn('Could not fetch user profile from Firestore, falling back to cache:', fetchErr);
          if (cached && (cached.id === firebaseUser.uid || !cached.id)) {
            profile = cached;
          }
        }

        if (!profile && cached && (cached.id === firebaseUser.uid || !cached.id)) {
          profile = cached;
        }

        if (profile) {
          saveCachedUser(profile);

          // Block revoked users even if their Firebase Auth token is valid
          if (profile.status === 'revoked') {
            saveCachedUser(null);
            await signOut(auth);
            set({ 
              user: null, 
              isAuthenticated: false, 
              isInitializing: false,
            });
            return;
          }

          // Enforce IP Lock for Workers (Sales/Repair) only when strictly ONLINE
          if (!isOffline && (profile.role === 'sales_agent' || profile.role === 'repair_agent')) {
            const settings = await settingsService.getSettings();
            if (settings && settings.allowedIp && settings.allowedIp.trim() !== '') {
              const allowedList = settings.allowedIp
                .split(/[\s,]+/)
                .map(ip => ip.trim())
                .filter(Boolean);
              if (allowedList.length > 0) {
                let userIP = await fetchPublicIP();
                if (!userIP) {
                  // Retry once after 1s before disconnecting
                  await new Promise(r => setTimeout(r, 1000));
                  userIP = await fetchPublicIP();
                }
                if (!userIP || !allowedList.includes(userIP)) {
                  saveCachedUser(null);
                  await signOut(auth);
                  set({ 
                    user: null, 
                    isAuthenticated: false, 
                    isInitializing: false,
                    error: userIP 
                      ? `Session ended: Your IP (${userIP}) is not authorized. Store Wi-Fi required.`
                      : 'Session ended: Could not verify store Wi-Fi connection.'
                  });
                  return;
                }
              }
            }
          }

          // Check super admin status with fallback to legacy owner email
          const isSuper = profile.isSuperAdmin === true || profile.email === LEGACY_OWNER_EMAIL;

          // One-time migration: attempt to set isSuperAdmin in DB asynchronously
          if (!isOffline && profile.email === LEGACY_OWNER_EMAIL && profile.isSuperAdmin !== true) {
            profile.isSuperAdmin = true;
            userService.updateUserProfile(firebaseUser.uid, { isSuperAdmin: true }).catch(console.error);
          }

          // Apply Role Override (Quick Login)
          const override = localStorage.getItem('role_override');
          if (override && isSuper) {
            profile.role = override as 'sales_agent' | 'repair_agent';
            profile.name = override === 'sales_agent' ? 'Sales Agent' : 'Repair Technician';
            profile.permissions = override === 'sales_agent'
              ? { ...SALES_AGENT_PERMISSIONS }
              : { ...REPAIR_AGENT_PERMISSIONS };
          }

          set({ 
            user: profile, 
            isAuthenticated: true, 
            isInitializing: false,
            isSuperAdmin: isSuper && !override,
            isHistoryUnlocked: profile.role === 'admin' // Admins always have unlocked history
          });
          if (!isOffline) {
            userService.updateLastActive(firebaseUser.uid).catch(console.error);
          }
        } else {
          // No Firestore profile yet — try auto-bootstrap (first user becomes Super Admin)
          let bootstrapped = false;
          try {
            let shouldBootstrap = false;
            if (LEGACY_OWNER_EMAIL && firebaseUser.email === LEGACY_OWNER_EMAIL) {
              shouldBootstrap = true;
            } else {
              try {
                const allUsers = await userService.getAllUsers();
                if (!allUsers || allUsers.length === 0) {
                  shouldBootstrap = true;
                }
              } catch {
                // If query fails (e.g. brand new collection), allow initial user to bootstrap
                shouldBootstrap = true;
              }
            }

            if (shouldBootstrap) {
              const rawName = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Owner');
              const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
              await userService.createUserProfile(firebaseUser.uid, {
                name: cleanName,
                email: firebaseUser.email || '',
                role: 'admin',
                status: 'active',
                isSuperAdmin: true,
                permissions: FULL_PERMISSIONS,
                avatar: rawName.slice(0, 2).toUpperCase(),
              });
              const newProfile = await userService.getUserById(firebaseUser.uid);
              if (newProfile) {
                bootstrapped = true;
                saveCachedUser(newProfile);
                set({
                  user: newProfile,
                  isAuthenticated: true,
                  isInitializing: false,
                  isSuperAdmin: true,
                  isHistoryUnlocked: true
                });
                userService.updateLastActive(firebaseUser.uid).catch(console.error);
              }
            }
          } catch (bootstrapErr) {
            console.error("Auto-bootstrap failed:", bootstrapErr);
          }

          if (!bootstrapped) {
            if (!isOffline) {
              saveCachedUser(null);
              await signOut(auth);
              set({ user: null, isAuthenticated: false, isInitializing: false });
            }
          }
        }
      } catch (err) {
        console.error("Auth state validation error:", err);
        set({ isInitializing: false });
      }
    } else {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const cached = getCachedUser();
      if (isOffline && cached) {
        // In offline reload, keep cached user session
        set({
          user: cached,
          isAuthenticated: true,
          isInitializing: false,
          isSuperAdmin: cached.isSuperAdmin === true || cached.email === LEGACY_OWNER_EMAIL,
          isHistoryUnlocked: cached.role === 'admin'
        });
      } else {
        saveCachedUser(null);
        set({ user: null, isAuthenticated: false, isInitializing: false });
      }
    }
  });

  return {
    user: initialCachedUser,
    isAuthenticated: !!initialCachedUser,
    isLoading: false,
    isInitializing: !initialCachedUser,
    error: null,
    staff: [],
    isSuperAdmin: initialCachedUser?.isSuperAdmin || initialCachedUser?.email === LEGACY_OWNER_EMAIL || false,
    isHistoryUnlocked: initialCachedUser?.role === 'admin',

    login: async (email, pass) => {
      set({ isLoading: true, error: null });
      _isLoginInProgress = true;
      try {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        let profile = await userService.getUserById(cred.user.uid);
        
        // Auto-bootstrap: If the user has no Firestore profile yet,
        // automatically make them Super Admin if:
        // 1. Matches LEGACY_OWNER_EMAIL, OR
        // 2. The database has no users yet (first account to ever sign in becomes Super Admin)
        if (!profile) {
          let shouldBootstrap = false;
          if (LEGACY_OWNER_EMAIL && cred.user.email === LEGACY_OWNER_EMAIL) {
            shouldBootstrap = true;
          } else {
            try {
              const allUsers = await userService.getAllUsers();
              if (!allUsers || allUsers.length === 0) {
                shouldBootstrap = true;
              }
            } catch {
              // If query fails (e.g. brand new collection), allow initial user to bootstrap
              shouldBootstrap = true;
            }
          }

          if (shouldBootstrap) {
            const rawName = cred.user.displayName || (cred.user.email ? cred.user.email.split('@')[0] : 'Owner');
            const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            await userService.createUserProfile(cred.user.uid, {
              name: cleanName,
              email: cred.user.email || '',
              role: 'admin',
              status: 'active',
              isSuperAdmin: true,
              permissions: FULL_PERMISSIONS,
              avatar: rawName.slice(0, 2).toUpperCase(),
            });
            profile = await userService.getUserById(cred.user.uid);
          }
        }
        
        if (!profile) {
          await signOut(auth);
          throw new Error('Access Denied. Your account does not have permission.');
        }

        // Block revoked users on login attempt
        if (profile.status === 'revoked') {
          await signOut(auth);
          throw new Error('Your account has been revoked. Please contact your administrator.');
        }

        // Enforce IP Lock for Workers on login
        if (profile.role === 'sales_agent' || profile.role === 'repair_agent') {
          const settings = await settingsService.getSettings();
          if (settings && settings.allowedIp && settings.allowedIp.trim() !== '') {
            const allowedList = settings.allowedIp
              .split(/[\s,]+/)
              .map(ip => ip.trim())
              .filter(Boolean);
            if (allowedList.length > 0) {
              let userIP = await fetchPublicIP();
              if (!userIP) {
                await new Promise(r => setTimeout(r, 1000));
                userIP = await fetchPublicIP();
              }
              if (!userIP) {
                await signOut(auth);
                throw new Error('Access Denied. Could not verify your location (IP lookup timed out).');
              }
              if (!allowedList.includes(userIP)) {
                await signOut(auth);
                throw new Error(`Access Denied. Your IP (${userIP}) is not authorized. You must connect to the store Wi-Fi.`);
              }
            }
          }
        }

        // Apply Role Override on login (if any)
        const override = localStorage.getItem('role_override');
        if (override && profile.isSuperAdmin) {
          profile.role = override as 'sales_agent' | 'repair_agent';
          profile.name = override === 'sales_agent' ? 'Sales Agent' : 'Repair Technician';
          profile.permissions = override === 'sales_agent'
            ? { ...SALES_AGENT_PERMISSIONS }
            : { ...REPAIR_AGENT_PERMISSIONS };
        }

        set({
          user: profile,
          isAuthenticated: true,
          isLoading: false,
          isSuperAdmin: (profile.isSuperAdmin === true) && !override,
          isHistoryUnlocked: profile.role === 'admin'
        });
        // Log the login event
        activityLogService.log('system', `${profile.name} logged in`, { userName: profile.name, userId: profile.id }).catch(console.error);
      } catch (err: unknown) {
        // Simplify Firebase error messages
        let message = errorMessage(err) || 'Failed to login';
        const code = errorCode(err);
        if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
          message = 'Invalid email or password.';
        }
        set({ error: message, isLoading: false });
      } finally {
        _isLoginInProgress = false;
      }
    },

    logout: async () => {
      const currentUser = get().user;
      if (currentUser) {
        activityLogService.log('system', `${currentUser.name} logged out`, { userName: currentUser.name, userId: currentUser.id }).catch(console.error);
      }
      localStorage.removeItem('role_override');
      try {
        await signOut(auth);
      } catch (err) {
        console.warn('SignOut network/auth warning:', err);
      } finally {
        set({ user: null, isAuthenticated: false, isSuperAdmin: false, isHistoryUnlocked: false });
      }
    },

    clearError: () => set({ error: null }),

    fetchStaff: async () => {
      try {
        const staff = await userService.getAllUsers();
        set({ staff });
      } catch (err) {
        console.error("Failed to fetch staff:", err);
      }
    },

    createStaffMember: async (name, email, pass, role, permissions) => {
      const currentUser = get().user;
      if (!currentUser || currentUser.role !== 'admin') {
        throw new Error('Only administrators can create staff members.');
      }

      // Regular admins cannot create other admins or super admins
      if (!currentUser.isSuperAdmin && role === 'admin') {
        throw new Error('Only the super admin can create other administrators.');
      }

      set({ isLoading: true, error: null });
      const secondaryAppName = `Secondary_${Date.now()}`;
      let secondaryApp: FirebaseApp | null = null;
      try {
        secondaryApp = initializeApp(app.options, secondaryAppName);
        const secondaryAuth = getAuth(secondaryApp);

        let cred: UserCredential | null = null;
        try {
          cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
        } catch (authErr: unknown) {
          throw authErr;
        }

        try {
          await userService.createUserProfile(cred.user.uid, {
            name,
            email,
            role,
            status: 'active',
            permissions: role === 'admin' ? FULL_PERMISSIONS : (permissions ?? undefined),
            avatar: name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
          });
        } catch (profileErr: unknown) {
          // Rollback newly created Firebase Auth user so we don't leave an orphaned account
          if (cred?.user) {
            try {
              await cred.user.delete();
            } catch (deleteErr) {
              console.error('Failed to rollback orphaned auth user:', deleteErr);
            }
          }
          throw profileErr;
        }

        await signOut(secondaryAuth);

        await get().fetchStaff();
        const actor = get().user;
        activityLogService.log('system', `New staff member "${name}" added as ${role}`, { userName: actor?.name, userId: actor?.id }).catch(console.error);
        set({ isLoading: false });
      } catch (err: unknown) {
        set({ error: errorMessage(err) || 'Failed to create staff member', isLoading: false });
        throw err;
      } finally {
        if (secondaryApp) {
          try {
            await deleteApp(secondaryApp);
          } catch (delAppErr) {
            console.error('Failed to delete secondary app:', delAppErr);
          }
        }
      }
    },

    updateStaffMember: async (uid, data) => {
      const currentUser = get().user;
      if (!currentUser) throw new Error('Not authenticated.');

      const targetMember = get().staff.find(s => s.id === uid);
      if (!targetMember) throw new Error('Staff member not found.');

      const isSuper = currentUser.isSuperAdmin === true;

      if (!isSuper) {
        if (currentUser.role !== 'admin') {
          throw new Error('Only administrators can manage users.');
        }
        // Cannot manage themselves
        if (currentUser.id === uid) {
          throw new Error('You cannot edit your own permissions or role.');
        }
        // Cannot manage other admins
        if (targetMember.role === 'admin') {
          throw new Error('You do not have permission to manage other administrators.');
        }
        // Cannot promote to admin
        if (data.role === 'admin' || data.isSuperAdmin) {
          throw new Error('Only the super admin can grant administrator privileges.');
        }
      }

      // Nobody can revoke or demote a super admin except themselves
      if (targetMember.isSuperAdmin && currentUser.id !== targetMember.id) {
        if (data.status === 'revoked' || data.role !== 'admin' || data.isSuperAdmin === false) {
           throw new Error('You cannot demote or revoke a Super Admin.');
        }
      }

      set({ isLoading: true, error: null });
      try {
        await userService.updateUserProfile(uid, data);
        // Update avatar if name is changing
        if (data.name) {
          const avatar = data.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
          await userService.updateUserProfile(uid, { avatar });
        }
        await get().fetchStaff();
        const actor = get().user;
        const actionDesc = data.status === 'revoked'
          ? `Access revoked for "${targetMember.name}"`
          : data.status === 'active'
          ? `Account reactivated for "${targetMember.name}"`
          : `Staff member "${data.name || targetMember.name}" profile updated`;
        activityLogService.log('system', actionDesc, { userName: actor?.name, userId: actor?.id }).catch(console.error);
        set({ isLoading: false });
      } catch (err: unknown) {
        set({ error: errorMessage(err) || 'Failed to update member.', isLoading: false });
        throw err;
      }
    },

    quickRoleLogin: async (role, adminPass) => {
      // Find a super admin to login as
      const superAdmins = get().staff.filter(s => s.isSuperAdmin);
      const superAdminEmail = superAdmins.length > 0 ? superAdmins[0].email : LEGACY_OWNER_EMAIL;
      
      set({ isLoading: true, error: null });
      try {
        localStorage.setItem('role_override', role);
        await get().login(superAdminEmail, adminPass);
      } catch (err: unknown) {
        localStorage.removeItem('role_override');
        set({ error: errorMessage(err) || 'Failed to authenticate Admin.', isLoading: false });
      }
    },

    unlockHistory: async (adminEmail, adminPass) => {
      set({ isLoading: true, error: null });
      const secondaryAppName = `VerifyAdminApp_${Date.now()}`;
      let secondaryApp: FirebaseApp | null = null;
      try {
        // Authenticate the provided admin credentials using a secondary app
        secondaryApp = initializeApp(app.options, secondaryAppName);
        const secondaryAuth = getAuth(secondaryApp);
        
        const cred = await signInWithEmailAndPassword(secondaryAuth, adminEmail, adminPass);
        
        // Verify the authenticated user is actually an admin
        const profile = await userService.getUserById(cred.user.uid);
        await signOut(secondaryAuth); // immediately sign out of secondary
        
        if (!profile || (profile.role !== 'admin' && profile.isSuperAdmin !== true)) {
           throw new Error('This account does not have administrator privileges.');
        }
        
        set({ isHistoryUnlocked: true, isLoading: false });
        
        // Refresh stores so they fetch full data
        const { useCartStore } = await import('./cartStore');
        const { useActivityStore } = await import('./activityStore');
        useCartStore.getState().fetchTransactions();
        useActivityStore.getState().fetchActivities();

      } catch (err: unknown) {
        set({ error: errorCode(err) === 'auth/wrong-password' || errorCode(err) === 'auth/invalid-credential'
          ? 'Incorrect Admin Password' : (errorMessage(err) || 'Failed to unlock.'), isLoading: false });
        throw err;
      } finally {
        if (secondaryApp) {
          try {
            await deleteApp(secondaryApp);
          } catch (delErr) {
            console.error('Failed to cleanup secondary verification app:', delErr);
          }
        }
      }
    },

    lockHistory: () => {
      // Admins always have unlocked history, so only lock if it's a worker
      const user = get().user;
      if (user && user.role !== 'admin') {
        set({ isHistoryUnlocked: false });
      }
    },

    sendPasswordReset: async (email: string) => {
      set({ isLoading: true, error: null });
      try {
        await sendPasswordResetEmail(auth, email);
        set({ isLoading: false });
      } catch (err: unknown) {
        set({ error: errorMessage(err) || 'Failed to send password reset email.', isLoading: false });
        throw err;
      }
    },

    setApprovalPin: async (pin: string, targetUid?: string) => {
      const currentUser = get().user;
      if (!currentUser) throw new Error('Not authenticated.');
      
      const targetId = targetUid || currentUser.id;
      const targetMember = get().staff.find(s => s.id === targetId) || (currentUser.id === targetId ? currentUser : null);
      if (!targetMember) throw new Error('Target user not found.');

      // Check permissions: only admin or super admin can set approval PINs
      if (currentUser.role !== 'admin' && !currentUser.isSuperAdmin) {
        throw new Error('Only administrators can configure approval PINs.');
      }

      // If setting someone else's PIN, caller must be superAdmin or admin managing non-superAdmin
      if (targetId !== currentUser.id && targetMember.isSuperAdmin && !currentUser.isSuperAdmin) {
        throw new Error('Only Super Admin can change another Super Admin\'s approval PIN.');
      }

      const cleanPin = pin.trim();
      if (!cleanPin || cleanPin.length < 4 || cleanPin.length > 8 || !/^\d+$/.test(cleanPin)) {
        throw new Error('Approval PIN must be between 4 and 8 digits (numeric only).');
      }

      set({ isLoading: true, error: null });
      try {
        const hashedPin = await hashApprovalPin(cleanPin);
        await userService.setApprovalPinVerifier(targetId, hashedPin);

        // Update local user if editing self
        if (currentUser.id === targetId) {
          set({ user: { ...currentUser, hasApprovalPin: true } });
        }
        await get().fetchStaff();

        activityLogService.log('system', `Approval PIN updated for "${targetMember.name}"`, {
          userName: currentUser.name,
          userId: currentUser.id,
        }).catch(console.error);

        set({ isLoading: false });
      } catch (err: unknown) {
        set({ error: errorMessage(err) || 'Failed to update approval PIN.', isLoading: false });
        throw err;
      }
    },

    removeApprovalPin: async (targetUid?: string) => {
      const currentUser = get().user;
      if (!currentUser) throw new Error('Not authenticated.');
      const targetId = targetUid || currentUser.id;
      const targetMember = get().staff.find(s => s.id === targetId) || (currentUser.id === targetId ? currentUser : null);
      if (!targetMember) throw new Error('Target user not found.');

      if (currentUser.role !== 'admin' && !currentUser.isSuperAdmin) {
        throw new Error('Only administrators can remove approval PINs.');
      }

      set({ isLoading: true, error: null });
      try {
        await userService.clearApprovalPinVerifier(targetId);
        if (currentUser.id === targetId) {
          set({ user: { ...currentUser, hasApprovalPin: false } });
        }
        await get().fetchStaff();
        set({ isLoading: false });
      } catch (err: unknown) {
        set({ error: errorMessage(err) || 'Failed to remove approval PIN.', isLoading: false });
        throw err;
      }
    }
  };
});
