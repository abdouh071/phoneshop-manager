import { useEffect, useRef } from 'react';
import { useEndOfDayStore, toDateStr } from '../store/endOfDayStore';
import { useToast } from '../components/ui/Toast';

/**
 * Global background watcher that:
 * 1. Automatically seals the day at 00:00:01 midnight.
 * 2. On app load or wake-from-sleep, checks if yesterday was left open and auto-closes it.
 */
export const useMidnightAutoClose = () => {
  const { checkTodayRecord, autoCloseMissedDays, closeDay, fetchRecords } = useEndOfDayStore();
  const toast = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Initial check on mount
    checkTodayRecord();

    // Catch up on any unclosed past days (e.g. computer was asleep overnight)
    autoCloseMissedDays().then(record => {
      if (record) {
        toast.info(
          'Past Day Auto-Closed',
          `End of Day report for ${record.date} was automatically closed and locked.`
        );
      }
    }).catch(console.error);

    // Schedule next midnight trigger
    const scheduleNextMidnight = () => {
      if (timerRef.current) clearTimeout(timerRef.current);

      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2); // 00:00:02
      const msUntilMidnight = Math.max(1000, nextMidnight.getTime() - now.getTime());

      timerRef.current = setTimeout(async () => {
        try {
          // The day that just ended is yesterday (1 second ago)
          const justEnded = new Date(Date.now() - 5000);
          const justEndedStr = toDateStr(justEnded);

          await fetchRecords();
          const { records } = useEndOfDayStore.getState();
          const alreadyDone = records.some(r => r.date === justEndedStr);

          if (!alreadyDone) {
            const closed = await closeDay(true, 'Auto-closed at midnight (00:00)', justEndedStr);
            toast.success(
              'End of Day Declared',
              `Midnight reached (00:00). Day report for ${closed.date} was automatically locked.`
            );
          }
          await checkTodayRecord();
        } catch (err) {
          console.error('[EndOfDay] Midnight auto-close error:', err);
        } finally {
          scheduleNextMidnight();
        }
      }, msUntilMidnight);
    };

    scheduleNextMidnight();

    // Re-check whenever computer wakes from sleep or tab regains visibility
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkTodayRecord();
        autoCloseMissedDays().then(record => {
          if (record) {
            toast.info(
              'Past Day Auto-Closed',
              `End of Day report for ${record.date} was automatically closed and locked.`
            );
          }
        }).catch(console.error);
        scheduleNextMidnight();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
};
