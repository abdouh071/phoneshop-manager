import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import type { ActivityCategory, ActivitySeverity } from '../types';

export const activityLogService = {
  log: async (
    category: ActivityCategory,
    message: string,
    options?: {
      detail?: string;
      entityId?: string;
      entityType?: string;
      severity?: ActivitySeverity;
      userName?: string;
      userId?: string;
    }
  ): Promise<void> => {
    try {
      const user = useAuthStore.getState().user;
      const userName = options?.userName || user?.name || 'Mobile App';
      const userId = options?.userId || user?.id || 'technician-app';

      let severity: ActivitySeverity = options?.severity || 'info';
      const text = `${message} ${options?.detail || ''}`.toLowerCase();
      if (text.includes('claimed') || text.includes('repaired') || text.includes('created')) {
        severity = 'success';
      } else if (text.includes('error') || text.includes('failed') || text.includes('delete')) {
        severity = 'danger';
      }

      await addDoc(collection(db, 'activityLogs'), {
        category,
        message,
        detail: options?.detail ?? null,
        entityId: options?.entityId ?? null,
        entityType: options?.entityType ?? null,
        severity,
        userName,
        userId,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.warn('[ActivityLog] Failed to log activity:', err);
    }
  }
};
