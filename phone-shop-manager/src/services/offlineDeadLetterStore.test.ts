/**
 * Dead-letter visibility for abandoned offline writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { offlineQueue, UnrecoverableSyncActionError } from './offlineQueue';
import { offlineDeadLetterStore } from './offlineDeadLetterStore';
import { inventoryService } from './inventoryService';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';

const mockStorage = new Map<string, string>();
let storageThrows = false;
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => {
    if (storageThrows) throw new Error('QuotaExceeded: storage full');
    mockStorage.set(key, String(value));
  },
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

// The products' Firestore document is gone; only the existence check matters here.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDoc: async () => ({ exists: () => false, data: () => undefined }),
  };
});

describe('offlineDeadLetterStore', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('navigator', { onLine: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStorage.clear();
    storageThrows = false;
    offlineQueue.clear();
    offlineDeadLetterStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('action_queue abandonment', () => {
    it('logs the action when it runs out of retries, with the payload needed to re-drive it', async () => {
      vi.useFakeTimers();
      offlineQueue.registerHandler('TEST_EXPLODES', async () => {
        throw new Error('permission denied');
      });
      await offlineQueue.enqueue({ type: 'TEST_EXPLODES', payload: { id: 't1', status: 'completed' } });

      // Five attempts, each after the previous back-off window has elapsed.
      for (let attempt = 0; attempt < 5; attempt++) {
        await offlineQueue.flush();
        vi.advanceTimersByTime(60_000);
      }

      expect(offlineQueue.getPendingCount()).toBe(0);
      const letters = offlineDeadLetterStore.list();
      expect(letters).toHaveLength(1);
      expect(letters[0].reason).toBe('retries_exhausted');
      expect(letters[0].type).toBe('TEST_EXPLODES');
      expect(letters[0].attempts).toBe(5);
      expect(letters[0].detail).toBe('permission denied');
      expect(letters[0].payload).toEqual({ id: 't1', status: 'completed' });
    });

    it('logs the action when nothing can handle it', async () => {
      await offlineQueue.enqueue({ type: 'TEST_ORPHAN', payload: { id: 'z9' } });

      await offlineQueue.flush();

      expect(offlineQueue.getPendingCount()).toBe(0);
      expect(offlineDeadLetterStore.list()[0].reason).toBe('no_handler');
    });

    it('logs the action once when its handler says no retry could ever land it', async () => {
      offlineQueue.registerHandler('TEST_TEMP_ID', async () => {
        throw new UnrecoverableSyncActionError('targets offline_tkt_1, an id only this device knew');
      });
      await offlineQueue.enqueue({ type: 'TEST_TEMP_ID', payload: { id: 'offline_tkt_1' } });

      await offlineQueue.flush();

      // Gone from the queue on the first pass, not retried five times, and visible to the
      // shop either way: an immortal entry used to be counted as synced on every pass.
      expect(offlineQueue.getPendingCount()).toBe(0);
      const letters = offlineDeadLetterStore.list();
      expect(letters).toHaveLength(1);
      expect(letters[0].reason).toBe('unrecoverable');
      expect(letters[0].attempts).toBe(0);
      expect(letters[0].detail).toContain('only this device knew');
    });

    it('does not log an action that is merely waiting to be retried', async () => {
      vi.useFakeTimers();
      offlineQueue.registerHandler('TEST_FLAKY', async () => {
        throw new Error('network dropped');
      });
      await offlineQueue.enqueue({ type: 'TEST_FLAKY', payload: { id: 't2' } });

      await offlineQueue.flush();

      expect(offlineQueue.getPendingCount()).toBe(1);
      expect(offlineDeadLetterStore.count()).toBe(0);
    });
  });

  describe('stock_adjustment abandonment', () => {
    it('logs a queued adjustment whose product document no longer exists', async () => {
      inventoryService.savePendingStockAdjustments([
        { id: 'adj_1', productId: 'prod_gone', delta: -2, newStock: 4, mode: 'relative', timestamp: '2026-01-01T00:00:00.000Z' },
      ]);

      expect(await unifiedOfflineSyncService.syncOfflineStockAdjustments()).toBe(1);
      expect(inventoryService.getPendingStockAdjustments()).toHaveLength(0);

      const letters = offlineDeadLetterStore.list();
      expect(letters).toHaveLength(1);
      expect(letters[0].source).toBe('stock_adjustment');
      expect(letters[0].reason).toBe('document_missing');
      expect(letters[0].enqueuedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('retry and dismissal', () => {
    it('re-queues an abandoned action and removes it from the log', async () => {
      await offlineQueue.enqueue({ type: 'TEST_ORPHAN', payload: { id: 'z9' } });
      await offlineQueue.flush();
      expect(offlineDeadLetterStore.count()).toBe(1);

      const letterId = offlineDeadLetterStore.list()[0].id;
      expect(await offlineDeadLetterStore.retry(letterId)).toBe(true);

      expect(offlineDeadLetterStore.count()).toBe(0);
      expect(offlineQueue.getPendingCount()).toBe(1);
      expect(JSON.parse(localStorage.getItem('offline_action_queue') || '[]')[0].payload).toEqual({ id: 'z9' });
    });

    it('puts an abandoned stock adjustment back into its queue', async () => {
      inventoryService.savePendingStockAdjustments([
        { id: 'adj_2', productId: 'prod_gone', delta: -1, newStock: 3, mode: 'relative', timestamp: '2026-01-02T00:00:00.000Z' },
      ]);
      await unifiedOfflineSyncService.syncOfflineStockAdjustments();
      expect(inventoryService.getPendingStockAdjustments()).toHaveLength(0);

      expect(await offlineDeadLetterStore.retry(offlineDeadLetterStore.list()[0].id)).toBe(true);
      const restored = inventoryService.getPendingStockAdjustments();
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe('adj_2');
    });

    it('keeps the entry when re-queueing fails, so nothing is lost twice', async () => {
      await offlineQueue.enqueue({ type: 'TEST_ORPHAN', payload: { id: 'z9' } });
      await offlineQueue.flush();
      const letterId = offlineDeadLetterStore.list()[0].id;

      storageThrows = true;
      expect(await offlineDeadLetterStore.retry(letterId)).toBe(false);
      storageThrows = false;

      expect(offlineDeadLetterStore.list()[0].id).toBe(letterId);
    });

    it('dismisses a single entry and clears the log', async () => {
      offlineDeadLetterStore.record({ source: 'action_queue', type: 'A', payload: {}, reason: 'no_handler', attempts: 0 });
      offlineDeadLetterStore.record({ source: 'action_queue', type: 'B', payload: {}, reason: 'no_handler', attempts: 0 });
      expect(offlineDeadLetterStore.list().map(l => l.type)).toEqual(['B', 'A']);

      const [newest, oldest] = offlineDeadLetterStore.list();
      expect([newest.type, oldest.type]).toEqual(['B', 'A']);

      offlineDeadLetterStore.dismiss(oldest.id);
      expect(offlineDeadLetterStore.list().map(l => l.type)).toEqual(['B']);

      offlineDeadLetterStore.clear();
      expect(offlineDeadLetterStore.count()).toBe(0);
    });
  });

  describe('log integrity', () => {
    it('never throws when the log itself cannot be written', () => {
      storageThrows = true;

      expect(() => offlineDeadLetterStore.record({
        source: 'action_queue', type: 'A', payload: {}, reason: 'no_handler', attempts: 0,
      })).not.toThrow();
      expect(offlineDeadLetterStore.count()).toBe(0);
    });

    it('keeps the newest entries and counts what it had to trim', () => {
      for (let i = 0; i < 205; i++) {
        offlineDeadLetterStore.record({ source: 'action_queue', type: `A${i}`, payload: { i }, reason: 'no_handler', attempts: 0 });
      }

      expect(offlineDeadLetterStore.count()).toBe(200);
      expect(offlineDeadLetterStore.list()[0].type).toBe('A204');
      expect(offlineDeadLetterStore.evictedTotal()).toBe(5);
    });

    it('notifies subscribers so the badge can update without polling', () => {
      const seen: number[] = [];
      const unsubscribe = offlineDeadLetterStore.subscribe(count => seen.push(count));

      offlineDeadLetterStore.record({ source: 'action_queue', type: 'A', payload: {}, reason: 'no_handler', attempts: 0 });
      unsubscribe();
      offlineDeadLetterStore.record({ source: 'action_queue', type: 'B', payload: {}, reason: 'no_handler', attempts: 0 });

      expect(seen).toEqual([0, 1]);
    });
  });
});
