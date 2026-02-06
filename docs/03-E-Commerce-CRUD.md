# E-Commerce CRUD Operations

Complete reference for managing products, variants, collections, inventory, suppliers, and purchase orders in FLEXI-POS.

## Table of Contents

1. [Overview](#overview)
2. [Products](#products)
3. [Variants](#variants)
4. [Collections](#collections)
5. [Locations](#locations)
6. [Inventory Management](#inventory-management)
7. [Inventory Audit](#inventory-audit)
8. [Suppliers](#suppliers)
9. [Purchase Orders](#purchase-orders)
10. [Transfers](#transfers)
11. [Gift Cards](#gift-cards)

---

## Overview

FLEXI-POS provides comprehensive e-commerce management with:
- **Products** - Base product information
- **Variants** - Product variations (size, color, etc.)
- **Collections** - Organize products into categories
- **Locations** - Multiple warehouse/store locations
- **Inventory** - Track stock across locations
- **Suppliers** - Manage vendor information
- **Purchase Orders** - Procurement workflow
- **Transfers** - Move inventory between locations
- **Gift Cards** - Gift card management

**Base URL:** `http://localhost:9200`  
**Authentication:** Bearer Token (JWT)

---

## Products

### Create Product

**Endpoint:** `POST /products`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "name": "Gaming Laptop Pro",
  "sku": "LAPTOP-001",
  "price": 1299.99,
  "compareAtPrice": 1499.99,
  "cost": 800,
  "type": "physical",
  "weight": 2.5,
  "weightUnit": "kg",
  "images": [
    {
      "url": "https://cdn.example.com/laptop.jpg",
      "alt": "Laptop front view",
      "isDefault": true
    }
  ],
  "tags": ["electronics", "gaming", "laptop"],
  "vendor": "TechBrand",
  "description": "High-performance gaming laptop with RTX 4090",
  "metaDescription": "Premium gaming laptop",
  "status": "active"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "product": {
    "_id": "507f1f77bcf86cd799439050",
    "name": "Gaming Laptop Pro",
    "sku": "LAPTOP-001",
    "price": 1299.99,
    "compareAtPrice": 1499.99,
    "cost": 800,
    "createdAt": "2026-01-22T22:00:00Z"
  }
}
```

### Get All Products

**Endpoint:** `GET /products`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `page` (optional) - Default: 1
- `limit` (optional) - Default: 20
- `search` (optional) - Search by name or SKU
- `tags` (optional) - Filter by tags (comma-separated)
- `status` (optional) - Filter by status (active, archived, draft)
- `sortBy` (optional) - created, name, price (default: created)
- `sortOrder` (optional) - asc, desc (default: desc)

**Example:**
```
GET /products?page=1&limit=10&search=laptop&status=active&sortBy=price&sortOrder=asc
```

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "_id": "507f1f77bcf86cd799439050",
      "name": "Gaming Laptop Pro",
      "sku": "LAPTOP-001",
      "price": 1299.99,
      "status": "active",
      "variants": 3,
      "images": [...]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5
  }
}
```

### Get Product by ID

**Endpoint:** `GET /products/:productId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "product": {
    "_id": "507f1f77bcf86cd799439050",
    "name": "Gaming Laptop Pro",
    "sku": "LAPTOP-001",
    "price": 1299.99,
    "compareAtPrice": 1499.99,
    "cost": 800,
    "description": "High-performance gaming laptop with RTX 4090",
    "vendor": "TechBrand",
    "variants": [
      {
        "_id": "507f1f77bcf86cd799439051",
        "sku": "LAPTOP-001-16GB",
        "name": "16GB RAM Version",
        "price": 1399.99
      }
    ],
    "createdAt": "2026-01-22T22:00:00Z",
    "updatedAt": "2026-01-22T22:00:00Z"
  }
}
```

### Update Product

**Endpoint:** `PUT /products/:productId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:** (any fields to update)
```json
{
  "name": "Gaming Laptop Pro X",
  "price": 1349.99,
  "description": "Updated description"
}
```

**Response:**
```json
{
  "success": true,
  "product": {
    "_id": "507f1f77bcf86cd799439050",
    "name": "Gaming Laptop Pro X",
    "price": 1349.99
  }
}
```

### Delete Product

**Endpoint:** `DELETE /products/:productId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

---

## Variants

Product variants represent different versions (size, color, etc.).

### Create Variant

**Endpoint:** `POST /products/:productId/variants`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "sku": "LAPTOP-001-16GB",
  "name": "16GB RAM Version",
  "price": 1399.99,
  "compareAtPrice": 1599.99,
  "cost": 850,
  "attributes": {
    "ram": "16GB",
    "storage": "512GB SSD"
  },
  "inventory": {
    "quantity": 100
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "variant": {
    "_id": "507f1f77bcf86cd799439051",
    "sku": "LAPTOP-001-16GB",
    "name": "16GB RAM Version",
    "price": 1399.99
  }
}
```

### Get Product Variants

**Endpoint:** `GET /products/:productId/variants`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "variants": [
    {
      "_id": "507f1f77bcf86cd799439051",
      "sku": "LAPTOP-001-16GB",
      "name": "16GB RAM Version",
      "price": 1399.99,
      "quantity": 100
    }
  ]
}
```

### Update Variant

**Endpoint:** `PUT /products/:productId/variants/:variantId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "price": 1449.99,
  "quantity": 90
}
```

### Delete Variant

**Endpoint:** `DELETE /products/:productId/variants/:variantId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Collections

Organize products into categories or collections.

### Create Collection

**Endpoint:** `POST /collections`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "name": "Gaming Laptops",
  "description": "High-performance laptops for gaming",
  "image": "https://cdn.example.com/gaming-collection.jpg",
  "products": ["507f1f77bcf86cd799439050", "507f1f77bcf86cd799439052"],
  "status": "active"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "collection": {
    "_id": "507f1f77bcf86cd799439060",
    "name": "Gaming Laptops",
    "productCount": 2
  }
}
```

### Get All Collections

**Endpoint:** `GET /collections`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

### Add Products to Collection

**Endpoint:** `PUT /collections/:collectionId/products`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "productIds": ["507f1f77bcf86cd799439050", "507f1f77bcf86cd799439052"]
}
```

---

## Locations

Represent physical locations (stores, warehouses) for inventory management.

### Create Location

**Endpoint:** `POST /locations`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "name": "Main Store",
  "address": "123 Main St, New York, NY 10001",
  "phone": "+1-555-0100",
  "type": "retail",
  "isActive": true,
  "coordinates": {
    "latitude": 40.7128,
    "longitude": -74.0060
  }
}
```

**Location Types:**
- `retail` - Physical retail store
- `warehouse` - Storage/fulfillment center
- `kiosk` - Small retail point
- `office` - Administrative office

**Response (201 Created):**
```json
{
  "success": true,
  "location": {
    "_id": "507f1f77bcf86cd799439070",
    "name": "Main Store",
    "type": "retail",
    "isActive": true
  }
}
```

### Get All Locations

**Endpoint:** `GET /locations`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

### Get Location Details

**Endpoint:** `GET /locations/:locationId`

---

## Inventory Management

### Initialize Inventory

**Endpoint:** `POST /inventory/initialize`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "variant": "507f1f77bcf86cd799439051",
  "location": "507f1f77bcf86cd799439070",
  "quantity": 100,
  "reorderLevel": 20,
  "reorderQuantity": 50
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "inventory": {
    "_id": "507f1f77bcf86cd799439080",
    "variant": "507f1f77bcf86cd799439051",
    "location": "507f1f77bcf86cd799439070",
    "quantity": 100,
    "available": 100,
    "reserved": 0
  }
}
```

### Get All Inventory

**Endpoint:** `GET /inventory`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `location` (optional) - Filter by location
- `variant` (optional) - Filter by variant
- `lowStock` (optional) - Show only items below reorder level

### Get Inventory Detail

**Endpoint:** `GET /inventory/:inventoryId`

### Adjust Inventory

**Endpoint:** `PATCH /inventory/:inventoryId/adjust`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "quantity": -10,
  "reason": "stock-correction",
  "notes": "Physical count discrepancy"
}
```

**Adjustment Reasons:**
- `stock-correction` - Manual adjustment
- `damage` - Damaged goods
- `theft` - Missing stock
- `return` - Customer return
- `transfer` - Moved to another location

**Response:**
```json
{
  "success": true,
  "inventory": {
    "_id": "507f1f77bcf86cd799439080",
    "quantity": 90,
    "adjustmentHistory": [
      {
        "quantity": -10,
        "reason": "stock-correction",
        "timestamp": "2026-01-22T22:00:00Z"
      }
    ]
  }
}
```

### Update Reorder Levels

**Endpoint:** `PATCH /inventory/:inventoryId/reorder-levels`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "reorderLevel": 25,
  "reorderQuantity": 60
}
```

---

## Inventory Audit

Track all inventory changes over time.

### Get Inventory Audit Trail

**Endpoint:** `GET /inventory/:inventoryId/audit`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `startDate` (optional) - ISO 8601 format
- `endDate` (optional) - ISO 8601 format
- `action` (optional) - adjust, transfer, sale, return

**Response:**
```json
{
  "success": true,
  "auditTrail": [
    {
      "_id": "507f1f77bcf86cd799439090",
      "action": "adjust",
      "previousQuantity": 100,
      "newQuantity": 90,
      "difference": -10,
      "reason": "stock-correction",
      "userId": "507f1f77bcf86cd799439011",
      "timestamp": "2026-01-22T22:00:00Z"
    }
  ]
}
```

### Get Variant Location Audit

**Endpoint:** `GET /inventory/audit/variant/:variantId/location/:locationId`

---

## Suppliers

Manage vendor information and pricing.

### Create Supplier

**Endpoint:** `POST /suppliers`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "name": "Tech Imports Inc",
  "email": "orders@techimports.com",
  "phone": "+1-555-0200",
  "address": "456 Supplier Ave, Los Angeles, CA 90001",
  "paymentTerms": "net-30",
  "leadTimeInDays": 5,
  "isActive": true,
  "contacts": [
    {
      "name": "John Sales",
      "email": "john@techimports.com",
      "phone": "+1-555-0201"
    }
  ]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "supplier": {
    "_id": "507f1f77bcf86cd799439100",
    "name": "Tech Imports Inc",
    "email": "orders@techimports.com"
  }
}
```

### Get All Suppliers

**Endpoint:** `GET /suppliers`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

### Get Supplier Details

**Endpoint:** `GET /suppliers/:supplierId`

### Update Supplier

**Endpoint:** `PUT /suppliers/:supplierId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

### Delete Supplier

**Endpoint:** `DELETE /suppliers/:supplierId`

---

## Purchase Orders

Manage procurement workflow.

### Create Purchase Order

**Endpoint:** `POST /purchase-orders`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "supplier": "507f1f77bcf86cd799439100",
  "deliveryLocation": "507f1f77bcf86cd799439070",
  "items": [
    {
      "variant": "507f1f77bcf86cd799439051",
      "quantity": 50,
      "unitCost": 800
    }
  ],
  "notes": "Rush order - needed ASAP",
  "expectedDeliveryDate": "2026-02-01T00:00:00Z"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "purchaseOrder": {
    "_id": "507f1f77bcf86cd799439110",
    "poNumber": "PO-2026-001",
    "status": "draft",
    "totalCost": 40000
  }
}
```

### Get All Purchase Orders

**Endpoint:** `GET /purchase-orders`

**Query Parameters:**
- `status` (optional) - draft, sent, confirmed, received, cancelled
- `supplier` (optional) - Filter by supplier

### Get Purchase Order Details

**Endpoint:** `GET /purchase-orders/:purchaseOrderId`

### Send Purchase Order

**Endpoint:** `POST /purchase-orders/:purchaseOrderId/send`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "purchaseOrder": {
    "_id": "507f1f77bcf86cd799439110",
    "status": "sent",
    "sentAt": "2026-01-22T22:00:00Z"
  }
}
```

Email sent to supplier automatically.

### Confirm Purchase Order

**Endpoint:** `POST /purchase-orders/:purchaseOrderId/confirm`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "poConfirmationNumber": "SUPPLIER-PO-123"
}
```

### Receive Purchase Order

**Endpoint:** `POST /purchase-orders/:purchaseOrderId/receive`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "items": [
    {
      "variant": "507f1f77bcf86cd799439051",
      "quantityReceived": 50
    }
  ],
  "notes": "All items received in good condition"
}
```

Inventory is automatically updated when receiving items.

### Cancel Purchase Order

**Endpoint:** `POST /purchase-orders/:purchaseOrderId/cancel`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Transfers

Move inventory between locations.

### Create Transfer

**Endpoint:** `POST /transfers`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "fromLocation": "507f1f77bcf86cd799439070",
  "toLocation": "507f1f77bcf86cd799439071",
  "items": [
    {
      "variant": "507f1f77bcf86cd799439051",
      "quantity": 20
    }
  ],
  "reason": "inventory-rebalance"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "transfer": {
    "_id": "507f1f77bcf86cd799439120",
    "status": "pending",
    "totalItems": 20
  }
}
```

### Get All Transfers

**Endpoint:** `GET /transfers`

### Ship Transfer

**Endpoint:** `POST /transfers/:transferId/ship`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

### Receive Transfer

**Endpoint:** `POST /transfers/:transferId/receive`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "items": [
    {
      "variant": "507f1f77bcf86cd799439051",
      "quantityReceived": 20
    }
  ]
}
```

---

## Gift Cards

### Create Gift Card

**Endpoint:** `POST /gift-cards`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "amount": 100,
  "currency": "USD",
  "expiryDate": "2027-01-22T00:00:00Z",
  "notes": "Customer loyalty reward"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "giftCard": {
    "_id": "507f1f77bcf86cd799439130",
    "code": "GC-XYZABC123",
    "balance": 100,
    "status": "active"
  }
}
```

### Get Gift Card by Code

**Endpoint:** `GET /gift-cards/lookup/:code`

**Response:**
```json
{
  "success": true,
  "giftCard": {
    "_id": "507f1f77bcf86cd799439130",
    "code": "GC-XYZABC123",
    "balance": 75.50,
    "status": "active",
    "expiryDate": "2027-01-22T00:00:00Z"
  }
}
```

### Redeem Gift Card

**Endpoint:** `POST /gift-cards/:giftCardId/redeem`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "amount": 25.00,
  "saleId": "507f1f77bcf86cd799439135"
}
```

**Response:**
```json
{
  "success": true,
  "giftCard": {
    "_id": "507f1f77bcf86cd799439130",
    "balance": 50.50
  }
}
```

### Deactivate Gift Card

**Endpoint:** `POST /gift-cards/:giftCardId/deactivate`

---

## Related Guides

- [Sales Operations](04-Sales.md) - Process POS sales
- [Shopify Integration](05-Shopify-Integration.md) - Sync FLEXI catalog with Shopify
- [Advanced Features](06-Advanced-Features.md) - Error handling and best practices
