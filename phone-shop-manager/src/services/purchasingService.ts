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
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Supplier, PurchaseOrder } from '../types';

const SUPPLIERS_COLLECTION = 'suppliers';
const PO_COLLECTION = 'purchaseOrders';

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
    await updateDoc(ref, merged as any);
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
    await updateDoc(ref, merged as any);
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
