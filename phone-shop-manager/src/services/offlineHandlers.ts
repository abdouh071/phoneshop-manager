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
import { offlineQueue } from './offlineQueue';
import { repairService } from './repairService';
import { transactionService } from './transactionService';
import type { RepairTicket, SaleTransaction } from '../types';

let registered = false;

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
    history?: any[];
  }) => {
    await repairService.updateStatus(payload.id, payload.status, payload.history);
  });

  /**
   * UPDATE_REPAIR_TICKET
   * Fired when a repair ticket field is updated while offline.
   */
  offlineQueue.registerHandler('UPDATE_REPAIR_TICKET', async (payload: {
    id: string;
    updates: Partial<RepairTicket>;
  }) => {
    await repairService.updateTicket(payload.id, payload.updates);
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
}
