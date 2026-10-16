import { create } from 'zustand';
import { activityLogService, inferSeverity } from '../services/activityLogService';
import type { ActivityCategory, ActivitySeverity, ActivityEntityType, ActivityLog, LogOptions } from '../services/activityLogService';
import { useAuthStore } from './authStore';

export type { ActivityCategory, ActivitySeverity, ActivityEntityType, LogOptions };

export interface Activity {
  id: string;
  category: ActivityCategory;
  message: string;
  detail?: string;
  entityId?: string;
  entityType?: ActivityEntityType;
  severity: ActivitySeverity;
  userName?: string;
  userId?: string;
  timestamp: string; // Guaranteed ISO string
}

interface ActivityState {
  activities: Activity[];
  isLoading: boolean;
  isLive: boolean;
  lastUpdated: string | null;
  error: string | null;
  limitCount: number;

  fetchActivities: (limitCount?: number) => Promise<void>;
  subscribeActivities: (limitCount?: number) => () => void;
  setLimitCount: (limit: number) => void;
  purgeOldLogs: (daysToKeep?: number) => Promise<number>;
  logActivity: (
    category: ActivityCategory,
    message: string,
    entityIdOrOptions?: string | LogOptions,
    userId?: string
  ) => Promise<void>;
}

/**
 * Normalizes Firestore timestamp, Date, number, or string to a reliable ISO string.
 * Completely eliminates the Jan 1, 1970 ("56 years ago") race condition bug.
 */
export const toISO = (ts: any): string => {
  if (!ts) return new Date().toISOString();
  try {
    if (ts.toDate && typeof ts.toDate === 'function') {
      const d = ts.toDate();
      return d.getTime() > 1000000 ? d.toISOString() : new Date().toISOString();
    }
    if (ts instanceof Date) {
      return ts.getTime() > 1000000 ? ts.toISOString() : new Date().toISOString();
    }
    if (typeof ts === 'number') {
      return ts > 1000000 ? new Date(ts).toISOString() : new Date().toISOString();
    }
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return !isNaN(d.getTime()) && d.getTime() > 1000000 ? d.toISOString() : new Date().toISOString();
    }
  } catch {
    // Fallback on any conversion issue
  }
  return new Date().toISOString();
};

const mapLogToActivity = (l: ActivityLog): Activity => ({
  id: l.id,
  category: l.category,
  message: l.message,
  detail: l.detail ?? undefined,
  entityId: l.entityId ?? undefined,
  entityType: l.entityType ?? undefined,
  severity: l.severity || inferSeverity(l.message, l.detail ?? undefined),
  userName: l.userName ?? undefined,
  userId: l.userId ?? undefined,
  timestamp: toISO(l.timestamp),
});

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  isLoading: false,
  isLive: false,
  lastUpdated: null,
  error: null,
  limitCount: 200,

  setLimitCount: (limitCount: number) => {
    set({ limitCount });
    get().fetchActivities(limitCount);
  },

  /**
   * One-time fetch of activities
   */
  fetchActivities: async (customLimit?: number) => {
    const limitCount = customLimit || get().limitCount;
    set({ isLoading: true, error: null });
    try {
      const logs = await activityLogService.getAll(limitCount);
      const activities = logs.map(mapLogToActivity);
      set({
        activities,
        isLoading: false,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Failed to fetch activities:', err);
      set({ error: err?.message || 'Failed to load activity log', isLoading: false });
    }
  },

  /**
   * Real-time onSnapshot subscription to live store activities
   */
  subscribeActivities: (customLimit?: number) => {
    const limitCount = customLimit || get().limitCount;
    set({ isLoading: true, error: null });

    const unsubscribe = activityLogService.subscribe((logs) => {
      const activities = logs.map(mapLogToActivity);
      set({
        activities,
        isLoading: false,
        isLive: true,
        lastUpdated: new Date().toISOString(),
      });
    }, limitCount);

    return () => {
      unsubscribe();
      set({ isLive: false });
    };
  },

  /**
   * Purge logs older than X days
   */
  purgeOldLogs: async (daysToKeep: number = 90) => {
    try {
      const count = await activityLogService.purgeOldLogs(daysToKeep);
      await get().fetchActivities();
      return count;
    } catch (err: any) {
      console.error('Failed to purge old activity logs:', err);
      throw err;
    }
  },

  /**
   * Log a new activity with optimistic update
   */
  logActivity: async (category, message, entityIdOrOptions, userId) => {
    try {
      let options: LogOptions = {};
      if (typeof entityIdOrOptions === 'string') {
        // Legacy: logActivity(cat, msg, entityId, userId)
        options = { entityId: entityIdOrOptions, userId };
      } else if (entityIdOrOptions && typeof entityIdOrOptions === 'object') {
        options = entityIdOrOptions;
      }

      // Look up actor if missing
      const storeUser = useAuthStore.getState().user;
      if (!options.userName && storeUser) {
        options.userName = storeUser.name;
        options.userId = options.userId || storeUser.id;
      }

      const severity = options.severity || inferSeverity(message, options.detail);

      await activityLogService.log(category, message, { ...options, severity });

      // Optimistic local state update
      const optimistic: Activity = {
        id: 'opt_' + Math.random().toString(36).substr(2, 9),
        category,
        message,
        detail: options.detail,
        entityId: options.entityId,
        entityType: options.entityType,
        severity,
        userName: options.userName,
        userId: options.userId,
        timestamp: new Date().toISOString(),
      };

      set(state => ({
        activities: [optimistic, ...state.activities.filter(a => a.id !== optimistic.id)],
        lastUpdated: new Date().toISOString(),
      }));
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  },
}));
