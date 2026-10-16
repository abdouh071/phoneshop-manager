// Appended types
export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface POItem {
  productId: string;
  productName: string;
  productSku: string;
  requestedQty: number;
  receivedQty: number;
  unitCost: number;
}

export type POStatus = 'draft' | 'sent' | 'partially_received' | 'completed' | 'cancelled';

export interface PurchaseOrder {
  id: string;
  poNumber: string; // e.g. PO-1001
  supplierId: string;
  supplierName: string;
  status: POStatus;
  orderDate: string;
  expectedDelivery?: string;
  items: POItem[];
  totalAmount: number;
  notes?: string;
  createdById?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}
