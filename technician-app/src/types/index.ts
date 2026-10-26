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
}

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'transfer' | 'debt' | 'store_credit';
export type ProductCategory = 'smartphone' | 'tablet' | 'accessory' | 'wearable' | 'repair_part';

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
  barcode?: string;
  category: ProductCategory;
  lowStockThreshold: number;
  imageUrl?: string;
}

export interface CartItem {
  product: PhoneModel;
  quantity: number;
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
  status?: 'completed' | 'refunded';
}

