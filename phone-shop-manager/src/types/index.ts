// ============================================================
// Domain Types — Phone Shop Manager
// ============================================================

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type RepairStatus = 'pending' | 'in_progress' | 'ready' | 'completed' | 'cancelled' | 'returned';
export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'transfer' | 'debt' | 'store_credit';
export type ProductCategory = 'smartphone' | 'tablet' | 'accessory' | 'wearable' | 'repair_part';
export type AccessorySubCategory = 'case' | 'glass' | 'cable' | 'charger' | 'earphone' | 'powerbank' | 'holder' | 'other';
export type ProductCondition = 'new' | 'refurbished' | 'used';

// --- Inventory ---
export interface PhoneModel {
  id: string;
  name: string;
  model: string;
  brand?: string;
  storage?: string;
  color?: string;
  price: number;
  costPrice: number;
  cost?: number; // unit cost used by repair parts
  partNumber?: string;
  condition?: ProductCondition;
  stock: number;
  stockStatus: StockStatus;
  sku: string;
  /** Legacy: some imported rows carry a barcode distinct from the SKU */
  barcode?: string;
  category: ProductCategory;
  accessorySubCategory?: AccessorySubCategory; // only set when category === 'accessory'
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
  unitPrice?: number;
  totalPrice?: number;
  isReturn?: boolean;
  returnReason?: string;
  restock?: boolean;
  customReturnPrice?: number;
  // Flat-item shape used by receipt builders (e.g. WhatsApp text from old/imported transactions)
  productName?: string;
  price?: number;
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
  status?: 'completed' | 'refunded' | 'partially_refunded' | 'voided' | 'cancelled' | 'pending_approval';
  notes?: string;
  paymentStatus?: 'paid' | 'partial' | 'debt';
  // Legacy flat fields read by receipt builders (WhatsApp text etc.)
  paymentMethod?: string;
  remainingBalance?: number;
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

// --- Admin approvals ---
/**
 * Free-form payload attached to an approval request. Keys the details card understands
 * are typed; anything else is rendered generically as a string.
 */
export interface ApprovalActionData {
  productName?: string;
  partName?: string;
  itemName?: string;
  itemType?: string;
  model?: string;
  deviceModel?: string;
  sku?: string;
  partNumber?: string;
  category?: string;
  price?: number;
  catalogPrice?: number;
  cost?: number;
  costPrice?: number;
  currentStock?: number;
  stock?: number;
  customerName?: string;
  ticketNumber?: string;
  invoiceNumber?: string;
  discountAmount?: number;
  restockAmount?: number;
  [key: string]: unknown;
}

// --- Repairs ---
export interface RepairStatusHistoryEntry {
  status: RepairStatus;
  changedById: string;
  changedByName: string;
  at: string; // ISO date string
}

export interface RepairPartUsed {
  productId: string;
  quantity: number;
  cost: number;
  name: string;
  /** Legacy alias written by older part-allocation flows */
  productName?: string;
}

export interface RepairTicket {
  id: string;
  ticketNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  deviceBrand: string;
  deviceModel: string;
  deviceName?: string;
  imei?: string;
  serialNumber?: string;
  deviceImei?: string;
  issueDescription: string;
  issue?: string; // legacy alias for issueDescription on older records
  problem?: string; // legacy alias
  notes?: string;
  settlementNotes?: string;
  remark?: string; // Technician remark / findings (e.g. additional issues found during repair, customer notes)
  estimatedCost: number;
  depositAmount?: number;
  actualCost?: number;
  // Legacy aliases read by settlement/handover components
  cost?: number;
  finalCost?: number;
  partsUsed?: RepairPartUsed[];
  status: RepairStatus;
  parentTicketId?: string; // Links to the main/first ticket for this device
  parentTicketNumber?: string; // Human-readable ticket number of parent ticket
  isReturn?: boolean; // True if this ticket is a return/warranty claim of the parent ticket
  activeReturnTicketId?: string; // Links original ticket to its active child return ticket
  activeReturnTicketNumber?: string; // Human-readable ticket number of active child return ticket
  assignedTechnician?: string;
  assignedTechnicianId?: string;
  // Device Lock / Passcode
  lockType?: 'pin' | 'pattern' | 'password' | 'none';
  lockValue?: string; // e.g. "1234" or "1-2-5-8-9"
  trackingPin?: string; // 4-char alphanumeric code for customer tracking portal security
  // Legacy account fields carried on some older intake tickets
  accountType?: 'retail' | 'shop_repairer';
  shopName?: string;
  // Worker accountability
  createdById?: string;
  createdByName?: string;
  statusHistory?: RepairStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  estimatedCompletionDate?: string;
  returnReason?: string;
  returnDate?: string;
  repairedAt?: string; // Timestamp when marked ready (production credit)
  // Handover / Settlement tracking
  paymentStatus?: 'paid' | 'partial' | 'debt' | 'pending';
  paidAmount?: number;
  handoverAmountPaid?: number;
  completedAt?: string;
  debtEntryId?: string;
  /** Structured return history records on this ticket */
  returnRecords?: {
    id: string;
    returnDate: string;
    reason: string;
    returnTicketId?: string;
    returnTicketNumber?: string;
    isWarranty?: boolean;
    estimatedCost?: number;
    actualCost?: number;
    resolvedAt?: string;
    resolutionNotes?: string;
    status: 'pending' | 'in_progress' | 'ready' | 'completed';
  }[];
  /** If set, this ticket was merged into another ticket and is archived (never deleted from DB) */
  mergedIntoTicketId?: string;
  /** ISO timestamp of when this ticket was merged */
  mergedAt?: string;
}

export interface RepairReturnRecord {
  id: string;
  returnDate: string;
  reason: string;
  returnTicketId?: string;
  returnTicketNumber?: string;
  isWarranty?: boolean;
  estimatedCost?: number;
  actualCost?: number;
  resolvedAt?: string;
  resolutionNotes?: string;
  status: 'pending' | 'in_progress' | 'ready' | 'completed';
}

export interface CustomerRegisteredDevice {
  id: string;
  brand: string;
  model: string;
  imei?: string;
  notes?: string;
  createdAt: string;
  firstSeen?: string;
  lastSeen?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  normalizedPhone?: string; // Canonical clean digits (e.g. 0550123456) for reliable search & indexing
  email?: string;
  accountType?: 'retail' | 'shop_repairer' | 'b2b';
  shopName?: string; // e.g. "AP Phone"
  creditLimit?: number; // Maximum allowed credit balance in DZD
  storeCredit?: number; // Active Store Credit / Avoir balance in DZD
  taxId?: string;
  address?: string; // Physical address / Wilaya
  rc?: string; // Registre de Commerce (e.g. 16/00-1234567B19)
  nif?: string; // Numéro d'Identification Fiscale
  nis?: string; // Numéro d'Identification Statistique
  art?: string; // Article d'Imposition (AI)
  wholesaleDiscountPercent?: number; // Custom wholesale discount percentage (e.g. 5, 10, 15)
  notes?: string;
  registeredDevices?: CustomerRegisteredDevice[];
  totalPurchases: number;
  totalSpent: number;
  totalDebt?: number;
  debt?: number; // current outstanding debt snapshot
  lastVisitDate: string;
  joinDate: string;
  /** If set, this customer was merged into another account and should be hidden from active lists */
  mergedIntoId?: string;
  /** ISO timestamp of when this customer was merged/archived */
  mergedAt?: string;
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
  /** Explicit link to the RepairTicket Firestore document ID that originated this debt.
   *  Preferred over productOrService string-match for ticket↔debt resolution. */
  linkedTicketId?: string;
  /** Human-readable ticket number copy (e.g. "TKT-0169") stored for display / legacy fallback. */
  linkedTicketNumber?: string;
  metadata?: { transactionId?: string };
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
  | 'debt_edited'
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
  metadata?: Record<string, unknown>;
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
