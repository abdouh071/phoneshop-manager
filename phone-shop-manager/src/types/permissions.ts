// All available feature permissions in the system
export interface Permissions {
  dashboard: boolean;
  pos: boolean;
  repairs: boolean;
  repair_add: boolean;         // Add new repair tickets
  repair_edit: boolean;        // Edit existing repair ticket info
  repair_status: boolean;      // Change repair ticket status
  repair_assign: boolean;      // Assign tickets to technicians
  inventory_products: boolean; // phones, accessories, tablets, wearables
  inventory_parts: boolean;    // repair parts (category = 'repair_part')
  inventory_edit: boolean;     // add/edit/delete items & adjust stock
  inventory_delete: boolean;   // delete products and parts
  parts_sell: boolean;         // sell repair parts from the dedicated Parts section
  customers: boolean;
  customers_debt: boolean;     // View and manage customer debt
  reports: boolean;
  activity: boolean;
}

// Sales Agent: can sell and view sales inventory only
export const SALES_AGENT_PERMISSIONS: Permissions = {
  dashboard: true,
  pos: true,
  repairs: false,
  repair_add: false,
  repair_edit: false,
  repair_status: false,
  repair_assign: false,
  inventory_products: true,
  inventory_parts: false,
  inventory_edit: false,
  inventory_delete: false,
  parts_sell: false,
  customers: true,
  customers_debt: false,
  reports: false,
  activity: false,
};

// Repair Agent: can manage repairs and repair parts only
export const REPAIR_AGENT_PERMISSIONS: Permissions = {
  dashboard: true,
  pos: false,
  repairs: true,
  repair_add: true,
  repair_edit: true,
  repair_status: true,
  repair_assign: true,
  inventory_products: false,
  inventory_parts: true,
  inventory_edit: false,
  inventory_delete: false,
  parts_sell: true,
  customers: true,
  customers_debt: false,
  reports: false,
  activity: false,
};

// Admins always have every permission
export const FULL_PERMISSIONS: Permissions = {
  dashboard: true,
  pos: true,
  repairs: true,
  repair_add: true,
  repair_edit: true,
  repair_status: true,
  repair_assign: true,
  inventory_products: true,
  inventory_parts: true,
  inventory_edit: true,
  inventory_delete: true,
  parts_sell: true,
  customers: true,
  customers_debt: true,
  reports: true,
  activity: true,
};

// Default for custom cashier-style roles (legacy fallback)
export const DEFAULT_CASHIER_PERMISSIONS: Permissions = { ...SALES_AGENT_PERMISSIONS };

// Human-readable labels and descriptions for the UI permissions panel
export const PERMISSION_DEFINITIONS: {
  key: keyof Permissions;
  label: string;
  description: string;
  group: string;
}[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'View sales stats, charts, and daily overview',
    group: 'Core',
  },
  {
    key: 'pos',
    label: 'Point of Sale',
    description: 'Process sales, apply discounts, and handle payments',
    group: 'Core',
  },
  {
    key: 'customers',
    label: 'View Customers',
    description: 'View customer profiles and history',
    group: 'Core',
  },
  {
    key: 'customers_debt',
    label: 'Manage Customer Debt',
    description: 'View and manage customer debt and payments',
    group: 'Core',
  },
  {
    key: 'repairs',
    label: 'View Repairs',
    description: 'View the repair board and tickets',
    group: 'Operations',
  },
  {
    key: 'repair_add',
    label: 'Add Repair Tickets',
    description: 'Create new repair tickets',
    group: 'Operations',
  },
  {
    key: 'repair_edit',
    label: 'Edit Repair Tickets',
    description: 'Edit existing repair ticket information',
    group: 'Operations',
  },
  {
    key: 'repair_status',
    label: 'Change Repair Status',
    description: 'Update the status of repair tickets (e.g., In Progress, Ready)',
    group: 'Operations',
  },
  {
    key: 'repair_assign',
    label: 'Assign Technicians',
    description: 'Assign repair tickets to registered technicians',
    group: 'Operations',
  },
  {
    key: 'inventory_products',
    label: 'View Sales Inventory',
    description: 'Browse phones, tablets, accessories, and wearables',
    group: 'Inventory',
  },
  {
    key: 'inventory_parts',
    label: 'View Repair Parts',
    description: 'Browse repair components and spare parts stock',
    group: 'Inventory',
  },
  {
    key: 'inventory_edit',
    label: 'Edit Inventory',
    description: 'Add/edit/delete products and adjust stock quantities',
    group: 'Inventory',
  },
  {
    key: 'parts_sell',
    label: 'Sell Parts',
    description: 'Sell repair parts directly to walk-in customers from the Parts section',
    group: 'Inventory',
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Access full business analytics and revenue reports',
    group: 'Management',
  },
  {
    key: 'activity',
    label: 'Activity Log',
    description: 'View the full log of actions taken by all staff',
    group: 'Management',
  },
];
