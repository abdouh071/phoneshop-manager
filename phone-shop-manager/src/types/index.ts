// ============================================================
// Domain Types — Phone Shop Manager
// ============================================================

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type RepairStatus = 'pending' | 'in_progress' | 'ready' | 'completed' | 'cancelled' | 'returned';
export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'transfer' | 'debt' | 'store_credit';
export type ProductCategory = 'smartphone' | 'tablet' | 'accessory' | 'wearable' | 'repair_part';
export type ProductCondition = 'new' | 'refurbished' | 'used';

// --- Inventory ---
export interface PhoneModel {
  id: string;
  name: string;
  model: string;
  storage?: string;
  color?: string;
  price: number;
  costPrice: number;
  stock: number;
  stockStatus: StockStatus;
  sku: string;
  category: ProductCategory;
  supplier?: string;
  location?: string;

  lowStockThreshold: number;
  notes?: string;
  imageUrl?: string;
}

// --- Sales / POS ---
export interface CartItem {
  product: PhoneModel;
  quantity: number;
  isReturn?: boolean;
  returnReason?: string;
  restock?: boolean;
  customReturnPrice?: number;
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
  shopName?: string;
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
  exchangeSummary?: {
    hasReturn: boolean;
    returnedTotal: number;
    purchasedTotal: number;
    netDifference: number; // positive = customer paid, negative = shop refunded/credited
    refundType?: 'cash' | 'store_credit' | 'debt_deduction';
    storeCreditUsed?: number;
  };
  status?: 'completed' | 'refunded' | 'partially_refunded';
  // Worker accountability
  processedById?: string;
  processedByName?: string;
}

export interface SuspendedCart {
  id: string;
  date: string;
  items: CartItem[];
  customerName: string;
  discount: { type: 'percent' | 'flat'; value: number } | null;
}

export interface RestockEntry {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantityAdded: number;
  stockBefore: number;
  stockAfter: number;
  supplier?: string;
  note?: string;
  cost?: number;         // unit cost at time of restock
  performedById?: string;
  performedByName?: string;
  date: string;          // ISO string
}

export type WriteOffReason = 'damaged' | 'defective' | 'lost' | 'stolen' | 'expired' | 'other';

export interface StockWriteOff {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantityWrittenOff: number;
  stockBefore: number;
  stockAfter: number;
  reason: WriteOffReason;
  note?: string;
  performedById?: string;
  performedByName?: string;
  date: string;          // ISO string
}

// --- Repairs ---
export interface RepairStatusHistoryEntry {
  status: RepairStatus;
  changedById: string;
  changedByName: string;
  at: string; // ISO date string
}

export interface RepairTicket {
  id: string;
  ticketNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  deviceBrand: string;
  deviceModel: string;
  issueDescription: string;
  remark?: string; // Technician remark / findings (e.g. additional issues found during repair, customer notes)
  estimatedCost: number;
  depositAmount?: number;
  actualCost?: number;
  partsUsed?: { productId: string; quantity: number; cost: number; name: string }[];
  status: RepairStatus;
  parentTicketId?: string; // Links to the main/first ticket for this device
  parentTicketNumber?: string; // Human-readable ticket number of parent ticket
  isReturn?: boolean; // True if this ticket is a return/warranty claim of the parent ticket
  activeReturnTicketId?: string; // Links original ticket to its active child return ticket
  activeReturnTicketNumber?: string; // Human-readable ticket number of active child return ticket
  assignedTechnician?: string;
  // Device Lock / Passcode
  lockType?: 'pin' | 'pattern' | 'password' | 'none';
  lockValue?: string; // e.g. "1234" or "1-2-5-8-9"
  trackingPin?: string; // 4-char alphanumeric code for customer tracking portal security
  // Worker accountability
  createdById?: string;
  createdByName?: string;
  statusHistory?: RepairStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  estimatedCompletionDate?: string;
  returnReason?: string;
  returnDate?: string;
  // Handover / Settlement tracking
  paymentStatus?: 'paid' | 'partial' | 'debt';
  paidAmount?: number;
  handoverAmountPaid?: number;
  completedAt?: string;
  debtEntryId?: string;
  settlementNotes?: string;
}

export interface CustomerRegisteredDevice {
  id: string;
  brand: string;
  model: string;
  imei?: string;
  notes?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  accountType?: 'retail' | 'shop_repairer' | 'b2b';
  shopName?: string; // e.g. "AP Phone"
  creditLimit?: number; // Maximum allowed credit balance in DZD
  storeCredit?: number; // Active Store Credit / Avoir balance in DZD
  taxId?: string;
  notes?: string;
  registeredDevices?: CustomerRegisteredDevice[];
  totalPurchases: number;
  totalSpent: number;
  totalDebt?: number;
  lastVisitDate: string;
  joinDate: string;
}

export const isShopCustomer = (c: Customer): boolean => {
  return c.accountType === 'shop_repairer' || c.accountType === 'b2b' || Boolean(c.shopName && c.shopName.trim());
};

export const isRetailCustomer = (c: Customer): boolean => {
  return !isShopCustomer(c);
};

export interface CustomerDebtPayment {
  id: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
  receivedByName?: string;
}

export interface CustomerDebtEntry {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  productOrService: string;
  date: string;
  totalAmount: number;
  amountPaid: number;
  remainingBalance: number;
  dueDate?: string;
  status: 'unpaid' | 'partially_paid' | 'paid';
  notes?: string;
  transactionId?: string;
  invoiceNumber?: string;
  itemsSummary?: string;
  type?: 'general' | 'parts_b2b' | 'repair';
  payments: CustomerDebtPayment[];
  createdAt: string;
  updatedAt?: string;
}

export type CustomerActionType =
  | 'customer_created'
  | 'customer_updated'
  | 'debt_added'
  | 'debt_payment'
  | 'debt_deleted'
  | 'sale_completed'
  | 'b2b_parts_sale'
  | 'repair_created'
  | 'repair_updated'
  | 'note_added'
  | 'item_return'
  | 'item_exchange'
  | 'store_credit_issued'
  | 'store_credit_used';

export interface CustomerActivityLog {
  id: string;
  customerId: string;
  customerName: string;
  actionType: CustomerActionType;
  actionTitle: string;
  actionDescription: string;
  actorId?: string;
  actorName: string;
  actorRole?: string;
  date: string;
  metadata?: Record<string, any>;
  createdAt?: string;
}

// --- B2B Checkout Options (Parts Sales) ---
export interface B2BCheckoutOptions {
  customer: Customer;
  settlementType: 'paid_full' | 'charged_to_account' | 'partial_payment';
  paidAmount: number;
  paymentMethod: PaymentMethod;
  chargedAmount: number;
  dueDate?: string;
  notes?: string;
  allowCreditLimitOverride?: boolean;
}

// --- Dashboard Stats ---
export interface DashboardStats {
  dailyRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  unitsSoldToday: number;
  activeRepairs: number;
  lowStockCount: number;
  revenueChange: number; // percentage vs yesterday
  unitsSoldChange: number; // percentage vs yesterday
}

export interface RevenueDataPoint {
  label: string;
  revenue: number;
}

// --- Held Repair Ticket Drafts (persistent across reload/logout) ---
export interface HeldRepairDraft {
  id: string;
  date: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  deviceBrand: string;
  deviceModel: string;
  issueDescription: string;
  estimatedCost: string;
  depositAmount: string;
  estimatedCompletionDate: string;
  assignedTechnician: string;
  lockType: 'none' | 'pin' | 'pattern';
  lockValue: string;
  remark?: string;
  label?: string; // auto-generated summary label
}

export * from './purchasing';
