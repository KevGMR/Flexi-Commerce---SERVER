# Shopify Integration - Testing Guide

## Prerequisites

Before testing, ensure you have:

1. **FLEXI-POS Server Running**
   ```bash
   cd server
   npm install
   npm run dev
   ```

2. **Valid Shopify Store**
   - Store URL: `your-store.myshopify.com`
   - API credentials (private app token or access token)
   - Products with variants in Shopify

3. **Postman Collection**
   - Import: `POSTMAN_SHOPIFY_COLLECTION.json`
   - Set variables: `baseUrl`, `token`, `storeUrl`, `apiPassword`

4. **Test User/Organization**
   - Login to get JWT token
   - Set as `token` variable in Postman
   - Verify `organizationId` in JWT

5. **Network Access**
   - Shopify webhooks must reach your API URL
   - For local testing, use ngrok: `ngrok http 9200`
   - Update `API_URL` in `.env` with ngrok URL

---

## Test Flow

### Phase 1: Connection Setup

**Test 1.1: Connect Shopify Store**

1. In Postman, go to "1) Connect Shopify"
2. Set variables:
   - `storeName`: "Test Store"
   - `storeUrl`: "your-store.myshopify.com"
   - `apiPassword`: "shpat_xxxxx" (private app token)
3. Send POST `/shopify/connect`

**Expected Result**:
```json
{
  "success": true,
  "message": "Shopify connection created successfully",
  "data": {
    "storeName": "Test Store",
    "storeUrl": "your-store.myshopify.com",
    "apiVersion": "2026-01",
    "status": "active",
    "webhooks": ["products/update", "products/delete", "inventory_levels/update"]
  }
}
```

**Verify**:
- ✅ Status 201
- ✅ Webhooks registered in Shopify (check Settings → Notifications → Webhooks)
- ✅ Database: `ShopifyConnection` record created with org ID

**Test 1.2: Check Connection Status**

1. Send GET `/shopify/connection`

**Expected Result**:
```json
{
  "success": true,
  "connected": true,
  "data": {
    "storeName": "Test Store",
    "storeUrl": "your-store.myshopify.com",
    "status": "active",
    "webhooks": ["products/update", "products/delete", "inventory_levels/update"]
  }
}
```

**Verify**:
- ✅ `connected: true`
- ✅ All 3 webhooks listed

---

### Phase 2: Product Fetching

**Test 2.1: Fetch Shopify Products**

1. Send GET `/shopify/products?limit=10`

**Expected Result**:
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "gid://shopify/Product/123456789",
        "title": "Cool T-Shirt",
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
                "inventoryQuantity": 25
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

**Verify**:
- ✅ Products returned with variants
- ✅ SKU present for each variant
- ✅ Inventory quantities showing
- ✅ `lastFetchedAt` timestamp

**Test 2.2: Pagination**

1. Copy `endCursor` from previous response
2. Send GET `/shopify/products?limit=10&cursor={{endCursor}}`

**Expected Result**:
- ✅ Next page of products returned
- ✅ `hasNextPage` updated accordingly

---

### Phase 3: Inventory Sync on Sales

**Test 3.1: Create Sale with Shopify Product**

This is NOT done via Shopify endpoints. Instead, use the existing POS sale endpoint:

1. Get a Shopify product ID and variant ID from Test 2.1
2. POST `/orders` (or existing sales endpoint) with:

```json
{
  "saleOrigin": "pos",
  "items": [
    {
      "productSource": "shopify",
      "shopifyProductId": "gid://shopify/Product/123456789",
      "shopifyVariantId": "gid://shopify/ProductVariant/987654321",
      "quantity": 2,
      "price": 29.99,
      "description": "Cool T-Shirt - Small Red"
    }
  ],
  "paymentMethod": "cash",
  "totalAmount": 59.98
}
```

**Expected Result**:
- ✅ Sale created successfully
- ✅ Response contains `synced: true` OR `synced: false` with warning

**Sync Result (Option A - Immediate Success)**:
```json
{
  "success": true,
  "synced": true,
  "warning": null,
  "newQuantity": 23,
  "locationId": "gid://shopify/Location/123"
}
```

**Sync Result (Option B - Queued for Retry)**:
```json
{
  "success": true,
  "synced": false,
  "warning": "Inventory sync failed, queued for retry",
  "error": "Rate limit exceeded"
}
```

**Verify**:
- ✅ Sale created in database
- ✅ Shopify quantity decreased by 2
- ✅ Sync log created (success or failed)

---

### Phase 4: Monitoring Queue & Logs

**Test 4.1: View Sync Queue (Pending Items)**

1. Send GET `/shopify/sync-queue?status=pending`

**Expected Result** (if sync was queued):
```json
{
  "success": true,
  "data": [
    {
      "_id": "abc123",
      "organizationId": "org456",
      "shopifyProductId": "gid://shopify/Product/123456789",
      "shopifyVariantId": "gid://shopify/ProductVariant/987654321",
      "saleId": "sale789",
      "status": "pending",
      "attemptCount": 0,
      "maxAttempts": 10,
      "nextRetryAt": "2026-01-20T10:30:00.000Z",
      "needsReview": false,
      "createdAt": "2026-01-20T10:25:00.000Z"
    }
  ]
}
```

**Verify**:
- ✅ Items show in queue if sync failed
- ✅ `nextRetryAt` is set
- ✅ `attemptCount` starts at 0

**Test 4.2: View Failed Items (needsReview)**

1. Send GET `/shopify/sync-queue?needsReview=true`

**Expected Result**:
- Items that failed 10+ times appear here
- Admin should manually review and resolve

**Test 4.3: View Sync Logs**

1. Send GET `/shopify/sync-logs?syncType=inventory_update&status=success`

**Expected Result**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "log123",
      "organizationId": "org456",
      "syncType": "inventory_update",
      "shopifyProductId": "gid://shopify/Product/123456789",
      "shopifyVariantId": "gid://shopify/ProductVariant/987654321",
      "saleId": "sale789",
      "status": "success",
      "requestPayload": {
        "quantityChange": -2,
        "newQuantity": 23
      },
      "responsePayload": { "inventoryAdjustmentGroup": { "id": "..." } },
      "attemptNumber": 1,
      "processingTime": 342,
      "createdAt": "2026-01-20T10:25:00.000Z"
    }
  ]
}
```

**Verify**:
- ✅ Successful syncs logged
- ✅ Failed syncs logged separately
- ✅ Processing time tracked
- ✅ Response payloads captured

**Test 4.4: View Failed Syncs**

1. Send GET `/shopify/sync-logs?syncType=inventory_update&status=failed`

**Expected Result**:
- Failed attempts show with error messages
- Useful for debugging sync issues

---

### Phase 5: Background Worker (Retry)

**Test 5.1: Manual Trigger Retry Worker**

The retry worker runs automatically every 5 minutes. To manually trigger for testing:

```javascript
// In Node.js console or test script
const shopifyRetryWorker = require('./workers/shopifyRetryWorker');
const result = await shopifyRetryWorker.runNow();
console.log(result);
// Output: { success: true, processed: 2, duration: 1234, timestamp: ... }
```

**Verify**:
- ✅ Worker processes pending items
- ✅ `nextRetryAt` advanced with exponential backoff
- ✅ Items move from `pending` → `processing` → `completed` or `failed`

**Test 5.2: Verify Backoff Timing**

1. Create multiple failed syncs (e.g., via invalid variant ID)
2. Check sync queue after each failure
3. Verify `nextRetryAt` increases: 1min, 2min, 4min, 8min, 16min, etc.

```javascript
// Attempt 1: nextRetryAt = now + 1 minute
// Attempt 2: nextRetryAt = now + 2 minutes
// Attempt 3: nextRetryAt = now + 4 minutes
// ...
// Attempt 10: nextRetryAt = now + 512 minutes, needsReview = true
```

**Verify**:
- ✅ Exponential backoff working
- ✅ After 10 attempts, item flagged `needsReview: true`

---

### Phase 6: Webhook Handling

**Test 6.1: Receive Webhook Simulation**

Shopify will POST webhooks to `/shopify/webhooks/:topic` automatically. To simulate:

```bash
# Get webhook signature
HMAC_SECRET="your-api-password"
PAYLOAD='{"id":123456789,"title":"Product Updated"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -binary | base64)

# Send webhook
curl -X POST http://localhost:9200/shopify/webhooks/products/update \
  -H "Content-Type: application/json" \
  -H "x-shopify-webhook-id: webhook-id-123" \
  -H "x-shopify-hmac-sha256: $SIGNATURE" \
  -H "x-shopify-shop-domain: your-store.myshopify.com" \
  -d "$PAYLOAD"
```

**Expected Result**:
- ✅ Status 200 OK
- ✅ Webhook processed
- ✅ Event broadcast to SSE clients

**Test 6.2: Webhook Deduplication**

1. Send the same webhook twice with same `x-shopify-webhook-id`
2. Only first is processed, second is ignored (cached)

**Verify**:
- ✅ Deduplication working (prevents double-processing)
- ✅ Second request returns 200 OK (no error)

---

### Phase 7: Real-time Events (SSE)

**Test 7.1: Connect SSE Stream**

```javascript
// JavaScript in browser or Node.js
const token = "your-jwt-token";
const eventSource = new EventSource(
  `http://localhost:9200/shopify/events`,
  { headers: { Authorization: `Bearer ${token}` } }
);

eventSource.onmessage = (event) => {
  console.log("Event received:", JSON.parse(event.data));
};

eventSource.onerror = (error) => {
  console.error("SSE error:", error);
};
```

**Expected Result**:
```
Event received: { type: "connected", timestamp: "2026-01-20T10:40:00.000Z" }
```

**Test 7.2: Webhook Broadcast**

1. Keep SSE connection open
2. Trigger a webhook from Shopify (or simulate with curl from Test 6.1)
3. Watch for event in SSE stream

**Expected Result**:
```
Event received: {
  "type": "webhook",
  "topic": "products/update",
  "webhookId": "123456",
  "payload": {...},
  "timestamp": "2026-01-20T10:41:00.000Z"
}
```

**Verify**:
- ✅ Event received in real-time
- ✅ Payload contains full webhook data
- ✅ Frontend can re-fetch products

---

### Phase 8: Permissions Testing

**Test 8.1: POS Price Override Permission**

1. Create user with `pos:override_price` permission
2. Create another without it
3. Test sale creation with price override

**Expected Result**:
- User WITH permission: ✅ Can override price
- User WITHOUT permission: ❌ Denied access

**Test 8.2: Shopify Products Access**

1. Create user with `pos:access_shopify_products` permission
2. Test GET `/shopify/products`

**Expected Result**:
- User WITH permission: ✅ Can fetch products
- User WITHOUT permission: ❌ Denied access

---

### Phase 9: Error Scenarios

**Test 9.1: Invalid API Credentials**

1. Connect with wrong `apiPassword`
2. Try to fetch products

**Expected Result**:
```json
{
  "success": false,
  "message": "Failed to fetch products from Shopify",
  "error": "Unauthorized"
}
```

**Test 9.2: Rate Limiting**

1. Make rapid product fetch requests
2. Shopify may respond with rate limit error

**Expected Result**:
- First request: ✅ Succeeds
- Requests within rate limit: ✅ Succeed
- Over rate limit: Auto-retry with backoff

**Test 9.3: Invalid Variant ID**

1. Create sale with fake `shopifyVariantId`
2. Sync attempt fails

**Expected Result**:
- Sale created: ✅
- Sync fails: ✅
- Item queued: ✅
- Sync log shows error: ✅

**Test 9.4: No Connection**

1. Test GET `/shopify/products` without connecting first

**Expected Result**:
```json
{
  "success": false,
  "message": "No Shopify connection found. Please connect first."
}
```

---

### Phase 10: Disconnect & Cleanup

**Test 10.1: Disconnect Shopify**

1. Send DELETE `/shopify/disconnect`

**Expected Result**:
```json
{
  "success": true,
  "message": "Shopify connection removed successfully"
}
```

**Verify**:
- ✅ Webhooks removed from Shopify
- ✅ Connection record deleted
- ✅ Subsequent API calls fail with "no connection" error

---

## Checklist

- [ ] Phase 1: Connection setup (connect, status check)
- [ ] Phase 2: Product fetching (list, pagination)
- [ ] Phase 3: Sales with inventory sync (immediate or queued)
- [ ] Phase 4: Queue & logs monitoring
- [ ] Phase 5: Retry worker (manual trigger, backoff timing)
- [ ] Phase 6: Webhook handling (receive, deduplication)
- [ ] Phase 7: Real-time SSE events
- [ ] Phase 8: Permission checks
- [ ] Phase 9: Error scenarios
- [ ] Phase 10: Cleanup & disconnect

---

## Debugging Tips

### Check Server Logs

```bash
# Watch server output for errors
npm run dev
# Look for [Shopify Retry Worker], [Shopify Webhook], etc.
```

### Check Database

```bash
# MongoDB
db.shopifyconnections.findOne({ organizationId: "..." })
db.shopifysyncqueues.find({ status: "failed" }).pretty()
db.shopifysynclogs.find({}).sort({ createdAt: -1 }).limit(10).pretty()
```

### Check Shopify Webhooks

1. Log into Shopify Admin
2. Settings → Notifications → Webhooks
3. Verify webhooks are registered
4. Check "Recent deliveries" for logs

### Network Issues (Webhooks Not Arriving)

1. If local development, use ngrok:
   ```bash
   ngrok http 9200
   # Get URL: https://abc123.ngrok.io
   ```

2. Update `.env`:
   ```env
   API_URL=https://abc123.ngrok.io
   ```

3. Reconnect Shopify (creates new webhooks with ngrok URL)

### Rate Limiting

Shopify Admin API has a query cost system:
- Budget: 1000 points per minute
- Each query costs points (tracked in response)
- If over limit, automatically retries with backoff

Check `SHOPIFY_INTEGRATION.md` for details on rate limiting handling.

---

## Performance Metrics

Track these during testing:

| Metric | Expected | Notes |
|--------|----------|-------|
| Product fetch | <500ms | GraphQL query with rate limiting |
| Inventory sync | <1000ms | Includes Shopify API call |
| Webhook processing | <100ms | HMAC verification + broadcast |
| SSE broadcast | <50ms | In-memory operation |
| Queue processing (10 items) | <10s | Background worker |

---

## Troubleshooting

### Issue: Webhooks not received

**Solution**:
1. Check Shopify webhooks are registered: GET `/shopify/connection`
2. Verify callback URL is public (use ngrok for local)
3. Check webhook logs in Shopify admin
4. Manually test webhook with curl

### Issue: Sync always fails

**Solution**:
1. Check API credentials (apiPassword or accessToken)
2. Verify variant ID format (should be GraphQL ID)
3. Check Shopify rate limit (query cost analysis)
4. View error in sync logs: GET `/shopify/sync-logs?status=failed`

### Issue: SSE events not received

**Solution**:
1. Ensure client is authenticated (valid JWT token)
2. Check browser DevTools → Network → EventSource
3. Verify SSE endpoint responds with `Content-Type: text/event-stream`
4. Check server logs for SSE connection

### Issue: Permission denied on product fetch

**Solution**:
1. Check user role has `pos:access_shopify_products`
2. Verify organization ID in JWT
3. Check user status (not banned or suspended)

---

## Next Steps After Testing

✅ Integration complete and tested  
→ Build POS frontend UI for:
  - Product selection tab (FLEXI-POS vs Shopify)
  - Inventory caching in IndexedDB
  - SSE notification handling
  - Offline queue for sales
  - Admin dashboard for sync monitoring

---

**Version**: 1.0.0  
**Last Updated**: January 20, 2026
