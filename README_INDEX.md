# 📚 FLEXI-POS API Documentation Index

**Complete API documentation and Postman collection for FLEXI-POS multi-tenant POS system**

---

## 🎯 Start Here

### First Time? Follow This Path:
1. 📖 Read [QUICK_REFERENCE.md](QUICK_REFERENCE.md) (5 min) - Essential quick start
2. 🔧 Import [POSTMAN_MASTER_COLLECTION.json](POSTMAN_MASTER_COLLECTION.json) into Postman
3. ⚙️ Load [POSTMAN_ENVIRONMENT.json](POSTMAN_ENVIRONMENT.json) as environment
4. 🚀 Run first request: `POST /users/new` (register)
5. 📚 Deep dive: [API_GUIDE.md](API_GUIDE.md) for full overview

---

## 📖 Documentation Files

### Master Index & Guides
| File | Purpose | Read Time |
|------|---------|-----------|
| **[API_GUIDE.md](API_GUIDE.md)** | Master API reference with endpoint table | 15 min |
| **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** | Quick start card and common workflows | 5 min |
| **[CONSOLIDATION_SUMMARY.md](CONSOLIDATION_SUMMARY.md)** | What was created and how to use it | 10 min |

### Category-Specific Guides
All guides in the `docs/` directory with code examples, workflows, and best practices:

| Guide | Topics | Read Time |
|-------|--------|-----------|
| **[docs/01-Authentication.md](docs/01-Authentication.md)** | User registration, login, session management, audit logs | 20 min |
| **[docs/02-Organizations.md](docs/02-Organizations.md)** | Team management, roles, permissions, RBAC | 15 min |
| **[docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md)** | Products, variants, inventory, suppliers, POs, transfers, gift cards | 25 min |
| **[docs/04-Sales.md](docs/04-Sales.md)** | Sales, void/refund, reporting, dual-catalog support | 20 min |
| **[docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md)** | Shopify connection, product sync, inventory sync, location mapping, troubleshooting | 20 min |
| **[docs/06-Advanced-Features.md](docs/06-Advanced-Features.md)** | Error handling, webhooks, RBAC, idempotency, offline sales, rate limiting, security | 25 min |

---

## 🔧 Postman Collections & Environments

### Master Collection (Recommended)
**File:** [POSTMAN_MASTER_COLLECTION.json](POSTMAN_MASTER_COLLECTION.json)
- **Requests:** 47 consolidated API endpoints
- **Organization:** 4 hierarchical categories
- **Variables:** 15 pre-configured variables
- **Status:** ✅ Ready to use
- **Usage:** Import into Postman, select POSTMAN_ENVIRONMENT.json

### Environment Template
**File:** [POSTMAN_ENVIRONMENT.json](POSTMAN_ENVIRONMENT.json)
- **Variables:** 31 pre-configured (auth, IDs, Shopify credentials, pagination)
- **Setup:** Load into Postman after importing collection
- **Update:** Values populate automatically after registration

### Original Collections (For Reference)
Also available but superseded by POSTMAN_MASTER_COLLECTION.json:
- FLEXI-POS Multi-Tenant Auth & Organizations.postman_collection.json
- FLEXI-POS E-Commerce CRUD APIs.postman_collection.json
- FLEXI-POS Sales (Dual Catalog).postman_collection.json
- FLEXI-POS Shopify Integration.postman_collection.json

---

## 📋 What's Documented

### ✅ Fully Covered
- **Authentication & Sessions** (21 endpoints)
- **Organization Management** (6 endpoints)
- **Users & Roles** (10 endpoints)
- **Product Management** (5 CRUD endpoints)
- **Variants** (5 CRUD endpoints)
- **Collections** (5 endpoints)
- **Locations** (5 endpoints)
- **Inventory** (7 endpoints)
- **Suppliers** (5 endpoints)
- **Purchase Orders** (7 endpoints)
- **Transfers** (6 endpoints)
- **Gift Cards** (7 endpoints)
- **Sales Operations** (8 endpoints)
- **Sales Reporting** (3 endpoints)
- **Shopify Integration** (8 endpoints)
- **Error Handling** (15+ error codes documented)
- **Webhooks** (4 event categories)
- **Advanced Patterns** (Idempotency, offline sales, RBAC, rate limiting)

### 🎯 Total Coverage
- **60+ API Endpoints** fully documented with examples
- **4,886 lines** of comprehensive documentation
- **47 Postman requests** ready to use
- **31 environment variables** pre-configured

---

## 🚀 Quick API Reference

### Base URL & Auth
```
Base URL: http://localhost:9200
Auth: Bearer Token (JWT)
Header: Authorization: Bearer {{accessToken}}
```

### Essential Endpoints
```
Auth:    POST /users/new              POST /auth/refresh     POST /auth/logout
Org:     GET /organizations/my        POST /organizations    GET /organizations/:id
Sales:   POST /sales                  GET /sales/:id         POST /sales/:id/refund
Products: POST /products              GET /products          POST /products/:id/variants
Inventory: POST /inventory/initialize GET /inventory         PATCH /inventory/:id/adjust
Shopify: POST /shopify/connect        GET /shopify/status    GET /shopify/products
```

---

## 📚 Learning Paths

### Path 1: Developer (First API Integration)
1. [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - 5 min overview
2. [docs/01-Authentication.md](docs/01-Authentication.md) - Understand auth
3. Import POSTMAN collection and test endpoints
4. [API_GUIDE.md](API_GUIDE.md) - Full endpoint reference
5. [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md) - Patterns & best practices

### Path 2: Integration (Building App)
1. [docs/01-Authentication.md](docs/01-Authentication.md) - User registration
2. [docs/02-Organizations.md](docs/02-Organizations.md) - Multi-tenant context
3. [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md) - Data models
4. [docs/04-Sales.md](docs/04-Sales.md) - Transaction processing
5. [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md) - Error handling, webhooks

### Path 3: Shopify Seller
1. [docs/01-Authentication.md](docs/01-Authentication.md) - Setup account
2. [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md) - Products & inventory
3. [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md) - Connect Shopify
4. [docs/04-Sales.md](docs/04-Sales.md) - Process mixed-catalog sales
5. [QUICK_REFERENCE.md](QUICK_REFERENCE.md#workflow-connect-shopify--sync) - Reference workflows

### Path 4: Support/Operations
1. [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Common workflows
2. [QUICK_REFERENCE.md](QUICK_REFERENCE.md#❌-common-errors--solutions) - Troubleshooting
3. [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md#troubleshooting) - Shopify issues
4. [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#error-handling--status-codes) - Error codes

---

## 🔍 Find What You Need

### By Topic
| Looking For | Go To |
|-------------|-------|
| How to register & login | [docs/01-Authentication.md](docs/01-Authentication.md) |
| How to manage users/roles | [docs/02-Organizations.md](docs/02-Organizations.md) |
| How to manage products | [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md#products) |
| How to track inventory | [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md#inventory-management) |
| How to process a sale | [docs/04-Sales.md](docs/04-Sales.md#creating-sales) |
| How to issue refund | [docs/04-Sales.md](docs/04-Sales.md#refund-operations) |
| How to connect Shopify | [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md#connection-setup) |
| How to handle errors | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#error-handling--status-codes) |
| How to use webhooks | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#webhooks--event-system) |
| How to avoid duplicates | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#idempotency--deduplication) |
| Common workflows | [QUICK_REFERENCE.md](QUICK_REFERENCE.md#💡-common-workflows) |
| Status codes | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#http-status-code-reference) |
| Rate limits | [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#rate-limiting) |

### By API Category
| Category | Guide | Requests |
|----------|-------|----------|
| Authentication | [docs/01-Authentication.md](docs/01-Authentication.md) | 21 |
| Organizations | [docs/02-Organizations.md](docs/02-Organizations.md) | 10 |
| E-Commerce | [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md) | 39 |
| Sales | [docs/04-Sales.md](docs/04-Sales.md) | 11 |
| Shopify | [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md) | 8 |

---

## 💾 File Locations

### Main Documentation
```
server/
├── API_GUIDE.md                    (Master index & endpoints table)
├── QUICK_REFERENCE.md              (Quick start card)
├── CONSOLIDATION_SUMMARY.md        (What's included)
├── README_INDEX.md                 (This file)
├── POSTMAN_MASTER_COLLECTION.json  (47 requests, use this)
├── POSTMAN_ENVIRONMENT.json        (Variables, use this)
└── docs/
    ├── 01-Authentication.md
    ├── 02-Organizations.md
    ├── 03-E-Commerce-CRUD.md
    ├── 04-Sales.md
    ├── 05-Shopify-Integration.md
    └── 06-Advanced-Features.md
```

### Original Collections (Legacy)
```
server/
├── FLEXI-POS Multi-Tenant Auth & Organizations.postman_collection.json
├── FLEXI-POS E-Commerce CRUD APIs.postman_collection.json
├── FLEXI-POS Sales (Dual Catalog).postman_collection.json
├── FLEXI-POS Shopify Integration.postman_collection.json
├── POSTMAN_COLLECTION.json
├── POSTMAN_SALES_COLLECTION.json
├── POSTMAN_SHOPIFY_COLLECTION.json
└── POSTMAN_WEEK4_CRUDS.json
```

---

## ⚡ Common Tasks

### Register & Get Started
```
1. POST /users/new
   → Save accessToken, organizationId
2. POST /email-verification/send
   → Verify email
3. GET /organizations/my
   → Confirm org created
```

### Create & Sell Product
```
1. POST /products
   → Save productId
2. POST /products/{{productId}}/variants
   → Save variantId
3. POST /inventory/initialize
   → Set initial stock
4. POST /sales
   → Create sale with variant
```

### Connect Shopify
```
1. POST /shopify/connect
   → OAuth setup
2. GET /shopify/locations
   → Get Shopify locations
3. POST /shopify/locations/map
   → Map to FLEXI location
4. GET /shopify/products
   → Products ready to sell
```

---

## 🆘 Getting Help

### Quick Troubleshooting
1. Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md#❌-common-errors--solutions) for common errors
2. Look up error code in [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md#common-error-codes)
3. Review relevant guide for your task
4. Check example requests in POSTMAN_MASTER_COLLECTION.json

### Detailed Help
- **Auth issues** → [docs/01-Authentication.md](docs/01-Authentication.md)
- **Product issues** → [docs/03-E-Commerce-CRUD.md](docs/03-E-Commerce-CRUD.md)
- **Sales issues** → [docs/04-Sales.md](docs/04-Sales.md)
- **Shopify issues** → [docs/05-Shopify-Integration.md](docs/05-Shopify-Integration.md#troubleshooting)
- **Errors/security** → [docs/06-Advanced-Features.md](docs/06-Advanced-Features.md)

---

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Documentation Files | 6 guides |
| Master Index Files | 3 (API_GUIDE, Quick Ref, Summary) |
| Total Documentation | 4,886 lines |
| Total Lines (with JSON) | ~7,686 lines |
| API Endpoints Documented | 60+ |
| Postman Requests | 47 |
| Environment Variables | 31 |
| Error Codes Documented | 15+ |
| Webhook Events | 4 categories |
| Use Cases Documented | 10+ |

---

## 🎓 Additional Resources

### In-Code Documentation
- Controllers: [server/controllers/](controllers/) - Implementation details
- Models: [server/models/](models/) - Data structures
- Middleware: [server/middleware/](middleware/) - Request handling
- Services: [server/services/](services/) - Business logic

### Related Files
- [API_QUICK_REFERENCE.md](API_QUICK_REFERENCE.md) - Original quick ref
- [SETUP_GUIDE.md](SETUP_GUIDE.md) - Server setup instructions
- [SHOPIFY_INTEGRATION.md](SHOPIFY_INTEGRATION.md) - Integration guide
- [POSTMAN_TESTING_GUIDE.md](POSTMAN_TESTING_GUIDE.md) - Testing workflows

---

## 📝 Version & Updates

| Version | Date | What's New |
|---------|------|-----------|
| 1.0 | Jan 22, 2026 | Initial consolidated API documentation |

---

## 🏁 Next Steps

1. **Import collection**: POSTMAN_MASTER_COLLECTION.json
2. **Load environment**: POSTMAN_ENVIRONMENT.json
3. **Register user**: POST /users/new
4. **Read guide**: Start with category relevant to your task
5. **Test endpoint**: Use Postman to verify
6. **Reference docs**: Keep guides open for examples

---

**Happy coding! 🚀**

For questions, refer to the relevant category guide or check [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for common workflows.

---

**Last Updated:** January 22, 2026 | **Documentation Version:** 1.0
