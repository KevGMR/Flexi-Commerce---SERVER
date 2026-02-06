# Advanced Features & Patterns

Deep dive into advanced FLEXI-POS features including error handling, webhooks, permissions, offline sales, and idempotency patterns.

## Table of Contents

1. [Error Handling & Status Codes](#error-handling--status-codes)
2. [Webhooks & Event System](#webhooks--event-system)
3. [Permissions & RBAC](#permissions--rbac)
4. [Idempotency & Deduplication](#idempotency--deduplication)
5. [Offline Sales Handling](#offline-sales-handling)
6. [Rate Limiting](#rate-limiting)
7. [Pagination & Filtering](#pagination--filtering)
8. [Performance Optimization](#performance-optimization)
9. [Security Best Practices](#security-best-practices)

---

## Error Handling & Status Codes

### HTTP Status Code Reference

| Code | Name | Meaning |
|------|------|---------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 204 | No Content | Request successful, no content returned |
| 400 | Bad Request | Invalid request body or parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Authenticated but lacks permission |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource conflict (duplicate, state violation) |
| 422 | Unprocessable Entity | Validation failed |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |
| 502 | Bad Gateway | Service temporarily unavailable |
| 503 | Service Unavailable | Server under maintenance |

### Standard Error Response Format

```json
{
  "success": false,
  "error": "User-friendly error message",
  "code": "ERROR_CODE_CONSTANT",
  "details": [
    {
      "field": "email",
      "message": "Email is required",
      "code": "FIELD_REQUIRED"
    }
  ],
  "requestId": "req-12345",
  "timestamp": "2026-01-22T22:00:00Z"
}
```

### Common Error Codes

#### Authentication Errors (4xx)

**INVALID_TOKEN**
```json
{
  "error": "Token is invalid or expired",
  "code": "AUTH_INVALID_TOKEN",
  "statusCode": 401
}
```

**MISSING_ORGANIZATION_CONTEXT**
```json
{
  "error": "Organization context required in request",
  "code": "AUTH_MISSING_ORG_CONTEXT",
  "statusCode": 401
}
```

**INSUFFICIENT_PERMISSIONS**
```json
{
  "error": "User role cannot perform this action",
  "code": "AUTH_INSUFFICIENT_PERMISSIONS",
  "statusCode": 403,
  "details": {
    "required": ["manager", "owner"],
    "userRole": "editor"
  }
}
```

#### Resource Errors (4xx)

**RESOURCE_NOT_FOUND**
```json
{
  "error": "Product not found",
  "code": "PRODUCT_NOT_FOUND",
  "statusCode": 404,
  "details": {
    "resourceId": "507f1f77bcf86cd799439050"
  }
}
```

**RESOURCE_ALREADY_EXISTS**
```json
{
  "error": "SKU already exists in organization",
  "code": "PRODUCT_SKU_EXISTS",
  "statusCode": 409,
  "details": {
    "sku": "LAPTOP-001"
  }
}
```

#### Validation Errors (422)

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_FAILED",
  "statusCode": 422,
  "details": [
    {
      "field": "email",
      "message": "Invalid email format",
      "code": "INVALID_FORMAT"
    },
    {
      "field": "price",
      "message": "Price must be positive",
      "code": "INVALID_VALUE"
    }
  ]
}
```

#### Business Logic Errors (4xx)

**INSUFFICIENT_INVENTORY**
```json
{
  "error": "Insufficient inventory for sale",
  "code": "INVENTORY_INSUFFICIENT",
  "statusCode": 400,
  "details": {
    "variant": "507f1f77bcf86cd799439051",
    "requested": 10,
    "available": 5
  }
}
```

**SALE_VOIDED**
```json
{
  "error": "Cannot refund a voided sale",
  "code": "SALE_VOIDED",
  "statusCode": 409
}
```

**SHOPIFY_NOT_CONNECTED**
```json
{
  "error": "Shopify is not connected for this organization",
  "code": "SHOPIFY_NOT_CONNECTED",
  "statusCode": 400
}
```

#### Rate Limit (429)

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "statusCode": 429,
  "details": {
    "retryAfter": 60,
    "limit": 100,
    "window": "1 minute"
  }
}
```

### Error Handling Best Practices

1. **Always check `success` field** - Indicates success or failure
2. **Use `code` for programmatic handling** - Not error message
3. **Include `requestId` in logs** - For debugging support
4. **Handle retryable errors** - 429, 502, 503
5. **Never expose error details to users** - Use `code` for user-facing messages

### Retry Strategy

```javascript
// Implement exponential backoff for retryable errors
async function requestWithRetry(endpoint, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, options);
      
      if (response.ok) return response;
      
      // Retryable errors
      if ([429, 502, 503].includes(response.status)) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-retryable error
      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## Webhooks & Event System

### Webhook Events

FLEXI-POS emits events for important business actions.

#### Supported Events

**Sales Events**
- `sale.created` - New sale completed
- `sale.voided` - Sale voided
- `sale.refunded` - Full refund issued
- `sale.partial_refund` - Partial refund issued

**Inventory Events**
- `inventory.adjusted` - Stock level adjusted
- `inventory.transferred` - Stock transferred between locations
- `inventory.low_stock` - Stock below reorder level

**Organization Events**
- `organization.created` - New organization created
- `member.invited` - Team member invited
- `member.joined` - Team member accepted invitation
- `member.removed` - Team member removed

**Shopify Events**
- `shopify.connected` - Shopify connection established
- `shopify.disconnected` - Shopify connection removed
- `shopify.sync.completed` - Shopify sync completed
- `shopify.sync.failed` - Shopify sync failed

### Webhook Configuration

**Register Webhook Endpoint:**

**Endpoint:** `POST /webhooks/register`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "url": "https://your-app.com/webhooks/flexi",
  "events": ["sale.created", "inventory.adjusted"],
  "active": true,
  "description": "My app webhook"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "webhook": {
    "_id": "507f1f77bcf86cd799439400",
    "url": "https://your-app.com/webhooks/flexi",
    "events": ["sale.created", "inventory.adjusted"],
    "secret": "whsec_1234567890abcdef",
    "createdAt": "2026-01-22T22:00:00Z"
  }
}
```

### Webhook Payload Format

```json
{
  "id": "evt_1234567890",
  "timestamp": "2026-01-22T22:00:00Z",
  "event": "sale.created",
  "organizationId": "507f1f77bcf86cd799439012",
  "data": {
    "saleId": "507f1f77bcf86cd799439200",
    "receiptNumber": "RCP-2026-001",
    "total": 2861.96,
    "paymentMethod": "card",
    "items": [
      {
        "type": "flexi",
        "variant": "507f1f77bcf86cd799439051",
        "quantity": 2
      }
    ]
  }
}
```

### Webhook Signature Verification

All webhooks include `X-FLEXI-Signature` header for security.

```javascript
// Verify webhook signature
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
  
  return hash === signature;
}

// Usage in webhook handler
app.post('/webhooks/flexi', (req, res) => {
  const signature = req.headers['x-flexi-signature'];
  const webhookSecret = 'whsec_1234567890abcdef';
  
  if (!verifyWebhookSignature(req.body, signature, webhookSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook
  processWebhook(req.body);
  res.json({ received: true });
});
```

### Webhook Best Practices

1. **Verify signatures** - Always validate webhook authenticity
2. **Idempotent processing** - Use event ID to avoid duplicate processing
3. **Quick response** - Return 2xx status immediately
4. **Async processing** - Queue webhook for background processing
5. **Implement retry logic** - We retry 5 times with exponential backoff
6. **Handle duplicates** - Same event may be delivered multiple times
7. **Log all webhooks** - For debugging and compliance

### Webhook Retry Policy

- **Initial delivery:** Immediate
- **Retry 1:** After 1 minute
- **Retry 2:** After 5 minutes
- **Retry 3:** After 30 minutes
- **Retry 4:** After 2 hours
- **Retry 5:** After 24 hours

If all retries fail, webhook marked as failed.

---

## Permissions & RBAC

### Permission Model

FLEXI-POS uses resource-based permission model:

```
User → Role → Permissions → Resource
```

### Permission Format

All permissions follow pattern: `resource:action`

**Resources:**
- `products` - Product management
- `inventory` - Inventory management
- `sales` - Sales operations
- `reports` - Reporting
- `users` - User management
- `organizations` - Organization settings
- `audit` - Audit log access

**Actions:**
- `create` - Create new resource
- `read` - View resource
- `update` - Modify resource
- `delete` - Remove resource

### Permission Checking

Every API request is checked:

```
1. Extract token and validate JWT
2. Check user exists and active
3. Get user's organization context
4. Check user is member of organization
5. Get user's role in organization
6. Check role has permission for resource:action
7. Check resource ownership (if applicable)
8. Execute endpoint logic
```

### Checking Permissions Programmatically

**Endpoint:** `POST /auth/check-permission`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "resource": "products",
  "action": "delete",
  "resourceId": "507f1f77bcf86cd799439050"
}
```

**Response:**
```json
{
  "success": true,
  "hasPermission": true,
  "details": {
    "resource": "products",
    "action": "delete",
    "userRole": "manager",
    "reason": "Manager role includes delete:products permission"
  }
}
```

---

## Idempotency & Deduplication

### Idempotency Key Pattern

Prevent duplicate resource creation from network retries.

**Add to any CREATE request:**

```json
{
  "items": [...],
  "idempotencyKey": "your-unique-key"
}
```

**Key Requirements:**
- Unique per organization per 24 hours
- Can be UUID, timestamp + random, or any unique string
- Maximum 255 characters

**Example Keys:**
```
// UUID format
d290f1ee-6c54-4b01-90e6-d701748f0851

// Timestamp + random
2026-01-22-001-abc123

// Business key
SALE-2026-01-22-001
```

### Idempotency Flow

```
Request 1: POST /sales {"items": [...], "idempotencyKey": "key-123"}
  → Creates sale with receiptNumber RCP-2026-001
  → Returns 201 Created

Request 2 (retry): Same request
  → Detects duplicate idempotencyKey
  → Returns SAME sale (RCP-2026-001)
  → Returns 200 OK (cached response)
  → No duplicate sale created ✓
```

### Implementing Idempotency

```javascript
// Client-side implementation
async function createSaleWithIdempotency(saleData) {
  const idempotencyKey = generateUUID(); // or crypto.randomUUID()
  
  const payload = {
    ...saleData,
    idempotencyKey
  };
  
  try {
    const response = await fetch('/sales', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    // Safe to retry with same idempotencyKey
    return await response.json();
  } catch (error) {
    // Network error - safe to retry with SAME idempotencyKey
    return createSaleWithIdempotency(saleData);
  }
}
```

---

## Offline Sales Handling

### Overview

FLEXI-POS supports offline sales processing when server unavailable.

**Offline Capabilities:**
- Create sales with local products/inventory
- Store sales locally
- Sync sales when connection restored
- Maintain receipt numbers offline

### Offline Sale Model

```json
{
  "id": "local-uuid",
  "type": "offline_sale",
  "status": "pending_sync",
  "timestamp": "2026-01-22T22:00:00Z",
  "items": [
    {
      "type": "flexi",
      "variant": "variant-id",
      "quantity": 2,
      "price": 1299.99
    }
  ],
  "total": 2861.96,
  "paymentMethod": "cash",
  "syncStatus": {
    "synced": false,
    "retries": 0,
    "lastError": null
  }
}
```

### Offline Sales Sync

**Endpoint:** `POST /sales/sync-offline`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "offlineSales": [
    {
      "id": "local-uuid-001",
      "timestamp": "2026-01-22T22:00:00Z",
      "items": [...],
      "total": 2861.96,
      "paymentMethod": "cash"
    }
  ],
  "idempotencyKey": "sync-batch-001"
}
```

**Response:**
```json
{
  "success": true,
  "synced": [
    {
      "offlineId": "local-uuid-001",
      "saleId": "507f1f77bcf86cd799439200",
      "receiptNumber": "RCP-2026-001"
    }
  ],
  "failed": []
}
```

### Offline Best Practices

1. **Store sales locally** with full data
2. **Sync on reconnection** - Automatic detection
3. **Handle conflicts** - Server may reject due to inventory
4. **Maintain receipt numbers** - Assign locally, reconcile after sync
5. **Queue failed syncs** - Retry with backoff
6. **Validate on reconnect** - Check inventory before accepting sync

---

## Rate Limiting

### Rate Limit Headers

Every response includes rate limit info:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642887600
```

### Rate Limits by Endpoint

| Endpoint Category | Limit | Window |
|------------------|-------|--------|
| Authentication | 5 | 1 minute |
| Read Operations | 100 | 1 minute |
| Write Operations | 50 | 1 minute |
| Reports | 20 | 1 minute |
| Webhooks | Unlimited | - |

### Rate Limit Response

When limit exceeded:

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "statusCode": 429,
  "headers": {
    "X-RateLimit-Limit": "100",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": "1642887600",
    "Retry-After": "60"
  }
}
```

### Handling Rate Limits

```javascript
async function requestWithRateLimit(endpoint, options) {
  const response = await fetch(endpoint, options);
  
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After'));
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    
    // Wait and retry
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return requestWithRateLimit(endpoint, options); // Retry
  }
  
  return response;
}
```

---

## Pagination & Filtering

### Pagination

All list endpoints support cursor-based pagination.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 500,
    "pages": 25,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Filtering

Endpoints support filter parameters:

**Examples:**

```
GET /products?search=laptop&status=active&tags=electronics

GET /sales?status=completed&paymentMethod=card&startDate=2026-01-01T00:00:00Z

GET /inventory?location=507f1f77bcf86cd799439070&lowStock=true
```

### Sorting

Some endpoints support sorting:

**Query Parameter:** `sortBy` and `sortOrder`

```
GET /products?sortBy=price&sortOrder=asc

GET /sales?sortBy=createdAt&sortOrder=desc
```

---

## Performance Optimization

### Best Practices

1. **Use pagination** - Don't fetch all records at once
2. **Filter results** - Use query parameters to reduce data
3. **Limit fields** (if supported) - Request only needed fields
4. **Batch operations** - Combine related requests
5. **Cache responses** - Cache read-only data locally
6. **Use CDN** - For product images
7. **Monitor rate limits** - Adjust request rate

### Pagination Best Practice

```javascript
// ❌ DON'T - Fetch all without pagination
const allProducts = await fetch('/products');

// ✅ DO - Use pagination
async function getAllProducts(limit = 50) {
  let page = 1;
  let allProducts = [];
  let hasMore = true;
  
  while (hasMore) {
    const response = await fetch(`/products?page=${page}&limit=${limit}`);
    const data = await response.json();
    
    allProducts = allProducts.concat(data.data);
    hasMore = data.pagination.hasNextPage;
    page++;
  }
  
  return allProducts;
}
```

---

## Security Best Practices

### Authentication

1. **Use Bearer tokens** - Always include Authorization header
2. **Keep tokens secure** - Store in memory or secure storage
3. **Use HTTPS only** - Never send tokens over HTTP
4. **Rotate tokens** - Use refresh tokens for long sessions
5. **Short expiry** - Access tokens expire after 1 hour
6. **Invalidate on logout** - Revoke refresh tokens

### Data Protection

1. **Encrypt sensitive data** - Use TLS for all connections
2. **Validate input** - Check all user inputs
3. **Sanitize output** - Prevent XSS attacks
4. **Rate limiting** - Prevent brute force attacks
5. **Audit logging** - Log all sensitive operations

### Webhook Security

1. **Verify signatures** - Always validate webhook authenticity
2. **Use HTTPS** - Webhook URLs must be HTTPS
3. **Implement timeout** - Process webhooks within 30 seconds
4. **Queue for retry** - Don't process directly from webhook

---

## Related Documentation

- [Authentication & Organizations](01-Authentication.md) - Auth flow and tokens
- [Organizations & Roles](02-Organizations.md) - Permissions and member management
- [E-Commerce CRUD](03-E-Commerce-CRUD.md) - Product and inventory APIs
- [Sales Operations](04-Sales.md) - Sales and refund workflows
- [Shopify Integration](05-Shopify-Integration.md) - Shopify connection and sync
