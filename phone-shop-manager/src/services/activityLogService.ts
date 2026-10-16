import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  where,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';

export type ActivityCategory = 'inventory' | 'sales' | 'repairs' | 'system';
export type ActivitySeverity = 'info' | 'success' | 'warning' | 'danger';
export type ActivityEntityType = 'sale' | 'repair' | 'product' | 'part' | 'customer' | 'po' | 'supplier' | 'user' | 'system';

export interface ActivityLog {
  id: string;
  category: ActivityCategory;
  message: string;
  detail?: string | null;
  entityId?: string | null;
  entityType?: ActivityEntityType | null;
  severity?: ActivitySeverity;
  userName?: string | null;
  userId?: string | null;
  timestamp: any; // Firestore Timestamp or serverTimestamp
}

export interface LogOptions {
  detail?: string;
  entityId?: string;
  entityType?: ActivityEntityType;
  severity?: ActivitySeverity;
  userName?: string;
  userId?: string;
}

const COLLECTION = 'activityLogs';

/** Automatically infers severity based on log content if not explicitly provided */
export function inferSeverity(message: string, detail?: string): ActivitySeverity {
  const text = `${message} ${detail || ''}`.toLowerCase();
  if (
    text.includes('deleted') ||
    text.includes('refund') ||
    text.includes('cancelled') ||
    text.includes('write-off') ||
    text.includes('revoked') ||
    text.includes('failed') ||
    text.includes('denied')
  ) {
    return 'danger';
  }
  if (
    text.includes('unlocked') ||
    text.includes('warning') ||
    text.includes('low stock') ||
    text.includes('reverted') ||
    text.includes('exchange')
  ) {
    return 'warning';
  }
  if (
    text.includes('completed') ||
    text.includes('ready for pickup') ||
    text.includes('restocked') ||
    text.includes('created') ||
    text.includes('logged in') ||
    text.includes('settled') ||
    text.includes('added')
  ) {
    return 'success';
  }
  return 'info';
}

export const activityLogService = {
  /**
   * Write a new event to the Firestore activity log with automatic actor and severity inference.
   */
  log: async (
    category: ActivityCategory,
    message: string,
    options?: LogOptions
  ): Promise<void> => {
    // Resolve actor from options or active auth session
    let userName = options?.userName ?? null;
    let userId = options?.userId ?? null;

    if (!userName || !userId) {
      try {
        const storeUser = useAuthStore.getState().user;
        if (storeUser) {
          userName = userName || storeUser.name;
          userId = userId || storeUser.id;
        } else if (auth.currentUser) {
          userName = userName || auth.currentUser.displayName || auth.currentUser.email || 'Authenticated User';
          userId = userId || auth.currentUser.uid;
        }
      } catch {
        // Fallback to null if auth state cannot be read
      }
    }

    const severity = options?.severity || inferSeverity(message, options?.detail);

    await addDoc(collection(db, COLLECTION), {
      category,
      message,
      detail: options?.detail ?? null,
      entityId: options?.entityId ?? null,
      entityType: options?.entityType ?? null,
      severity,
      userName: userName ?? null,
      userId: userId ?? null,
      timestamp: serverTimestamp(),
    });
  },

  /**
   * Fetch the most recent activity logs with configurable limit.
   */
  getAll: async (limitCount: number = 200): Promise<ActivityLog[]> => {
    const q = query(
      collection(db, COLLECTION),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as ActivityLog[];
  },

  /**
   * Real-time Firestore onSnapshot listener for the activity feed.
   */
  subscribe: (
    callback: (logs: ActivityLog[]) => void,
    limitCount: number = 250
  ): (() => void) => {
    const q = query(
      collection(db, COLLECTION),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const logs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as ActivityLog[];
        callback(logs);
      },
      (error) => {
        console.error('Activity onSnapshot listener error:', error);
      }
    );
  },

  /**
   * Purge logs older than X days (admin maintenance utility).
   * Returns count of deleted records.
   */
  purgeOldLogs: async (daysToKeep: number = 90): Promise<number> => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    const q = query(
      collection(db, COLLECTION),
      where('timestamp', '<', cutoffTimestamp),
      limit(300)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) return 0;

    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    return snapshot.size;
  },
};
