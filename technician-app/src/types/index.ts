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
  createdById?: string;
  createdByName?: string;
  statusHistory?: RepairStatusHistoryEntry[];
  lockType?: 'none' | 'pin' | 'pattern' | 'password';
  lockValue?: string;
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
