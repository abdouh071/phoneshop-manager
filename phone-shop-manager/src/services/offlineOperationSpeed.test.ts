import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repairService } from './repairService';
import { customerService } from './customerService';
import { transactionService } from './transactionService';
import { debtService } from './debtService';
import { activityLogService } from './activityLogService';
import { cartService } from './cartService';

// In-memory mock for localStorage in Node environment
type QueuedSyncAction = { type: string; payload?: { id?: string } };
const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

describe('Offline Fast-Path & Zero-Hang Operations', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  describe('repairService offline behavior', () => {
    it('creates ticket immediately when offline with fallback ticket number and offline id', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const startTime = Date.now();
      const ticket = await repairService.createTicket({
        customerName: 'Karim Offline',
        customerPhone: '0555123456',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 13',
        issueDescription: 'Screen replacement',
        estimatedCost: 15000,
        status: 'pending',
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100); // Must resolve in < 100ms
      expect(ticket.id).toMatch(/^offline_tkt_/);
      expect(ticket.ticketNumber).toMatch(/^TKT-\d+/);
      expect(ticket.customerName).toBe('Karim Offline');

      // Verify stored in local storage
      const local = JSON.parse(mockStorage.get('offline_repairs') || '[]');
      expect(local.length).toBe(1);
      expect(local[0].id).toBe(ticket.id);
    });

    it('updates ticket immediately without calling remote server when offline or offline id', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const offlineId = 'offline_tkt_12345';
      mockStorage.set('offline_repairs', JSON.stringify([{
        id: offlineId,
        ticketNumber: 'TKT-0001',
        customerName: 'Karim',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 13',
        status: 'pending',
        estimatedCost: 15000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));

      const startTime = Date.now();
      const updated = await repairService.updateTicket(offlineId, {
        status: 'ready',
        actualCost: 16000,
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(updated.status).toBe('ready');
      expect(updated.actualCost).toBe(16000);

      const local = JSON.parse(mockStorage.get('offline_repairs') || '[]');
      expect(local[0].status).toBe('ready');
      expect(local[0].actualCost).toBe(16000);
    });

    it('updates ticket with online doc ID immediately when offline and enqueues to offlineQueue', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const onlineDocId = 'server_doc_tkt_0039';
      mockStorage.set('offline_repairs', JSON.stringify([{
        id: onlineDocId,
        ticketNumber: 'TKT-0039',
        customerName: 'amrouch',
        customerPhone: '0555123456',
        deviceBrand: 'Oppo',
        deviceModel: 'a5s',
        status: 'ready',
        estimatedCost: 3400,
        depositAmount: 3400,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));

      const startTime = Date.now();
      const updated = await repairService.updateTicket(onlineDocId, {
        status: 'completed',
        actualCost: 3400,
        paidAmount: 3400,
        handoverAmountPaid: 0,
        paymentStatus: 'paid',
        completedAt: new Date().toISOString(),
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(updated.status).toBe('completed');
      expect(updated.paymentStatus).toBe('paid');

      const local = JSON.parse(mockStorage.get('offline_repairs') || '[]');
      expect(local[0].status).toBe('completed');
      expect(local[0].paymentStatus).toBe('paid');

      // Verify action is enqueued for later sync
      const queue = JSON.parse(mockStorage.get('offline_action_queue') || '[]');
      expect(queue.some((a: QueuedSyncAction) => a.type === 'UPDATE_REPAIR_TICKET' && a.payload?.id === onlineDocId)).toBe(true);
    });

    it('updates status with online doc ID immediately when offline and enqueues to offlineQueue', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const onlineDocId = 'server_doc_tkt_0040';
      mockStorage.set('offline_repairs', JSON.stringify([{
        id: onlineDocId,
        ticketNumber: 'TKT-0040',
        customerName: 'Client B',
        deviceBrand: 'Samsung',
        deviceModel: 'A12',
        status: 'in_progress',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));

      const startTime = Date.now();
      const updated = await repairService.updateStatus(onlineDocId, 'ready');
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(updated.status).toBe('ready');

      const queue = JSON.parse(mockStorage.get('offline_action_queue') || '[]');
      expect(queue.some((a: QueuedSyncAction) => a.type === 'UPDATE_REPAIR_STATUS' && a.payload?.id === onlineDocId)).toBe(true);
    });

    it('deletes ticket immediately, records tombstone, purges local cache, and enqueues to offlineQueue', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const targetDocId = 'server_doc_tkt_0045';
      mockStorage.set('offline_repairs', JSON.stringify([{
        id: targetDocId,
        ticketNumber: 'TKT-0045',
        customerName: 'Customer to Delete',
        deviceBrand: 'Redmi',
        deviceModel: 'Note 11',
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, {
        id: 'keep_me_doc_1',
        ticketNumber: 'TKT-0046',
        customerName: 'Keep Customer',
        deviceBrand: 'iPhone',
        deviceModel: '13',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));

      const startTime = Date.now();
      await repairService.deleteTicket(targetDocId);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);

      // Verify purged from local storage
      const local = JSON.parse(mockStorage.get('offline_repairs') || '[]');
      expect(local.some((t: { id: string }) => t.id === targetDocId)).toBe(false);
      expect(local.length).toBe(1);

      // Verify tombstone is recorded
      const tombstones = JSON.parse(mockStorage.get('deleted_repair_ticket_ids') || '[]');
      expect(tombstones.includes(targetDocId)).toBe(true);

      // Verify queued for offline sync
      const queue = JSON.parse(mockStorage.get('offline_action_queue') || '[]');
      expect(queue.some((a: QueuedSyncAction) => a.type === 'DELETE_REPAIR_TICKET' && a.payload?.id === targetDocId)).toBe(true);

      // Verify getAll() never resurrects tombstoned ticket
      const all = await repairService.getAll();
      expect(all.some(t => t.id === targetDocId)).toBe(false);
    });
  });

  describe('customerService offline behavior', () => {
    it('returns undefined immediately on findByPhone when offline if not in local cache', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const startTime = Date.now();
      const match = await customerService.findByPhone('0770999888');
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(50);
      expect(match).toBeUndefined();
    });

    it('returns local customer on findByPhone when offline if present locally', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      mockStorage.set('offline_customers', JSON.stringify([{
        id: 'cust_local_1',
        name: 'Ahmed Local',
        phone: '0770112233',
        normalizedPhone: '0770112233',
      }]));

      const match = await customerService.findByPhone('0770112233');
      expect(match).toBeDefined();
      expect(match?.name).toBe('Ahmed Local');
    });

    it('adds customer immediately when offline with offline_cust_ id and queues for sync', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const startTime = Date.now();
      const created = await customerService.addCustomer({
        name: 'New Client Offline',
        phone: '0661223344',
        accountType: 'retail',
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(created.id).toMatch(/^offline_cust_/);
      expect(created.name).toBe('New Client Offline');

      const local = JSON.parse(mockStorage.get('offline_customers') || '[]');
      expect(local.some((c: { id: string }) => c.id === created.id)).toBe(true);

      const queue = JSON.parse(mockStorage.get('offline_customer_sync_queue') || '[]');
      expect(queue.some((item: { tempId?: string; customerData?: { id?: string } }) => item.tempId === created.id || item.customerData?.id === created.id)).toBe(true);
    });

    it('updates customer immediately when offline without hanging on remote getDoc', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      mockStorage.set('offline_customers', JSON.stringify([{
        id: 'cust_offline_update',
        name: 'Old Name',
        phone: '0550111222',
      }]));

      const startTime = Date.now();
      const updated = await customerService.updateCustomer('cust_offline_update', {
        name: 'Updated Name',
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(updated.name).toBe('Updated Name');

      const local = JSON.parse(mockStorage.get('offline_customers') || '[]');
      expect(local[0].name).toBe('Updated Name');
    });
  });

  describe('transactionService offline behavior', () => {
    it('saves POS sale immediately when offline with offline_tx_ id', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const startTime = Date.now();
      const tx = await transactionService.save({
        date: new Date().toISOString(),
        items: [],
        subtotal: 5000,
        total: 5000,
        payments: [{ method: 'cash', amount: 5000 }],
        saleType: 'retail',
        status: 'completed',
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(tx.id).toMatch(/^offline_tx_/);

      const local = JSON.parse(mockStorage.get('offline_transactions') || '[]');
      expect(local.some((t: { id: string }) => t.id === tx.id)).toBe(true);
    });

    it('updates transaction settlement immediately when offline without hanging on updateDoc', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const offlineTxId = 'offline_tx_9999';
      mockStorage.set('offline_transactions', JSON.stringify([{
        id: offlineTxId,
        date: new Date().toISOString(),
        items: [],
        total: 8000,
        payments: [{ method: 'debt', amount: 8000 }],
        status: 'completed',
      }]));

      const startTime = Date.now();
      await transactionService.updateTransaction(offlineTxId, {
        accountSettlement: {
          type: 'charged_to_account',
          paidAmount: 0,
          chargedAmount: 8000,
          debtEntryId: 'debt_123',
        },
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);

      const local = JSON.parse(mockStorage.get('offline_transactions') || '[]');
      expect(local[0].accountSettlement?.debtEntryId).toBe('debt_123');
    });
  });

  describe('debtService offline behavior', () => {
    it('records debt payment immediately when offline without hanging on getDoc', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const offlineDebtId = 'offline_debt_555';
      mockStorage.set('offline_customer_debts', JSON.stringify([{
        id: offlineDebtId,
        customerId: 'cust_1',
        customerName: 'Samir',
        totalAmount: 10000,
        amountPaid: 2000,
        remainingBalance: 8000,
        status: 'partially_paid',
        payments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));

      const startTime = Date.now();
      const updated = await debtService.recordPayment(offlineDebtId, {
        amount: 3000,
        method: 'cash',
        note: 'Offline payment',
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(updated.amountPaid).toBe(5000);
      expect(updated.remainingBalance).toBe(5000);

      const local = JSON.parse(mockStorage.get('offline_customer_debts') || '[]');
      expect(local[0].remainingBalance).toBe(5000);
    });
  });

  describe('cartService & activityLogService offline guards', () => {
    it('clearActiveCart resolves immediately when offline without calling deleteDoc', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const startTime = Date.now();
      await cartService.clearActiveCart();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(50);
    });

    it('activityLogService.log returns immediately when offline without calling addDoc', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      const startTime = Date.now();
      await activityLogService.log('sales', 'Test offline sale');
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
