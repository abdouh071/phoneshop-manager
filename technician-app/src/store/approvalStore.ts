import { create } from 'zustand';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  query,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { Vibration } from 'react-native';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import { createRefCountedSubscription, type RefCountedSubscription } from '../utils/liveSubscription';
import { notificationService } from '../services/notificationService';
import { activityLogService } from '../services/activityLogService';
import { voidSale, type SaleVoidOutcome } from '../services/saleVoidService';
import type { ApprovalRequest, SaleTransaction } from '../types';

/**
 * Actions whose `targetId` names an invoice. Every other action points at a product,
 * a part, a ticket, a customer or a debt — stamping those ids into `transactions`
 * writes at a document that was never there.
 */
const INVOICE_ACTIONS = ['void_sale', 'pos_edit_receipt', 'pos_refund_transaction', 'pos_discount_override'];

interface ApprovalState {
  pendingRequests: ApprovalRequest[];
  recentResolved: ApprovalRequest[];
  pendingCount: number;
  isLoading: boolean;
  error: string | null;

  submitRequest: (params: {
    actionType: string;
    actionLabel: string;
    actionData?: Record<string, any>;
    targetId?: string;
    reason?: string;
  }) => Promise<string>;

  cancelRequest: (requestId: string) => Promise<void>;

  /**
   * Approving an action. Answers with what the void left undone — stock the server
   * refused to take back, a balance this phone could not reach — and with null for any
   * action that has no side-effect to report. The approver is the one person standing
   * close enough to finish those, so they come back rather than into a console.
   */
  approveRequest: (requestId: string, method?: 'remote' | 'pin') => Promise<SaleVoidOutcome | null>;

  rejectRequest: (requestId: string, reason?: string) => Promise<void>;

  subscribeToPending: () => (() => void);

  subscribeToSingleRequest: (requestId: string, onUpdate: (req: ApprovalRequest) => void) => (() => void);
}

// Track IDs globally to avoid duplicate vibration/chimes on mobile
let _knownPendingIds: Set<string> | null = null;

// The Approvals screen and the admin dashboard can be mounted at the same time.
// Without refcounting, each held its own listener on the same 120-document query,
// so every request arriving was billed and processed twice.
let _pendingStream: RefCountedSubscription | null = null;

type PendingSetter = (partial: Partial<ApprovalState>) => void;

const attachPendingListeners = (set: PendingSetter): (() => void) => {
  set({ isLoading: true });
  // Query approval requests (limit to 120 items)
  const q = query(collection(db, 'approvalRequests'), limit(120));

  return onSnapshot(
    q,
    (snapshot) => {
      const all: ApprovalRequest[] = [];
      snapshot.forEach((d) => {
        all.push({ id: d.id, ...d.data() } as ApprovalRequest);
      });

      // Sort descending by requestedAt
      all.sort((a, b) => {
        const tA = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
        const tB = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
        return tB - tA;
      });

      const pending = all.filter((r) => r.status === 'pending');
      const resolved = all.filter((r) => r.status === 'approved' || r.status === 'rejected').slice(0, 30);

      // Check if there is a new pending request that just arrived
      if (_knownPendingIds !== null) {
        const currentIds = new Set(pending.map((r) => r.id));
        const hasNew = pending.some((r) => !_knownPendingIds!.has(r.id));
        if (hasNew) {
          const currentUser = useAuthStore.getState().user;
          if (currentUser?.role === 'admin') {
            Vibration.vibrate([0, 200, 100, 200]);
          }
        }
        _knownPendingIds = currentIds;
      } else {
        _knownPendingIds = new Set(pending.map((r) => r.id));
      }

      set({
        pendingRequests: pending,
        recentResolved: resolved,
        pendingCount: pending.length,
        isLoading: false,
        error: null,
      });
    },
    (err) => {
      console.warn('[ApprovalStore] Subscription error:', err);
      set({ error: err.message, isLoading: false });
    }
  );
};

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  pendingRequests: [],
  recentResolved: [],
  pendingCount: 0,
  isLoading: false,
  error: null,

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
        avatar: user.name ? user.name[0].toUpperCase() : 'U',
      },
      status: 'pending' as const,
      requestedAt: new Date().toISOString(),
      reason: reason?.trim() || '',
      createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'approvalRequests'), newRequestData);

    // Push trilingual notification to all Admins
    notificationService.notifyAdminsNewApprovalRequest(
      user.name,
      actionLabel,
      reason,
      docRef.id
    ).catch(err => console.warn('[ApprovalStore] Push notify admins error:', err));

    // Log to activity feed
    activityLogService.log('system', `Approval requested by ${user.name}: "${actionLabel}"`, {
      entityId: docRef.id,
      entityType: 'approval_request',
      detail: reason || actionType,
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

  approveRequest: async (requestId: string, method: 'remote' | 'pin' = 'remote'): Promise<SaleVoidOutcome | null> => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('Not authenticated.');
    if (user.role !== 'admin') {
      throw new Error('Only administrators can approve requests.');
    }

    const docRef = doc(db, 'approvalRequests', requestId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Approval request not found.');

    const reqData = snap.data() as ApprovalRequest;
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

    // Execute side-effects for specific actions (such as void sale)
    let voidOutcome: SaleVoidOutcome | null = null;
    if (reqData.actionType === 'void_sale' && reqData.targetId) {
      try {
        // The same void the till runs: the goods go back, the credit record closes and
        // the profile's numbers follow. Answering only with a status used to leave an
        // approved invoice standing on the shelf it had already emptied.
        const txSnap = await getDoc(doc(db, 'transactions', reqData.targetId));
        if (txSnap.exists()) {
          voidOutcome = await voidSale(
            { ...(txSnap.data() as SaleTransaction), id: txSnap.id },
            `Void approved by ${user.name}${reqData.reason ? ` — ${reqData.reason}` : ''}`
          );
        } else {
          console.warn('[ApprovalStore] Approved void names a transaction that is not there:', reqData.targetId);
        }
      } catch (txErr) {
        console.warn('[ApprovalStore] Error marking transaction voided:', txErr);
      }
    }

    // Record which approval authorised this money movement so an audit can trace
    // void→approval→invoice without relying on the approval list alone. This outlives
    // `approvalRequestId`, which names the request an invoice is still waiting on and
    // is cleared the moment the correction lands. A refusal authorises nothing, so
    // only an approve writes it.
    if (reqData.targetId && INVOICE_ACTIONS.includes(reqData.actionType)) {
      updateDoc(doc(db, 'transactions', reqData.targetId), {
        approvedRequestId: requestId,
      }).catch((err) => console.error('[ApprovalStore] approvedRequestId back-link failed:', err));
    }

    // Push trilingual notification back to requesting staff member
    if (reqData.requestedBy?.uid) {
      notificationService.notifyStaffApprovalDecision(
        reqData.requestedBy.uid,
        reqData.actionLabel,
        'approved',
        user.name
      ).catch(err => console.warn('[ApprovalStore] Push notify staff approved error:', err));
    }

    // Activity log
    activityLogService.log('system', `Admin ${user.name} approved request: "${reqData.actionLabel || requestId}"`, {
      entityId: requestId,
      entityType: 'approval_request',
      detail: `Approved via ${method}`,
      userName: user.name,
      userId: user.id,
    }).catch(console.error);

    return voidOutcome;
  },

  rejectRequest: async (requestId: string, reason?: string) => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('Not authenticated.');
    if (user.role !== 'admin') {
      throw new Error('Only administrators can reject requests.');
    }

    const docRef = doc(db, 'approvalRequests', requestId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Approval request not found.');

    const reqData = snap.data() as ApprovalRequest;
    const resolvedAt = new Date().toISOString();
    const finalReason = reason?.trim() || 'Rejected by administrator';

    await updateDoc(docRef, {
      status: 'rejected',
      resolvedAt,
      resolvedBy: {
        uid: user.id,
        name: user.name,
      },
      rejectionReason: finalReason,
    });

    // If sale void was rejected, revert transaction to completed
    if (reqData.actionType === 'void_sale' && reqData.targetId) {
      try {
        await updateDoc(doc(db, 'transactions', reqData.targetId), {
          status: 'completed',
        });
      } catch (txErr) {
        console.warn('[ApprovalStore] Error reverting transaction status:', txErr);
      }
    }

    // Push trilingual notification back to requesting staff member
    if (reqData.requestedBy?.uid) {
      notificationService.notifyStaffApprovalDecision(
        reqData.requestedBy.uid,
        reqData.actionLabel,
        'rejected',
        user.name,
        finalReason
      ).catch(err => console.warn('[ApprovalStore] Push notify staff rejected error:', err));
    }

    // Activity log
    activityLogService.log('system', `Admin ${user.name} rejected request: "${reqData.actionLabel || requestId}" (${finalReason})`, {
      entityId: requestId,
      entityType: 'approval_request',
      detail: finalReason,
      userName: user.name,
      userId: user.id,
    }).catch(console.error);
  },

  subscribeToPending: () => {
    if (!_pendingStream) {
      _pendingStream = createRefCountedSubscription(() =>
        attachPendingListeners((partial) => set(partial))
      );
    }
    return _pendingStream.acquire();
  },

  subscribeToSingleRequest: (requestId: string, onUpdate: (req: ApprovalRequest) => void) => {
    const docRef = doc(db, 'approvalRequests', requestId);
    return onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          onUpdate({ id: snap.id, ...snap.data() } as ApprovalRequest);
        }
      },
      (err) => {
        console.error('[ApprovalStore] Single request listener error:', err);
      }
    );
  },
}));
