# Shopify Integration

Complete guide to connecting FLEXI-POS with Shopify, syncing products and inventory, and managing dual-catalog operations.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Connection Setup](#connection-setup)
4. [Product Synchronization](#product-synchronization)
5. [Inventory Synchronization](#inventory-synchronization)
6. [Location Mapping](#location-mapping)
7. [Sync Queue & Retry Logic](#sync-queue--retry-logic)
8. [Webhook Management](#webhook-management)
9. [Error Handling](#error-handling)
10. [Troubleshooting](#troubleshooting)

---

## Overview

FLEXI-POS integrates with Shopify to:
- **Sync Products** - Import Shopify products into FLEXI
- **Sync Inventory** - Real-time inventory level synchronization
- **Dual Catalog** - Mix FLEXI and Shopify products in single sales
- **Location Mapping** - Map Shopify locations to FLEXI locations
- **Automatic Sync** - Webhook-triggered inventory updates
- **Retry Logic** - Exponential backoff for failed syncs

**Prerequisites:**
- Shopify store (development or production)
- Shopify API credentials (OAuth 2.0)
- Organization in FLEXI-POS
- At least one location configured

**Base URL:** `http://localhost:9200`  
**Authentication:** Bearer Token (JWT)

---

## Getting Started

### Step 1: Obtain Shopify Credentials

1. Go to your Shopify store admin: `https://your-store.myshopify.com/admin`
2. Navigate to **Settings → Apps and integrations → App and integration settings**
3. Create a custom app with:
   - **Scope Required:**
     - `read_products`
     - `write_products`
     - `read_inventory`
     - `write_inventory`
     - `read_locations`
   - Note: `storeName` (without .myshopify.com)
   - Note: `clientId` and `clientSecret`

### Step 2: Configure Environment Variables

Add to Postman environment:
```
{{storeName}} = your-store
{{storeUrl}} = https://your-store.myshopify.com
{{clientId}} = Your Shopify App Client ID
{{clientSecret}} = Your Shopify App Client Secret
```

---

## Connection Setup

### Connect Shopify

Establishes OAuth connection between FLEXI-POS and Shopify store.

**Endpoint:** `POST /shopify/connect`

**Headers:**
```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```

**Request Body:**
```json
{
  "storeName": "{{storeName}}",
  "storeUrl": "{{storeUrl}}",
  "clientId": "{{clientId}}",
  "clientSecret": "{{clientSecret}}"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "connection": {
    "_id": "507f1f77bcf86cd799439300",
    "storeName": "your-store",
    "storeUrl": "https://your-store.myshopify.com",
    "status": "connected",
    "connectedAt": "2026-01-22T22:00:00Z",
    "lastSyncAt": "2026-01-22T22:00:00Z",
    "webhooksRegistered": [
      "products/create",
      "products/update",
      "products/delete",
      "inventory_levels/update"
    ]
  }
}
```

**What Happens Automatically:**
1. OAuth token validated with Shopify
2. Webhooks registered for real-time updates
3. Connection stored for organization
4. Ready for product/inventory sync

### Check Connection Status

**Endpoint:** `GET /shopify/status`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "connected": true,
  "connection": {
    "storeName": "your-store",
    "status": "connected",
    "lastSyncAt": "2026-01-22T22:00:00Z",
    "productsCount": 156,
    "syncStatus": "completed"
  }
}
```

### Disconnect Shopify

**Endpoint:** `POST /shopify/disconnect`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "message": "Shopify connection disconnected"
}
```

---

## Product Synchronization

### Fetch Shopify Products

Import products from connected Shopify store.

**Endpoint:** `GET /shopify/products`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `limit` (optional) - Results per page, default: 50, max: 250
- `cursor` (optional) - Pagination cursor for next page
- `status` (optional) - active, draft, archived

**Example:**
```
GET /shopify/products?limit=50&status=active
```

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "id": "gid://shopify/Product/123456",
      "title": "Gaming Laptop Pro",
      "handle": "gaming-laptop-pro",
      "description": "High-performance laptop",
      "status": "active",
      "variants": [
        {
          "id": "gid://shopify/ProductVariant/987654",
          "title": "16GB / 512GB",
          "sku": "LAPTOP-001-16GB",
          "price": "1399.99",
          "inventory": 45
        }
      ],
      "images": [
        {
          "url": "https://cdn.shopify.com/s/files/...",
          "alt": "Product image"
        }
      ]
    }
  ],
  "pagination": {
    "hasNextPage": true,
    "cursor": "eyJkaXJlY3Rpb24iOiJuZXh0IiwiY..."
  }
}
```

### Get Product Details

**Endpoint:** `GET /shopify/products/:shopifyProductId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Inventory Synchronization

### Real-Time Inventory Sync

Inventory is automatically synced when:
- Sale is completed (inventory decremented)
- Sale is voided (inventory restored)
- Sale is refunded (inventory restored)
- Manual inventory adjustment made
- Transfer between locations completed

### Force Sync Shopify Inventory

Manually trigger inventory sync with Shopify.

**Endpoint:** `POST /shopify/sync-inventory`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "variantIds": [
    "507f1f77bcf86cd799439051",
    "507f1f77bcf86cd799439052"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "syncResult": {
    "queued": 2,
    "processing": 0,
    "completed": 0,
    "failed": 0
  }
}
```

### Inventory Sync Behavior

**Before Sale:**
```
FLEXI Inventory: 100
Shopify Inventory: 100
        ↓ (Sale of 5 units)
FLEXI Inventory: 95
Shopify Inventory: 95 (auto-synced via webhook)
```

**Shopify Inventory Levels:**
- Updated in real-time via webhook
- 5-minute reconciliation check if webhook fails
- Exponential backoff retry (max 10 attempts)
- Manual sync available if needed

---

## Location Mapping

Map Shopify locations to FLEXI locations for accurate inventory tracking.

### Get Available Shopify Locations

**Endpoint:** `GET /shopify/locations`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "locations": [
    {
      "id": "gid://shopify/Location/123456",
      "name": "Main Store",
      "address": {
        "address1": "123 Main St",
        "city": "New York",
        "state": "NY",
        "zip": "10001",
        "country": "US"
      },
      "type": "shop",
      "isActive": true
    },
    {
      "id": "gid://shopify/Location/789012",
      "name": "Warehouse",
      "type": "warehouse",
      "isActive": true
    }
  ]
}
```

### Map FLEXI Location to Shopify Location

**Endpoint:** `POST /shopify/locations/map`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "flexiLocationId": "{{locationId}}",
  "shopifyLocationId": "gid://shopify/Location/123456"
}
```

**Response:**
```json
{
  "success": true,
  "mapping": {
    "_id": "507f1f77bcf86cd799439310",
    "flexiLocationId": "507f1f77bcf86cd799439070",
    "shopifyLocationId": "gid://shopify/Location/123456",
    "flexiLocationName": "Main Store",
    "shopifyLocationName": "Main Store",
    "createdAt": "2026-01-22T22:00:00Z"
  }
}
```

### Get Location Mappings

**Endpoint:** `GET /shopify/locations/mappings`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Sync Queue & Retry Logic

### View Sync Queue

**Endpoint:** `GET /shopify/sync-queue`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `status` (optional) - pending, processing, completed, failed
- `needsReview` (optional) - true/false (show only items needing attention)

**Response:**
```json
{
  "success": true,
  "queue": [
    {
      "_id": "507f1f77bcf86cd799439320",
      "syncType": "inventory_update",
      "variant": "507f1f77bcf86cd799439051",
      "status": "pending",
      "payload": {
        "location": "gid://shopify/Location/123456",
        "quantity": 95
      },
      "attempts": 0,
      "maxAttempts": 10,
      "nextRetry": "2026-01-22T22:01:00Z",
      "createdAt": "2026-01-22T22:00:00Z",
      "updatedAt": "2026-01-22T22:00:30Z"
    }
  ]
}
```

### Retry Failed Sync

**Endpoint:** `POST /shopify/sync-queue/:queueId/retry`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "queueItem": {
    "_id": "507f1f77bcf86cd799439320",
    "status": "pending",
    "attempts": 1,
    "nextRetry": "2026-01-22T22:02:00Z"
  }
}
```

### Retry Policy

FLEXI-POS uses exponential backoff for failed syncs:

| Attempt | Wait Time | Total Delay |
|---------|-----------|------------|
| 1 | 1 minute | 1 min |
| 2 | 2 minutes | 3 min |
| 3 | 4 minutes | 7 min |
| 4 | 8 minutes | 15 min |
| 5 | 16 minutes | 31 min |
| 6 | 32 minutes | 1 hr 3 min |
| 7 | 1 hour | 2 hr 3 min |
| 8 | 2 hours | 4 hr 3 min |
| 9 | 4 hours | 8 hr 3 min |
| 10 | 8 hours | 16 hr 3 min |

After 10 attempts, sync is marked as `failed` and flagged for manual review.

### View Sync Logs

**Endpoint:** `GET /shopify/sync-logs`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `syncType` (optional) - product, inventory, webhook
- `syncStatus` (optional) - completed, failed, pending
- `startDate` (optional) - ISO 8601
- `endDate` (optional) - ISO 8601
- `limit` (optional) - Default: 50

**Response:**
```json
{
  "success": true,
  "logs": [
    {
      "_id": "507f1f77bcf86cd799439330",
      "syncType": "inventory_update",
      "syncStatus": "completed",
      "variant": "507f1f77bcf86cd799439051",
      "details": {
        "previousInventory": 100,
        "newInventory": 95,
        "location": "gid://shopify/Location/123456"
      },
      "completedAt": "2026-01-22T22:00:15Z",
      "duration": "2 seconds"
    }
  ],
  "pagination": {
    "total": 1250,
    "page": 1,
    "pages": 25
  }
}
```

---

## Webhook Management

### Shopify Webhooks Registered

Automatically registered when connecting Shopify:

| Event | Purpose |
|-------|---------|
| `products/create` | New product added to Shopify |
| `products/update` | Product details changed |
| `products/delete` | Product removed from Shopify |
| `inventory_levels/update` | Inventory changed in Shopify |

### Webhook Payload Example

**Shopify sends to:** `https://your-flexi-server.com/webhooks/shopify`

**Example Inventory Update Payload:**
```json
{
  "inventory_item_id": 987654,
  "location_id": 123456,
  "quantity": 95,
  "updated_at": "2026-01-22T22:00:00Z"
}
```

### Webhook Signature Verification

All Shopify webhooks include `X-Shopify-Hmac-SHA256` header for security verification.

```javascript
// Example validation (pseudo-code)
const hmac = req.headers['x-shopify-hmac-sha256'];
const hash = crypto
  .createHmac('sha256', clientSecret)
  .update(req.rawBody, 'utf8')
  .digest('base64');

if (hash !== hmac) {
  return 403; // Unauthorized
}
```

---

## Error Handling

### Common Errors

**Shopify Connection Failed:**
```json
{
  "success": false,
  "error": "Failed to connect to Shopify",
  "code": "SHOPIFY_CONNECTION_FAILED",
  "details": {
    "reason": "Invalid credentials or store not found"
  }
}
```

**Already Connected:**
```json
{
  "success": false,
  "error": "Organization already connected to Shopify",
  "code": "SHOPIFY_ALREADY_CONNECTED"
}
```

**Sync Failed:**
```json
{
  "success": false,
  "error": "Failed to sync with Shopify",
  "code": "SHOPIFY_SYNC_FAILED",
  "details": {
    "reason": "Rate limit exceeded",
    "retryAfter": 60
  }
}
```

**Invalid Location Mapping:**
```json
{
  "success": false,
  "error": "Location not found",
  "code": "LOCATION_NOT_FOUND"
}
```

### Rate Limiting

Shopify API has rate limits:
- **Standard Plan:** 2 requests/second
- **Shopify Plus:** 4 requests/second

FLEXI-POS queues requests to respect limits. If rate limited:
- Queue item retried with exponential backoff
- You see: `X-Shop-Api-Call-Limit: 40/40` in response
- Automatic retry starts after cooldown

---

## Troubleshooting

### Connection Issues

**Problem:** "Invalid credentials"

**Solution:**
1. Verify `clientId` and `clientSecret` in Shopify admin
2. Check store name matches Shopify store URL
3. Ensure custom app has required scopes
4. Disconnect and reconnect

### Inventory Sync Problems

**Problem:** Shopify inventory not updating after sale

**Possible Causes:**
1. Location not mapped to Shopify location
2. Webhook delivery failed (check sync queue)
3. Rate limit hit (queued for retry)
4. Variant SKU mismatch

**Solution:**
1. Check location mappings: `GET /shopify/locations/mappings`
2. Review sync queue: `GET /shopify/sync-queue?status=failed`
3. Manual retry: `POST /shopify/sync-queue/:queueId/retry`
4. Check sync logs: `GET /shopify/sync-logs`

### Product Not Appearing

**Problem:** Shopify product not visible in FLEXI

**Solution:**
1. Verify product is active in Shopify
2. Fetch products: `GET /shopify/products`
3. Check variants have SKUs
4. Ensure product has at least 1 variant

### Performance Issues

**Problem:** Sync is slow or timing out

**Best Practices:**
1. Use pagination for large product lists: `GET /shopify/products?limit=50&cursor=...`
2. Limit sync queue monitoring calls
3. Use filters to reduce data: `GET /shopify/sync-logs?syncStatus=failed`
4. Batch product syncs during off-hours

---

## Best Practices

### Inventory Management

- **Always map locations** before processing sales with Shopify products
- **Monitor sync queue** daily for failed items
- **Reconcile inventory** weekly between FLEXI and Shopify
- **Use location mapping** to prevent double-counting

### Sync Monitoring

- Review sync logs daily
- Check for items needing manual review
- Set up alerts for high failure rates
- Monitor retry attempts (>5 indicates persistent issue)

### Sales Processing

- Verify location mapping before accepting Shopify sales
- Handle inventory delays (up to 5 minutes for webhook)
- Show customers final inventory after sync completes
- Use idempotency keys to prevent duplicate syncs

---

## Related Guides

- [E-Commerce CRUD](03-E-Commerce-CRUD.md) - Manage products and inventory
- [Sales Operations](04-Sales.md) - Process dual-catalog sales
- [Advanced Features](06-Advanced-Features.md) - Webhooks and error handling
