# Quick Start - Shopify Integration with Client Credentials

## Get Your Shopify Credentials

You already have these:
```
Client ID: 74b1c79d9523c3d86372902bdf4b964c
Client Secret: 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
Store URL: house-of-queens-ke.myshopify.com
```

## Set Up Postman

1. Import [POSTMAN_SHOPIFY_COLLECTION.json](POSTMAN_SHOPIFY_COLLECTION.json)
2. Set environment variables:
   - `baseUrl`: http://localhost:9200
   - `token`: (get from auth flow - see [POSTMAN_TESTING_GUIDE.md](POSTMAN_TESTING_GUIDE.md))
   - `storeName`: House of Queens KE
   - `storeUrl`: house-of-queens-ke.myshopify.com
   - `clientId`: 74b1c79d9523c3d86372902bdf4b964c
   - `clientSecret`: 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

## Connect to Shopify

**Request:** POST `{{baseUrl}}/shopify/connect`

**Headers:**
```
Authorization: Bearer {{token}}
Content-Type: application/json
```

**Body:**
```json
{
  "storeName": "House of Queens",
  "storeUrl": "house-of-queens-ke.myshopify.com",
  "clientId": "74b1c79d9523c3d86372902bdf4b964c",
  "clientSecret": "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"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Shopify connection created successfully",
  "data": {
    "storeName": "House of Queens",
    "storeUrl": "house-of-queens-ke.myshopify.com",
    "apiVersion": "2026-01",
    "status": "active",
    "webhooks": [
      "products/update",
      "products/delete",
      "inventory_levels/update"
    ],
    "tokenExpiresAt": "2026-01-21T12:34:56.789Z"
  }
}
```

## What Happens Automatically

✅ **Access token fetched** - System exchanges your client credentials for a 24-hour access token  
✅ **Token cached** - Stored in memory and database  
✅ **Webhooks registered** - Shopify will send updates to your server  
✅ **Auto-refresh** - Token refreshes every 24 hours automatically  
✅ **Error recovery** - On 401 errors, system refreshes token and retries  

## Test the Integration

### 1. Check Connection Status
```http
GET {{baseUrl}}/shopify/connection
Authorization: Bearer {{token}}
```

### 2. Fetch Products
```http
GET {{baseUrl}}/shopify/products?limit=10
Authorization: Bearer {{token}}
```

### 3. Monitor Token Refresh
- Check console logs: `[Shopify Auth] Token refreshed for org...`
- Check database: `ShopifySyncLog` collection, `syncType: 'token_refresh'`
- Connection status should stay 'active'

### 4. View Sync Logs
```http
GET {{baseUrl}}/shopify/sync-logs?syncType=token_refresh
Authorization: Bearer {{token}}
```

## Webhooks (Optional)

To receive real-time updates from Shopify:

1. **Set up ngrok** (for local testing):
   ```bash
   ngrok http 9200
   ```

2. **Update .env**:
   ```
   API_URL=https://your-ngrok-url.ngrok.io
   ```

3. **Reconnect** (webhooks are registered on connect):
   - Disconnect: `DELETE {{baseUrl}}/shopify/disconnect`
   - Reconnect: `POST {{baseUrl}}/shopify/connect` (same body as above)

4. **Test webhooks**:
   - Update a product in Shopify admin
   - Check console logs for webhook receipt
   - Check SSE stream: `GET {{baseUrl}}/shopify/events`

## Troubleshooting

### "Failed to authenticate with Shopify"
- ✓ Check clientId and clientSecret are correct
- ✓ Ensure app is installed to your store
- ✓ Verify storeUrl is correct (no https://, no trailing slash)

### Token not refreshing
- ✓ Check console logs for errors
- ✓ Check `ShopifySyncLog` for failed token_refresh attempts
- ✓ Verify clientSecret is still valid in Shopify Partner Dashboard

### Connection status: 'error'
- ✓ Check `syncError` field in connection document
- ✓ Refresh credentials if compromised
- ✓ Disconnect and reconnect with valid credentials

## Monitoring

Watch these indicators for health:
- **Connection status**: Should be 'active'
- **lastTokenRefreshAt**: Should update every 24 hours
- **syncError**: Should be null
- **Console logs**: Look for `[Shopify Auth] Token refreshed...`
- **ShopifySyncLog**: `syncType: 'token_refresh'` should show status: 'success'

---

**Ready to go!** Your integration will manage tokens automatically. Just use the Postman collection to interact with Shopify. 🚀
