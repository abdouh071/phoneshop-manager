/**
 * Unit tests for Unified Offline Sync & Inventory Offline Capabilities
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inventoryService } from './inventoryService';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';

// In-memory mock for localStorage in Node environment
const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

describe('Offline Inventory & Sync Capabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  describe('inventoryService offline behavior', () => {
    it('saves new products to offline_inventory and offline_pending_products when offline', async () => {
      // Mock navigator.onLine = false
      vi.stubGlobal('navigator', { onLine: false });

      const newProd = await inventoryService.addProduct({
        name: 'iPhone 15 Screen Replacement',
        model: 'iPhone 15',
        category: 'repair_part',
        sku: 'PRT-IPH15-SCR',
        stock: 5,
        price: 18000,
        cost: 12000,
        costPrice: 12000,
        stockStatus: 'in_stock',
        lowStockThreshold: 1,
      });

      expect(newProd.id).toMatch(/^offline_prod_/);
      expect(newProd.stockStatus).toBe('in_stock');

      // Verify it was persisted to local storage
      const local = inventoryService.getLocalInventory();
      expect(local.length).toBe(1);
      expect(local[0].id).toBe(newProd.id);
      expect(local[0].name).toBe('iPhone 15 Screen Replacement');

      // Verify it was added to pending products queue
      const pending = inventoryService.getPendingProducts();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(newProd.id);
    });

    it('queues stock adjustments locally when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      // Pre-populate inventory
      inventoryService.saveLocalInventory([
        {
          id: 'prod_123',
          name: 'USB-C Cable',
          model: 'Universal',
          category: 'accessory',
          stock: 10,
          price: 500,
          cost: 200,
          costPrice: 200,
          sku: 'ACC-USB-C',
          lowStockThreshold: 1,
          stockStatus: 'in_stock',
        },
      ]);

      // Deduct 2 units (POS checkout)
      const updated = await inventoryService.adjustStockAsync('prod_123', -2);

      expect(updated.stock).toBe(8);
      expect(updated.stockStatus).toBe('in_stock');

      // Verify local storage reflects new stock immediately
      const local = inventoryService.getLocalInventory();
      expect(local[0].stock).toBe(8);

      // Verify adjustment was queued
      const pendingAdj = inventoryService.getPendingStockAdjustments();
      expect(pendingAdj.length).toBe(1);
      expect(pendingAdj[0].productId).toBe('prod_123');
      expect(pendingAdj[0].delta).toBe(-2);
      expect(pendingAdj[0].newStock).toBe(8);
    });

    it('returns local cache immediately when getRetailProducts() is called offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });

      inventoryService.saveLocalInventory([
        {
          id: 'prod_retail_1',
          name: 'Samsung Galaxy A54',
          model: 'A54',
          category: 'smartphone',
          stock: 3,
          price: 45000,
          cost: 38000,
          costPrice: 38000,
          sku: 'PHN-A54',
          lowStockThreshold: 1,
          stockStatus: 'in_stock',
        },
        {
          id: 'prod_part_1',
          name: 'A54 Battery',
          model: 'A54',
          category: 'repair_part',
          stock: 5,
          price: 3500,
          cost: 2000,
          costPrice: 2000,
          sku: 'PRT-A54-BAT',
          lowStockThreshold: 1,
          stockStatus: 'in_stock',
        },
      ]);

      const retail = await inventoryService.getRetailProducts();
      expect(retail.length).toBe(1);
      expect(retail[0].name).toBe('Samsung Galaxy A54');
    });
  });

  describe('unifiedOfflineSyncService pending count calculation', () => {
    it('aggregates pending items across all domains including offline products and adjustments', () => {
      // 1 offline product
      inventoryService.savePendingProducts([
        {
          id: 'offline_prod_1',
          name: 'AirPods Pro Case',
          model: 'Pro',
          category: 'accessory',
          stock: 2,
          price: 1500,
          cost: 800,
          costPrice: 800,
          sku: 'ACC-AIRPODS-PRO',
          lowStockThreshold: 1,
          stockStatus: 'in_stock',
        },
      ]);

      // 1 offline stock adjustment
      inventoryService.savePendingStockAdjustments([
        {
          id: 'adj_1',
          productId: 'prod_existing',
          delta: -1,
          newStock: 4,
          timestamp: new Date().toISOString(),
        },
      ]);

      // 1 offline repair ticket
      localStorage.setItem('offline_repairs', JSON.stringify([
        { id: 'offline_tkt_123', ticketNumber: 'TKT-0012', customerName: 'Karim' },
        { id: 'real_tkt_456', ticketNumber: 'TKT-0011', customerName: 'Ahmed' },
      ]));

      // 1 offline transaction
      localStorage.setItem('offline_transactions', JSON.stringify([
        { id: 'offline_tx_999', total: 5000 },
        { id: 'real_tx_888', total: 2000 },
      ]));

      // 1 offline debt
      localStorage.setItem('offline_customer_debts', JSON.stringify([
        { id: 'offline_debt_777', customerName: 'Yacine', remainingBalance: 3000 },
      ]));

      // 1 offline customer log
      localStorage.setItem('offline_customer_activity_logs', JSON.stringify([
        { id: 'offline_log_555', actionTitle: 'Phone Repaired' },
      ]));

      const totalPending = unifiedOfflineSyncService.getTotalPendingCount();
      // 1 prod + 1 adj + 1 tkt + 1 tx + 1 debt + 1 log = 6
      expect(totalPending).toBe(6);
    });
  });
});
