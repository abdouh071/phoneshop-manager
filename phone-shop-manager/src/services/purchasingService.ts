import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  runTransaction,
  Timestamp,
  type Transaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Supplier, PurchaseOrder, POItem, POStatus } from '../types';
import { computeStockStatus } from '../utils/stockStatus';
import { withTimeout } from '../utils/withTimeout';

const SUPPLIERS_COLLECTION = 'suppliers';
const PO_COLLECTION = 'purchaseOrders';
const INVENTORY_COLLECTION = 'inventory';
const RESTOCK_LOG_COLLECTION = 'restockLogs';

/** A multi-document transaction reads everything first, so the budget is wider than a plain write. */
const RECEIVE_TX_TIMEOUT_MS = 5000;

const docToSupplier = (id: string, data: Record<string, unknown>): Supplier => ({
  id,
  name: data.name as string,
  contactName: data.contactName as string | undefined,
  email: data.email as string | undefined,
  phone: data.phone as string | undefined,
  address: data.address as string | undefined,
  notes: data.notes as string | undefined,
  createdAt: data.createdAt as string,
  updatedAt: data.updatedAt as string,
});

const docToPO = (id: string, data: Record<string, unknown>): PurchaseOrder => ({
  ...(data as Omit<PurchaseOrder, 'id'>),
  id,
});

export const purchasingService = {
  // --- Suppliers ---
  getSuppliers: async (): Promise<Supplier[]> => {
    const q = query(collection(db, SUPPLIERS_COLLECTION), orderBy('name'));
    const snap = await getDocs(q);
    return snap.docs.map(d => docToSupplier(d.id, d.data() as Record<string, unknown>));
  },

  addSupplier: async (supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier> => {
    const now = new Date().toISOString();
    const docRef = await addDoc(collection(db, SUPPLIERS_COLLECTION), {
      ...supplier,
      createdAt: now,
      updatedAt: now,
    });
    return { ...supplier, id: docRef.id, createdAt: now, updatedAt: now };
  },

  updateSupplier: async (id: string, updates: Partial<Omit<Supplier, 'id'>>): Promise<Supplier> => {
    const ref = doc(db, SUPPLIERS_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Supplier not found');
    const existing = docToSupplier(snap.id, snap.data() as Record<string, unknown>);
    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await updateDoc(ref, { ...merged });
    return merged;
  },

  deleteSupplier: async (id: string): Promise<void> => {
    // Check if supplier has POs
    const q = query(collection(db, PO_COLLECTION), where('supplierId', '==', id));
    const snap = await getDocs(q);
    if (!snap.empty) throw new Error('Cannot delete supplier with existing purchase orders.');
    await deleteDoc(doc(db, SUPPLIERS_COLLECTION, id));
  },

  // --- Purchase Orders ---
  getPurchaseOrders: async (): Promise<PurchaseOrder[]> => {
    const q = query(collection(db, PO_COLLECTION), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => docToPO(d.id, d.data() as Record<string, unknown>));
  },

  addPurchaseOrder: async (po: Omit<PurchaseOrder, 'id' | 'poNumber' | 'createdAt' | 'updatedAt'>): Promise<PurchaseOrder> => {
    const now = new Date().toISOString();
    // Auto-generate a simple PO number based on timestamp
    const poNumber = `PO-${Date.now().toString().slice(-6)}`;
    const newPO = {
      ...po,
      poNumber,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await addDoc(collection(db, PO_COLLECTION), newPO);
    return { ...newPO, id: docRef.id };
  },

  updatePurchaseOrder: async (id: string, updates: Partial<Omit<PurchaseOrder, 'id' | 'poNumber' | 'createdAt'>>): Promise<PurchaseOrder> => {
    const ref = doc(db, PO_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('PO not found');
    const existing = docToPO(snap.id, snap.data() as Record<string, unknown>);
    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await updateDoc(ref, { ...merged });
    return merged;
  },
  
  deletePurchaseOrder: async (id: string): Promise<void> => {
    const ref = doc(db, PO_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const po = docToPO(snap.id, snap.data() as Record<string, unknown>);
    if (po.status !== 'draft' && po.status !== 'cancelled') {
      throw new Error('Can only delete draft or cancelled POs.');
    }
    await deleteDoc(ref);
  },
};

export interface PurchaseOrderReceiptLine {
  productId: string;
  qty: number;
}

export interface ReceivedPurchaseOrderLine {
  productId: string;
  productName: string;
  productSku: string;
  qty: number;
  stockBefore: number;
  stockAfter: number;
}

export interface ReceivedPurchaseOrderResult {
  poNumber: string;
  status: POStatus;
  items: POItem[];
  received: ReceivedPurchaseOrderLine[];
}

/**
 * Receive a delivery: the PO lines, the stock of every product and the restock audit trail are
 * written inside one Firestore transaction.
 *
 * The previous flow awaited the PO update and then one restock per line, so a failure on line 3 of
 * 5 left the order claiming all five had arrived while only two had reached the shelf — and a
 * second click added the missing stock on top of what was already there. Outstanding quantities are
 * now re-read from the server inside the transaction, which makes a double submit abort instead of
 * double-counting.
 */
export const receivePurchaseOrder = async (
  poId: string,
  receipts: PurchaseOrderReceiptLine[],
  actor: { performedById?: string; performedByName?: string } = {}
): Promise<ReceivedPurchaseOrderResult> => {
  const wanted = receipts.filter(r => r.qty > 0);
  if (wanted.length === 0) throw new Error('Nothing to receive.');
  const qtyByProduct = new Map(wanted.map(r => [r.productId, r.qty]));

  return withTimeout(
    runTransaction(db, async (tx: Transaction) => {
      const poSnap = await tx.get(doc(db, PO_COLLECTION, poId));
      if (!poSnap.exists()) throw new Error('Purchase order not found.');
      const po = docToPO(poSnap.id, poSnap.data() as Record<string, unknown>);

      // Firestore requires every document a transaction writes to be read before any write.
      const stockReads = new Map<string, { stock: number; threshold: number }>();
      for (const productId of qtyByProduct.keys()) {
        const snap = await tx.get(doc(db, INVENTORY_COLLECTION, productId));
        if (!snap.exists()) throw new Error(`Product ${productId} no longer exists.`);
        const data = snap.data() as Record<string, unknown>;
        stockReads.set(productId, {
          stock: typeof data.stock === 'number' ? data.stock : 0,
          threshold: typeof data.lowStockThreshold === 'number' ? data.lowStockThreshold : 1,
        });
      }

      interface PlannedLine extends ReceivedPurchaseOrderLine {
        threshold: number;
        cost: number;
      }
      const planned: PlannedLine[] = [];
      const items = po.items.map(item => {
        const qty = qtyByProduct.get(item.productId);
        const read = qty === undefined ? undefined : stockReads.get(item.productId);
        if (!qty || !read) return item;
        const outstanding = item.requestedQty - item.receivedQty;
        if (qty > outstanding) {
          throw new Error(
            `Cannot receive ${qty} × ${item.productName}: ${outstanding} still outstanding on ${po.poNumber}.`
          );
        }
        planned.push({
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          qty,
          cost: item.unitCost,
          stockBefore: read.stock,
          stockAfter: read.stock + qty,
          threshold: read.threshold,
        });
        return { ...item, receivedQty: item.receivedQty + qty };
      });

      if (planned.length !== wanted.length) {
        throw new Error('This delivery references a product that is no longer on the order.');
      }

      const stillOutstanding = items.some(i => i.receivedQty < i.requestedQty);
      const anyReceived = items.some(i => i.receivedQty > 0);
      const status: POStatus = !stillOutstanding
        ? 'completed'
        : anyReceived
          ? 'partially_received'
          : po.status;

      for (const line of planned) {
        tx.update(doc(db, INVENTORY_COLLECTION, line.productId), {
          stock: line.stockAfter,
          stockStatus: computeStockStatus(line.stockAfter, line.threshold),
        });
        tx.set(doc(collection(db, RESTOCK_LOG_COLLECTION)), {
          productId: line.productId,
          productName: line.productName,
          productSku: line.productSku,
          quantityAdded: line.qty,
          stockBefore: line.stockBefore,
          stockAfter: line.stockAfter,
          supplier: po.supplierName,
          note: `Received from ${po.poNumber}`,
          cost: line.cost,
          performedById: actor.performedById,
          performedByName: actor.performedByName,
          // serverTimestamp() is rejected inside a transaction, so the clock of the receiving till stamps it.
          timestamp: Timestamp.now(),
        });
      }

      tx.update(doc(db, PO_COLLECTION, poId), {
        items,
        status,
        updatedAt: new Date().toISOString(),
      });

      return {
        poNumber: po.poNumber,
        status,
        items,
        received: planned.map(({ threshold: _threshold, cost: _cost, ...rest }) => rest),
      };
    }),
    RECEIVE_TX_TIMEOUT_MS,
    'purchase receipt'
  );
};
