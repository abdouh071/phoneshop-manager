export type RepairStatus = 'pending' | 'in_progress' | 'ready' | 'completed' | 'cancelled' | 'returned';

export interface RepairStatusHistoryEntry {
  status: RepairStatus;
  changedById?: string;
  changedByName?: string;
  at?: string;
  timestamp?: string;
  notes?: string;
}

export interface RepairTicket {
  id: string;
  ticketNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  deviceBrand: string;
  deviceModel: string;
  issueDescription: string;
  status: RepairStatus;
  estimatedCost: number;
  actualCost?: number;
  depositAmount?: number;
  estimatedCompletionDate?: string;
  createdAt: string;
  updatedAt: string;
  assignedTechnician?: string;
  technicianRemark?: string;
  remark?: string; // Technician findings / intake remark
  repairedAt?: string; // Timestamp when marked ready
  completedAt?: string; // Timestamp when handed over
  paymentStatus?: 'paid' | 'partial' | 'debt';
  paidAmount?: number;
  handoverAmountPaid?: number;
  debtEntryId?: string;
  settlementNotes?: string;
  trackingPin?: string;
  createdById?: string;
  createdByName?: string;
  statusHistory?: RepairStatusHistoryEntry[];
  lockType?: 'none' | 'pin' | 'pattern' | 'password';
  lockValue?: string;
  partsUsed?: { productId: string; name: string; cost: number; quantity: number }[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  accountType?: 'retail' | 'shop_repairer' | 'b2b';
  shopName?: string;
  creditLimit?: number;
  totalPurchases: number;
  totalSpent: number;
  totalDebt?: number;
  lastVisitDate: string;
  joinDate: string;
}

export interface CustomerDebtPayment {
  id: string;
  date: string;
  amount: number;
  method: string;
  note?: string;
  receivedByName?: string;
}

export interface CustomerDebtEntry {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  productOrService: string;
  totalAmount: number;
  amountPaid: number;
  remainingBalance: number;
  date: string;
  dueDate?: string;
  status: 'unpaid' | 'partially_paid' | 'paid';
  type: 'sale' | 'repair' | 'manual';
  notes?: string;
  payments?: CustomerDebtPayment[];
  /**
   * The sale this entry was raised by. The counter writes it, and every lookup that
   * corrects or voids an invoice reads it — without it a phone-written credit sale
   * cannot be found again from the transaction side.
   */
  transactionId?: string;
  /**
   * Stable across a queue replay, unlike `transactionId`: the invoice number is minted
   * at the counter before the phone has a server id, so it is the one key that survives
   * a sale that was written while the shop had no network.
   */
  invoiceNumber?: string;
  itemsSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityCategory = 'inventory' | 'sales' | 'repairs' | 'system';
export type ActivitySeverity = 'info' | 'success' | 'warning' | 'danger';

export interface ActivityLog {
  id?: string;
  category: ActivityCategory;
  message: string;
  detail?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  severity?: ActivitySeverity;
  userName?: string | null;
  userId?: string | null;
  timestamp?: any;
}

export interface Permissions {
  dashboard: boolean;
  pos: boolean;
  repairs: boolean;
  repair_add: boolean;
  repair_edit: boolean;
  repair_status: boolean;
  repair_assign: boolean;
  inventory_products: boolean;
  inventory_parts: boolean;
  inventory_edit: boolean;
  parts_sell: boolean;
  customers: boolean;
  customers_debt: boolean;
  reports: boolean;
  activity: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'sales_agent' | 'repair_agent';
  status?: 'active' | 'revoked';
  permissions?: Permissions;
  pushToken?: string;
  pushTokenUpdatedAt?: any;
  preferredLanguage?: 'en' | 'fr' | 'ar';
  approvalPin?: string;
}

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'transfer' | 'debt' | 'store_credit';
export type ProductCategory = 'smartphone' | 'tablet' | 'accessory' | 'wearable' | 'repair_part';

export interface PhoneModel {
  id: string;
  name: string;
  model: string;
  brand?: string;
  storage?: string;
  color?: string;
  price: number;
  costPrice: number;
  stock: number;
  stockStatus: StockStatus;
  sku: string;
  barcode?: string;
  category: ProductCategory;
  lowStockThreshold: number;
  imageUrl?: string;
}

export interface CartItem {
  product: PhoneModel;
  quantity: number;
  unitPrice?: number;
  /**
   * A line the customer handed over instead of bought, so its money comes off the
   * invoice. The counter writes these on an exchange; a phone only has to read them
   * back, but a void that missed the sign would restock goods that were never sold.
   */
  isReturn?: boolean;
  /** False when a returned line was kept off the shelf (faulty, sent for repair). */
  restock?: boolean;
}

export interface SaleTransaction {
  id: string;
  date: string;
  items: CartItem[];
  subtotal: number;
  discount?: { type: 'percent' | 'flat'; value: number };
  total: number;
  payments: { method: PaymentMethod; amount: number }[];
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  saleType?: 'retail' | 'parts_b2b';
  invoiceNumber?: string;
  accountSettlement?: {
    type: 'paid_full' | 'charged_to_account' | 'partial_payment';
    paidAmount: number;
    chargedAmount: number;
    debtEntryId?: string;
    dueDate?: string;
    notes?: string;
  };
  processedById?: string;
  processedByName?: string;
  status?: 'completed' | 'refunded' | 'partially_refunded' | 'voided' | 'cancelled' | 'pending_approval';
  approvalRequestId?: string;
  notes?: string;
}

export interface ApprovalRequest {
  id: string;
  actionType: string;
  actionLabel: string;
  actionData?: Record<string, any>;
  targetId?: string;
  requestedBy: {
    uid: string;
    name: string;
    email?: string;
    role?: string;
    avatar?: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedAt: string;
  reason?: string;
  resolvedAt?: string;
  resolvedBy?: {
    uid: string;
    name: string;
  };
  rejectionReason?: string;
  approvalMethod?: 'pin' | 'remote' | 'password';
  createdAt?: any;
}


