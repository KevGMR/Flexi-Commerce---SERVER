# Quick API Reference - Week 4 CRUD Endpoints

## Base URL
```
http://localhost:9200
```

## Authentication
All endpoints require: `Authorization: Bearer {accessToken}`

---

## PRODUCTS
```
POST   /products                    → Create product
GET    /products                    → List products (status, search, skip, limit)
GET    /products/:id                → Get product + variants
PUT    /products/:id                → Update product
DELETE /products/:id                → Delete product (no variants)
```

---

## VARIANTS
```
POST   /variants                    → Create variant
GET    /variants                    → List variants (productId, status, skip, limit)
GET    /variants/:id                → Get variant
PUT    /variants/:id                → Update variant
DELETE /variants/:id                → Delete variant
```

---

## COLLECTIONS
```
POST   /collections                 → Create collection
GET    /collections                 → List collections (parentCollectionId, type, status, skip, limit)
GET    /collections/:id             → Get collection
PUT    /collections/:id             → Update collection
DELETE /collections/:id             → Delete collection (cascades hierarchy)
```

---

## LOCATIONS
```
POST   /locations                   → Create location
GET    /locations                   → List locations (locationType, status, skip, limit)
GET    /locations/:id               → Get location
PUT    /locations/:id               → Update location
DELETE /locations/:id               → Delete location (not last one)
```

---

## INVENTORY
```
POST   /inventory                   → Initialize inventory
GET    /inventory                   → List inventory (variantId, locationId, skip, limit)
GET    /inventory/:variantId/:locationId            → Get specific inventory
PUT    /inventory/:variantId/:locationId/adjust     → Adjust stock manually
PUT    /inventory/:variantId/:locationId            → Update reorder levels
```

---

## INVENTORY AUDIT
```
GET    /inventory-audit                             → List audit trail (variantId, locationId, eventType, startDate, endDate, skip, limit)
GET    /inventory-audit/:variantId/:locationId      → Get variant-location audit
```

---

## SUPPLIERS
```
POST   /suppliers                   → Create supplier
GET    /suppliers                   → List suppliers (status, search, skip, limit)
GET    /suppliers/:id               → Get supplier
PUT    /suppliers/:id               → Update supplier
DELETE /suppliers/:id               → Delete supplier
```

---

## PURCHASE ORDERS
```
POST   /purchase-orders             → Create PO (draft)
GET    /purchase-orders             → List POs (supplierId, status, skip, limit)
GET    /purchase-orders/:id         → Get PO details
PUT    /purchase-orders/:id         → Edit draft PO
PUT    /purchase-orders/:id/send    → Send PO to supplier
PUT    /purchase-orders/:id/confirm → Supplier confirmed receipt
PUT    /purchase-orders/:id/receive → Receive items (updates inventory)
PUT    /purchase-orders/:id/cancel  → Cancel PO
```

**Workflow**: draft → sent → confirmed → received (or partially_received → received)

---

## TRANSFERS
```
POST   /transfers                   → Create transfer (pending)
GET    /transfers                   → List transfers (fromLocationId, toLocationId, status, skip, limit)
GET    /transfers/:id               → Get transfer details
PUT    /transfers/:id/ship          → Mark as shipped (in_transit)
PUT    /transfers/:id/receive       → Receive items (updates source & dest inventory)
PUT    /transfers/:id/cancel        → Cancel transfer (releases committed)
```

**Workflow**: pending → in_transit → delivered (or cancelled)

---

## GIFT CARDS
```
POST   /gift-cards                  → Create gift card
GET    /gift-cards                  → List gift cards (status, customerId, skip, limit)
GET    /gift-cards/lookup/:code     → Lookup by code
GET    /gift-cards/:id              → Get gift card
PUT    /gift-cards/:id/redeem       → Redeem amount
PUT    /gift-cards/:id              → Update gift card
PUT    /gift-cards/:id/deactivate   → Deactivate
```

---

## Request Body Examples

### Create Product
```json
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
  "tags": ["electronics", "gaming"],
  "vendor": "TechBrand",
  "description": "High-performance laptop"
}
```

### Create Variant
```json
{
  "productId": "507f1f77bcf86cd799439011",
  "sku": "LAPTOP-001-BLACK",
  "price": 1299.99,
  "weight": 2.5,
  "metafields": [
    {"key": "color", "value": "Black", "namespace": "custom"},
    {"key": "storage", "value": "1TB", "namespace": "custom"}
  ],
  "barcode": "123456789012"
}
```

### Create Collection
```json
{
  "name": "Gaming Laptops",
  "description": "High-performance gaming laptops",
  "type": "manual",
  "productIds": ["507f1f77bcf86cd799439011"],
  "published": true
}
```

### Create Location
```json
{
  "name": "Main Warehouse",
  "locationType": "warehouse",
  "address": {
    "street": "123 Tech Ave",
    "city": "San Francisco",
    "state": "CA",
    "postalCode": "94105",
    "country": "USA"
  },
  "taxRate": 0.0725,
  "taxId": "98-1234567",
  "currency": "USD",
  "isDefault": true
}
```

### Initialize Inventory
```json
{
  "variantId": "507f1f77bcf86cd799439012",
  "locationId": "507f1f77bcf86cd799439013",
  "onHand": 100,
  "reorderPoint": 20,
  "reorderQuantity": 50
}
```

### Create Supplier
```json
{
  "name": "TechSupply Co",
  "email": "sales@techsupply.com",
  "phone": "+1-555-0100",
  "address": {
    "street": "456 Supply Way",
    "city": "Portland",
    "state": "OR",
    "postalCode": "97201",
    "country": "USA"
  },
  "contactPerson": "John Supplier",
  "paymentTerms": "Net 30",
  "paymentMethod": "bank_transfer",
  "taxId": "98-7654321",
  "currency": "USD",
  "rating": 4.5
}
```

### Create Purchase Order
```json
{
  "supplierId": "507f1f77bcf86cd799439014",
  "receivingLocationId": "507f1f77bcf86cd799439013",
  "items": [
    {
      "variantId": "507f1f77bcf86cd799439012",
      "quantity": 50,
      "unitCost": 900
    }
  ],
  "totals": {
    "subtotal": 45000,
    "tax": 3150,
    "shipping": 500,
    "total": 48650
  }
}
```

### Create Transfer
```json
{
  "fromLocationId": "507f1f77bcf86cd799439013",
  "toLocationId": "507f1f77bcf86cd799439015",
  "items": [
    {
      "variantId": "507f1f77bcf86cd799439012",
      "quantity": 25
    }
  ],
  "reason": "rebalancing"
}
```

### Create Gift Card
```json
{
  "initialBalance": 500,
  "currency": "USD",
  "expiryDate": "2025-12-31",
  "notes": "Birthday gift"
}
```

---

## Response Status Codes

| Code | Meaning |
|------|---------|
| 201 | Created successfully |
| 200 | OK / Success |
| 400 | Bad request / validation error |
| 404 | Resource not found |
| 409 | Conflict (e.g., duplicate SKU) |
| 500 | Server error |

---

## Query Parameters

### Pagination
- `skip` - Number of records to skip (default: 0)
- `limit` - Number of records to return (default: 50)

### Filtering
- `status` - Filter by status
- `search` - Text search (products, suppliers)
- `productId` - Filter variants by product
- `variantId` - Filter inventory by variant
- `locationId` - Filter inventory by location
- `locationType` - Filter locations by type
- `parentCollectionId` - Filter child collections
- `type` - Collection type (manual/automatic)
- `fromLocationId` - Filter transfers by source
- `toLocationId` - Filter transfers by destination
- `supplierId` - Filter POs by supplier
- `customerId` - Filter gift cards by customer
- `eventType` - Filter audit by event type
- `startDate` - Date range start (audit trail)
- `endDate` - Date range end (audit trail)

---

## Common Error Responses

```json
{
  "error": "SKU already exists in this organization"
}
```

```json
{
  "error": "Product not found"
}
```

```json
{
  "error": "Insufficient inventory for variant at source location"
}
```

```json
{
  "error": "Gift card has expired"
}
```

```json
{
  "error": "Only draft purchase orders can be edited"
}
```

---

## Inventory States

- **onHand**: Physical stock count
- **available**: onHand - committed (ready to sell)
- **committed**: Reserved for orders/transfers
- **unavailable**: Damaged/lost stock

Formula: `available = onHand - committed`

---

## Event Types (Inventory Audit)

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

---

## Status Workflows

### Purchase Order
- draft → sent → confirmed → partially_received → received
- Any state → cancelled

### Transfer
- pending → in_transit → delivered
- Any state → cancelled

### Gift Card
- active ↔ inactive
- active → expired (on expiry check)

### Product/Variant
- draft → active → archived

---

## Tips for Testing

1. **Import Postman Collection**: POSTMAN_WEEK4_CRUDS.json
2. **Set Variables**:
   - baseUrl: http://localhost:9200
   - accessToken: {JWT from login}
3. **Run Sequentially**: Collection auto-saves IDs
4. **Test Workflows**:
   - Create Product → Create Variant → Initialize Inventory → Adjust
   - Create PO → Send → Confirm → Receive (check inventory)
   - Create Transfer → Ship → Receive (check both locations)

---

## Notes

- All endpoints require valid JWT token with organizationId
- Data automatically scoped to user's organization
- All changes logged to audit trail
- Complex operations (PO/Transfer receive) update inventory automatically
- Inventory calculations are real-time (available = onHand - committed)
- SKU must be unique per organization
- Transfers prevent moving stock to same location
- Last location in organization cannot be deleted

---

## SHOPIFY INTEGRATION
```
POST   /shopify/connect             → Connect org to Shopify (store credentials)
DELETE /shopify/disconnect          → Disconnect Shopify store
GET    /shopify/connection          → Get connection status
GET    /shopify/products            → Fetch Shopify products (limit, cursor)
POST   /shopify/webhooks/:topic     → Receive Shopify webhooks (products/update, products/delete, inventory_levels/update)
GET    /shopify/events              → SSE stream for real-time webhook notifications
GET    /shopify/sync-queue          → Get pending/failed sync items (status, needsReview)
GET    /shopify/sync-logs           → Get sync history (syncType, status, limit)
```

### Shopify Features
- **Dual Catalog**: Sell both FLEXI-POS and Shopify products from POS
- **Auto Sync**: Inventory updates pushed to Shopify on sale
- **Retry Queue**: Failed syncs retry 10 times with exponential backoff
- **Real-time Updates**: SSE stream broadcasts Shopify webhook events to POS clients
- **Org-scoped**: Each organization provides their own Shopify store credentials
- **Background Worker**: Processes retry queue every 5 minutes

### POS Permissions
```
pos:override_price              → Override product price at POS
pos:access_shopify_products     → Access and sell Shopify products
pos:apply_discount              → Apply discounts to sales
pos:view_cost                   → View product cost price
```

**Role Mapping**:
- **Owner/Manager**: All POS permissions
- **Cashier**: Access Shopify products + apply discounts (no price override or cost view)
- **Employee**: No POS permissions
