// Permission System Configuration
// Defines all available permissions, role mappings, and critical permission classifications

const PERMISSIONS = {
  VIEW_USERS: "view_users",
  // Sales Permissions
  CREATE_SALE: "create_sale",
  VIEW_SALE_HISTORY: "view_sale_history",
  EDIT_SALE: "edit_sale",
  DELETE_SALE: "delete_sale",
  REFUND_SALE: "refund_sale",

  // POS Permissions
  POS_OVERRIDE_PRICE: "pos:override_price",
  POS_ACCESS_SHOPIFY_PRODUCTS: "pos:access_shopify_products",
  POS_APPLY_DISCOUNT: "pos:apply_discount",
  POS_VIEW_COST: "pos:view_cost",

  // Reporting Permissions
  VIEW_REPORTS: "view_reports",
  EXPORT_REPORTS: "export_reports",
  VIEW_FINANCIAL_REPORTS: "view_financial_reports",

  // Finance Permissions
  MANAGE_FINANCE: "manage_finance",
  VIEW_EXPENSES: "view_expenses",
  CREATE_EXPENSES: "create_expenses",
  APPROVE_EXPENSES: "approve_expenses",

  // Inventory Permissions
  MANAGE_INVENTORY: "manage_inventory",
  VIEW_INVENTORY: "view_inventory",
  ADJUST_INVENTORY: "adjust_inventory",

  // Product Permissions
  CREATE_PRODUCT: "create_product",
  EDIT_PRODUCT: "edit_product",
  DELETE_PRODUCT: "delete_product",
  VIEW_PRODUCT: "view_product",

  // Invoice Permissions
  CREATE_INVOICE: "create_invoice",
  VIEW_INVOICE: "view_invoice",
  EDIT_INVOICE: "edit_invoice",
  DELETE_INVOICE: "delete_invoice",

  // Vault Permissions
  MANAGE_VAULT: "manage_vault",
  VIEW_VAULT: "view_vault",
  CREATE_VAULT: "create_vault",
  DELETE_VAULT: "delete_vault",

  // Quick Items Permissions
  MANAGE_QUICK_ITEMS: "manage_quick_items",
  VIEW_QUICK_ITEMS: "view_quick_items",

  // User Management Permissions
  MANAGE_USERS: "manage_users",
  VIEW_USERS: "view_users",
  CREATE_USER: "create_user",
  EDIT_USER: "edit_user",
  DELETE_USER: "delete_user",
  BAN_USER: "ban_user",

  // Role & Permission Management
  MANAGE_ROLES: "manage_roles",
  VIEW_ROLES: "view_roles",
  ASSIGN_PERMISSIONS: "assign_permissions",

  // Audit & Security
  MANAGE_AUDIT_LOGS: "manage_audit_logs",
  VIEW_AUDIT_LOGS: "view_audit_logs",
  EXPORT_AUDIT_LOGS: "export_audit_logs",
  PURGE_AUDIT_LOGS: "purge_audit_logs",

  // System Administration
  MANAGE_SETTINGS: "manage_settings",
  VIEW_SETTINGS: "view_settings",

  // Delivery Fee Permissions
  DELIVERY_FEES_CREATE: "delivery_fees.create",
  DELIVERY_FEES_READ: "delivery_fees.read",
  DELIVERY_FEES_UPDATE: "delivery_fees.update",
  DELIVERY_FEES_DELETE: "delivery_fees.delete",
  DELIVERY_FEES_ASSIGN_DRIVER: "delivery_fees.assign_driver",
  DELIVERY_FEES_UPDATE_STATUS: "delivery_fees.update_status",

  // NEW: Customer Permissions
  VIEW_CUSTOMERS: "view_customers",
  CREATE_CUSTOMERS: "create_customers",
};

// Critical permissions that require immediate database check
const CRITICAL_PERMISSIONS = [
  PERMISSIONS.MANAGE_USERS,
  PERMISSIONS.DELETE_USER,
  PERMISSIONS.BAN_USER,
  PERMISSIONS.DELETE_SALE,
  PERMISSIONS.DELETE_INVOICE,
  PERMISSIONS.MANAGE_ROLES,
  PERMISSIONS.ASSIGN_PERMISSIONS,
  PERMISSIONS.MANAGE_AUDIT_LOGS,
  PERMISSIONS.EXPORT_AUDIT_LOGS,
  PERMISSIONS.PURGE_AUDIT_LOGS,
  PERMISSIONS.MANAGE_SETTINGS,
  PERMISSIONS.MANAGE_FINANCE,
];

// Role to Permissions Mapping (No Inheritance)
const ROLE_PERMISSIONS = {
  Owner: [
    // All permissions
    ...Object.values(PERMISSIONS),
  ],
  
  Manager: [
    // Sales
    PERMISSIONS.CREATE_SALE,
    PERMISSIONS.VIEW_SALE_HISTORY,
    PERMISSIONS.EDIT_SALE,
    PERMISSIONS.REFUND_SALE,
    
      // POS
      PERMISSIONS.POS_OVERRIDE_PRICE,
      PERMISSIONS.POS_ACCESS_SHOPIFY_PRODUCTS,
      PERMISSIONS.POS_APPLY_DISCOUNT,
      PERMISSIONS.POS_VIEW_COST,
    
    // Reporting
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.EXPORT_REPORTS,
    PERMISSIONS.VIEW_FINANCIAL_REPORTS,
    PERMISSIONS.MANAGE_FINANCE,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.CREATE_EXPENSES,
    PERMISSIONS.APPROVE_EXPENSES,
    
    // Inventory
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_INVENTORY,
    PERMISSIONS.ADJUST_INVENTORY,
    
    // Products
    PERMISSIONS.CREATE_PRODUCT,
    PERMISSIONS.EDIT_PRODUCT,
    PERMISSIONS.VIEW_PRODUCT,
    
    // Invoices
    PERMISSIONS.CREATE_INVOICE,
    PERMISSIONS.VIEW_INVOICE,
    PERMISSIONS.EDIT_INVOICE,
    
    // Vault
    PERMISSIONS.MANAGE_VAULT,
    PERMISSIONS.VIEW_VAULT,
    PERMISSIONS.CREATE_VAULT,
    
    // Quick Items
    PERMISSIONS.MANAGE_QUICK_ITEMS,
    PERMISSIONS.VIEW_QUICK_ITEMS,
    
    // Users (limited)
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.CREATE_USER,
    PERMISSIONS.EDIT_USER,
    
    // Delivery Fees
    PERMISSIONS.DELIVERY_FEES_CREATE,
    PERMISSIONS.DELIVERY_FEES_READ,
    PERMISSIONS.DELIVERY_FEES_UPDATE,
    PERMISSIONS.DELIVERY_FEES_DELETE,
    PERMISSIONS.DELIVERY_FEES_ASSIGN_DRIVER,
    PERMISSIONS.DELIVERY_FEES_UPDATE_STATUS,
    
    // Settings
    PERMISSIONS.VIEW_SETTINGS,

    // NEW: Customers
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.CREATE_CUSTOMERS,
  ],
  
  Cashier: [
    
      // POS (limited - no price override or cost view)
      PERMISSIONS.POS_ACCESS_SHOPIFY_PRODUCTS,
      PERMISSIONS.POS_APPLY_DISCOUNT,
    // Sales
    PERMISSIONS.CREATE_SALE,
    PERMISSIONS.VIEW_SALE_HISTORY,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.CREATE_EXPENSES,
    
    // Inventory (view only)
    PERMISSIONS.VIEW_INVENTORY,
    
    // Products (view only)
    PERMISSIONS.VIEW_PRODUCT,
    
    // Invoices
    PERMISSIONS.CREATE_INVOICE,
    PERMISSIONS.VIEW_INVOICE,
    
    // Vault (view only)
    PERMISSIONS.VIEW_VAULT,
    
    // Quick Items
    PERMISSIONS.VIEW_QUICK_ITEMS,
    
    // Delivery Fees (limited)
    PERMISSIONS.DELIVERY_FEES_CREATE,
    PERMISSIONS.DELIVERY_FEES_READ,
  ],
  
  Employee: [
    // Minimal permissions
    PERMISSIONS.VIEW_PRODUCT,
    PERMISSIONS.VIEW_INVENTORY,
    
    // Delivery Fees (view only for potential driver role)
    PERMISSIONS.DELIVERY_FEES_READ,
    PERMISSIONS.DELIVERY_FEES_UPDATE_STATUS,
  ],
};

// Permission Groups for easier management
const PERMISSION_GROUPS = {
  sales: [
    PERMISSIONS.CREATE_SALE,
    PERMISSIONS.VIEW_SALE_HISTORY,
    PERMISSIONS.EDIT_SALE,
    PERMISSIONS.DELETE_SALE,
    PERMISSIONS.REFUND_SALE,
  ],
  pos: [
    PERMISSIONS.POS_OVERRIDE_PRICE,
    PERMISSIONS.POS_ACCESS_SHOPIFY_PRODUCTS,
    PERMISSIONS.POS_APPLY_DISCOUNT,
    PERMISSIONS.POS_VIEW_COST,
  ],
  reporting: [
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.EXPORT_REPORTS,
    PERMISSIONS.VIEW_FINANCIAL_REPORTS,
  ],
  finance: [
    PERMISSIONS.MANAGE_FINANCE,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.CREATE_EXPENSES,
    PERMISSIONS.APPROVE_EXPENSES,
  ],
  inventory: [
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_INVENTORY,
    PERMISSIONS.ADJUST_INVENTORY,
  ],
  products: [
    PERMISSIONS.CREATE_PRODUCT,
    PERMISSIONS.EDIT_PRODUCT,
    PERMISSIONS.DELETE_PRODUCT,
    PERMISSIONS.VIEW_PRODUCT,
  ],
  admin: [
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.MANAGE_AUDIT_LOGS,
    PERMISSIONS.MANAGE_SETTINGS,
  ],
  deliveryFees: [
    PERMISSIONS.DELIVERY_FEES_CREATE,
    PERMISSIONS.DELIVERY_FEES_READ,
    PERMISSIONS.DELIVERY_FEES_UPDATE,
    PERMISSIONS.DELIVERY_FEES_DELETE,
    PERMISSIONS.DELIVERY_FEES_ASSIGN_DRIVER,
    PERMISSIONS.DELIVERY_FEES_UPDATE_STATUS,
  ],
  customers: [
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.CREATE_CUSTOMERS,
  ],
};

// Helper function to check if permission is critical
const isCriticalPermission = (permission) => {
  return CRITICAL_PERMISSIONS.includes(permission);
};

// Helper function to get permissions for a role
const getPermissionsForRole = (role) => {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Employee;
};

// Helper function to validate permission exists
const isValidPermission = (permission) => {
  return Object.values(PERMISSIONS).includes(permission);
};

module.exports = {
  PERMISSIONS,
  CRITICAL_PERMISSIONS,
  ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  isCriticalPermission,
  getPermissionsForRole,
  isValidPermission,
};