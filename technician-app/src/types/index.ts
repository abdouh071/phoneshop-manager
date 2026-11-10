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
  assignedTechnicianId?: string;
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
  // Return family: the desktop opens a separate return ticket when a customer
  // brings a repaired device back, linking both directions. The phone reads
  // these links to route the technician to the ticket that holds the work.
  parentTicketId?: string;
  parentTicketNumber?: string;
  isReturn?: boolean;
  activeReturnTicketId?: string;
  activeReturnTicketNumber?: string;
  returnReason?: string;
  returnDate?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  accountType?: 'retail' | 'shop_repairer' | 'b2b';
  shopName?: string;
  creditLimit?: number;
  /** Avoir: money the shop holds for the customer, the same field the counter uses. */
  storeCredit?: number;
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
  /** This row is money the linked sale or repair document already counts at the till
   *  (its opening payment row), so the drawer must not add it a second time. */
  countedOn?: 'sale' | 'repair';
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
  /** The replay key of the debt entry — see `SaleTransaction.idempotencyKey`. */
  idempotencyKey?: string;
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
  /** The line's money at the price the document carries, so a reprint of a corrected
   *  invoice does not have to re-multiply what the counter already wrote down. */
  totalPrice?: number;
  /**
   * A line the customer handed over instead of bought, so its money comes off the
   * invoice. The counter writes these on an exchange; a phone only has to read them
   * back, but a void that missed the sign would restock goods that were never sold.
   */
  isReturn?: boolean;
  /** What the counter agreed to pay for a line it took back, when that is not the
   *  price the shelf still shows. The till prices an exchange off this first. */
  customReturnPrice?: number;
  /** False when a returned line was kept off the shelf (faulty, sent for repair). */
  restock?: boolean;
  /** Why a line came back, as the counter wrote it. A re-correction rebuilds the line
   *  from the units, and the reason is the one thing it must not lose. */
  returnReason?: string;
}

export interface SaleTransaction {
  id: string;
  date: string;
  items: CartItem[];
  subtotal: number;
  discount?: { type: 'percent' | 'flat'; value: number };
  /** What each line was knocked down to, in dinars — the same field the counter
   *  writes. A concession folded into a line's price is invisible to anything that
   *  adds up the document's discount field, so the shop keeps it written down here
   *  where its totals can see it. */
  lineDiscounts?: { productId: string; name: string; granted: number; percent: number }[];
  total: number;
  payments: { method: PaymentMethod; amount: number }[];
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  saleType?: 'retail' | 'parts_b2b';
  invoiceNumber?: string;
  /**
   * True when the number came off the phone's own clock because the shared counter
   * could not be reached. A clock number repeats inside a busy day, so this says which
   * references a match on `invoiceNumber` may not trust.
   */
  invoiceNumberProvisional?: boolean;
  /**
   * The clock's guess, kept once the counter has replaced it. It is the reference
   * printed on the paper the customer left with, and the one a debt raised before
   * the rename still names.
   */
  provisionalInvoiceNumber?: string;
  /**
   * Minted before the first attempt to write this sale and stamped on the document,
   * so a replay can find what it already wrote. Without it the queue's own id is the
   * only key, and a sale the server saved while the phone saw a timeout is a sale
   * nothing can recognise — so the next sync posts it a second time.
   */
  idempotencyKey?: string;
  /**
   * The sold units have already left the shelf for this invoice, and the customer's own
   * totals have already gained it. Stamped in the same transaction that moves them, so a
   * sync pass finding the document already on the server can tell work that is finished
   * from an invoice nobody ever moved the shelf for.
   */
  stockApplied?: boolean;
  profileApplied?: boolean;
  /**
   * The approval that authorised this void, refund or edit. Kept for the audit trail:
   * unlike `approvalRequestId` it survives the correction landing, so an invoice edited
   * under permission still names the permission after it stops waiting for anyone.
   */
  approvedRequestId?: string;
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
  /** The request this invoice is parked behind while it waits; cleared once the answer lands. */
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


