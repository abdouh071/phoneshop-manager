/**
 * Dropped-writes warning (admin only)
 * ===================================
 * Unlike OfflineBanner, this does not disappear when the connection comes back: a write
 * that was abandoned three days ago is still abandoned today, and the only way to notice
 * one is to be told. It sits in the same slot as the offline banner so the two never compete
 * for space, and opens the review modal where each dropped write can be retried or dismissed.
 */
import React, { useEffect, useState } from 'react';
import { AlertOctagon, ChevronRight, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { offlineDeadLetterStore } from '../../services/offlineDeadLetterStore';
import { offlineQueueMirror } from '../../services/offlineQueueMirror';
import { DroppedWritesModal } from '../../features/sync/DroppedWritesModal';
import styles from './DroppedWritesBanner.module.css';

export const DroppedWritesBanner: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [count, setCount] = useState<number>(() => offlineDeadLetterStore.count());
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.isSuperAdmin === true;

  useEffect(
    () => offlineDeadLetterStore.subscribe(setCount),
    [],
  );

  if (!isAdmin) return null;

  // The mirror only reports trouble after it has been opened, which the app does before
  // anything that can write a queue.
  const mirror = offlineQueueMirror.stats();
  const mirrorDegraded = !mirror.available || mirror.failures > 0;

  // The modal stays mounted once opened, even if the last entry is dismissed inside it:
  // unmounting from under the admin would close the dialog mid-action instead of showing
  // the empty state. Modal renders nothing while closed.
  return (
    <>
      {count > 0 ? (
        <button
          type="button"
          className={styles.banner}
          onClick={() => setIsModalOpen(true)}
          aria-label={t('common.droppedWritesTitle')}
        >
          <AlertOctagon size={14} />
          <span>{t('common.droppedWrites', { count })}</span>
          {mirrorDegraded && (
            <span className={styles.mirrorTag}>{t('common.queueMirrorUnavailableShort')}</span>
          )}
          <span className={styles.action}>
            {t('common.review')}
            <ChevronRight size={14} />
          </span>
        </button>
      ) : mirrorDegraded ? (
        <div className={styles.notice} role="status">
          <Database size={14} />
          <span>{t('common.queueMirrorUnavailable')}</span>
        </div>
      ) : null}

      <DroppedWritesModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
};
