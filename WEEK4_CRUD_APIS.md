# Week 4: E-Commerce CRUD APIs - Implementation Complete

## Controllers Created (10 total)

All controllers implement full CRUD operations with:
- ✅ Organization-scoped tenant isolation (organizationId)
- ✅ Token-based authentication (verifyToken middleware)
- ✅ Audit logging via logTokenEvent
- ✅ Pagination support (skip/limit)
- ✅ Error handling
- ✅ Data validation

---

## API Endpoints

### 1. PRODUCTS
Base URL: `/products`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/products` | Create product | ✅ | name, sku, price, type, description, images, tags, vendor |
| GET | `/products` | List all products | ✅ | Query: status, search, skip, limit |
| GET | `/products/:id` | Get product + variants | ✅ | - |
| PUT | `/products/:id` | Update product | ✅ | name, description, sku, price, compareAtPrice, cost, weight, tags, images, status |
| DELETE | `/products/:id` | Delete product (no variants) | ✅ | - |

**Key Features:**
- SKU unique per organization
- Prevents deletion if variants exist
- Automatic createdBy tracking
- Supports search and status filtering

---

### 2. VARIANTS
Base URL: `/variants`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/variants` | Create variant | ✅ | productId, sku, price (optional - inherits), weight, metafields, barcode, digitalContent |
| GET | `/variants` | List variants | ✅ | Query: productId, status, skip, limit |
| GET | `/variants/:id` | Get variant | ✅ | - |
| PUT | `/variants/:id` | Update variant | ✅ | sku, price, weight, metafields, barcode, status, taxClass |
| DELETE | `/variants/:id` | Delete variant | ✅ | - |

**Key Features:**
- Inherits product pricing if not overridden
- SKU unique per organization
- Supports metafields (custom key-value pairs)
- Ordered by position then creation date
- Tracks variant-specific taxes

---

### 3. COLLECTIONS
Base URL: `/collections`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/collections` | Create collection | ✅ | name, description, type (manual/automatic), rules, productIds, parentCollectionId |
| GET | `/collections` | List collections | ✅ | Query: parentCollectionId, type, status, skip, limit |
| GET | `/collections/:id` | Get collection | ✅ | - |
| PUT | `/collections/:id` | Update collection | ✅ | name, description, type, rules, productIds, parentCollectionId, status |
| DELETE | `/collections/:id` | Delete collection & fix hierarchy | ✅ | - |

**Key Features:**
- Hierarchical support (parent-child tree structure)
- Auto-slug generation (sanitized, conflict-resolved)
- Manual collections (static product list)
- Automatic collections (rule-based: tag contains, price > etc.)
- Cascading delete (child collections keep hierarchy)

---

### 4. LOCATIONS
Base URL: `/locations`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/locations` | Create location | ✅ | name, locationType (warehouse/retail/fulfillment), address, taxRate, currency, isDefault |
| GET | `/locations` | List locations | ✅ | Query: locationType, status, skip, limit |
| GET | `/locations/:id` | Get location | ✅ | - |
| PUT | `/locations/:id` | Update location | ✅ | name, locationType, address, taxRate, currency, isDefault, status |
| DELETE | `/locations/:id` | Delete location (not last one) | ✅ | - |

**Key Features:**
- Default location per organization
- Multi-warehouse/retail/fulfillment support
- Region-specific tax rates
- Metafield definitions per location
- Prevents deletion of last location

---

### 5. INVENTORY
Base URL: `/inventory`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/inventory` | Initialize inventory | ✅ | variantId, locationId, onHand, reorderPoint, reorderQuantity |
| GET | `/inventory` | List inventory | ✅ | Query: variantId, locationId, skip, limit |
| GET | `/inventory/:variantId/:locationId` | Get specific inventory | ✅ | - |
| PUT | `/inventory/:variantId/:locationId/adjust` | Manual adjustment | ✅ | onHandAdjustment, reason |
| PUT | `/inventory/:variantId/:locationId` | Update reorder levels | ✅ | reorderPoint, reorderQuantity |

**Key Features:**
- Unique compound index: (organizationId, variantId, locationId)
- Four-state tracking: onHand, available, committed, unavailable
- Available = onHand - committed
- Automatic inventory audit logging
- Reorder point alerts
- Unique per variant per location

---

### 6. INVENTORY AUDIT
Base URL: `/inventory-audit`

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/inventory-audit` | List audit trail | ✅ |
| GET | `/inventory-audit/:variantId/:locationId` | Variant-location audit | ✅ |

**Query Parameters:**
- variantId, locationId, eventType, startDate, endDate, skip, limit

**Event Types:**
- manual_adjustment
- order_reserved
- order_fulfilled
- order_cancelled
- purchase_order_received
- transfer_sent
- transfer_received
- inventory_count
- damage_reported
- loss_reported

**Key Features:**
- Full before/after snapshot
- User tracking (who made change)
- Reference tracking (linked to orders/transfers)
- Date range filtering

---

### 7. SUPPLIERS
Base URL: `/suppliers`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/suppliers` | Create supplier | ✅ | name, email, phone, address, contactPerson, paymentTerms, taxId, currency, rating |
| GET | `/suppliers` | List suppliers | ✅ | Query: status, search, skip, limit |
| GET | `/suppliers/:id` | Get supplier | ✅ | - |
| PUT | `/suppliers/:id` | Update supplier | ✅ | name, email, phone, address, paymentTerms, rating, status |
| DELETE | `/suppliers/:id` | Delete supplier | ✅ | - |

**Key Features:**
- Payment terms tracking (e.g., "Net 30")
- Payment method enum (bank_transfer, credit_card, check, paypal)
- Rating system (1-5 stars)
- Status tracking (active/inactive)
- Text search by name

---

### 8. PURCHASE ORDERS
Base URL: `/purchase-orders`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/purchase-orders` | Create PO | ✅ | supplierId, items[], receivingLocationId, totals, notes |
| GET | `/purchase-orders` | List POs | ✅ | Query: supplierId, status, skip, limit |
| GET | `/purchase-orders/:id` | Get PO details | ✅ | - |
| PUT | `/purchase-orders/:id` | Edit draft PO | ✅ | items[], totals, notes |
| PUT | `/purchase-orders/:id/send` | Send to supplier | ✅ | - |
| PUT | `/purchase-orders/:id/confirm` | Supplier confirmed | ✅ | - |
| PUT | `/purchase-orders/:id/receive` | Receive items | ✅ | itemReceivingQty[] |
| PUT | `/purchase-orders/:id/cancel` | Cancel PO | ✅ | - |

**Workflow:**
```
draft → sent → confirmed → (partially_received →) received
                                   ↓
                              cancelled
```

**Key Features:**
- Auto-generated PO number (PO-1001, PO-1002, etc.)
- Item-level cost tracking
- Partial receiving support
- Automatic inventory updates on receive
- Shipment tracking (carrier, tracking number, ETA)
- User tracking (createdBy, receivedBy)
- Automatic inventory audit trail

---

### 9. TRANSFERS
Base URL: `/transfers`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/transfers` | Create transfer | ✅ | fromLocationId, toLocationId, items[], reason, notes |
| GET | `/transfers` | List transfers | ✅ | Query: fromLocationId, toLocationId, status, skip, limit |
| GET | `/transfers/:id` | Get transfer | ✅ | - |
| PUT | `/transfers/:id/ship` | Mark shipped | ✅ | - |
| PUT | `/transfers/:id/receive` | Mark received | ✅ | itemReceivingQty[] |
| PUT | `/transfers/:id/cancel` | Cancel transfer | ✅ | - |

**Workflow:**
```
pending → in_transit → delivered
   ↓
cancelled
```

**Key Features:**
- Auto-generated transfer number (TRF-1001, etc.)
- Inventory commitment (blocks source availability)
- Bi-directional inventory updates on receive
- Separate audit trails for source and destination
- Reason tracking (rebalancing, fulfillment, storage_optimization)
- Partial receipt support
- Cannot transfer to same location
- Automatic audit trail on both locations

---

### 10. GIFT CARDS
Base URL: `/gift-cards`

| Method | Endpoint | Purpose | Auth | Body |
|--------|----------|---------|------|------|
| POST | `/gift-cards` | Create gift card | ✅ | initialBalance, currency, expiryDate, customerId, notes |
| GET | `/gift-cards` | List gift cards | ✅ | Query: status, customerId, skip, limit |
| GET | `/gift-cards/lookup/:code` | Lookup by code | ✅ | - |
| GET | `/gift-cards/:id` | Get gift card | ✅ | - |
| PUT | `/gift-cards/:id/redeem` | Redeem amount | ✅ | amountRedeemed, orderId |
| PUT | `/gift-cards/:id` | Update gift card | ✅ | customerId, status, notes |
| PUT | `/gift-cards/:id/deactivate` | Deactivate | ✅ | - |

**Key Features:**
- Auto-generated unique code (GC-XXXXXXXXXX)
- Balance tracking (initialBalance, currentBalance, totalRedeemed)
- Expiry enforcement (auto-flags as expired)
- Redemption history (date, amount, user, order)
- Status: active/inactive/expired
- Automatic deactivation when fully redeemed
- Customer linking for tracking

---

## Request Examples

### Create Product
```bash
POST /products
{
  "name": "Gaming Laptop",
  "sku": "LAPTOP-001",
  "price": 1299.99,
  "compareAtPrice": 1499.99,
  "cost": 800,
  "type": "physical",
  "weight": 2.5,
  "weightUnit": "kg",
  "images": ["https://cdn.example.com/laptop.jpg"],
  "tags": ["electronics", "gaming", "laptop"],
  "vendor": "TechBrand"
}
```

### Create Purchase Order
```bash
POST /purchase-orders
{
  "supplierId": "507f1f77bcf86cd799439011",
  "receivingLocationId": "507f1f77bcf86cd799439012",
  "items": [
    {
      "variantId": "507f1f77bcf86cd799439013",
      "quantity": 50,
      "unitCost": 800
    }
  ],
  "totals": {
    "subtotal": 40000,
    "tax": 4000,
    "shipping": 500,
    "total": 44500
  }
}
```

### Create Transfer
```bash
POST /transfers
{
  "fromLocationId": "507f1f77bcf86cd799439011",
  "toLocationId": "507f1f77bcf86cd799439012",
  "items": [
    {
      "variantId": "507f1f77bcf86cd799439013",
      "quantity": 25
    }
  ],
  "reason": "rebalancing"
}
```

---

## Authentication & Authorization

All endpoints require:
1. **verifyToken** - Valid JWT token (org-scoped)
2. **checkUserStatus** - User account active
3. **organizationId** - Extracted from token

All endpoints automatically:
- Isolate data by organizationId
- Log actions via auditLogger
- Track user (req.user.userId)
- Track IP & user-agent

---

## Error Responses

Standard error format:
```json
{
  "error": "Descriptive error message"
}
```

Common HTTP status codes:
- `201` - Created successfully
- `200` - OK / Updated
- `400` - Bad request / validation error
- `404` - Resource not found
- `409` - Conflict (e.g., duplicate SKU)
- `500` - Server error

---

## Data Consistency Features

### Inventory Management
- ✅ Automatic availability calculation (onHand - committed)
- ✅ Prevents negative inventory
- ✅ Full audit trail for every change
- ✅ Reference tracking to orders/transfers

### Purchase Orders
- ✅ Auto-inventory updates on receive
- ✅ Partial receipt support
- ✅ Bi-directional inventory audit
- ✅ Cost tracking per item

### Transfers
- ✅ Source inventory commitment on create
- ✅ Bi-directional inventory updates on receive
- ✅ Separate audit trails per location
- ✅ Prevents negative inventory

### Collections
- ✅ Hierarchical support (parent-child)
- ✅ Automatic slug generation
- ✅ Cascading deletes preserve child hierarchy

### Gift Cards
- ✅ Expiry enforcement
- ✅ Auto-deactivation when depleted
- ✅ Redemption history tracking
- ✅ Balance verification on redeem

---

## Status Workflows

### Product
- draft → active → archived

### Collection
- active → archived

### Location
- active ↔ inactive

### Purchase Order
```
draft → sent → confirmed → partially_received → received
  ↓                            ↓
  └─────────────────────────→ cancelled
```

### Transfer
```
pending → in_transit → delivered
   ↓
cancelled
```

### Inventory
- on_hand (physical stock)
- available = on_hand - committed
- committed (reserved for orders)
- unavailable (damaged/lost)

### Gift Card
- active ↔ inactive, expired

---

## Implementation Notes

### Scalability
- Compound indexes on (organizationId, status/key) for fast queries
- Pagination on all list endpoints
- Efficient populate/join patterns
- Minimal N+1 queries

### Audit Trail
- Automatic event logging for all changes
- Full before/after snapshots for inventory
- Reference tracking to source documents
- User attribution on all operations

### Tenant Isolation
- organizationId on every document
- Tenant filtering on all queries
- Prevents cross-organization data leakage
- Safe for SaaS deployment

### Error Handling
- Validation on all inputs
- Clear error messages
- Proper HTTP status codes
- Transaction safety for complex operations (PO receive, Transfer receive)

---

## Next Steps

- **Week 5:** Customer & Order Management models/APIs
- **Week 6:** Payment & Invoicing
- **Week 7:** Notifications & Reporting
- **Week 8:** Testing & Documentation
