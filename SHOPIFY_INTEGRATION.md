# Shopify Integration - Implementation Guide

## Overview

The Shopify Integration addon enables FLEXI-POS to sell products from both its own catalog and connected Shopify stores. Each organization can connect their own Shopify store and sell Shopify products directly from the POS, with automatic inventory synchronization.

## Architecture

### Key Components

1. **Models** (`server/models/`)
   - `ShopifyConnection.js` - Stores org-specific Shopify credentials and webhook IDs
   - `ShopifySyncLog.js` - Audit trail for all sync operations
   - `ShopifySyncQueue.js` - Retry queue for failed inventory updates

2. **Controller** (`server/controllers/ShopifyController.js`)
   - Connection management (connect, disconnect, status)
   - Product fetching from Shopify
   - Webhook receiver with signature verification
   - SSE stream for real-time notifications
   - Sync queue and logs endpoints

3. **Service** (`server/services/shopifySync.js`)
   - Inventory update logic
   - Queue management
   - Retry processing with exponential backoff
   - Shopify GraphQL client wrapper

4. **Worker** (`server/workers/shopifyRetryWorker.js`)
   - Background job running every 5 minutes
   - Processes failed sync queue items
   - Maximum 10 retry attempts per item

5. **Permissions** (`server/config/permissions.js`)
   - POS-specific permissions for price override, discounts, etc.
   - Role-based access control

## Features

### 1. Organization-Scoped Connections
- Each organization connects their own Shopify store
- Credentials stored encrypted (not returned in queries)
- One connection per organization
- Automatic webhook registration on connect

### 2. Dual Product Catalog
- FLEXI-POS products managed in FLEXI-POS inventory
- Shopify products fetched on-demand from Shopify
- Products distinguished by `productSource` field: `'flexi'` or `'shopify'`
- Sales tracked with `saleOrigin`: `'pos'`, `'website'`, `'shopify'`, or `'manual'`

### 3. Inventory Synchronization
- **One-way sync**: FLEXI-POS → Shopify
- When Shopify product sold on POS:
  - Immediate attempt to update Shopify inventory
  - On failure: Queue for retry
  - Returns warning to client if queued
- **Webhook notifications** (read-only):
  - Receive updates when Shopify inventory changes externally
  - Broadcast to connected POS clients via SSE
  - Frontend re-fetches fresh data

### 4. Retry Mechanism
- Failed syncs queued automatically
- Exponential backoff: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512 minutes
- Maximum 10 attempts
- After 10 failures: `needsReview: true` flag set
- Background worker processes queue every 5 minutes

### 5. Real-time Updates (SSE)
- Endpoint: `GET /shopify/events`
- Organization-scoped broadcast
- Events:
  - Webhook notifications (product/inventory updates)
  - Connection established
- Frontend caches products in browser storage
- SSE notifies when to re-fetch

### 6. POS Permissions
- `pos:override_price` - Override product price at checkout
- `pos:access_shopify_products` - View and sell Shopify products
- `pos:apply_discount` - Apply discounts to sales
- `pos:view_cost` - View product cost (for margin calculation)

## API Endpoints

### Connection Management

#### POST /shopify/connect
Connect organization to Shopify store.

**Request Body**:
```json
{
  "storeName": "My Store",
  "storeUrl": "my-store.myshopify.com",
  "apiKey": "optional-api-key",
  "apiPassword": "shpat_xxxxx",
  "accessToken": "shpat_xxxxx" // Alternative to apiPassword
}
```

**Response**:
```json
{
  "success": true,
  "message": "Shopify connection created successfully",
  "data": {
    "storeName": "My Store",
    "storeUrl": "my-store.myshopify.com",
    "apiVersion": "2026-01",
    "status": "active",
    "webhooks": ["products/update", "products/delete", "inventory_levels/update"]
  }
}
```

**Webhooks Registered**:
- `products/update` - Product/variant changes
- `products/delete` - Product deleted
- `inventory_levels/update` - Inventory quantity changed

---

#### DELETE /shopify/disconnect
Disconnect organization from Shopify.

**Response**:
```json
{
  "success": true,
  "message": "Shopify connection removed successfully"
}
```

---

#### GET /shopify/connection
Get connection status for organization.

**Response**:
```json
{
  "success": true,
  "connected": true,
  "data": {
    "storeName": "My Store",
    "storeUrl": "my-store.myshopify.com",
    "apiVersion": "2026-01",
    "status": "active",
    "lastSyncedAt": "2026-01-20T10:30:00.000Z",
    "webhooks": ["products/update", "products/delete", "inventory_levels/update"],
    "syncError": null
  }
}
```

---

### Product Management

#### GET /shopify/products
Fetch products from Shopify store.

**Query Parameters**:
- `limit` (default: 50) - Number of products to fetch
- `cursor` (optional) - Pagination cursor

**Response**:
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "gid://shopify/Product/123456789",
        "title": "Cool T-Shirt",
        "descriptionHtml": "<p>Best shirt ever</p>",
        "vendor": "Brand Name",
        "productType": "Apparel",
        "status": "ACTIVE",
        "totalInventory": 100,
        "variants": {
          "edges": [
            {
              "node": {
                "id": "gid://shopify/ProductVariant/987654321",
                "title": "Small / Red",
                "sku": "TSHIRT-SM-RED",
                "price": "29.99",
                "inventoryQuantity": 25,
                "inventoryItem": {
                  "id": "gid://shopify/InventoryItem/111222333"
                }
              }
            }
          ]
        },
        "images": {
          "edges": [
            {
              "node": {
                "url": "https://cdn.shopify.com/...",
                "altText": "Red T-Shirt"
              }
            }
          ]
        }
      }
    ],
    "pageInfo": {
      "hasNextPage": true,
      "endCursor": "eyJsYXN0X2lkIjo..."
    },
    "lastFetchedAt": "2026-01-20T10:35:00.000Z"
  }
}
```

---

### Webhooks

#### POST /shopify/webhooks/:topic
Receive Shopify webhooks (internal endpoint - called by Shopify).

**Headers**:
- `x-shopify-webhook-id` - Unique webhook ID (for deduplication)
- `x-shopify-hmac-sha256` - Signature for verification
- `x-shopify-shop-domain` - Store domain

**Topics**:
- `products/update`
- `products/delete`
- `inventory_levels/update`

**Process**:
1. Verify HMAC signature
2. Check deduplication cache
3. Broadcast event to org's SSE clients
4. Return 200 OK

---

### Real-time Events

#### GET /shopify/events
SSE stream for real-time webhook notifications.

**Headers**:
- `Authorization: Bearer {accessToken}`

**Event Format**:
```
data: {"type":"connected","timestamp":"2026-01-20T10:40:00.000Z"}

data: {"type":"webhook","topic":"products/update","webhookId":"123456","payload":{...},"timestamp":"2026-01-20T10:41:00.000Z"}
```

**Client Implementation** (JavaScript):
```javascript
const eventSource = new EventSource('/shopify/events', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'webhook') {
    console.log('Shopify update:', data.topic);
    // Re-fetch products
    fetchShopifyProducts();
  }
};
```

---

### Sync Monitoring

#### GET /shopify/sync-queue
Get pending/failed sync items.

**Query Parameters**:
- `status` (optional) - Filter by status: `pending`, `processing`, `failed`, `completed`, `needs_review`
- `needsReview` (optional) - Filter items needing review: `true`/`false`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "abc123",
      "organizationId": "org456",
      "shopifyProductId": "gid://shopify/Product/123",
      "shopifyVariantId": "gid://shopify/ProductVariant/456",
      "saleId": "sale789",
      "inventoryUpdate": {
        "quantityChange": -2,
        "newQuantity": 23,
        "locationId": "gid://shopify/Location/789"
      },
      "status": "failed",
      "attemptCount": 3,
      "maxAttempts": 10,
      "nextRetryAt": "2026-01-20T11:00:00.000Z",
      "lastError": {
        "message": "Rate limit exceeded",
        "code": "THROTTLED",
        "occurredAt": "2026-01-20T10:45:00.000Z"
      },
      "needsReview": false,
      "createdAt": "2026-01-20T10:30:00.000Z",
      "updatedAt": "2026-01-20T10:45:00.000Z"
    }
  ]
}
```

---

#### GET /shopify/sync-logs
Get sync history.

**Query Parameters**:
- `syncType` (optional) - Filter by type: `inventory_update`, `product_fetch`, `webhook_received`
- `status` (optional) - Filter by status: `success`, `failed`, `pending`
- `limit` (default: 50) - Max results

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "log123",
      "organizationId": "org456",
      "syncType": "inventory_update",
      "shopifyProductId": "gid://shopify/Product/123",
      "shopifyVariantId": "gid://shopify/ProductVariant/456",
      "saleId": "sale789",
      "status": "success",
      "requestPayload": {
        "quantityChange": -2,
        "newQuantity": 23
      },
      "responsePayload": {
        "inventoryAdjustQuantities": {
          "inventoryAdjustmentGroup": {
            "id": "gid://shopify/InventoryAdjustmentGroup/999"
          }
        }
      },
      "attemptNumber": 1,
      "processingTime": 342,
      "createdAt": "2026-01-20T10:30:00.000Z"
    }
  ]
}
```

---

## Sale Integration

### Selling Shopify Products

When creating a sale with Shopify products, include these fields in sale items:

```json
{
  "saleOrigin": "pos",  // 'pos', 'website', 'shopify', 'manual'
  "items": [
    {
      "productSource": "shopify",  // 'flexi' or 'shopify'
      "shopifyProductId": "gid://shopify/Product/123456789",
      "shopifyVariantId": "gid://shopify/ProductVariant/987654321",
      "quantity": 2,
      "price": 29.99,
      // ... other fields
    }
  ]
}
```

### Inventory Sync Flow

1. **Sale Created** → Sale controller validates items
2. **Detect Shopify Product** → Check `productSource === 'shopify'`
3. **Trigger Sync** → Call `shopifySync.syncInventoryOnSale()`
4. **Immediate Update Attempt**:
   - Fetch current inventory from Shopify
   - Calculate new quantity
   - Push update via GraphQL mutation
   - Log success to `ShopifySyncLog`
5. **On Failure**:
   - Queue to `ShopifySyncQueue`
   - Log failure to `ShopifySyncLog`
   - Return warning to client: `{ synced: false, warning: 'Queued for retry' }`
6. **Background Worker**:
   - Runs every 5 minutes
   - Processes items where `nextRetryAt <= now`
   - Exponential backoff on retry
   - After 10 attempts: `needsReview: true`

**Example Service Call**:
```javascript
const { syncInventoryOnSale } = require('../services/shopifySync');

// In sale creation endpoint
for (const item of req.body.items) {
  if (item.productSource === 'shopify') {
    const result = await syncInventoryOnSale(
      req.user.organizationId,
      item.shopifyProductId,
      item.shopifyVariantId,
      -item.quantity,  // Negative for sales
      sale._id
    );
    
    if (!result.synced) {
      // Warn user but allow sale
      console.warn('Shopify sync queued:', result.warning);
    }
  }
}
```

---

## Security

### Credential Storage
- API keys and passwords stored with `select: false` in Mongoose schema
- Must explicitly `.select('+apiPassword +accessToken')` to retrieve
- Never returned in standard queries

### Webhook Verification
- HMAC-SHA256 signature verification
- Compares Shopify signature with computed hash
- Rejects invalid signatures with 401

### In-Memory Deduplication
- Webhook IDs cached for 24 hours
- Prevents processing duplicate webhooks
- Cleaned up hourly to prevent memory leaks

---

## Error Handling

### Common Errors

1. **No Connection Found** (404)
   ```json
   {
     "success": false,
     "message": "No Shopify connection found. Please connect first."
   }
   ```

2. **Webhook Signature Invalid** (401)
   ```
   Unauthorized
   ```

3. **Rate Limit Exceeded** (handled internally)
   - Automatic retry with exponential backoff
   - Uses Shopify's cost analysis for throttling

4. **Sync Failures**
   - Queued automatically
   - Logged to `ShopifySyncLog`
   - Retried up to 10 times

---

## Environment Variables

Add to `.env`:
```env
# Shopify Integration
API_URL=https://yourdomain.com  # For webhook callback URL
SHOPIFY_API_VERSION=2026-01     # Optional, defaults to 2026-01
TZ=UTC                          # Timezone for cron jobs
```

---

## Testing

### 1. Connect Store
```bash
POST /shopify/connect
{
  "storeName": "Test Store",
  "storeUrl": "test-store.myshopify.com",
  "apiPassword": "shpat_xxxxx"
}
```

### 2. Fetch Products
```bash
GET /shopify/products?limit=10
```

### 3. Test SSE Stream
```javascript
const eventSource = new EventSource('/shopify/events', {
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
});

eventSource.onmessage = console.log;
```

### 4. Trigger Manual Sync (for testing)
```javascript
const shopifyRetryWorker = require('./workers/shopifyRetryWorker');
await shopifyRetryWorker.runNow();
```

### 5. Check Sync Logs
```bash
GET /shopify/sync-logs?syncType=inventory_update&status=failed
```

---

## Best Practices

1. **Frontend Caching**
   - Cache Shopify products in IndexedDB/localStorage
   - Use `lastFetchedAt` to determine staleness
   - Re-fetch on SSE webhook notification

2. **Offline Sales**
   - Queue sales in browser when offline
   - Sync when connection restored
   - Server handles retry automatically

3. **Price Overrides**
   - Check `pos:override_price` permission
   - Log price changes for audit trail
   - Show original vs. override price in UI

4. **Sync Monitoring**
   - Display `needsReview` items in admin dashboard
   - Allow manual retry or resolution
   - Export sync logs for debugging

5. **Error Messages**
   - Show user-friendly warnings for failed syncs
   - Display sync status indicator in POS
   - Alert on persistent failures (>5 attempts)

---

## Future Enhancements

1. **Bidirectional Sync** - Sync FLEXI-POS products to Shopify
2. **Order Sync** - Pull Shopify orders into FLEXI-POS
3. **Customer Sync** - Sync customer data between systems
4. **Bulk Operations** - Batch sync for large catalogs
5. **Webhook Replay** - Re-process missed webhooks
6. **Multi-location Sync** - Map FLEXI-POS locations to Shopify locations
7. **Variant Mapping** - Auto-map by SKU matching
8. **Price Rules** - Sync pricing rules and discounts

---

## Troubleshooting

### Webhooks Not Received
1. Check webhook registration: `GET /shopify/connection`
2. Verify callback URL is publicly accessible
3. Check Shopify admin → Settings → Notifications → Webhooks
4. Test webhook signature verification locally

### Sync Failures
1. Check `ShopifySyncLog` for error messages
2. Verify Shopify credentials are valid
3. Check rate limiting (Shopify has 1000 point budget)
4. Review retry queue: `GET /shopify/sync-queue?needsReview=true`

### SSE Disconnections
1. Client reconnects automatically (browser behavior)
2. Implement exponential backoff for reconnection
3. Use `EventSource.readyState` to monitor connection
4. Fallback to polling if SSE unavailable

### Performance Issues
1. Paginate product fetches (use cursor)
2. Cache products in frontend
3. Limit SSE connections per org
4. Batch sync operations in worker

---

## Support

For issues or questions:
1. Check sync logs: `GET /shopify/sync-logs`
2. Review queue items: `GET /shopify/sync-queue`
3. Monitor worker output in server logs
4. Test connection: `GET /shopify/connection`

---

**Version**: 1.0.0  
**API Version**: Shopify Admin API 2026-01  
**Last Updated**: January 20, 2026
