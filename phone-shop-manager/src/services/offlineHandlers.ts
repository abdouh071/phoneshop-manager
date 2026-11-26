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
import { transactionService, type SaleEditRequest } from './transactionService';
import { debtService } from './debtService';
import { customerService } from './customerService';
import type {
  Customer,
  CustomerDebtPayment,
  PhoneModel,
  RepairStatusHistoryEntry,
  RepairTicket,
  SaleTransaction,
} from '../types';

let registered = false;

/**
 * An id starting with `offline_` names a record this device invented and never uploaded:
 * the document it points at does not exist and never will, so no retry can land it.
 */
function assertUploadedId(id: unknown, actionType: string, entityLabel = 'record'): void {
  if (typeof id === 'string' && id.startsWith('offline_')) {
    throw new UnrecoverableSyncActionError(
      `${actionType} targets ${id}, a ${entityLabel} id that only ever existed on this device.`
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
    completedAt?: string;
  }) => {
    assertUploadedId(payload.id, 'UPDATE_REPAIR_STATUS', 'ticket');
    await repairService.updateStatus(payload.id, payload.status, payload.history, {
      throwOnError: true,
      completedAt: payload.completedAt,
    });
  });

  /**
   * UPDATE_REPAIR_TICKET
   * Fired when a repair ticket field is updated while offline.
   */
  offlineQueue.registerHandler('UPDATE_REPAIR_TICKET', async (payload: {
    id: string;
    updates: Partial<RepairTicket>;
    baseValues?: Record<string, unknown>;
  }) => {
    assertUploadedId(payload.id, 'UPDATE_REPAIR_TICKET', 'ticket');
    if (payload.baseValues) {
      await repairService.replayQueuedTicketUpdate(payload);
    } else {
      await repairService.updateTicket(payload.id, payload.updates, { throwOnError: true });
    }
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
    assertUploadedId(payload.id, 'DELETE_REPAIR_TICKET', 'ticket');
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

  /**
   * EDIT_SALE_TRANSACTION
   * Atomic server replay of an invoice edit queued while offline.
   */
  offlineQueue.registerHandler('EDIT_SALE_TRANSACTION', async (payload: {
    transactionId: string;
    operationId: string;
    expected: SaleTransaction;
    edit: SaleEditRequest;
  }) => {
    assertUploadedId(payload.transactionId, 'EDIT_SALE_TRANSACTION', 'invoice');
    const result = await transactionService.replayQueuedSaleEdit(payload);
    try {
      const [{ useCartStore }, { usePartsCartStore }, { useInventoryStore }, { useCustomerStore }] = await Promise.all([
        import('../store/cartStore'),
        import('../store/partsCartStore'),
        import('../store/inventoryStore'),
        import('../store/customerStore'),
      ]);
      useCartStore.setState(state => ({
        transactions: state.transactions.map(t => (t.id === result.transaction.id ? result.transaction : t)),
      }));
      usePartsCartStore.setState(state => ({
        invoices: state.invoices.map(t => (t.id === result.transaction.id ? result.transaction : t)),
      }));
      if (result.stock.length > 0) {
        const stockMap = new Map(result.stock.map(p => [p.id, p]));
        useInventoryStore.setState(state => ({
          products: state.products.map(p => stockMap.get(p.id) ?? p),
          parts: state.parts.map(p => stockMap.get(p.id) ?? p),
        }));
      }
      if (result.customer || result.debt) {
        useCustomerStore.setState(state => ({
          customers: result.customer
            ? [result.customer, ...state.customers.filter(c => c.id !== result.customer!.id)]
            : state.customers,
          debts: result.debt
            ? [result.debt, ...state.debts.filter(d => d.id !== result.debt!.id)]
            : state.debts,
        }));
      }
    } catch {
      // Stores not mounted yet during headless replay
    }
  });

  // ─── CUSTOMER & DEBT LEDGER HANDLERS ────────────────────────────────────────

  /**
   * UPDATE_CUSTOMER
   * Field-level profile update for an existing server customer with conflict check.
   */
  offlineQueue.registerHandler('UPDATE_CUSTOMER', async (payload: {
    id: string;
    updates: Partial<Customer>;
    baseValues?: Record<string, unknown>;
    baseUpdatedAt?: string;
    operationId?: string;
  }) => {
    assertUploadedId(payload.id, 'UPDATE_CUSTOMER', 'customer');
    const updated = await customerService.replayQueuedUpdate(payload);
    try {
      const { useCustomerStore } = await import('../store/customerStore');
      useCustomerStore.setState(state => ({
        customers: state.customers.map(c => (c.id === updated.id ? { ...c, ...updated } : c)),
      }));
    } catch {
      // Store not mounted
    }
  });

  /**
   * RECORD_DEBT_PAYMENT
   * Idempotent replay of a debt installment collected offline.
   */
  offlineQueue.registerHandler('RECORD_DEBT_PAYMENT', async (payload: {
    debtId: string;
    payment: CustomerDebtPayment;
    operationId?: string;
  }) => {
    assertUploadedId(payload.debtId, 'RECORD_DEBT_PAYMENT', 'debt');
    const updatedDebt = await debtService.replayQueuedPayment(payload.debtId, payload.payment);
    try {
      const { useCustomerStore } = await import('../store/customerStore');
      useCustomerStore.setState(state => ({
        debts: state.debts.map(d => (d.id === updatedDebt.id ? updatedDebt : d)),
      }));
    } catch {
      // Store not mounted
    }
  });

  /**
   * UPDATE_DEBT_AMOUNT
   * Replay of a debt balance adjustment queued while offline.
   */
  offlineQueue.registerHandler('UPDATE_DEBT_AMOUNT', async (payload: {
    debtId: string;
    newTotalAmount: number;
    newItemsSummary?: string;
    newChargedAmount?: number;
    expectedPaid?: number;
  }) => {
    assertUploadedId(payload.debtId, 'UPDATE_DEBT_AMOUNT', 'debt');
    const updatedDebt = await debtService.replayQueuedDebtAmount(payload);
    try {
      const { useCustomerStore } = await import('../store/customerStore');
      useCustomerStore.setState(state => ({
        debts: state.debts.map(d => (d.id === updatedDebt.id ? updatedDebt : d)),
      }));
    } catch {
      // Store not mounted
    }
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
    baseValues?: Record<string, unknown>;
  }) => {
    assertUploadedId(payload.id, 'UPDATE_PRODUCT', 'product');
    const { inventoryService } = await import('./inventoryService');
    if (payload.baseValues) {
      await inventoryService.replayQueuedProductUpdate({
        id: payload.id,
        updates: payload.updates as Record<string, unknown>,
        baseValues: payload.baseValues,
      });
    } else {
      await inventoryService.updateProduct(payload.id, payload.updates);
    }
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

