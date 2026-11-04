/**
 * Offline Queue Handler Registration
 * ====================================
 * Registers all domain-specific action handlers for the offline queue.
 * Call `registerOfflineHandlers()` once at app startup (in App.tsx or main.tsx)
 * AFTER all services are imported.
 *
 * Handlers are responsible for re-executing the Firebase call when the queue
 * is flushed on network recovery.
 */
import { offlineQueue, UnrecoverableSyncActionError } from './offlineQueue';
import { repairService } from './repairService';
import { transactionService } from './transactionService';
import type { PhoneModel, RepairStatusHistoryEntry, RepairTicket, SaleTransaction } from '../types';

let registered = false;

/**
 * An id starting with `offline_` names a ticket this device invented and never uploaded:
 * the document it points at does not exist and never will, so no retry can land it. The
 * ticket's own data is not lost — the sync creates the document from the local copy, which
 * already carries these changes. Before this guard the service re-queued such an action and
 * returned success, so it was re-born on every pass and the shop was told each time that the
 * sync had completed.
 */
function assertUploadedTicketId(id: unknown, actionType: string): void {
  if (typeof id === 'string' && id.startsWith('offline_')) {
    throw new UnrecoverableSyncActionError(
      `${actionType} targets ${id}, a ticket id that only ever existed on this device.`
    );
  }
}

export function registerOfflineHandlers(): void {
  if (registered) return;
  registered = true;

  // ─── REPAIR HANDLERS ────────────────────────────────────────────────────────

  /**
   * UPDATE_REPAIR_STATUS
   * Fired when a repair ticket status changes while offline.
   * The optimistic update has already been applied locally.
   */
  offlineQueue.registerHandler('UPDATE_REPAIR_STATUS', async (payload: {
    id: string;
    status: RepairTicket['status'];
    history?: RepairStatusHistoryEntry[];
  }) => {
    assertUploadedTicketId(payload.id, 'UPDATE_REPAIR_STATUS');
    await repairService.updateStatus(payload.id, payload.status, payload.history, { throwOnError: true });
  });

  /**
   * UPDATE_REPAIR_TICKET
   * Fired when a repair ticket field is updated while offline.
   */
  offlineQueue.registerHandler('UPDATE_REPAIR_TICKET', async (payload: {
    id: string;
    updates: Partial<RepairTicket>;
  }) => {
    assertUploadedTicketId(payload.id, 'UPDATE_REPAIR_TICKET');
    await repairService.updateTicket(payload.id, payload.updates, { throwOnError: true });
  });

  /**
   * CREATE_REPAIR_TICKET
   * Fired when a new repair ticket is created while offline.
   * Note: the ticket was already saved to localStorage via the service.
   */
  offlineQueue.registerHandler('CREATE_REPAIR_TICKET', async (payload: {
    ticket: Omit<RepairTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>;
  }) => {
    await repairService.createTicket(payload.ticket);
  });

  /**
   * DELETE_REPAIR_TICKET
   * Fired when a repair ticket is deleted while offline.
   */
  offlineQueue.registerHandler('DELETE_REPAIR_TICKET', async (payload: {
    id: string;
  }) => {
    assertUploadedTicketId(payload.id, 'DELETE_REPAIR_TICKET');
    await repairService.deleteTicket(payload.id, { throwOnError: true });
  });

  // ─── SALE / TRANSACTION HANDLERS ────────────────────────────────────────────

  /**
   * CREATE_SALE_TRANSACTION
   * Fired when a POS sale is completed while offline.
   */
  offlineQueue.registerHandler('CREATE_SALE_TRANSACTION', async (payload: {
    transaction: Omit<SaleTransaction, 'id'>;
  }) => {
    await transactionService.save(payload.transaction);
  });

  // ─── INVENTORY & PRODUCT HANDLERS ───────────────────────────────────────────

  /**
   * ADJUST_STOCK
   * Fired when inventory stock is adjusted or deducted while offline.
   */
  offlineQueue.registerHandler('ADJUST_STOCK', async (payload: {
    id: string;
    delta: number;
  }) => {
    const { inventoryService } = await import('./inventoryService');
    await inventoryService.adjustStockAsync(payload.id, payload.delta);
  });

  /**
   * UPDATE_PRODUCT
   * Fired when product details are modified while offline.
   */
  offlineQueue.registerHandler('UPDATE_PRODUCT', async (payload: {
    id: string;
    updates: Partial<Omit<PhoneModel, 'id'>>;
  }) => {
    const { inventoryService } = await import('./inventoryService');
    await inventoryService.updateProduct(payload.id, payload.updates);
  });

  /**
   * DELETE_PRODUCT
   * Fired when a product is deleted while offline.
   */
  offlineQueue.registerHandler('DELETE_PRODUCT', async (payload: {
    id: string;
  }) => {
    const { inventoryService } = await import('./inventoryService');
    await inventoryService.deleteProduct(payload.id);
  });

  /**
   * CREATE_PRODUCT
   * Fired when a new product is added while offline.
   */
  offlineQueue.registerHandler('CREATE_PRODUCT', async (payload: {
    product: Omit<PhoneModel, 'id'>;
  }) => {
    const { inventoryService } = await import('./inventoryService');
    await inventoryService.addProduct(payload.product);
  });
}

