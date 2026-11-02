/**
 * Dropped writes review (admin only)
 * ==================================
 * Lists every offline write that was abandoned before it reached Firestore, and lets the
 * shop owner put it back in the queue or dismiss it. Nothing here is read-only: a retry
 * re-queues the original payload exactly as it was stored, so the `offlineDeadLetterStore`
 * remove-before-requeue rule is what keeps a double tap from deducting stock twice.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Inbox, RotateCcw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../utils/errorUtils';
import {
  offlineDeadLetterStore,
  type DeadLetter,
  type DeadLetterReason,
} from '../../services/offlineDeadLetterStore';
import styles from './DroppedWritesModal.module.css';

interface DroppedWritesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const REASON_LABEL_KEY: Record<DeadLetterReason, string> = {
  retries_exhausted: 'common.dropReasonRetriesExhausted',
  no_handler: 'common.dropReasonNoHandler',
  document_missing: 'common.dropReasonDocumentMissing',
};

const REASON_HINT_KEY: Record<DeadLetterReason, string> = {
  retries_exhausted: 'common.dropHintRetriesExhausted',
  no_handler: 'common.dropHintNoHandler',
  document_missing: 'common.dropHintDocumentMissing',
};

const formatWhen = (iso: string | undefined): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export const DroppedWritesModal: React.FC<DroppedWritesModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [letters, setLetters] = useState<DeadLetter[]>(() => offlineDeadLetterStore.list());
  const [evicted, setEvicted] = useState<number>(() => offlineDeadLetterStore.evictedTotal());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  useEffect(
    () =>
      offlineDeadLetterStore.subscribe(() => {
        setLetters(offlineDeadLetterStore.list());
        setEvicted(offlineDeadLetterStore.evictedTotal());
      }),
    [],
  );

  const handleRetry = async (letter: DeadLetter) => {
    setBusyId(letter.id);
    try {
      const requeued = await offlineDeadLetterStore.retry(letter.id);
      if (requeued) {
        toast.success(t('common.dropRequeued'), t('common.dropRequeuedBody', { type: letter.type }));
      } else {
        toast.error(t('common.dropRequeueFailed'), t('common.dropRequeueFailedBody'));
      }
    } catch (e) {
      toast.error(t('common.dropRequeueFailed'), errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleRetryAll = async () => {
    setBusyAll(true);
    try {
      const requeued = await offlineDeadLetterStore.retryAll();
      if (requeued > 0) {
        toast.success(t('common.dropRequeued'), t('common.dropRequeuedCount', { count: requeued }));
      } else {
        toast.warning(t('common.dropRequeueFailed'), t('common.dropRequeueFailedBody'));
      }
    } catch (e) {
      toast.error(t('common.dropRequeueFailed'), errorMessage(e));
    } finally {
      setBusyAll(false);
    }
  };

  const handleDismiss = (letter: DeadLetter) => {
    offlineDeadLetterStore.dismiss(letter.id);
    toast.info(t('common.dropDismissed'), t('common.dropDismissedBody', { type: letter.type }));
  };

  const handleClearAll = () => {
    offlineDeadLetterStore.clear();
    toast.info(t('common.dropCleared'), t('common.dropClearedBody'));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.droppedWritesTitle')}
      subtitle={t('common.droppedWritesSubtitle')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
          {letters.length > 0 && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearAll}
                disabled={busyAll}
                leftIcon={<Trash2 size={14} />}
              >
                {t('common.clearAll')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRetryAll}
                isLoading={busyAll}
                leftIcon={<RotateCcw size={14} />}
              >
                {t('common.retryAll')}
              </Button>
            </>
          )}
        </>
      }
    >
      {letters.length === 0 ? (
        <div className={styles.empty}>
          <Inbox size={28} />
          <p className={styles.emptyTitle}>{t('common.dropNoneTitle')}</p>
          <p className={styles.emptyBody}>{t('common.dropNoneBody')}</p>
        </div>
      ) : (
        <>
          {evicted > 0 && (
            <div className={styles.evictedNotice}>
              {t('common.dropEvictedNotice', { count: evicted })}
            </div>
          )}
          <ul className={styles.list}>
            {letters.map(letter => (
              <li key={letter.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.itemType}>{letter.type}</span>
                  <span className={styles.itemReason}>
                    <AlertTriangle size={12} />
                    {t(REASON_LABEL_KEY[letter.reason])}
                  </span>
                  <span className={styles.itemWhen}>{formatWhen(letter.droppedAt)}</span>
                </div>

                <p className={styles.itemHint}>{t(REASON_HINT_KEY[letter.reason])}</p>

                {letter.detail && <p className={styles.itemDetail}>{letter.detail}</p>}

                <div className={styles.itemMeta}>
                  {letter.attempts > 0 && (
                    <span>{t('common.dropAttempts', { count: letter.attempts })}</span>
                  )}
                  {letter.enqueuedAt && (
                    <span>
                      {t('common.dropQueuedAt')} {formatWhen(letter.enqueuedAt)}
                    </span>
                  )}
                </div>

                <div className={styles.itemActions}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDismiss(letter)}
                    disabled={busyId === letter.id}
                    leftIcon={<X size={14} />}
                  >
                    {t('common.dismiss')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleRetry(letter)}
                    isLoading={busyId === letter.id}
                    leftIcon={<RotateCcw size={14} />}
                  >
                    {t('common.retry')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
};
