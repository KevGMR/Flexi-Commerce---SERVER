# FLEXI-POS API - Quick Reference Card

**Generated:** January 22, 2026 | **Status:** ✅ Ready for Use

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Import into Postman
1. Open Postman
2. Click **Import** → **File** or **Paste Raw text**
3. Select [POSTMAN_MASTER_COLLECTION.json](POSTMAN_MASTER_COLLECTION.json)
4. Click **Import**

### Step 2: Load Environment
1. Click **Manage Environments** (⚙️ icon)
2. Click **Import**
3. Select [POSTMAN_ENVIRONMENT.json](POSTMAN_ENVIRONMENT.json)
4. Select environment from dropdown

### Step 3: Authenticate
1. Run: `POST /users/new` (register first user)
2. Check environment variables updated: `{{accessToken}}`, `{{organizationId}}`
3. All subsequent requests use this token

### Step 4: First Request
1. Navigate to `Sales Operations` → `Create Sale - FLEXI Only`
2. Click **Send**
3. Check response for receipt number

---

## 📚 Documentation Map

| Need | Start Here |
|------|-----------|
| API overview | [API_GUIDE.md](API_GUIDE.md) |
| User authentication | [docs/01-Authentication.md](docs/01-Authentication.md) |
| Team management | [docs/02-Organizations.md](docs/02-Organizations.md) |
| Products & inventory | [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md) |
| Sales processing | [docs/04-Sales.md](docs/04-Sales.md) |
| Shopify connection | [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md) |
| Error handling | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md) |
| Webhooks & patterns | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md) |
| Rate limiting | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#rate-limiting) |
| Troubleshooting | [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md#troubleshooting) |

---

## 🔌 API Base URL & Authentication

```
Base URL: http://localhost:9200
Auth: Bearer Token (JWT)
Header: Authorization: Bearer {{accessToken}}
```

---

## 📋 Core Resources

### Users & Organizations
```
POST   /users/new                          Register user
GET    /organizations/my                   Get my orgs
POST   /organizations                      Create org
GET    /organizations/:id                  Get org details
PUT    /organizations/:id                  Update org
POST   /auth/refresh                       Refresh token
POST   /auth/logout                        Logout
```

### Team Management
```
GET    /organizations/:id/members          List members
POST   /organizations/:id/members/invite   Invite member
PUT    /organizations/:id/members/:userId  Update role
DELETE /organizations/:id/members/:userId  Remove member
```

### Products
```
POST   /products                           Create product
GET    /products                           List products
GET    /products/:id                       Get product
PUT    /products/:id                       Update product
DELETE /products/:id                       Delete product
```

### Variants
```
POST   /products/:id/variants              Create variant
GET    /products/:id/variants              List variants
PUT    /products/:id/variants/:variantId   Update variant
DELETE /products/:id/variants/:variantId   Delete variant
```

### Inventory
```
POST   /inventory/initialize               Setup inventory
GET    /inventory                          List inventory
PATCH  /inventory/:id/adjust               Adjust stock
GET    /inventory/:id/audit                View audit trail
```

### Locations
```
POST   /locations                          Create location
GET    /locations                          List locations
GET    /locations/:id                      Get location
```

### Sales
```
POST   /sales                              Create sale
GET    /sales                              List sales
GET    /sales/:id                          Get sale
POST   /sales/:id/void                     Void sale
POST   /sales/:id/refund                   Refund sale
GET    /sales/reports/summary              Sales report
```

### Shopify
```
POST   /shopify/connect                    Connect Shopify
GET    /shopify/status                     Connection status
GET    /shopify/products                   Fetch products
POST   /shopify/sync-inventory             Sync inventory
GET    /shopify/sync-queue                 View sync queue
```

---

## 🔑 Common Environment Variables

```
{{baseUrl}}              = http://localhost:9200
{{accessToken}}          = <JWT token>
{{organizationId}}       = <Org ID>
{{userId}}               = <User ID>
{{locationId}}           = <Location ID>
{{productId}}            = <Product ID>
{{variantId}}            = <Variant ID>
{{saleId}}               = <Sale ID>
{{supplierId}}           = <Supplier ID>
{{purchaseOrderId}}      = <PO ID>
{{transferId}}           = <Transfer ID>
{{giftCardId}}           = <Gift Card ID>
{{storeName}}            = <Shopify store>
{{clientId}}             = <Shopify App ID>
{{clientSecret}}         = <Shopify App Secret>
```

---

## 💡 Common Workflows

### Workflow: Create & Sell Product
```
1. POST /products
   → Save {{productId}}

2. POST /products/{{productId}}/variants
   → Save {{variantId}}

3. POST /locations
   → Save {{locationId}}

4. POST /inventory/initialize
   (variant, location, quantity)

5. POST /sales
   (items with variant)
   → Save {{saleId}}

6. GET /sales/{{saleId}}
   → Verify completed
```

### Workflow: Connect Shopify & Sync
```
1. Collect Shopify credentials:
   - storeName
   - clientId
   - clientSecret

2. POST /shopify/connect
   → Webhooks auto-registered

3. GET /shopify/locations
   → Save shopifyLocationId

4. POST /shopify/locations/map
   (flexiLocation → shopifyLocation)

5. GET /shopify/products
   → Products ready to use

6. Monitor: GET /shopify/sync-queue
   → Real-time inventory sync
```

### Workflow: Process Refund
```
1. POST /sales/{{saleId}}/refund
   {
     "refundType": "partial",
     "items": [...],
     "reason": "customer-request"
   }

2. GET /sales/{{saleId}}/refunds
   → Verify processed

3. GET /sales/{{saleId}}
   → Confirm status: partial_refund
```

---

## ❌ Common Errors & Solutions

| Error | Status | Solution |
|-------|--------|----------|
| Invalid token | 401 | Run registration, update {{accessToken}} |
| Missing org context | 401 | Set {{organizationId}} |
| Insufficient permissions | 403 | Check user role (admin/manager required) |
| Resource not found | 404 | Verify ID is correct, entity exists |
| Already exists | 409 | Check for duplicates (email, SKU, etc.) |
| Insufficient inventory | 400 | Check stock level with GET /inventory |
| Rate limit exceeded | 429 | Wait 60 seconds, retry |
| Shopify not connected | 400 | Run POST /shopify/connect first |
| Invalid Shopify credentials | 400 | Verify clientId, clientSecret |

---

## 🔐 Security Checklist

- ✅ Store tokens securely (memory, not localStorage)
- ✅ Always use HTTPS in production
- ✅ Include idempotency keys for creates: `"idempotencyKey": "unique-key"`
- ✅ Verify webhook signatures: `X-FLEXI-Signature` header
- ✅ Implement exponential backoff for retries
- ✅ Monitor rate limits: `X-RateLimit-Remaining` header
- ✅ Use separate tokens per session
- ✅ Refresh token before expiry (1 hour)
- ✅ Never commit tokens to git

---

## 📊 Collection Structure

```
POSTMAN_MASTER_COLLECTION
├── 1. Authentication & Organizations (17 reqs)
│   ├── Register/Login
│   ├── Organization Management
│   ├── User Invitations
│   └── Session Management
├── 2. E-Commerce CRUD (13 reqs)
│   ├── Products CRUD
│   ├── Variants CRUD
│   ├── Collections
│   ├── Locations & Inventory
│   └── Suppliers & POs
├── 3. Sales Operations (8 reqs)
│   ├── Create Sales
│   ├── Void/Refund
│   └── Reporting
├── 4. Shopify Integration (7 reqs)
│   ├── Connect/Disconnect
│   ├── Product & Inventory Sync
│   └── Location Mapping
└── 5. Uncategorized (2 reqs)
```

---

## 🚨 Troubleshooting

### API Returns 401 Unauthorized
- [ ] Check token in Authorization header
- [ ] Verify token not expired (1 hour)
- [ ] Use POST /auth/refresh to get new token
- [ ] Check {{accessToken}} variable is set

### Shopify Sync Not Working
- [ ] Verify connection: GET /shopify/status
- [ ] Check location mapping: GET /shopify/locations/mappings
- [ ] View sync queue: GET /shopify/sync-queue?status=failed
- [ ] Retry failed sync: POST /shopify/sync-queue/:id/retry
- [ ] Check sync logs: GET /shopify/sync-logs

### Sale Returns Insufficient Inventory
- [ ] Check inventory: GET /inventory
- [ ] View details: GET /inventory/:id
- [ ] Adjust if needed: PATCH /inventory/:id/adjust
- [ ] Verify location: {{locationId}}

### Rate Limit Exceeded (429)
- [ ] Wait time in `Retry-After` header
- [ ] Check `X-RateLimit-Remaining` header
- [ ] Implement exponential backoff
- [ ] Batch requests efficiently

---

## 📞 Support Resources

| Resource | Location |
|----------|----------|
| API Documentation | [API_GUIDE.md](API_GUIDE.md) |
| Auth Guide | [docs/01-Authentication.md](docs/01-Authentication.md) |
| Product Management | [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md) |
| Error Codes | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#error-handling--status-codes) |
| Shopify Setup | [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md) |
| Postman Collection | [POSTMAN_MASTER_COLLECTION.json](POSTMAN_MASTER_COLLECTION.json) |
| Postman Environment | [POSTMAN_ENVIRONMENT.json](POSTMAN_ENVIRONMENT.json) |

---

## 📈 API Limits

| Resource | Limit | Window |
|----------|-------|--------|
| Auth endpoints | 5 req/min | Per IP |
| Read operations | 100 req/min | Per user |
| Write operations | 50 req/min | Per user |
| Product upload | 100 files/min | Per org |
| Shopify sync | Depends on Shopify | 2-4 req/sec |

---

## 🎯 Getting Help

1. **Check documentation first** → [API_GUIDE.md](API_GUIDE.md)
2. **Search error code** → [Error Reference](docs/06-Advanced-Features.md#common-error-codes)
3. **Review examples** → Relevant category guide in `/docs`
4. **Check Postman collection** → Request examples pre-configured
5. **Verify status** → GET endpoint returns current state

---

**Last Updated:** January 22, 2026 | **Version:** 1.0
