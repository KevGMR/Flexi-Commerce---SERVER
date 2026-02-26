# FLEXI-POS API Documentation

Complete API documentation for FLEXI-POS, a comprehensive multi-tenant POS system with e-commerce, inventory management, and Shopify integration.

## Quick Start

- **Base URL:** `http://localhost:9200`
- **Authentication:** Bearer Token (JWT)
- **Content-Type:** `application/json`
- **Postman Collection:** [POSTMAN_MASTER_COLLECTION.json](POSTMAN_MASTER_COLLECTION.json)
- **Environment Template:** [POSTMAN_ENVIRONMENT.json](POSTMAN_ENVIRONMENT.json)

---

## 📚 Documentation Guide

### 1. [Authentication & Organizations](docs/01-Authentication.md)
**User registration, login, organization management, and session handling**

Key topics:
- User registration and email verification
- Multi-organization support
- Authentication flow
- Password management
- Audit logging
- Rate limiting

**Key Endpoints:**
- `POST /users/new` - Register user
- `GET /organizations/my` - Get my organizations
- `POST /users/switch-organization` - Switch organization
- `POST /users/refresh` - Refresh access token
- `POST /users/logout` - Logout

---

### 2. [Organizations & Roles](docs/02-Organizations.md)
**Team management, roles, permissions, and access control**

Key topics:
- Organization structure and settings
- Role-based access control (RBAC)
- Built-in roles (Owner, Manager, Editor, Viewer, Guest)
- Custom role creation
- Member invitations and management
- Permission matrix
- Audit trail

**Key Endpoints:**
- `GET /organizations/:id` - Get organization details
- `POST /organizations/:id/members/invite` - Invite member
- `PUT /organizations/:id/members/:userId` - Update member role
- `DELETE /organizations/:id/members/:userId` - Remove member
- `POST /organizations/:id/roles` - Create custom role (Enterprise)

---

### 3. [E-Commerce CRUD Operations](docs/03-E-Commerce-CRUD.md)
**Complete product, inventory, supplier, and purchase order management**

Key topics:
- Product and variant management
- Collections (categories)
- Locations (stores/warehouses)
- Inventory tracking and adjustments
- Inventory audit trail
- Supplier management
- Purchase order workflow
- Transfers between locations
- Gift cards

**Key Endpoints:**
- `POST /products` - Create product
- `GET /products` - List products
- `POST /products/:id/variants` - Create variant
- `POST /inventory/initialize` - Setup inventory
- `PATCH /inventory/:id/adjust` - Adjust stock
- `POST /purchase-orders` - Create PO
- `POST /transfers` - Transfer inventory
- `POST /gift-cards` - Create gift card

---

### 4. [Sales Operations](docs/04-Sales.md)
**POS sales processing, refunds, voids, and reporting**

Key topics:
- Single and dual-catalog sales (FLEXI + Shopify)
- Multiple payment methods
- Sale lifecycle and status tracking
- Void operations
- Partial and full refunds
- Sales reporting and analytics
- Revenue by catalog and payment method
- Idempotency keys for duplicate prevention

**Key Endpoints:**
- `POST /sales` - Create sale
- `GET /sales` - List sales
- `GET /sales/:id` - Get sale details
- `POST /sales/:id/void` - Void sale
- `POST /sales/:id/refund` - Refund sale
- `GET /sales/reports/summary` - Sales summary report
- `GET /sales/reports/payment-methods` - Payment method breakdown
- `GET /sales/reports/catalog-breakdown` - FLEXI vs Shopify breakdown

---

### 5. [Shopify Integration](docs/05-Shopify-Integration.md)
**Connect with Shopify, sync products and inventory**

Key topics:
- Shopify OAuth connection setup
- Product synchronization with pagination
- Real-time inventory sync via webhooks
- Location mapping (Shopify ↔ FLEXI)
- Sync queue and retry logic (exponential backoff)
- Webhook event handling
- Troubleshooting sync issues

**Key Endpoints:**
- `POST /shopify/connect` - Connect Shopify store
- `GET /shopify/status` - Check connection status
- `GET /shopify/products` - Fetch Shopify products
- `POST /shopify/sync-inventory` - Manual sync
- `GET /shopify/locations` - Available Shopify locations
- `POST /shopify/locations/map` - Map FLEXI location to Shopify
- `GET /shopify/sync-queue` - View pending syncs
- `POST /shopify/sync-queue/:id/retry` - Retry failed sync

---

### 6. [Advanced Features & Patterns](docs/06-Advanced-Features.md)
**Error handling, webhooks, permissions, offline sales, security**

Key topics:
- HTTP status codes and error handling
- Standard error response format
- Common error codes and solutions
- Webhook events and payload format
- Webhook signature verification
- Permission checking patterns
- Idempotency keys and deduplication
- Offline sales handling
- Rate limiting and handling
- Pagination and filtering best practices
- Performance optimization
- Security best practices

---

## API Overview

### Resource Hierarchy

```
Organization
├── Users & Roles
│   ├── Authentication
│   ├── Organization Management
│   ├── Member Management
│   └── Audit Logs
├── E-Commerce
│   ├── Products
│   ├── Variants
│   ├── Collections
│   └── Gift Cards
├── Inventory
│   ├── Locations
│   ├── Inventory Levels
│   ├── Transfers
│   └── Inventory Audit
├── Procurement
│   ├── Suppliers
│   └── Purchase Orders
├── POS Sales
│   ├── Sales Transactions
│   ├── Refunds & Voids
│   └── Sales Reports
└── Shopify Integration
    ├── Connection Management
    ├── Product Sync
    ├── Inventory Sync
    └── Location Mapping
```

---

## Authentication Flow

### 1. Register First User

```
POST /users/new
{
  "fullname": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "organizationName": "My Store"
}
↓
Returns: accessToken, refreshToken, userId, organizationId
Save to environment: {{accessToken}}, {{organizationId}}
```

### 2. Verify Email

```
POST /email-verification/send
Authorization: Bearer {{accessToken}}
↓
Check email for verification link
```

### 3. Use Authorization Header

```
All subsequent requests:
Authorization: Bearer {{accessToken}}
```

### 4. Refresh Token (Before Expiry)

```
POST /users/refresh
Headers:
  X-Device-ID: <device-id>
Cookie:
  refreshToken=<httpOnly-cookie>
↓
Returns: new accessToken
Update: {{accessToken}}
```

---

## Endpoint Summary Table

### Authentication & Organizations
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/users/new` | Register first user |
| POST | `/email-verification/send` | Send verification email |
| POST | `/email-verification/verify` | Verify email address |
| GET | `/organizations/my` | Get my organizations |
| GET | `/organizations/:id` | Get org details |
| POST | `/organizations` | Create new organization |
| PUT | `/organizations/:id` | Update org settings |
| POST | `/users/switch-organization` | Switch organization |
| POST | `/users/refresh` | Refresh access token |
| POST | `/users/logout` | Logout |

### Users & Roles
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/organizations/:id/members` | List members |
| POST | `/organizations/:id/members/invite` | Invite member |
| PUT | `/organizations/:id/members/:userId` | Update member role |
| DELETE | `/organizations/:id/members/:userId` | Remove member |
| POST | `/organizations/:id/roles` | Create custom role |
| GET | `/organizations/:id/audit-logs` | View audit logs |

### Products & Catalog
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/products` | Create product |
| GET | `/products` | List products |
| GET | `/products/:id` | Get product |
| PUT | `/products/:id` | Update product |
| DELETE | `/products/:id` | Delete product |
| POST | `/products/:id/variants` | Create variant |
| GET | `/products/:id/variants` | List variants |
| PUT | `/products/:id/variants/:variantId` | Update variant |
| DELETE | `/products/:id/variants/:variantId` | Delete variant |
| POST | `/collections` | Create collection |
| GET | `/collections` | List collections |
| PUT | `/collections/:id/products` | Add products to collection |

### Locations & Inventory
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/locations` | Create location |
| GET | `/locations` | List locations |
| GET | `/locations/:id` | Get location |
| POST | `/inventory/initialize` | Initialize inventory |
| GET | `/inventory` | List inventory |
| GET | `/inventory/:id` | Get inventory |
| PATCH | `/inventory/:id/adjust` | Adjust stock |
| PATCH | `/inventory/:id/reorder-levels` | Update reorder levels |
| GET | `/inventory/:id/audit` | Get audit trail |
| POST | `/transfers` | Create transfer |
| GET | `/transfers` | List transfers |
| POST | `/transfers/:id/ship` | Ship transfer |
| POST | `/transfers/:id/receive` | Receive transfer |

### Suppliers & Procurement
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/suppliers` | Create supplier |
| GET | `/suppliers` | List suppliers |
| GET | `/suppliers/:id` | Get supplier |
| PUT | `/suppliers/:id` | Update supplier |
| DELETE | `/suppliers/:id` | Delete supplier |
| POST | `/purchase-orders` | Create PO |
| GET | `/purchase-orders` | List POs |
| GET | `/purchase-orders/:id` | Get PO |
| POST | `/purchase-orders/:id/send` | Send PO |
| POST | `/purchase-orders/:id/confirm` | Confirm PO |
| POST | `/purchase-orders/:id/receive` | Receive PO |

### Sales & POS
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sales` | Create sale |
| GET | `/sales` | List sales |
| GET | `/sales/:id` | Get sale |
| POST | `/sales/:id/void` | Void sale |
| POST | `/sales/:id/refund` | Refund sale |
| GET | `/sales/reports/summary` | Sales summary |
| GET | `/sales/reports/payment-methods` | Payment breakdown |
| GET | `/sales/reports/catalog-breakdown` | FLEXI vs Shopify |

### Gift Cards
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/gift-cards` | Create gift card |
| GET | `/gift-cards` | List gift cards |
| GET | `/gift-cards/lookup/:code` | Lookup by code |
| POST | `/gift-cards/:id/redeem` | Redeem gift card |
| POST | `/gift-cards/:id/deactivate` | Deactivate card |

### Shopify Integration
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/shopify/connect` | Connect Shopify |
| GET | `/shopify/status` | Check connection |
| POST | `/shopify/disconnect` | Disconnect Shopify |
| GET | `/shopify/products` | Fetch products |
| POST | `/shopify/sync-inventory` | Manual sync |
| GET | `/shopify/locations` | List Shopify locations |
| POST | `/shopify/locations/map` | Map location |
| GET | `/shopify/sync-queue` | View sync queue |
| POST | `/shopify/sync-queue/:id/retry` | Retry sync |
| GET | `/shopify/sync-logs` | View sync history |

---

## Environment Variables

### Required Variables

```
{{baseUrl}} = http://localhost:9200
{{accessToken}} = <JWT token from login>
{{organizationId}} = <Organization ID>
```

### Entity IDs

```
{{userId}} = <User ID>
{{locationId}} = <Location ID>
{{productId}} = <Product ID>
{{variantId}} = <Variant ID>
{{collectionId}} = <Collection ID>
{{supplierId}} = <Supplier ID>
{{purchaseOrderId}} = <Purchase Order ID>
{{transferId}} = <Transfer ID>
{{giftCardId}} = <Gift Card ID>
{{saleId}} = <Sale ID>
```

### Shopify Variables

```
{{storeName}} = <Shopify store name>
{{storeUrl}} = <Shopify store URL>
{{clientId}} = <Shopify App Client ID>
{{clientSecret}} = <Shopify App Client Secret>
{{shopifyLocationId}} = <Shopify Location ID>
```

### Pagination & Filtering

```
{{page}} = 1
{{limit}} = 20
{{search}} = <search term>
{{status}} = <filter status>
{{sortBy}} = <field to sort>
{{sortOrder}} = asc|desc
```

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439050",
    "name": "Gaming Laptop Pro",
    "...": "..."
  }
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [
    { "id": "...", "name": "..." }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": "User-friendly message",
  "code": "ERROR_CODE",
  "details": [
    {
      "field": "email",
      "message": "Email is required"
    }
  ]
}
```

---

## Common Workflows

### Workflow 1: Complete Sale (FLEXI Products)

```
1. POST /sales
   {
     "locationId": "{{locationId}}",
     "items": [
       {
         "type": "flexi",
         "variant": "{{variantId}}",
         "quantity": 2
       }
     ],
     "paymentMethod": "card",
     "idempotencyKey": "unique-key"
   }
   ↓ Save: {{saleId}}, {{receiptNumber}}

2. GET /sales/{{saleId}}
   (Verify sale completed)

3. GET /sales?status=completed&limit=10
   (View recent sales)
```

### Workflow 2: Create & Manage Product

```
1. POST /products
   {
     "name": "Gaming Laptop",
     "sku": "LAPTOP-001",
     "price": 1299.99
   }
   ↓ Save: {{productId}}

2. POST /products/{{productId}}/variants
   {
     "sku": "LAPTOP-001-16GB",
     "price": 1399.99
   }
   ↓ Save: {{variantId}}

3. POST /locations
   { "name": "Main Store" }
   ↓ Save: {{locationId}}

4. POST /inventory/initialize
   {
     "variant": "{{variantId}}",
     "location": "{{locationId}}",
     "quantity": 100
   }

5. GET /inventory?location={{locationId}}
   (View inventory)
```

### Workflow 3: Connect Shopify & Sync

```
1. POST /shopify/connect
   {
     "storeName": "{{storeName}}",
     "clientId": "{{clientId}}",
     "clientSecret": "{{clientSecret}}"
   }

2. GET /shopify/products?limit=50
   (Fetch Shopify products)

3. GET /shopify/locations
   (Get Shopify locations)

4. POST /shopify/locations/map
   {
     "flexiLocationId": "{{locationId}}",
     "shopifyLocationId": "gid://shopify/Location/123"
   }

5. GET /shopify/sync-queue
   (Monitor sync)
```

### Workflow 4: Process Refund

```
1. POST /sales/{{saleId}}/refund
   {
     "refundType": "partial",
     "items": [
       {
         "variant": "{{variantId}}",
         "quantity": 1
       }
     ],
     "reason": "customer-request"
   }
   ↓ Save: refundId

2. GET /sales/{{saleId}}/refunds
   (Verify refund processed)

3. GET /sales/{{saleId}}
   (Confirm sale status updated)
```

---

## Best Practices Checklist

- ✅ Always use HTTPS in production
- ✅ Store tokens securely
- ✅ Include idempotency keys for create operations
- ✅ Implement exponential backoff for retries
- ✅ Verify webhook signatures
- ✅ Use pagination for large datasets
- ✅ Handle 429 (rate limit) errors gracefully
- ✅ Log all API requests and errors
- ✅ Never commit tokens to version control
- ✅ Use environment variables for sensitive data
- ✅ Implement proper error handling
- ✅ Monitor rate limit headers

---

## Support & Resources

### Documentation Files
- [docs/01-Authentication.md](docs/01-Authentication.md) - Auth and user management
- [docs/02-Organizations.md](docs/02-Organizations.md) - Roles and permissions
- [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md) - Products and inventory
- [docs/04-Sales.md](docs/04-Sales.md) - Sales and refunds
- [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md) - Shopify connection
- [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md) - Webhooks and patterns

### Postman Resources
- **Master Collection:** [POSTMAN_MASTER_COLLECTION.json](POSTMAN_MASTER_COLLECTION.json) - All 47+ requests organized
- **Environment Template:** [POSTMAN_ENVIRONMENT.json](POSTMAN_ENVIRONMENT.json) - Pre-configured variables

### Source Code
- [server/index.js](index.js) - Server entry point
- [server/controllers/](controllers/) - API endpoint implementations
- [server/models/](models/) - Data models
- [server/middleware/](middleware/) - Request middleware
- [server/services/](services/) - Business logic

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 22, 2026 | Initial consolidated API documentation |

---

## License & Usage

FLEXI-POS is a proprietary system. For licensing inquiries, contact support.

---

**Last Updated:** January 22, 2026
