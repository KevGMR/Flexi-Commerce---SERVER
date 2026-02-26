# Delivery Fee System - Testing Guide

**Complete testing guide for FLEXI-POS Delivery Fee Management System**

Last Updated: February 7, 2026

> **New in this version:** Comprehensive testing scenarios for customizable Delivery Categories system including Shop Pickup, Local Delivery, Pickup Mtaani, and Matatu/Saccos with custom status workflows and pricing.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup](#setup)
3. [Test Scenarios](#test-scenarios)
4. [Integration Testing](#integration-testing)
5. [Permissions Testing](#permissions-testing)
6. [Troubleshooting](#troubleshooting)
7. [Verification Checklist](#verification-checklist)

---

## Prerequisites

### Required Setup
- ✅ Server running on `http://localhost:9200`
- ✅ MongoDB connected and accessible
- ✅ User account created and verified
- ✅ Organization created
- ✅ At least one location created
- ✅ At least one product created (for sales with delivery)
- ✅ Access token obtained from login

### Import Postman Collection
1. Open Postman
2. Import `FLEXI-POS Delivery Fees.postman_collection.json`
3. Import your environment or create new with these variables:
   ```
   baseUrl: http://localhost:9200
   accessToken: <your-jwt-token>
   locationId: <your-location-id>
   productId: <your-product-id>
   ```

---

## Setup

### Step 1: Configure Location Delivery Settings

**Request:** `PATCH /locations/:locationId/delivery-settings`

```json
{
  "enableDeliveryFees": true,
  "taxDeliveryFees": true,
  "standardFee": 5.00,
  "expressFee": 10.00,
  "overnightFee": 15.00,
  "defaultFeeType": "standard",
  "allowCustomFees": true
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Delivery settings updated successfully",
  "deliveryFeeSettings": {
    "enableDeliveryFees": true,
    "taxDeliveryFees": true,
    "standardFee": 5,
    "expressFee": 10,
    "overnightFee": 15,
    "defaultFeeType": "standard",
    "allowCustomFees": true
  }
}
```

**Verification:**
- Settings are saved correctly
- Fee amounts match what you configured
- Tax setting is applied

### Step 2: Verify Location Settings

**Request:** `GET /locations/:locationId`

**Expected Response:** Should include `deliveryFeeSettings` object

---

## Test Scenarios

### Scenario 1: Create Standalone Delivery Fees

#### Test 1.1: Standard Delivery
**Request:** `POST /delivery-fees`

```json
{
  "locationId": "{{locationId}}",
  "feeType": "standard",
  "recipientName": "John Doe",
  "recipientPhone": "+254712345678",
  "recipientEmail": "john.doe@example.com",
  "deliveryAddress": {
    "street": "123 Kenyatta Avenue",
    "city": "Nairobi",
    "state": "Nairobi County",
    "postalCode": "00100",
    "country": "Kenya",
    "landmark": "Near City Market"
  },
  "deliveryInstructions": "Call upon arrival",
  "notes": "Fragile items"
}
```

**Expected Response:** `201 Created`
```json
{
  "success": true,
  "message": "Delivery fee created successfully",
  "data": {
    "_id": "...",
    "trackingNumber": "DEL-...",
    "feeType": "standard",
    "amount": 5,
    "taxAmount": 0.8,  // If tax rate is 16%
    "totalAmount": 5.8,
    "status": "pending",
    "recipientName": "John Doe",
    "deliveryAddress": {...}
  }
}
```

**Verify:**
- ✅ Tracking number auto-generated
- ✅ Fee amount matches location's standard fee
- ✅ Tax calculated correctly (if enabled)
- ✅ Total = amount + tax
- ✅ Status is "pending"
- ✅ Address fields saved correctly

#### Test 1.2: Express Delivery
Change `feeType` to `"express"` and verify:
- ✅ Amount = 10.00 (expressFee)
- ✅ Tax calculated on 10.00
- ✅ Total = 10.00 + tax

#### Test 1.3: Overnight Delivery
Change `feeType` to `"overnight"` and verify:
- ✅ Amount = 15.00 (overnightFee)
- ✅ Tax calculated on 15.00
- ✅ Total = 15.00 + tax

#### Test 1.4: Custom Delivery Fee
```json
{
  "locationId": "{{locationId}}",
  "feeType": "custom",
  "customAmount": 25.00,
  "isTaxable": false,
  "recipientName": "Alice Johnson",
  "recipientPhone": "+254723456789",
  "deliveryAddress": {
    "street": "789 Uhuru Highway",
    "city": "Nairobi",
    "country": "Kenya"
  }
}
```

**Verify:**
- ✅ Amount = 25.00 (custom amount)
- ✅ Tax = 0 (isTaxable: false)
- ✅ Total = 25.00

#### Test 1.5: Validation - Missing Required Fields
Try creating delivery without `recipientName`:

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Missing required fields: locationId, feeType, deliveryAddress, recipientName, recipientPhone"
}
```

#### Test 1.6: Validation - Incomplete Address
Try with address missing `street`:

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Delivery address must include street, city, and country"
}
```

#### Test 1.7: Validation - Custom Fee Without Amount
```json
{
  "feeType": "custom"
  // missing customAmount
}
```

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Custom fee amount is required for custom fee type"
}
```

---

### Scenario 2: List and Filter Deliveries

#### Test 2.1: List All Deliveries
**Request:** `GET /delivery-fees?page=1&limit=20`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "pages": 1
  }
}
```

**Verify:**
- ✅ Returns array of deliveries
- ✅ Pagination info correct
- ✅ Location populated
- ✅ Sale populated (if linked)

#### Test 2.2: Filter by Status
**Request:** `GET /delivery-fees?status=pending`

**Verify:**
- ✅ Only returns deliveries with "pending" status
- ✅ No deliveries with other statuses

#### Test 2.3: Filter by Location
**Request:** `GET /delivery-fees?locationId={{locationId}}`

**Verify:**
- ✅ Only returns deliveries for specified location

#### Test 2.4: Filter by Date Range
**Request:** `GET /delivery-fees?startDate=2026-02-01&endDate=2026-02-07`

**Verify:**
- ✅ Only returns deliveries created within date range

#### Test 2.5: Get Single Delivery
**Request:** `GET /delivery-fees/{{deliveryFeeId}}`

**Expected Response:** `200 OK` with full delivery details including:
- ✅ Populated location reference
- ✅ Populated sale reference (if linked)
- ✅ Populated driver reference (if assigned)
- ✅ Populated createdBy reference

---

### Scenario 3: Driver Assignment

#### Test 3.1: Assign Driver to Pending Delivery
**Request:** `PATCH /delivery-fees/{{deliveryFeeId}}/assign`

```json
{
  "driverId": "{{driverId}}"
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Driver assigned successfully",
  "data": {
    "status": "assigned",
    "driverId": "...",
    "assignedAt": "2026-02-07T..."
  }
}
```

**Verify:**
- ✅ Status changed to "assigned"
- ✅ driverId field populated
- ✅ assignedAt timestamp set
- ✅ Linked sale's deliveryStatus updated (if applicable)

#### Test 3.2: Reassign Driver
Assign a different driver to the same delivery:

**Verify:**
- ✅ driverId updated to new driver
- ✅ Status remains "assigned"
- ✅ assignedAt timestamp updated

#### Test 3.3: Validation - Invalid Driver ID
```json
{
  "driverId": "invalid-id-12345"
}
```

**Expected Response:** `404 Not Found`
```json
{
  "success": false,
  "message": "Driver not found"
}
```

---

### Scenario 4: Status Workflow

#### Test 4.1: Update to In Transit
**Request:** `PATCH /delivery-fees/{{deliveryFeeId}}/status`

```json
{
  "status": "in_transit"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Status = "in_transit"
- ✅ pickedUpAt timestamp set
- ✅ Linked sale's deliveryStatus updated

#### Test 4.2: Update to Delivered
```json
{
  "status": "delivered",
  "receivedByName": "John Doe",
  "signatureUrl": "https://example.com/signature.png",
  "photoUrl": "https://example.com/proof.jpg"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Status = "delivered"
- ✅ deliveredAt timestamp set
- ✅ actualDelivery timestamp set
- ✅ receivedByName saved
- ✅ signatureUrl saved
- ✅ photoUrl saved
- ✅ Linked sale's deliveryStatus = "delivered"

#### Test 4.3: Update to Failed
```json
{
  "status": "failed",
  "failReason": "Recipient not available after 3 attempts"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Status = "failed"
- ✅ failReason saved

#### Test 4.4: Update to Cancelled
```json
{
  "status": "cancelled",
  "cancelReason": "Customer requested cancellation"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Status = "cancelled"
- ✅ cancelledAt timestamp set
- ✅ cancelReason saved

#### Test 4.5: Validation - Invalid Status Transition
Try changing delivered delivery back to "pending":

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Cannot transition from delivered to pending"
}
```

#### Test 4.6: Validation - Invalid Status Value
```json
{
  "status": "invalid_status"
}
```

**Expected Response:** `400 Bad Request`

---

### Scenario 5: Update Delivery Details

#### Test 5.1: Update Address and Contact
**Request:** `PATCH /delivery-fees/{{deliveryFeeId}}`

```json
{
  "deliveryAddress": {
    "street": "456 Updated Street",
    "city": "Nairobi",
    "country": "Kenya"
  },
  "recipientPhone": "+254700000000",
  "notes": "Updated delivery instructions"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Address updated
- ✅ Phone updated
- ✅ Notes updated
- ✅ Other fields unchanged

#### Test 5.2: Validation - Cannot Update Delivered Delivery
Try updating a delivery with status "delivered":

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Cannot update delivery fee with status: delivered"
}
```

---

### Scenario 6: Cancel Delivery

#### Test 6.1: Cancel Pending Delivery
**Request:** `DELETE /delivery-fees/{{deliveryFeeId}}`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Delivery fee cancelled successfully",
  "data": {
    "status": "cancelled",
    "cancelledAt": "2026-02-07T...",
    "cancelReason": "Cancelled by user"
  }
}
```

**Verify:**
- ✅ Status changed to "cancelled"
- ✅ cancelledAt timestamp set
- ✅ Record still exists (soft delete)
- ✅ Linked sale updated

#### Test 6.2: Validation - Cannot Cancel Delivered
Try cancelling a delivered delivery:

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Cannot delete delivered delivery fee"
}
```

---

### Scenario 7: Delivery Statistics

#### Test 7.1: Get Overall Statistics
**Request:** `GET /delivery-fees/stats`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "statusCounts": {
      "pending": 3,
      "assigned": 2,
      "in_transit": 1,
      "delivered": 5,
      "cancelled": 1
    },
    "revenueByType": [
      {
        "_id": "standard",
        "totalRevenue": 29,
        "count": 5,
        "avgFee": 5.8
      },
      {
        "_id": "express",
        "totalRevenue": 23.2,
        "count": 2,
        "avgFee": 11.6
      }
    ],
    "totalRevenue": 52.2,
    "avgDeliveryTimeMs": 7200000,
    "avgDeliveryTimeHours": "2.00"
  }
}
```

**Verify:**
- ✅ Status counts accurate
- ✅ Revenue by type calculated
- ✅ Total revenue correct
- ✅ Average delivery time calculated

#### Test 7.2: Get Stats by Location
**Request:** `GET /delivery-fees/stats?locationId={{locationId}}`

**Verify:**
- ✅ Only includes deliveries from specified location

#### Test 7.3: Get Stats by Date Range
**Request:** `GET /delivery-fees/stats?startDate=2026-02-01&endDate=2026-02-07`

**Verify:**
- ✅ Only includes deliveries within date range

---

### Scenario 10: Delivery Categories System

#### Test 10.1: Create Shop Pickup Category
**Request:** `POST /locations/:locationId/delivery-categories`

```json
{
  "categoryName": "Shop Pickup",
  "description": "Customer picks up items from store",
  "statusWorkflow": [
    { "status": "pending", "label": "Order Received", "color": "#FFA500" },
    { "status": "ready_for_pickup", "label": "Ready for Pickup", "color": "#4169E1" },
    { "status": "picked_up", "label": "Picked Up", "color": "#32CD32" }
  ],
  "childOptions": [
    { "optionName": "Standard Pickup", "price": 0, "description": "Pick up within 24 hours", "isActive": true },
    { "optionName": "Express Pickup", "price": 2.50, "description": "Ready within 2 hours", "isActive": true }
  ],
  "isActive": true
}
```

**Expected Response:** `201 Created`
```json
{
  "success": true,
  "message": "Delivery category created successfully",
  "category": {
    "categoryName": "Shop Pickup",
    "statusWorkflow": [...],
    "childOptions": [...],
    "isActive": true
  }
}
```

**Verify:**
- ✅ Category created with correct name
- ✅ Status workflow contains 3 statuses
- ✅ Child options array contains 2 options
- ✅ `categoryId` captured in environment

#### Test 10.2: Create Local Delivery Category
**Request:** `POST /locations/:locationId/delivery-categories`

```json
{
  "categoryName": "Local Delivery",
  "description": "Door-to-door delivery within city",
  "statusWorkflow": [
    { "status": "pending", "label": "Order Placed", "color": "#FFA500" },
    { "status": "assigned", "label": "Driver Assigned", "color": "#9370DB" },
    { "status": "out_for_delivery", "label": "Out for Delivery", "color": "#4169E1" },
    { "status": "completed", "label": "Delivered", "color": "#32CD32" },
    { "status": "failed", "label": "Delivery Failed", "color": "#FF4500" }
  ],
  "childOptions": [
    { "optionName": "Standard Delivery", "price": 5.00, "description": "Delivery within 24 hours", "isActive": true },
    { "optionName": "Express Delivery", "price": 15.00, "description": "Same-day delivery", "isActive": true }
  ],
  "isActive": true
}
```

**Expected Response:** `201 Created`

**Verify:**
- ✅ Category created with 5-step workflow
- ✅ Two delivery options with different prices

#### Test 10.3: Create Matatu/Saccos Category
**Request:** `POST /locations/:locationId/delivery-categories`

```json
{
  "categoryName": "Matatu/Saccos",
  "description": "Package delivery via public transport",
  "statusWorkflow": [
    { "status": "pending", "label": "Package Received", "color": "#FFA500" },
    { "status": "in_transit", "label": "In Transit", "color": "#4169E1" },
    { "status": "ready_for_collection", "label": "Ready for Collection", "color": "#9370DB" },
    { "status": "collected", "label": "Collected", "color": "#32CD32" }
  ],
  "childOptions": [
    { "optionName": "Route 45 - Nairobi-Kiambu", "price": 3.00, "description": "Daily route", "isActive": true },
    { "optionName": "Route 111 - Nairobi-Thika", "price": 5.00, "description": "Daily route", "isActive": true },
    { "optionName": "Route 237 - Nairobi-Ngong", "price": 4.00, "description": "Daily route", "isActive": true }
  ],
  "isActive": true
}
```

**Expected Response:** `201 Created`

**Verify:**
- ✅ Category created with 4-step workflow
- ✅ Three route options with location-based pricing

#### Test 10.4: List All Categories
**Request:** `GET /locations/:locationId/delivery-categories`

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "categories": [
    { "categoryName": "Shop Pickup", "childOptions": [...], "isActive": true },
    { "categoryName": "Local Delivery", "childOptions": [...], "isActive": true },
    { "categoryName": "Matatu/Saccos", "childOptions": [...], "isActive": true }
  ]
}
```

**Verify:**
- ✅ All 3 categories returned
- ✅ Each category has child options array
- ✅ Status workflows included

#### Test 10.5: Update Category Workflow
**Request:** `PATCH /locations/:locationId/delivery-categories/:categoryId/workflow`

```json
{
  "statusWorkflow": [
    { "status": "pending", "label": "Order Received", "color": "#FFA500" },
    { "status": "preparing", "label": "Preparing Order", "color": "#FFD700" },
    { "status": "ready_for_pickup", "label": "Ready for Pickup", "color": "#4169E1" },
    { "status": "picked_up", "label": "Picked Up", "color": "#32CD32" },
    { "status": "cancelled", "label": "Cancelled", "color": "#DC143C" }
  ]
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Workflow updated with new "preparing" step
- ✅ New "cancelled" status added

#### Test 10.6: Add Child Option to Category
**Request:** `POST /locations/:locationId/delivery-categories/:categoryId/options`

```json
{
  "optionName": "Priority Pickup",
  "price": 5.00,
  "description": "Ready within 1 hour",
  "isActive": true
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ New option added to category
- ✅ `optionId` captured

#### Test 10.7: Update Child Option
**Request:** `PATCH /locations/:locationId/delivery-categories/:categoryId/options/:optionId`

```json
{
  "price": 7.50,
  "description": "Ready within 30 minutes"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Option price updated
- ✅ Option description updated

#### Test 10.8: Deactivate Child Option
**Request:** `PATCH /locations/:locationId/delivery-categories/:categoryId/options/:optionId`

```json
{
  "isActive": false
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Option deactivated (not deleted)
- ✅ Still visible in category but marked inactive

#### Test 10.9: Create Delivery with Category
**Request:** `POST /delivery-fees`

```json
{
  "locationId": "{{locationId}}",
  "deliveryCategory": "Shop Pickup",
  "deliveryOption": "Standard Pickup",
  "recipientName": "Michael Ouma",
  "recipientPhone": "+254711223344",
  "recipientEmail": "michael.ouma@example.com",
  "deliveryInstructions": "Call when ready",
  "notes": "Fragile items"
}
```

**Expected Response:** `201 Created`
```json
{
  "success": true,
  "message": "Delivery fee created successfully",
  "deliveryFee": {
    "deliveryCategory": "Shop Pickup",
    "deliveryOption": "Standard Pickup",
    "categoryStatus": "pending",
    "amount": 0,
    "trackingNumber": "DF-XXXXXX"
  }
}
```

**Verify:**
- ✅ Delivery created with category and option
- ✅ Initial `categoryStatus` is "pending"
- ✅ Amount matches option price (0 for Standard Pickup)
- ✅ No `feeType` field (category-based, not legacy)

#### Test 10.10: Update Category Status - Ready for Pickup
**Request:** `PATCH /delivery-fees/:deliveryFeeId/status`

```json
{
  "categoryStatus": "ready_for_pickup"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Status updated to "ready_for_pickup"
- ✅ Follows Shop Pickup workflow (pending → ready_for_pickup)

#### Test 10.11: Update Category Status - Picked Up
**Request:** `PATCH /delivery-fees/:deliveryFeeId/status`

```json
{
  "categoryStatus": "picked_up",
  "receivedByName": "Michael Ouma",
  "signatureUrl": "https://example.com/signatures/pickup123.png"
}
```

**Expected Response:** `200 OK`

**Verify:**
- ✅ Status updated to "picked_up"
- ✅ Proof of pickup captured
- ✅ Follows workflow (ready_for_pickup → picked_up)

#### Test 10.12: Invalid Status Transition
**Request:** `PATCH /delivery-fees/:deliveryFeeId/status`

```json
{
  "categoryStatus": "picked_up"
}
```
(Assuming current status is "pending", skipping "ready_for_pickup")

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Invalid status transition"
}
```

**Verify:**
- ✅ System enforces workflow order
- ✅ Cannot skip steps in custom workflow

#### Test 10.13: Create Delivery with Non-Existent Category
**Request:** `POST /delivery-fees`

```json
{
  "locationId": "{{locationId}}",
  "deliveryCategory": "Non-Existent Category",
  "deliveryOption": "Some Option",
  "recipientName": "Test User",
  "recipientPhone": "+254700000000"
}
```

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Delivery category not found or inactive"
}
```

**Verify:**
- ✅ Validation prevents invalid category
- ✅ Clear error message

#### Test 10.14: Create Delivery with Non-Existent Option
**Request:** `POST /delivery-fees`

```json
{
  "locationId": "{{locationId}}",
  "deliveryCategory": "Shop Pickup",
  "deliveryOption": "Non-Existent Option",
  "recipientName": "Test User",
  "recipientPhone": "+254700000000"
}
```

**Expected Response:** `400 Bad Request`
```json
{
  "success": false,
  "message": "Delivery option not found or inactive in this category"
}
```

**Verify:**
- ✅ Validation prevents invalid option
- ✅ Category validation passed but option failed

#### Test 10.15: Delete Category Option
**Request:** `DELETE /locations/:locationId/delivery-categories/:categoryId/options/:optionId`

**Expected Response:** `200 OK`

**Verify:**
- ✅ Option removed from category
- ✅ Existing deliveries using this option are unaffected

#### Test 10.16: Delete Category
**Request:** `DELETE /locations/:locationId/delivery-categories/:categoryId`

**Expected Response:** `200 OK`

**Verify:**
- ✅ Category removed from location
- ✅ All child options removed
- ✅ Existing deliveries using this category are unaffected

#### Test 10.17: Create Sale with Category Delivery
**Request:** `POST /sales`

```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "flexi",
      "productId": "{{productId}}",
      "quantity": 1,
      "unitPrice": 100.00,
      "discount": 0,
      "taxAmount": 16.00
    }
  ],
  "paymentMethod": "card",
  "deliveryInfo": {
    "requiresDelivery": true,
    "deliveryCategory": "Local Delivery",
    "deliveryOption": "Express Delivery",
    "recipientName": "Sarah Mwangi",
    "recipientPhone": "+254722334455",
    "recipientEmail": "sarah.mwangi@example.com",
    "deliveryAddress": {
      "street": "45 Ngong Road",
      "city": "Nairobi",
      "country": "Kenya"
    },
    "deliveryInstructions": "Same-day delivery"
  }
}
```

**Expected Response:** `201 Created`
```json
{
  "success": true,
  "sale": {
    "items": [...],
    "subtotal": 100,
    "taxAmount": 16,
    "deliveryFee": 15.00,
    "total": 131.00,
    "deliveryInfo": {
      "deliveryCategory": "Local Delivery",
      "deliveryOption": "Express Delivery",
      "categoryStatus": "pending",
      "trackingNumber": "DF-XXXXXX"
    }
  }
}
```

**Verify:**
- ✅ Sale created with Express Delivery ($15)
- ✅ Delivery fee added to total
- ✅ Delivery created with category and option
- ✅ Initial categoryStatus is "pending"
- ✅ Tracking number generated

---

## Integration Testing


### Scenario 8: Sales with Delivery

#### Test 8.1: Create Sale with Standard Delivery
**Request:** `POST /sales`

```json
{
  "locationId": "{{locationId}}",
  "items": [
    {
      "type": "flexi",
      "productId": "{{productId}}",
      "quantity": 2,
      "unitPrice": 50.00,
      "discount": 0,
      "taxAmount": 8.00
    }
  ],
  "paymentMethod": "card",
  "deliveryInfo": {
    "requiresDelivery": true,
    "feeType": "standard",
    "recipientName": "John Customer",
    "recipientPhone": "+254712345678",
    "recipientEmail": "john@example.com",
    "deliveryAddress": {
      "street": "123 Main Street",
      "city": "Nairobi",
      "country": "Kenya"
    }
  }
}
```

**Expected Response:** `201 Created`
```json
{
  "success": true,
  "message": "Sale created successfully",
  "data": {
    "saleId": "...",
    "receiptNumber": "REC-...",
    "totalAmount": 113.8,  // items + delivery fee + taxes
    "deliveryFeeAmount": 5.8,
    "requiresDelivery": true,
    "deliveryStatus": "pending",
    "deliveryFeeId": "...",
    "trackingNumber": "DEL-..."
  }
}
```

**Verify:**
- ✅ Sale created successfully
- ✅ Delivery fee created and linked
- ✅ totalAmount includes delivery fee
- ✅ deliveryFeeAmount matches delivery total
- ✅ deliveryStatus = "pending"
- ✅ Tracking number returned

#### Test 8.2: Verify Delivery Fee Creation
**Request:** `GET /delivery-fees/{{deliveryFeeId}}`

**Verify:**
- ✅ Delivery fee exists
- ✅ saleId points to created sale
- ✅ All delivery info saved correctly

#### Test 8.3: Verify Sale Link
**Request:** `GET /sales/{{saleId}}`

**Verify:**
- ✅ Sale.deliveryFeeId exists
- ✅ Sale.deliveryFeeAmount correct
- ✅ Sale.requiresDelivery = true
- ✅ Sale.deliveryStatus = "pending"

#### Test 8.4: Update Delivery Status from Sale
Assign driver and update status to "in_transit":

**Verify:**
- ✅ DeliveryFee.status updated
- ✅ Sale.deliveryStatus automatically updated

#### Test 8.5: Complete Delivery
Update delivery to "delivered":

**Verify:**
- ✅ DeliveryFee.status = "delivered"
- ✅ Sale.deliveryStatus = "delivered"
- ✅ Both records synchronized

#### Test 8.6: Create Sale with Express Delivery
Use `"feeType": "express"` in deliveryInfo:

**Verify:**
- ✅ Higher delivery fee applied (10.00)
- ✅ totalAmount reflects express fee

#### Test 8.7: Create Sale with Custom Delivery
```json
{
  "deliveryInfo": {
    "requiresDelivery": true,
    "feeType": "custom",
    "customAmount": 30.00,
    "isTaxable": false,
    "recipientName": "Bob Remote",
    "recipientPhone": "+254723456789",
    "deliveryAddress": {...}
  }
}
```

**Verify:**
- ✅ Custom amount used (30.00)
- ✅ No tax on delivery (isTaxable: false)
- ✅ totalAmount correct

#### Test 8.8: Create Sale WITHOUT Delivery
Omit `deliveryInfo` or set `requiresDelivery: false`:

**Verify:**
- ✅ Sale created normally
- ✅ No delivery fee created
- ✅ deliveryFeeId = null
- ✅ requiresDelivery = false
- ✅ deliveryStatus = "not_required"

---

## Permissions Testing

### Scenario 9: Role-Based Access Control

#### Test 9.1: Owner/Manager Permissions
Login as Owner or Manager:

**Should Allow:**
- ✅ Create delivery fees
- ✅ View delivery fees
- ✅ Update delivery fees
- ✅ Delete/cancel delivery fees
- ✅ Assign drivers
- ✅ Update delivery status
- ✅ View statistics

#### Test 9.2: Cashier Permissions
Login as Cashier:

**Should Allow:**
- ✅ Create delivery fees (with sales)
- ✅ View delivery fees

**Should Deny:**
- ❌ Assign drivers (403 Forbidden)
- ❌ Update delivery status (403 Forbidden)
- ❌ Delete delivery fees (403 Forbidden)

#### Test 9.3: Employee Permissions
Login as Employee:

**Should Allow:**
- ✅ View delivery fees
- ✅ Update delivery status (for driver role)

**Should Deny:**
- ❌ Create delivery fees (403 Forbidden)
- ❌ Assign drivers (403 Forbidden)
- ❌ Delete delivery fees (403 Forbidden)

#### Test 9.4: Test Permission Denial
Try accessing endpoint without permission:

**Expected Response:** `403 Forbidden`
```json
{
  "success": false,
  "message": "Permission denied: delivery_fees.create"
}
```

---

## Troubleshooting

### Common Issues

#### Issue 1: "Delivery fees are not enabled for this location"
**Solution:** Configure location delivery settings first (Step 1 in Setup)

#### Issue 2: "Custom fees are not allowed for this location"
**Solution:** Set `allowCustomFees: true` in location delivery settings

#### Issue 3: Tax not calculated correctly
**Check:**
- Location.taxRate is set
- Location.deliveryFeeSettings.taxDeliveryFees = true
- deliveryInfo.isTaxable not set to false

#### Issue 4: Sale total doesn't include delivery fee
**Check:**
- deliveryInfo.requiresDelivery = true
- Delivery fee created successfully
- Check API response for delivery fee amount

#### Issue 5: Status transition rejected
**Solution:** Review valid status transitions:
- pending → assigned → in_transit → delivered ✓
- Cannot go back from delivered to earlier states ✗
- Can cancel from pending/assigned/in_transit ✓

#### Issue 6: Driver assignment fails
**Check:**
- Driver user ID exists
- Driver belongs to organization
- Delivery is in "pending" or "assigned" status

#### Issue 7: Cannot update delivered delivery
**Solution:** This is by design. Delivered deliveries are immutable to maintain delivery history integrity.

---

## Verification Checklist

### Core Functionality
- [ ] Location delivery settings can be configured
- [ ] Standalone deliveries can be created
- [ ] All fee types work (standard, express, overnight, custom)
- [ ] Tax calculation is correct
- [ ] Tracking numbers auto-generated
- [ ] Deliveries can be listed and filtered
- [ ] Driver assignment works
- [ ] Status workflow is enforced
- [ ] Status transitions validated correctly
- [ ] Delivery details can be updated
- [ ] Deliveries can be cancelled
- [ ] Statistics are calculated correctly

### Delivery Categories System
- [ ] Delivery categories can be created
- [ ] Categories support custom status workflows
- [ ] Child options can be added to categories
- [ ] Option prices are configurable per option
- [ ] Categories can be listed and retrieved
- [ ] Category workflows can be updated
- [ ] Child options can be updated/deleted
- [ ] Categories can be activated/deactivated
- [ ] Deliveries can be created with categories
- [ ] Category status transitions are validated
- [ ] Custom workflows enforce correct order
- [ ] Invalid category/option names are rejected
- [ ] Sales can use category-based delivery
- [ ] Category pricing applied correctly in sales
- [ ] Backward compatibility with legacy feeType maintained

### Sales Integration
- [ ] Sales with delivery can be created (legacy feeType)
- [ ] Sales with category delivery can be created
- [ ] Delivery fee added to sale total
- [ ] Delivery fee record created automatically
- [ ] Sale and delivery are linked correctly
- [ ] Delivery status updates reflect in sale
- [ ] Category status updates reflect in sale
- [ ] Sales without delivery work normally

### Validation & Security
- [ ] Required fields validated
- [ ] Address completeness validated
- [ ] Status transitions validated (legacy)
- [ ] Category status transitions validated
- [ ] Cannot modify delivered deliveries
- [ ] Permissions enforced correctly
- [ ] Each role has appropriate access
- [ ] Category name uniqueness enforced per location
- [ ] Option name uniqueness enforced per category

### Data Integrity
- [ ] Deliveries linked to correct organization
- [ ] Deliveries linked to correct location
- [ ] Sale-delivery linking bidirectional
- [ ] Timestamps recorded correctly
- [ ] Audit fields populated (createdBy, lastModifiedBy)
- [ ] Existing deliveries unaffected when category deleted
- [ ] Category changes don't break existing deliveries

### Performance
- [ ] Lists paginate correctly
- [ ] Filtering works efficiently
- [ ] Statistics calculate quickly
- [ ] No duplicate indexes (check server logs)

---

## Test Reports

### Test Session Template
```
Test Date: _____________
Tester: _____________
Environment: _____________
Version: _____________

Scenarios Passed: ___/10 (includes Delivery Categories)
Total Tests Passed: ___/87+ (17 new category tests added)

Critical Issues: ___
Minor Issues: ___

Notes:
________________________
________________________
________________________
```

---

## Next Steps After Testing

1. **If All Tests Pass:**
   - ✅ Delivery system is production-ready
   - ✅ Document any custom configurations
   - ✅ Train staff on delivery workflows
   - ✅ Set up monitoring for delivery metrics

2. **If Tests Fail:**
   - 📋 Document failing scenarios
   - 🐛 Create bug reports with reproduction steps
   - 🔧 Fix issues and retest
   - ✅ Re-run full test suite

3. **Production Deployment:**
   - 📊 Monitor delivery creation rates
   - 📈 Track delivery completion times
   - 💰 Monitor delivery revenue
   - 🚨 Set up alerts for failed deliveries
   - 📱 Consider driver mobile app integration

---

**Happy Testing! 🚀**

For questions or issues, refer to the API documentation or create a support ticket.
