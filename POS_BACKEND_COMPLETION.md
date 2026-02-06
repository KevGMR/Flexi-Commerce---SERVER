# POS Backend Completion Summary

## Overview
Completed critical POS backend features before moving to client-side development:

1. ✅ Inventory reversal on void/refund
2. ✅ Queue location preservation
3. ✅ Permission enforcement on Sales routes  
4. ✅ Background retry worker (already enabled)

---

## 1. Inventory Reversal Implementation

### Void Sale Inventory Reversal
**File:** [server/controllers/Sales.js](server/controllers/Sales.js)

Added `reverseInventoryUpdates()` helper function that:
- Restores FLEXI inventory (adds back quantities)
- Queues Shopify inventory reversals (positive quantity adjustments)
- Respects location mapping for Shopify updates

**Void Endpoint:**
```javascript
// After status update
await reverseInventoryUpdates(sale, organizationId);
```

### Refund Sale Inventory Reversal
**File:** [server/controllers/Sales.js](server/controllers/Sales.js)

**Logic:**
- Full refunds: Restore all inventory via `reverseInventoryUpdates()`
- Partial refunds: Skip inventory reversal (complex - which items returned?)

```javascript
if (!isPartial) {
  await reverseInventoryUpdates(sale, organizationId);
}
```

### Helper Function
```javascript
async function reverseInventoryUpdates(sale, organizationId) {
  const flexiLocation = await Location.findOne({ 
    _id: sale.locationId, 
    organizationId 
  });
  
  const connection = await ShopifyConnection.findOne({ organizationId });
  
  for (const item of sale.items) {
    if (item.type === 'flexi') {
      // Restore FLEXI inventory
      const inventory = await Inventory.findOne({ 
        productId: item.productId, 
        locationId: sale.locationId 
      });
      
      if (inventory) {
        inventory.quantity += item.quantity;
        await inventory.save();
      }
    } else if (item.type === 'shopify' && connection) {
      // Queue Shopify reversal (positive = restock)
      await updateShopifyInventory(
        organizationId,
        item.shopifyVariantId,
        +item.quantity, // Positive = add back
        sale._id,
        flexiLocation?.shopifyLocationId
      );
    }
  }
}
```

---

## 2. Queue Location Preservation

### Issue
Retry queue items needed `shopifyLocationId` to target correct Shopify location on retry.

### Fix
**File:** [server/services/shopifySync.js](server/services/shopifySync.js)

Updated `updateShopifyInventory()` catch block to pass location:

```javascript
await queueInventoryUpdate(
  organizationId,
  shopifyProductId,
  shopifyVariantId,
  quantityChange,
  null, // newQuantity will be calculated during retry
  saleId,
  shopifyLocationId // ✅ Now passed for retry consistency
);
```

### Verification
- `queueInventoryUpdate()` accepts `locationId` parameter (already implemented)
- `processQueueItem()` uses `queueItem.inventoryUpdate.locationId` (already implemented)
- All callers now pass `shopifyLocationId`

---

## 3. Permission Enforcement

### Added Permission Checks
**File:** [server/controllers/Sales.js](server/controllers/Sales.js)

```javascript
const permissionCheck = require('../middleware/permissionCheck');

// Routes with permissions
router.post('/', permissionCheck('create_sale'), createSale);
router.get('/reports/summary', permissionCheck('view_reports'), getSalesSummary);
router.get('/:id', permissionCheck('view_sale'), getSale);
router.get('/', permissionCheck('view_sale'), listSales);
router.post('/:id/void', permissionCheck('refund_sale'), voidSale);
router.post('/:id/refund', permissionCheck('refund_sale'), refundSale);
```

### Permission Matrix

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `POST /sales` | `create_sale` | Create new sale |
| `GET /sales/:id` | `view_sale` | View single sale |
| `GET /sales` | `view_sale` | List all sales |
| `POST /sales/:id/void` | `refund_sale` | Void sale + restore inventory |
| `POST /sales/:id/refund` | `refund_sale` | Refund sale + restore inventory (full only) |
| `GET /sales/reports/summary` | `view_reports` | Sales analytics |

### Middleware Chain
All sales routes go through:
1. `verifyToken` - JWT authentication
2. `checkUserStatus` - User active check
3. `permissionCheck(permission)` - Role-based authorization

---

## 4. Background Retry Worker

### Status
✅ **Already enabled and running**

### Configuration
**File:** [server/workers/shopifyRetryWorker.js](server/workers/shopifyRetryWorker.js)

- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **Function:** Processes failed Shopify inventory updates from queue
- **Location-aware:** Uses `queueItem.inventoryUpdate.locationId` for retries

**Started in:** [server/index.js](server/index.js#L85)
```javascript
shopifyRetryWorker.start();
```

### Worker Features
- Skip-lock prevents overlapping jobs
- Processes queue items with exponential backoff
- Updates `shopifyLocationId` from queue for retry consistency
- Logs processing time and item count

---

## Testing Checklist

### 1. Void Sale Test
- [ ] Create sale with FLEXI + Shopify items
- [ ] Check inventory deducted in both systems
- [ ] Void sale
- [ ] Verify inventory restored in both systems
- [ ] Check ShopifySyncLog for reversal entries

### 2. Refund Sale Test (Full)
- [ ] Create sale with FLEXI + Shopify items
- [ ] Check inventory deducted
- [ ] Refund full amount
- [ ] Verify inventory restored

### 3. Refund Sale Test (Partial)
- [ ] Create sale
- [ ] Refund partial amount
- [ ] Verify inventory NOT restored (expected behavior)
- [ ] Status = `partial_refund`

### 4. Location Preservation Test
- [ ] Map FLEXI location to specific Shopify location
- [ ] Create sale that fails Shopify sync (disconnect network)
- [ ] Check queue item has `locationId` field
- [ ] Wait for worker to retry (or trigger manually)
- [ ] Verify retry targets correct Shopify location

### 5. Permission Test
- [ ] Create user with `Cashier` role (has `create_sale`, no `view_reports`)
- [ ] Attempt `POST /sales` → Should succeed
- [ ] Attempt `GET /sales/reports/summary` → Should fail 403
- [ ] Create user with `Owner` role → All endpoints succeed

### 6. Idempotency Test
- [ ] Create sale with idempotency key
- [ ] Submit same request again
- [ ] Verify returns existing sale (200, not 201)
- [ ] Check database has only 1 sale record

### 7. Worker Test
- [ ] Check server logs for `[Shopify Retry Worker] Started`
- [ ] Create sale with network disconnected
- [ ] Verify item added to ShopifySyncQueue
- [ ] Wait 5 minutes or trigger manual run
- [ ] Check ShopifySyncLog for successful retry

---

## Files Modified

1. **[server/controllers/Sales.js](server/controllers/Sales.js)**
   - Added `permissionCheck` import
   - Added `reverseInventoryUpdates()` helper function
   - Updated `voidSale()` to call reversal function
   - Updated `refundSale()` to call reversal function (full refunds only)
   - Added permission checks to all routes

2. **[server/services/shopifySync.js](server/services/shopifySync.js)**
   - Updated `queueInventoryUpdate()` call to pass `shopifyLocationId`

---

## Next Steps

### Before Client Development
- [x] Void/refund inventory reversal
- [x] Queue location preservation  
- [x] Permission enforcement
- [x] Background worker enabled
- [ ] **Run full testing suite** (see checklist above)
- [ ] Document any edge cases discovered during testing

### Client-Side POS (React)
Once backend testing is complete, start implementing:
1. POS cart interface
2. Product search/scan
3. Payment processing UI
4. Receipt generation
5. Void/refund UI
6. Offline mode (idempotency key generation)
7. Network retry indicators

---

## Permissions Reference

### Default Roles
**Owner:** All permissions  
**Manager:** All except user management  
**Cashier:** `create_sale`, `view_sale`, `refund_sale`  
**Employee:** `view_sale` only

### Sales-Specific Permissions
- `create_sale` - Create new sales
- `view_sale` - View sale details/list
- `refund_sale` - Void or refund sales
- `view_reports` - Access sales analytics

---

## Known Limitations

1. **Partial Refund Inventory:**  
   Currently skips inventory reversal on partial refunds (complex logic - which items were returned?).  
   Future: Add item-level refund tracking.

2. **Concurrent Voids:**  
   No locking mechanism if same sale voided by 2 users simultaneously.  
   Consider adding sale-level locking or status transition validation.

3. **Network Failure During Void:**  
   If void succeeds but Shopify reversal fails, inventory will be in queue.  
   Sale status = `voided`, but Shopify inventory restored on next worker run.

---

## Production Deployment Notes

### Environment Variables
Ensure these are set:
- `JWT_SECRET` - Token signing
- `ENCRYPTION_KEY` - Shopify credential encryption (32 bytes hex)
- `NODE_ENV=production` - Production mode

### Database Indexes
Required compound indexes (already created):
```javascript
// Sale model
{ organizationId: 1, idempotencyKey: 1 } // unique, sparse

// Location model
{ organizationId: 1, name: 1 } // unique
```

### Worker Monitoring
Monitor worker logs for:
- `[Shopify Retry Worker] Started` on server start
- Processing times (should be < 5 min)
- Failed retries after max attempts

### Rate Limiting
Shopify API has rate limits:
- **REST:** 2 requests/second
- **GraphQL:** Cost-based (monitor cost field in responses)

Worker processes queue items sequentially to respect limits.

---

## Support

For issues or questions:
1. Check `ShopifySyncLog` collection for error details
2. Review server logs for worker activity
3. Verify location mapping: `GET /locations/shopify/available-locations`
4. Test permissions: Check user's role has required permission
