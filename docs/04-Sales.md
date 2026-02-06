# Sales Operations

Complete guide to POS sales processing, including single and multi-catalog sales, void/refund operations, and sales reporting in FLEXI-POS.

## Table of Contents

1. [Overview](#overview)
2. [Sales Fundamentals](#sales-fundamentals)
3. [Creating Sales](#creating-sales)
4. [Sale Workflows](#sale-workflows)
5. [Void Operations](#void-operations)
6. [Refund Operations](#refund-operations)
7. [Sales Reporting](#sales-reporting)
8. [Error Handling](#error-handling)

---

## Overview

FLEXI-POS supports:
- **Single-catalog sales** - FLEXI products only
- **Dual-catalog sales** - Mix FLEXI and Shopify products
- **Multiple payment methods** - Cash, card, check, gift card, custom
- **Partial refunds** - Issue partial or full refunds
- **Void operations** - Cancel sales before payment settlement
- **Sales reporting** - Revenue by catalog type, payment method, and period

**Base URL:** `http://localhost:9200`  
**Authentication:** Bearer Token (JWT)  
**Recommended Use:** Postman collection: `FLEXI-POS Sales (Dual Catalog)`

---

## Sales Fundamentals

### Sale Lifecycle

```
CREATE SALE
    ↓
[Payment Collected]
    ↓
SALE COMPLETED (status: completed)
    ↓
├─ VOID (cancel entire sale)
│   └─ Status: voided
│   └─ Inventory restored
│
└─ REFUND (partial or full)
    └─ Status: partial_refund or refunded
    └─ Inventory restored
    └─ Refund issued to payment method
```

### Sale Object Structure

```json
{
  "_id": "507f1f77bcf86cd799439200",
  "receiptNumber": "RCP-2026-001",
  "locationId": "507f1f77bcf86cd799439070",
  "organizationId": "507f1f77bcf86cd799439012",
  "items": [
    {
      "type": "flexi",
      "variant": "507f1f77bcf86cd799439051",
      "quantity": 2,
      "unitPrice": 1299.99,
      "subtotal": 2599.98
    }
  ],
  "subtotal": 2599.98,
  "tax": 207.99,
  "total": 2807.97,
  "paymentMethod": "card",
  "paymentStatus": "completed",
  "status": "completed",
  "createdAt": "2026-01-22T22:00:00Z",
  "createdBy": "507f1f77bcf86cd799439011"
}
```

### Sale Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Sale created, awaiting payment |
| `completed` | Payment received, sale finalized |
| `voided` | Entire sale cancelled |
| `partial_refund` | Partial refund issued |
| `refunded` | Full refund issued |

### Payment Methods

- `cash` - Cash payment
- `card` - Credit/debit card
- `check` - Check payment
- `bank_transfer` - Bank transfer/ACH
- `gift_card` - Gift card payment
- `split` - Multiple payment methods
- `other` - Custom payment method

---

## Creating Sales

### Create Sale - FLEXI Products Only

**Endpoint:** `POST /sales`

**Headers:**
```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```

**Request Body:**
```json
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
  "notes": "Regular customer",
  "idempotencyKey": "unique-sale-key-001"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "saleId": "507f1f77bcf86cd799439200",
    "receiptNumber": "RCP-2026-001",
    "subtotal": 2599.98,
    "tax": 207.99,
    "total": 2807.97,
    "paymentMethod": "card",
    "status": "completed",
    "timestamp": "2026-01-22T22:00:00Z"
  }
}
```

### Create Sale - Shopify Products Only

**Endpoint:** `POST /sales`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "shopify",
      "shopifyProductId": "gid://shopify/Product/123456",
      "quantity": 1
    }
  ],
  "paymentMethod": "card"
}
```

### Create Sale - Mixed Catalog (FLEXI + Shopify)

**Endpoint:** `POST /sales`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "flexi",
      "variant": "{{variantId}}",
      "quantity": 2
    },
    {
      "type": "shopify",
      "shopifyProductId": "gid://shopify/Product/123456",
      "quantity": 1
    }
  ],
  "paymentMethod": "card",
  "notes": "Mixed product sale"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "saleId": "507f1f77bcf86cd799439200",
    "receiptNumber": "RCP-2026-001",
    "items": [
      {
        "type": "flexi",
        "quantity": 2,
        "subtotal": 2599.98
      },
      {
        "type": "shopify",
        "quantity": 1,
        "subtotal": 49.99
      }
    ],
    "subtotal": 2649.97,
    "tax": 211.99,
    "total": 2861.96,
    "catalogBreakdown": {
      "flexi": 2599.98,
      "shopify": 49.99
    }
  }
}
```

### Create Sale with Split Payment

**Endpoint:** `POST /sales`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "locationId": "{{locationId}}",
  "items": [...],
  "paymentMethod": "split",
  "payments": [
    {
      "method": "cash",
      "amount": 1000.00
    },
    {
      "method": "gift_card",
      "amount": 500.00,
      "giftCardCode": "GC-XYZABC123"
    },
    {
      "method": "card",
      "amount": 361.96
    }
  ]
}
```

### Idempotency Keys

Prevent duplicate sales from network retries. Include unique `idempotencyKey` in request.

```json
{
  "items": [...],
  "idempotencyKey": "unique-key-12345"
}
```

If request fails and is retried with same key:
- Duplicate sale NOT created
- Original sale returned with same receipt number
- Idempotency guaranteed within 24 hours

---

## Sale Workflows

### Get Sale Details

**Endpoint:** `GET /sales/:saleId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "sale": {
    "_id": "507f1f77bcf86cd799439200",
    "receiptNumber": "RCP-2026-001",
    "items": [...],
    "total": 2861.96,
    "status": "completed",
    "createdAt": "2026-01-22T22:00:00Z",
    "createdBy": {
      "_id": "507f1f77bcf86cd799439011",
      "fullname": "John Doe"
    }
  }
}
```

### List Sales

**Endpoint:** `GET /sales`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `location` (optional) - Filter by location ID
- `status` (optional) - Filter by status (completed, voided, partial_refund)
- `paymentMethod` (optional) - Filter by payment method
- `startDate` (optional) - ISO 8601 format
- `endDate` (optional) - ISO 8601 format
- `page` (optional) - Default: 1
- `limit` (optional) - Default: 20

**Example:**
```
GET /sales?location=507f1f77bcf86cd799439070&status=completed&startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z
```

**Response:**
```json
{
  "success": true,
  "sales": [
    {
      "_id": "507f1f77bcf86cd799439200",
      "receiptNumber": "RCP-2026-001",
      "total": 2861.96,
      "status": "completed",
      "createdAt": "2026-01-22T22:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "pages": 8
  }
}
```

---

## Void Operations

### Void Entire Sale

Cancel a sale completely. Inventory is restored, payment is reversed (if already processed).

**Endpoint:** `POST /sales/:saleId/void`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "reason": "customer-request",
  "notes": "Customer changed mind - requesting full refund"
}
```

**Void Reasons:**
- `customer-request` - Customer asked for cancellation
- `payment-failed` - Payment didn't go through
- `inventory-error` - Wrong item sold
- `system-error` - Technical issue

**Response (200 OK):**
```json
{
  "success": true,
  "sale": {
    "_id": "507f1f77bcf86cd799439200",
    "status": "voided",
    "voidedAt": "2026-01-22T22:05:00Z",
    "voidReason": "customer-request",
    "inventoryRestored": [
      {
        "variant": "507f1f77bcf86cd799439051",
        "quantity": 2
      }
    ]
  }
}
```

### Void Cancellation (Revert Void)

**Endpoint:** `POST /sales/:saleId/unvoid`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Note:** Can only revert void if no other refunds have been issued.

---

## Refund Operations

### Partial Refund

Issue refund for specific items or amount.

**Endpoint:** `POST /sales/:saleId/refund`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body - Item-Based Refund:**
```json
{
  "refundType": "items",
  "items": [
    {
      "variant": "507f1f77bcf86cd799439051",
      "quantity": 1
    }
  ],
  "reason": "defective-product",
  "notes": "Screen not working - customer returning item"
}
```

**Refund Reasons:**
- `customer-request` - General customer refund request
- `defective-product` - Product is defective
- `wrong-item` - Wrong item shipped/given
- `price-adjustment` - Price adjustment/discount
- `damaged` - Item arrived damaged

**Response (200 OK):**
```json
{
  "success": true,
  "refund": {
    "_id": "507f1f77bcf86cd799439210",
    "saleId": "507f1f77bcf86cd799439200",
    "refundAmount": 1299.99,
    "items": [
      {
        "variant": "507f1f77bcf86cd799439051",
        "quantity": 1
      }
    ],
    "status": "processed",
    "refundMethod": "original_payment",
    "processedAt": "2026-01-22T22:05:00Z"
  }
}
```

**Request Body - Amount-Based Refund:**
```json
{
  "refundType": "amount",
  "amount": 50.00,
  "reason": "price-adjustment",
  "notes": "Applied loyalty discount"
}
```

### Full Refund

**Endpoint:** `POST /sales/:saleId/refund`

**Request Body:**
```json
{
  "refundType": "full",
  "reason": "customer-request",
  "notes": "Customer no longer wants items"
}
```

**Response:**
Entire sale amount is refunded. Sale status becomes `refunded`.

### Get Refund Details

**Endpoint:** `GET /sales/:saleId/refunds`

**Response:**
```json
{
  "success": true,
  "refunds": [
    {
      "_id": "507f1f77bcf86cd799439210",
      "refundAmount": 1299.99,
      "status": "processed",
      "processedAt": "2026-01-22T22:05:00Z"
    }
  ]
}
```

---

## Sales Reporting

### Sales Summary Report

**Endpoint:** `GET /sales/reports/summary`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `startDate` (required) - ISO 8601 format
- `endDate` (required) - ISO 8601 format
- `location` (optional) - Specific location, or "all"
- `groupBy` (optional) - day, week, month (default: day)
- `paymentMethod` (optional) - Filter by payment method

**Example:**
```
GET /sales/reports/summary?startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z&location=all&groupBy=day
```

**Response:**
```json
{
  "success": true,
  "report": {
    "period": {
      "startDate": "2026-01-01T00:00:00Z",
      "endDate": "2026-01-31T23:59:59Z"
    },
    "summary": {
      "totalSales": 45821.50,
      "totalTransactions": 156,
      "averageTransaction": 293.99,
      "totalTax": 3665.72,
      "totalRefunds": 899.99,
      "netRevenue": 44921.51
    },
    "byPaymentMethod": {
      "card": 35000.00,
      "cash": 8900.50,
      "gift_card": 1921.00
    },
    "byCatalog": {
      "flexi": 40000.00,
      "shopify": 5821.50
    },
    "dailyBreakdown": [
      {
        "date": "2026-01-22",
        "sales": 2861.96,
        "transactions": 8,
        "tax": 228.95
      }
    ]
  }
}
```

### Sales by Payment Method

**Endpoint:** `GET /sales/reports/payment-methods`

**Response:**
```json
{
  "success": true,
  "byPaymentMethod": {
    "card": {
      "total": 35000.00,
      "transactions": 120,
      "percentage": 76.4
    },
    "cash": {
      "total": 8900.50,
      "transactions": 28,
      "percentage": 19.4
    },
    "gift_card": {
      "total": 1921.00,
      "transactions": 8,
      "percentage": 4.2
    }
  }
}
```

### Sales by Catalog

**Endpoint:** `GET /sales/reports/catalog-breakdown`

**Response:**
```json
{
  "success": true,
  "byCatalog": {
    "flexi": {
      "total": 40000.00,
      "transactions": 140,
      "percentage": 87.3
    },
    "shopify": {
      "total": 5821.50,
      "transactions": 16,
      "percentage": 12.7
    }
  }
}
```

---

## Error Handling

### Common Errors

**Insufficient Inventory:**
```json
{
  "success": false,
  "error": "Insufficient inventory",
  "code": "INVENTORY_INSUFFICIENT",
  "details": {
    "requested": 5,
    "available": 2
  }
}
```

**Invalid Payment Method:**
```json
{
  "success": false,
  "error": "Payment method not supported",
  "code": "PAYMENT_METHOD_INVALID"
}
```

**Gift Card Expired:**
```json
{
  "success": false,
  "error": "Gift card has expired",
  "code": "GIFT_CARD_EXPIRED"
}
```

**Shopify Sync Error:**
```json
{
  "success": false,
  "error": "Failed to sync inventory with Shopify",
  "code": "SHOPIFY_SYNC_FAILED"
}
```

**Cannot Refund Voided Sale:**
```json
{
  "success": false,
  "error": "Cannot refund a voided sale",
  "code": "SALE_VOIDED"
}
```

---

## Best Practices

### Sales Processing

1. **Use Idempotency Keys** - Always include unique key to prevent duplicates on retry
2. **Validate Inventory** - Check stock before accepting payment
3. **Handle Shopify Sync** - Be prepared for async Shopify inventory updates
4. **Payment Verification** - Confirm payment succeeded before completing sale
5. **Audit Trail** - All sales are automatically logged with user ID and timestamp

### Refunds & Voids

1. **Same-Day Corrections** - Void sales immediately if error detected
2. **Customer Returns** - Process refund when item physically returned
3. **Partial Refunds** - Document item condition and reason for partial refunds
4. **Payment Reversals** - Allow 2-5 business days for payment method refunds
5. **Receipt Retention** - Keep receipts for refund verification

### Reporting

1. **Daily Reconciliation** - Run daily summary report to verify cash/card
2. **Catalog Tracking** - Monitor FLEXI vs Shopify sales ratio
3. **Payment Methods** - Identify trending payment preferences
4. **Tax Compliance** - Use summary report for tax filing
5. **Forecasting** - Use historical data to forecast inventory needs

---

## Related Guides

- [E-Commerce CRUD](03-E-Commerce-CRUD.md) - Manage products and inventory
- [Shopify Integration](05-Shopify-Integration.md) - Sync with Shopify catalog
- [Advanced Features](06-Advanced-Features.md) - Webhooks and event handling
