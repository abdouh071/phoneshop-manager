import { create } from 'zustand';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { activityLogService } from '../services/activityLogService';
import { verifyApprovalPin } from '../utils/security';

export interface ApprovalRequest {
  id: string;
  actionType: string;
  actionLabel: string;
  actionData?: Record<string, any>;
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
  createdAt?: any;
}

// Audible chime for new approval requests
export function playApprovalNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
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
    actionData?: Record<string, any>;
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

    let staff = useAuthStore.getState().staff;
    if (!staff || staff.length === 0) {
      await useAuthStore.getState().fetchStaff();
      staff = useAuthStore.getState().staff;
    }

    // Filter to active admins or super admins
    const activeAdmins = staff.filter(s => (s.role === 'admin' || s.isSuperAdmin) && s.status !== 'revoked');
    const adminsWithPin = activeAdmins.filter(s => Boolean(s.approvalPin));

    if (adminsWithPin.length === 0) {
      return {
        success: false,
        noPinConfigured: true,
        error: 'No administrator has configured an approval PIN yet.',
      };
    }

    // Check each admin's PIN
    for (const admin of adminsWithPin) {
      const isMatch = await verifyApprovalPin(cleanPin, admin.approvalPin!);
      if (isMatch) {
        return {
          success: true,
          adminName: admin.name,
          adminId: admin.id,
        };
      }
    }

    return {
      success: false,
      error: 'Incorrect approval PIN. Please check and try again.',
    };
  },

  subscribeToPending: () => {
    // We query the approvalRequests collection with a limit to avoid missing index errors
    // and filter status in memory.
    const q = query(collection(db, 'approvalRequests'), limit(150));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const all: ApprovalRequest[] = [];
        snapshot.forEach((docSnap) => {
          all.push({
            id: docSnap.id,
            ...docSnap.data(),
          } as ApprovalRequest);
        });

        // Sort descending by requestedAt
        all.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());

        const pending = all.filter(r => r.status === 'pending');
        const resolved = all.filter(r => r.status === 'approved' || r.status === 'rejected').slice(0, 30);

        const currentPendingIds = new Set(pending.map(r => r.id));
        if (_knownPendingIds !== null) {
          const newReqs = pending.filter(r => !_knownPendingIds!.has(r.id));
          if (newReqs.length > 0) {
            playApprovalNotificationChime();
          }
        }
        _knownPendingIds = currentPendingIds;

        set({
          pendingRequests: pending,
          recentResolved: resolved,
          pendingCount: pending.length,
          error: null,
        });
      },
      (err) => {
        console.error('Approval subscription error:', err);
        set({ error: err.message });
      }
    );

    return unsubscribe;
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
