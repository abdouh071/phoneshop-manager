import { create } from 'zustand';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FieldValue, Timestamp } from 'firebase/firestore';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { userService, type ApprovalPinHolder } from '../services/userService';
import { verifyApprovalPin, isLegacyApprovalPinVerifier, hashApprovalPin } from '../utils/security';
import { serverEnforcement } from '../services/serverEnforcement';
import { errorCode } from '../utils/errorUtils';
import type { ApprovalActionData } from '../types';

export interface ApprovalRequest {
  id: string;
  actionType: string;
  actionLabel: string;
  actionData?: ApprovalActionData;
  targetId?: string;
  requestedBy: {
    uid: string;
    name: string;
    email?: string;
    role?: string;
    avatar?: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedAt: string;
  reason?: string;
  resolvedAt?: string;
  resolvedBy?: {
    uid: string;
    name: string;
  };
  rejectionReason?: string;
  approvalMethod?: 'pin' | 'remote' | 'password';
  createdAt?: FieldValue | Timestamp;
}

// Audible chime for new approval requests
export function playApprovalNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Two-tone chime (F5 -> A5)
    osc.frequency.setValueAtTime(698.46, ctx.currentTime);
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Audio context may be restricted before user gesture
  }
}

interface ApprovalState {
  pendingRequests: ApprovalRequest[];
  recentResolved: ApprovalRequest[];
  pendingCount: number;
  isModalOpen: boolean;
  isLoading: boolean;
  error: string | null;

  openModal: () => void;
  closeModal: () => void;

  submitRequest: (params: {
    actionType: string;
    actionLabel: string;
    actionData?: ApprovalActionData;
    targetId?: string;
    reason?: string;
  }) => Promise<string>;

  cancelRequest: (requestId: string) => Promise<void>;

  approveRequest: (requestId: string, method?: 'remote' | 'pin' | 'password') => Promise<void>;

  rejectRequest: (requestId: string, reason?: string) => Promise<void>;

  verifyPin: (pin: string) => Promise<{ success: boolean; adminName?: string; adminId?: string; error?: string; noPinConfigured?: boolean }>;

  subscribeToPending: () => (() => void);

  subscribeToSingleRequest: (requestId: string, onUpdate: (req: ApprovalRequest) => void) => (() => void);
}

// Track IDs globally so multiple mounted components don't double-trigger notifications
let _knownPendingIds: Set<string> | null = null;

/**
 * Replaces a v1 (fixed-salt SHA-256) verifier with the strong form once the PIN behind it
 * has been proven correct. Fails silently: the approval that just succeeded does not depend
 * on this write, and a staff till is not always allowed to write another user's profile.
 */
async function upgradeLegacyPinVerifier(uid: string, pin: string): Promise<void> {
  try {
    await userService.setApprovalPinVerifier(uid, await hashApprovalPin(pin));
  } catch { /**/ }
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  pendingRequests: [],
  recentResolved: [],
  pendingCount: 0,
  isModalOpen: false,
  isLoading: false,
  error: null,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  submitRequest: async ({ actionType, actionLabel, actionData, targetId, reason }) => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('Not authenticated.');

    const newRequestData = {
      actionType,
      actionLabel,
      actionData: actionData || null,
      targetId: targetId || null,
      requestedBy: {
        uid: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar || (user.name ? user.name[0].toUpperCase() : 'U'),
      },
      status: 'pending' as const,
      requestedAt: new Date().toISOString(),
      reason: reason?.trim() || '',
      createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'approvalRequests'), newRequestData);

    activityLogService.log('system', `Approval requested by ${user.name}: "${actionLabel}"`, {
      requestId: docRef.id,
      actionType,
      userName: user.name,
      userId: user.id,
    }).catch(console.error);

    return docRef.id;
  },

  cancelRequest: async (requestId: string) => {
    const { user } = useAuthStore.getState();
    const docRef = doc(db, 'approvalRequests', requestId);
    await updateDoc(docRef, {
      status: 'cancelled',
      resolvedAt: new Date().toISOString(),
      resolvedBy: user ? { uid: user.id, name: user.name } : null,
    });
  },

  approveRequest: async (requestId: string, method: 'remote' | 'pin' | 'password' = 'remote') => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('Not authenticated.');
    if (user.role !== 'admin' && !user.isSuperAdmin) {
      throw new Error('Only administrators can approve requests.');
    }

    const docRef = doc(db, 'approvalRequests', requestId);
    const resolvedAt = new Date().toISOString();

    await updateDoc(docRef, {
      status: 'approved',
      resolvedAt,
      resolvedBy: {
        uid: user.id,
        name: user.name,
      },
      approvalMethod: method,
    });

    const targetReq = get().pendingRequests.find(r => r.id === requestId);
    activityLogService.log('system', `Admin ${user.name} approved request: "${targetReq?.actionLabel || requestId}" (${method})`, {
      requestId,
      approvedBy: user.name,
      approvalMethod: method,
    }).catch(console.error);
  },

  rejectRequest: async (requestId: string, reason?: string) => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('Not authenticated.');
    if (user.role !== 'admin' && !user.isSuperAdmin) {
      throw new Error('Only administrators can reject requests.');
    }

    const docRef = doc(db, 'approvalRequests', requestId);
    const resolvedAt = new Date().toISOString();

    await updateDoc(docRef, {
      status: 'rejected',
      resolvedAt,
      resolvedBy: {
        uid: user.id,
        name: user.name,
      },
      rejectionReason: reason?.trim() || 'Rejected by administrator',
    });

    const targetReq = get().pendingRequests.find(r => r.id === requestId);
    activityLogService.log('system', `Admin ${user.name} rejected request: "${targetReq?.actionLabel || requestId}"`, {
      requestId,
      rejectedBy: user.name,
      reason: reason || 'None provided',
    }).catch(console.error);
  },

  verifyPin: async (pin: string) => {
    const cleanPin = (pin || '').trim();
    if (!cleanPin) {
      return { success: false, error: 'Please enter your approval PIN.' };
    }

    let holders: ApprovalPinHolder[];
    try {
      // The server answers when the callables are deployed: it holds the verifiers, so the
      // PIN stops being compared against a list a till has to read, and a legacy verifier is
      // upgraded with privileges this device does not have.
      const server = await serverEnforcement.verifyApprovalPin(cleanPin);
      if (server.status === 'ok' && server.data.verified) {
        return { success: true, adminName: server.data.adminName, adminId: server.data.adminId };
      }
      if (server.status === 'rejected') {
        // An answer of "no" is not a missing server: falling back here would make the
        // check decorative, and would let a wrong PIN through on a till that still has a
        // stale verifier list.
        return {
          success: false,
          error:
            server.code === 'permission-denied'
              ? 'Incorrect approval PIN. Please check and try again.'
              : server.message,
        };
      }
      holders = await userService.getApprovalPinVerifiers();
    } catch (err) {
      // The verifiers live in an admin-only subcollection: a staff till is denied by
      // design, and without the callable there is no local way to check a PIN.
      if (errorCode(err) === 'permission-denied') {
        return {
          success: false,
          error: 'Quick PIN is not available on this till. Use Remote Request, or the admin password fallback below.',
        };
      }
      return {
        success: false,
        error: 'Could not reach the server to verify the approval PIN. Send a remote approval request instead.',
      };
    }

    if (holders.length === 0) {
      return {
        success: false,
        noPinConfigured: true,
        error: 'No administrator has configured an approval PIN yet.',
      };
    }

    // Check each admin's PIN
    for (const holder of holders) {
      const isMatch = await verifyApprovalPin(cleanPin, holder.approvalPin);
      if (isMatch) {
        if (isLegacyApprovalPinVerifier(holder.approvalPin)) {
          // Best-effort: a staff till is not allowed to write other users' profiles, and the
          // approval above already succeeded, so a rejected upgrade must stay silent.
          void upgradeLegacyPinVerifier(holder.id, cleanPin);
        }
        return {
          success: true,
          adminName: holder.name,
          adminId: holder.id,
        };
      }
    }

    return {
      success: false,
      error: 'Incorrect approval PIN. Please check and try again.',
    };
  },

  subscribeToPending: () => {
    // Two indexed streams instead of one unfiltered scan. The old `limit(150)` with no ordering
    // returned the OLDEST 150 requests (auto ids sort chronologically), so once a shop's approval
    // history outgrew that window new pending requests stopped reaching the badge at all.
    // Both queries use the (status, requestedAt) composite index already in firestore.indexes.json.
    const pendingQuery = query(
      collection(db, 'approvalRequests'),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc'),
      limit(100)
    );

    const resolvedQuery = query(
      collection(db, 'approvalRequests'),
      where('status', 'in', ['approved', 'rejected']),
      orderBy('requestedAt', 'desc'),
      limit(30)
    );

    let pendingRequests: ApprovalRequest[] = [];
    let recentResolved: ApprovalRequest[] = [];

    const unsubscribePending = onSnapshot(
      pendingQuery,
      (snapshot) => {
        pendingRequests = snapshot.docs.map(
          (docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ApprovalRequest)
        );

        // The chime compares against the previous pending set, so only the pending stream may
        // seed or advance it — otherwise a resolved snapshot landing first would make every
        // already-open request look new and ring on app start.
        const currentPendingIds = new Set(pendingRequests.map(r => r.id));
        if (_knownPendingIds !== null) {
          const newReqs = pendingRequests.filter(r => !_knownPendingIds!.has(r.id));
          if (newReqs.length > 0) {
            playApprovalNotificationChime();
          }
        }
        _knownPendingIds = currentPendingIds;

        set({
          pendingRequests,
          pendingCount: pendingRequests.length,
          error: null,
        });
      },
      (err) => {
        console.error('Approval subscription error:', err);
        set({ error: err.message });
      }
    );

    const unsubscribeResolved = onSnapshot(
      resolvedQuery,
      (snapshot) => {
        recentResolved = snapshot.docs.map(
          (docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ApprovalRequest)
        );
        set({ recentResolved, error: null });
      },
      (err) => {
        console.error('Approval resolved-stream error:', err);
        set({ error: err.message });
      }
    );

    return () => {
      unsubscribePending();
      unsubscribeResolved();
    };
  },

  subscribeToSingleRequest: (requestId: string, onUpdate: (req: ApprovalRequest) => void) => {
    const docRef = doc(db, 'approvalRequests', requestId);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = {
            id: snap.id,
            ...snap.data(),
          } as ApprovalRequest;
          onUpdate(data);
        }
      },
      (err) => {
        console.error('Single approval subscription error:', err);
      }
    );

    return unsubscribe;
  },
}));
