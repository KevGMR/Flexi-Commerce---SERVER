# Location-Based Access Control - Quick Reference

## 🔴 BREAKING CHANGES
**None.** Fully backward compatible.

---

## 📋 New/Updated Endpoints

### New Endpoint
```
PUT /organizations/{orgId}/members/{userId}/locations
Content-Type: application/json
Authorization: Bearer {accessToken}

Body:
{
  "locations": ["loc1", "loc2"]
}

Response: 200 OK
{
  "message": "Locations updated successfully",
  "locations": ["loc1", "loc2"]
}
```

**Access:** Owner/Manager only
**Purpose:** Assign locations to a user

---

### Updated Endpoints (Responses Changed)

| Endpoint | Change | New Field |
|----------|--------|-----------|
| `POST /users/login` | Response includes locations | `organization.locations: [String]` |
| `GET /users/organizations` | Response includes locations | `organizations[].locations: [String]` |
| `POST /users/switch-organization` | Response includes locations | `organization.locations: [String]` |
| `POST /organizations/{orgId}/invite` | Now accepts locations param | `locations?: [String]` in body |
| `POST /sales` | Location access validated | Middleware enforces access |
| `GET /sales` | Filtered by user's locations | Auto-filters results |
| `POST /inventory` | Location access validated | Middleware enforces access |
| `GET /inventory` | Filtered by user's locations | Auto-filters results |
| `PUT /inventory/{variantId}/{locationId}/adjust` | Location access validated | Middleware enforces access |

---

## 🚀 Quick Start - Backend

### 1. Model Change
[Invitation.js](../server/models/Invitation.js) - Added:
```javascript
locations: {
  type: [String],
  default: []
}
```

### 2. Middleware
[locationAccess.js](../server/middleware/locationAccess.js) - New file
- Validates `req.body.locationId` or `req.params.locationId`
- Bypasses Owner/Manager
- Returns 403 with `code: "LOCATION_ACCESS_DENIED"` if no access

### 3. Controllers Updated
- [Organization.js](../server/controllers/Organization.js) - New endpoint + validation in invite
- [User.js](../server/controllers/User.js) - Include locations in auth responses
- [Sales.js](../server/controllers/Sales.js) - Middleware + location filtering
- [Inventory.js](../server/controllers/Inventory.js) - Middleware + location filtering

---

## 🎨 Quick Start - Frontend

### Auth Changes
```javascript
// Login response now includes locations
const { organization } = loginResponse;
const { locations } = organization;

// locations.length === 0 = full org access
// locations.length > 0 = restricted to those location IDs
```

### Location Picker Logic
```javascript
if (locations.length === 0) {
  // Owner/Manager - show all org locations
  showAllLocations();
} else if (locations.length === 1) {
  // Auto-select single location
  selectLocation(locations[0]);
} else {
  // Show picker with available locations
  showLocationPicker(locations);
}
```

### Error Handling
```javascript
if (error.code === 'LOCATION_ACCESS_DENIED') {
  // User tried to transact at unauthorized location
  showAlert('You do not have access to this location');
  resetLocationPicker();
}
```

---

## 🔐 Access Control Matrix

| Action | Owner | Manager | Cashier (No Restrictions) | Cashier (Restricted) |
|--------|-------|---------|-------------------------|----------------------|
| View All Sales | ✅ | ✅ | ✅ | ❌ (Only assigned locs) |
| Create Sale | ✅ Any Loc | ✅ Any Loc | ✅ Any Loc | ✅ Assigned only |
| View All Inventory | ✅ | ✅ | ✅ | ❌ (Only assigned locs) |
| Adjust Inventory | ✅ Any Loc | ✅ Any Loc | ✅ Any Loc | ✅ Assigned only |
| Assign Locations | ✅ | ✅ | ❌ | ❌ |
| Invite Users | ✅ | ✅ | ❌ | ❌ |

**Notes:**
- "No Restrictions" = `locations: []` (empty array)
- "Restricted" = `locations: ["loc1", "loc2"]` (non-empty array)
- Owners/Managers always bypass location restrictions
- Restriction applies to same role - a Manager cannot assign locations to other Managers

---

## 📊 Data Flow

```
User Login
  ↓
  ├─→ Server returns: locations = []
  │   ├─→ Frontend: Show all org locations
  │   └─→ Behavior: Full org access
  │
  └─→ Server returns: locations = ["loc1", "loc2"]
      ├─→ Frontend: Show only loc1, loc2 in picker
      └─→ Behavior: Restrict sales/inventory to loc1, loc2

POS Transaction (Create Sale)
  ↓
  ├─→ Frontend validates: locationId in user.locations
  │   └─→ If invalid: Show error, block request
  │
  └─→ Backend validates via middleware
      ├─→ User has access: Continue
      └─→ User lacks access: 403 LOCATION_ACCESS_DENIED
```

---

## 🔄 Environment Variables

No new env vars needed. Use existing:
```
API_URL=http://localhost:9200
NODE_ENV=production
```

---

## 📝 Migration Path

### For Existing Users
1. ✅ All existing users work unchanged (locations = [] = full access)
2. To restrict: Use new `PUT /organizations/{orgId}/members/{userId}/locations` endpoint
3. ✅ No force migration required

### For New Users
1. When inviting, optionally include `locations` array
2. If not provided: User gets full org access (backward compatible)

---

## 🧪 Postman Updates

**New Request Added:**
- `PUT /organizations/{orgId}/members/{userId}/locations`

**Updated Requests:**
- `POST /organizations/{orgId}/invite` - body now includes `locations: [...]`
- `POST /users/login` - response shows `locations`
- `GET /users/organizations` - response shows `locations`
- `POST /users/switch-organization` - response shows `locations`

All in: [POSTMAN_MASTER_COLLECTION.json](../server/POSTMAN_MASTER_COLLECTION.json)

---

## ❓ FAQ

**Q: Will this break my existing code?**
A: No. Empty locations array = current behavior. Fully backward compatible.

**Q: Can I roll this out gradually?**
A: Yes. Only assign locations to users you want to restrict. Others work unchanged.

**Q: What if I assign someone to 0 locations?**
A: They can't access any location. Use empty array or null for full access.

**Q: Can employees remove their location restrictions?**
A: No. Only Owner/Manager can change location assignments.

**Q: Does location restrict other org features?**
A: No, only Sales and Inventory. Org settings, products, etc. are org-level.

---

## 📚 Full Documentation

- Backend detailed spec: [LOCATION_ACCESS_CONTROL_UPDATES.md](./LOCATION_ACCESS_CONTROL_UPDATES.md)
- Frontend implementation: [FRONTEND_IMPLEMENTATION_GUIDE.md](./FRONTEND_IMPLEMENTATION_GUIDE.md)
