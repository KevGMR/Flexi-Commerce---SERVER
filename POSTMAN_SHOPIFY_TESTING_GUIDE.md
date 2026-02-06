# Postman Testing Guide - Shopify Integration

## Import Collection
- Open Postman and import [server/POSTMAN_SHOPIFY_COLLECTION.json](server/POSTMAN_SHOPIFY_COLLECTION.json)
- Collection name: "FLEXI-POS Shopify Integration"What doi

## Environment Variables (Postman)
Set these in a Postman environment (example: "FLEXI-POS Development"):
- baseUrl: http://localhost:9200 (or your deployed URL)
- token: Bearer access token from the auth flow (see [server/POSTMAN_TESTING_GUIDE.md](server/POSTMAN_TESTING_GUIDE.md))
- storeName: My Store
- storeUrl: your-store.myshopify.com (no protocol, no trailing slash)
- clientId: Your Shopify app's client ID (from Shopify Partner Dashboard)
- clientSecret: Your Shopify app's client secret (from Shopify Partner Dashboard)
- locationId: FLEXI location ID (from GET /locations; used for mapping)
- shopifyLocationId: Shopify location ID (from GET /locations/shopify/available-locations; format: gid://shopify/Location/...)
- limit: 50 (default page size for products)
- cursor: blank (fill with endCursor to paginate)
- queueStatus: pending|processing|failed|completed|needs_review (optional filter)
- needsReview: true|false (optional filter)
- syncType: inventory_update|product_fetch|webhook_received|token_refresh (optional filter)
- syncStatus: success|failed|pending (optional filter)

## Prerequisites
- Server running:
  ```bash
  cd server
  npm install
  npm run dev
  ```
- MongoDB running and MONGO_URI set in .env
- .env includes:
  - JWT_SECRET, CLIENT_URL, CORS_ORIGINS
  - API_URL set to a public HTTPS URL reachable by Shopify webhooks (use ngrok when local)
- Shopify app created in Partner Dashboard with:
  - Client ID and Client Secret (OAuth 2.0 credentials)
  - Admin API scopes: read_products, read_inventory, write_inventory, read_locations
  - Access token will be automatically managed by the system (24-hour expiry, auto-refresh)
- Use the auth guide to obtain a token and organization context: [server/POSTMAN_TESTING_GUIDE.md](server/POSTMAN_TESTING_GUIDE.md)

## Test Scenarios

### 1) Connect Shopify
- Request: POST {{baseUrl}}/shopify/connect
- Headers: Authorization: Bearer {{token}}
- Body (raw JSON):
  ```json
  {
    "storeName": "{{storeName}}",
    "storeUrl": "{{storeUrl}}",
    "clientId": "{{clientId}}",
    "clientSecret": "{{clientSecret}}"
  }
  ```
- Expected: 201, success: true, lists registered webhook topics (products/update, products/delete, inventory_levels/update), tokenExpiresAt
- Notes: 
  - Only one connection per organization; disconnect before re-connecting
  - Access token is automatically fetched and will auto-refresh every 24 hours
  - No need to manually manage tokens

### 2) Connection Status
- Request: GET {{baseUrl}}/shopify/connection
- Headers: Authorization: Bearer {{token}}
- Expected: connected: true/false, store info, webhooks, lastSyncedAt, lastTokenRefreshAt

### 3) List Products
- Request: GET {{baseUrl}}/shopify/products?limit={{limit}}&cursor={{cursor}}
- Headers: Authorization: Bearer {{token}}
- Expected: products array with variants, images, pageInfo.endCursor for pagination
- Uses Shopify API version 2026-01; set cursor to endCursor to fetch next page

### 4) Sync Queue (pending/failed)
- Request: GET {{baseUrl}}/shopify/sync-queue?status={{queueStatus}}&needsReview={{needsReview}}
- Headers: Authorization: Bearer {{token}}
- Expected: latest 100 queued items filtered by status/needsReview

### 5) Sync Logs (history)
- Request: GET {{baseUrl}}/shopify/sync-logs?syncType={{syncType}}&status={{syncStatus}}&limit=50
- Headers: Authorization: Bearer {{token}}
- Expected: recent sync events for the organization (inventory updates, product fetches, webhook receipts)

### 6) Disconnect Shopify
- Request: DELETE {{baseUrl}}/shopify/disconnect
- Headers: Authorization: Bearer {{token}}
- Expected: success: true, webhooks removed and connection deleted

### 7) Get Available Shopify Locations (for mapping)
- Request: GET {{baseUrl}}/locations/shopify/available-locations
- Headers: Authorization: Bearer {{token}}
- Expected: shopifyLocations array with id, name, isActive, address, city
- Notes:
  - Call this after connecting to Shopify
  - Shows all locations available in the Shopify store
  - Use the `id` field (gid://shopify/Location/...) in the next step

### 8) Map FLEXI Location to Shopify Location
- Request: POST {{baseUrl}}/locations/{{locationId}}/set-shopify-location
- Headers: Authorization: Bearer {{token}}, Content-Type: application/json
- Body:
  ```json
  {
    "shopifyLocationId": "gid://shopify/Location/123456",
    "shopifyLocationName": "Main Warehouse"
  }
  ```
- Expected: success: true, location object with shopifyLocationId and shopifyLocationName set
- Notes:
  - {{locationId}} is the FLEXI location ID (from GET /locations)
  - shopifyLocationId is from step 7 (Available Shopify Locations)
  - After mapping, all Shopify inventory updates for this FLEXI location will target the mapped Shopify location
  - Repeat for each FLEXI location you want to map to a Shopify location

## Location Mapping Flow
1. Create/get your FLEXI locations (GET /locations)
2. Connect to Shopify (POST /shopify/connect)
3. Fetch available Shopify locations (GET /locations/shopify/available-locations)
4. Map each FLEXI location to a Shopify location (POST /locations/:id/set-shopify-location)
5. Create sales with Shopify items → inventory updates use the mapped location automatically

## Real-Time & Webhooks
- Webhooks: Shopify calls {{API_URL}}/shopify/webhooks/{topic} for products/update, products/delete, inventory_levels/update. API_URL must be public. Signature is verified using the current access token.
- SSE stream: GET {{baseUrl}}/shopify/events with Authorization: Bearer {{token}} to receive webhook events in real time per organization. Postman may not render SSE well; use curl if needed:
  ```bash
  curl -N -H "Authorization: Bearer <token>" {{baseUrl}}/shopify/events
  ```
- Deduplication: Webhooks are deduplicated in-memory by webhookId for 24 hours.
- Token Management: Access tokens are automatically refreshed before expiry (5-minute buffer). If a 401 error occurs, the system will refresh the token and retry the request once.

## Common Issues
- 401 Unauthorized: Missing/expired token; re-login via auth guide
- 400 Missing fields: Provide storeName, storeUrl, clientId, and clientSecret
- 400 Authentication failed: Check your clientId and clientSecret are correct from Shopify Partner Dashboard
- 404 No connection: Connect first before products/sync endpoints
- Webhook 401: HMAC mismatch; ensure API_URL is correct and access token is valid
- Webhook not received: API_URL not publicly reachable or CORS/SSL blocking; retest with ngrok and re-connect to re-register webhooks
- Token refresh failures: Check console logs and sync logs for detailed error messages; verify client credentials are still valid

## How to Get Shopify Credentials

1. **Login to Shopify Partner Dashboard** - https://partners.shopify.com
2. **Create or select your app**
3. **Navigate to App Setup → Configuration**
4. **Copy Client ID and Client Secret** under "Client credentials"
5. **Configure API Scopes** - At minimum: `read_products`, `read_inventory`, `write_inventory`, `read_locations`
6. **Install app to your store** if not already installed
7. Use these credentials in Postman variables: `clientId` and `clientSecret`

## Testing Report Template
```
Date: ___________
Server Version: ___________
Node Version: ___________
Shopify Store: ___________

Connect Shopify: PASS / FAIL
Connection Status: PASS / FAIL
List Products (pagination): PASS / FAIL
Sync Queue: PASS / FAIL
Sync Logs: PASS / FAIL
Webhooks delivered: PASS / FAIL
SSE stream receives webhook events: PASS / FAIL
Disconnect: PASS / FAIL

Issues Found:
- Issue 1: ___________
- Issue 2: ___________

Notes: ___________
```
