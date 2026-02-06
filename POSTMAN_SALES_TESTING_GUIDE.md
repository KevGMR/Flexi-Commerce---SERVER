# Postman Testing Guide - FLEXI-POS Sales (Dual Catalog)

## 📥 Import Collection

1. **Open Postman**
2. **Click Import** (top left)
3. **Select** `POSTMAN_SALES_COLLECTION.json` from server folder
4. Collection name: "FLEXI-POS Sales (Dual Catalog)"

## 🔧 Setup Environment Variables

Create a Postman environment called "FLEXI-POS Sales Testing" with:

| Variable | Value | Notes |
|----------|-------|-------|
| `baseUrl` | http://localhost:9200 | Local server |
| `token` | (from login) | Your FLEXI-POS JWT |
| `locationId` | (from locations endpoint) | Valid location for your org |
| `saleId` | (auto-filled) | Set by "Create Sale" test |
| `receiptNumber` | (auto-filled) | Set by "Create Sale" test |

## ⚙️ Prerequisites

**Before testing sales:**

1. **Server running**:
   ```bash
   cd server
   npm run dev
   ```

2. **MongoDB running** with MONGO_URI set in .env

3. **Authenticated user** (get JWT):
   - Use [POSTMAN_TESTING_GUIDE.md](POSTMAN_TESTING_GUIDE.md)
   - Register → Verify email → Login
   - Copy `accessToken` → Set as `{{token}}`

4. **Organization created** (auto-created on registration)

5. **Location created**:
   ```http
   POST {{baseUrl}}/locations
   Authorization: Bearer {{token}}
   
   {
     "name": "Main Store",
     "locationType": "retail",
     "address": {
       "street": "123 Main St",
       "city": "Nairobi",
       "country": "Kenya"
     },
     "phone": "+254712345678",
     "email": "store@example.com",
     "taxRate": 0.16,
     "currency": "KES",
     "isDefault": true
   }
   ```
   - **Required:** `name`, `locationType` (warehouse|retail|fulfillment)
   - **Optional:** address, phone, email, taxRate, currency, isDefault
   - Copy location `_id` → Set as `{{locationId}}`

6. **FLEXI Products created** (if testing FLEXI items):
   ```http
   POST {{baseUrl}}/products
   Authorization: Bearer {{token}}
   
   {
     "name": "Blue T-Shirt",
     "sku": "FLEXI-TSHIRT-BLU",
     "price": 15.00,
     "cost": 5.00
   }
   ```
   - Copy product `_id` for use in sales

7. **Shopify connected** (if testing Shopify items):
   - Follow [POSTMAN_SHOPIFY_TESTING_GUIDE.md](POSTMAN_SHOPIFY_TESTING_GUIDE.md)
   - **Map FLEXI location to Shopify location:**
     ```http
     POST {{baseUrl}}/locations/{{locationId}}/set-shopify-location
     Authorization: Bearer {{token}}
     
     {
       "shopifyLocationId": "gid://shopify/Location/123456",
       "shopifyLocationName": "Main Warehouse"
     }
     ```
   - Get Shopify product variant IDs from: `GET /shopify/products`

## 🧪 Test Scenarios

### Scenario 1: Create Sale (Mixed FLEXI + Shopify)

**Request:** `POST {{baseUrl}}/sales`

**Headers:**
```
Authorization: Bearer {{token}}
Content-Type: application/json
```

**Body:**
```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "flexi",
      "productId": "YOUR_FLEXI_PRODUCT_ID",
      "quantity": 2,
      "unitPrice": 15.00,
      "discount": 0,
      "taxAmount": 2.40
    },
    {
      "type": "shopify",
      "shopifyVariantId": "gid://shopify/ProductVariant/789456",
      "productName": "Shopify Blue Jeans",
      "sku": "SHOP-JEANS-BLU-32",
      "quantity": 1,
      "unitPrice": 45.00,
      "discount": 5.00,
      "taxAmount": 3.20
    }
  ],
  "paymentMethod": "cash",
  "paymentStatus": "completed",
  "notes": "Mixed catalog sale test"
}
```

**Expected Response:** `201 Created`
```json
{
  "success": true,
  "message": "Sale created successfully",
  "data": {
    "saleId": "63f7a1b2c3d4e5f6g7h8i9j0",
    "receiptNumber": "REC-696d9ce14c331daf-1705999200000",
    "transactionId": "TXN-696d9ce14c331daf-1705999200000",
    "totalAmount": 57.60,
    "status": "completed",
    "itemCount": 2,
    "createdAt": "2026-01-20T12:00:00.000Z"
  }
}
```

**What happens:**
- ✅ Sale document created
- ✅ FLEXI item: Inventory decremented by 2
- ✅ Shopify item: `updateShopifyInventory()` queued, Shopify sync pending
- ✅ `saleId` auto-saved to environment for next tests

---

### Scenario 2: Create Sale (FLEXI Only)

**Request:** `POST {{baseUrl}}/sales`

**Body:**
```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "flexi",
      "productId": "YOUR_FLEXI_PRODUCT_ID",
      "quantity": 3,
      "unitPrice": 20.00,
      "discount": 0,
      "taxAmount": 4.80
    }
  ],
  "paymentMethod": "card",
  "paymentStatus": "completed"
}
```

**Expected:** 201 Created, local inventory updated immediately

---

### Scenario 3: Create Sale (Shopify Only)

**Request:** `POST {{baseUrl}}/sales`

**Body:**
```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "shopify",
      "shopifyVariantId": "gid://shopify/ProductVariant/123789",
      "productName": "Shopify Red Jeans",
      "sku": "SHOP-JEANS-RED-32",
      "quantity": 1,
      "unitPrice": 50.00,
      "discount": 0,
      "taxAmount": 4.00
    }
  ],
  "paymentMethod": "mobile",
  "paymentStatus": "completed"
}
```

**Expected:** 201 Created, Shopify inventory sync queued

---

### Scenario 4: Get Sale Details

**Request:** `GET {{baseUrl}}/sales/{{saleId}}`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "_id": "63f7a1b2c3d4e5f6g7h8i9j0",
    "receiptNumber": "REC-...",
    "transactionId": "TXN-...",
    "items": [...],
    "totalAmount": 57.60,
    "status": "completed",
    "paymentMethod": "cash",
    "paymentStatus": "completed",
    "inventoryUpdates": [
      {
        "itemId": "0",
        "type": "flexi",
        "productId": "...",
        "quantityDeducted": 2,
        "previousStock": 50,
        "newStock": 48,
        "status": "success",
        "timestamp": "2026-01-20T12:00:00.000Z"
      },
      {
        "itemId": "1",
        "type": "shopify",
        "shopifyVariantId": "gid://shopify/ProductVariant/789456",
        "status": "success",
        "timestamp": "2026-01-20T12:00:00.000Z"
      }
    ],
    "shopifySyncStatus": "synced",
    "cashierId": "696d9ce04c331daf705c5260",
    "createdAt": "2026-01-20T12:00:00.000Z"
  }
}
```

**Check:**
- ✅ `inventoryUpdates` shows both items updated successfully
- ✅ `shopifySyncStatus` = "synced" (Shopify inventory updated)
- ✅ `status` = "completed"

---

### Scenario 5: List Sales

**Request:** `GET {{baseUrl}}/sales?locationId={{locationId}}&status=completed&limit=10&page=1`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "sales": [
      {
        "_id": "...",
        "receiptNumber": "...",
        "totalAmount": 57.60,
        "status": "completed",
        "paymentMethod": "cash",
        "createdAt": "2026-01-20T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "pages": 1
    }
  }
}
```

**Filters available:**
- `locationId` - Filter by store location
- `status` - completed|voided|pending|partial_refund
- `paymentMethod` - cash|card|mobile|check|credit
- `startDate` - ISO date (e.g., 2026-01-01)
- `endDate` - ISO date (e.g., 2026-01-31)
- `limit` - Items per page (default 50)
- `page` - Page number (default 1)

---

### Scenario 6: Void Sale

**Request:** `POST {{baseUrl}}/sales/{{saleId}}/void`

**Body:**
```json
{
  "reason": "Incorrect item sold - customer requested void"
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Sale voided successfully",
  "data": {
    "saleId": "...",
    "status": "voided",
    "voidedAt": "2026-01-20T12:05:00.000Z"
  }
}
```

**What happens:**
- ✅ Sale status changed to "voided"
- ✅ Reason logged
- ✅ Voided by user ID recorded
- ⚠️ TODO: Inventory should be restored (not yet implemented)

---

### Scenario 7: Refund Sale (Partial)

**Request:** `POST {{baseUrl}}/sales/{{saleId}}/refund`

**Body:**
```json
{
  "refundAmount": 25.00,
  "reason": "Customer returned one Shopify item"
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Refund processed successfully",
  "data": {
    "saleId": "...",
    "refundAmount": 25.00,
    "status": "partial_refund",
    "refundedAt": "2026-01-20T12:10:00.000Z"
  }
}
```

**Rules:**
- Refund amount must be > 0
- Refund amount cannot exceed sale total
- If refund = total → status becomes "voided"
- If refund < total → status becomes "partial_refund"

---

### Scenario 8: Sales Summary Report

**Request:** `GET {{baseUrl}}/sales/reports/summary?locationId={{locationId}}&startDate=2026-01-01&endDate=2026-01-31`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "totalSales": 5,
    "totalRevenue": 287.80,
    "totalTax": 28.80,
    "totalDiscount": 5.00,
    "averageTransactionValue": 57.56,
    "itemsSold": {
      "flexi": 8,
      "shopify": 5,
      "total": 13
    },
    "paymentMethodBreakdown": {
      "cash": { "count": 2, "total": 115.20 },
      "card": { "count": 2, "total": 120.00 },
      "mobile": { "count": 1, "total": 52.60 }
    }
  }
}
```

**Insights:**
- Revenue by catalog (FLEXI vs Shopify)
- Payment method breakdown
- Average transaction value
- Tax and discount totals

---

## 📊 Testing Checklist

### Basic Flow
- [ ] Create sale with mixed items → 201 with saleId
- [ ] Get sale details → 200 with full inventory tracking
- [ ] Verify FLEXI inventory updated (check inventoryUpdates)
- [ ] Verify Shopify inventory queued (shopifySyncStatus: pending/synced)
- [ ] List sales → See created sale in results

### Catalog Types
- [ ] Create FLEXI-only sale → Inventory updates immediately
- [ ] Create Shopify-only sale → Shopify sync queued
- [ ] Create mixed sale → Both types handled correctly

### Payment Methods
- [ ] Test cash payment
- [ ] Test card payment
- [ ] Test mobile payment
- [ ] Verify payment method saved in sale

### Voids & Refunds
- [ ] Void completed sale → Status = "voided"
- [ ] Refund partial amount → Status = "partial_refund"
- [ ] Refund full amount → Status = "voided"
- [ ] Try refunding already voided sale → Error
- [ ] Try refunding amount > total → Error

### Filtering & Reports
- [ ] Filter by location
- [ ] Filter by status (completed/voided/pending)
- [ ] Filter by payment method
- [ ] Filter by date range
- [ ] Pagination works (page, limit)
- [ ] Sales summary shows correct totals
- [ ] Item counts by catalog type correct

### Inventory Tracking
- [ ] FLEXI items: Previous stock → New stock logged
- [ ] Shopify items: Sync status tracked
- [ ] Mixed items: Both inventories updated in one transaction
- [ ] Check ShopifySyncLog for Shopify updates

---

## 🔍 Common Issues & Fixes

### "locationId not found"
- ✅ Create a location first: `POST /locations`
- ✅ Use correct organization's location
- ✅ Verify locationId in environment variable

### "FLEXI product not found"
- ✅ Product must exist in your organization
- ✅ Use correct organization when creating product
- ✅ Copy full `_id` from product response (not name/sku)

### "Invalid item type"
- ✅ Item type must be exactly: "flexi" or "shopify"
- ✅ No spaces or typos

### "Shopify variant not found"
- ✅ Get valid Shopify variant ID from: `GET /shopify/products`
- ✅ Must start with: `gid://shopify/ProductVariant/`
- ✅ Requires Shopify connection (use SHOPIFY_TESTING_GUIDE first)

### "Cannot refund voided sale"
- ✅ Try refunding sale before voiding it
- ✅ Or create a new sale to refund

### "Refund amount exceeds total"
- ✅ Check sale totalAmount in response
- ✅ Set refund amount less than or equal to total

### "Missing required fields"
- ✅ Check all required fields present: locationId, items, paymentMethod
- ✅ items array must have at least 1 item
- ✅ Each item needs: type, productId/shopifyVariantId, quantity, unitPrice

### Shopify inventory not updating
- ✅ Check ShopifySyncLog: `GET /shopify/sync-logs?syncType=inventory_update`
- ✅ Check connection status: `GET /shopify/connection`
- ✅ Verify Shopify connection is active (no auth errors)
- ✅ **Verify location mapping:** POST `/locations/:id/set-shopify-location` to map FLEXI location to Shopify location
- ✅ Check if FLEXI location has `shopifyLocationId` set: GET `/locations/:id`
- ✅ Check sale.shopifySyncStatus in sale details
- ✅ Verify Shopify variant has inventory tracking enabled in Shopify Admin

---

## 📈 Revenue Reporting

**Get daily revenue:**
```
GET /sales/reports/summary?startDate=2026-01-20&endDate=2026-01-20
```

**Get location performance:**
```
GET /sales/reports/summary?locationId={{locationId}}&startDate=2026-01-01&endDate=2026-01-31
```

**Export data from report response** for spreadsheets:
- totalRevenue
- itemsSold (by catalog)
- paymentMethodBreakdown
- averageTransactionValue

---

## 🔐 Permissions

Sales endpoints require:
- ✅ `create_sale` - Create new sales
- ✅ `view_sale_history` - View sales
- ✅ `refund_sale` - Process refunds
- ✅ `manage_inventory` - Auto-update inventory

Owner role has all permissions by default.

---

## 📋 Testing Report Template

```
Date: ___________
Server Version: ___________
Node Version: ___________

✓ Create Sale (Mixed): PASS / FAIL
✓ Create Sale (FLEXI): PASS / FAIL
✓ Create Sale (Shopify): PASS / FAIL
✓ FLEXI Inventory Updated: PASS / FAIL
✓ Shopify Sync Queued: PASS / FAIL
✓ Get Sale Details: PASS / FAIL
✓ List Sales: PASS / FAIL
✓ Void Sale: PASS / FAIL
✓ Refund Sale (Partial): PASS / FAIL
✓ Refund Sale (Full): PASS / FAIL
✓ Sales Summary Report: PASS / FAIL
✓ Payment Methods: PASS / FAIL
✓ Error Handling: PASS / FAIL

Overall Status: PASS / FAIL

Issues Found:
- Issue 1: ___________
- Issue 2: ___________

Notes: ___________
```

---

## 🚀 Next Steps

1. **Test locally** using this guide with Postman
2. **Verify inventory updates** for both FLEXI and Shopify
3. **Check ShopifySyncLog** to confirm Shopify inventory synced
4. **Test voids/refunds** to ensure audit trail recorded
5. **Monitor sales summary** for reporting accuracy
6. **Build POS UI** to create sales from frontend
7. **Add payment gateway** integration (stripe, M-Pesa, etc.)

---

**Ready to test!** Start with Scenario 1. 🎉
