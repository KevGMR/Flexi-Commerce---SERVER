# Location-Based Access Control Implementation Summary

## Overview
Multi-location POS support added. Users can now be restricted to specific locations within an organization. Owners/Managers retain full access; Cashiers/Employees can be assigned to specific locations.

---

## Backend Changes

### 1. **Models**

#### Invitation.js
**Added field:**
```javascript
locations: {
  type: [String],  // Array of location IDs
  default: [],
}
```

#### UserOrganization.js
**Existing field (now actively used):**
```javascript
locations: {
  type: [String],
  default: [],  // Empty = full access (backward compatible)
}
```

---

### 2. **New Middleware**

#### server/middleware/locationAccess.js
**Function:** `validateLocationAccess`
- Validates user has access to locationId in request
- Bypasses check for Owner/Manager roles
- Empty locations array = full access (backward compatible)
- Returns 403 with `code: "LOCATION_ACCESS_DENIED"` if no access

**Usage:**
```javascript
router.post('/endpoint', validateLocationAccess, handler);
```

---

### 3. **Controllers - Updated Endpoints**

#### Organization.js

##### NEW: PUT `/organizations/:organizationId/members/:userId/locations`
Assign/update location access for a user.

**Auth:** Owner/Manager only
**Body:**
```json
{
  "locations": ["locationId1", "locationId2"]
}
```

**Response:**
```json
{
  "message": "Locations updated successfully",
  "locations": ["locationId1", "locationId2"]
}
```

---

##### UPDATED: POST `/organizations/:organizationId/invite`
Now accepts optional locations array.

**Body (with locations):**
```json
{
  "email": "user@example.com",
  "role": "Cashier",
  "locations": ["locationId1", "locationId2"]
}
```

**Notes:**
- Validates location IDs exist in organization
- Locations applied to user on invitation acceptance
- Empty locations array = full access

---

#### User.js

##### UPDATED: POST `/users/login`
Response now includes locations in organization object.

**Response (when organizationId provided):**
```json
{
  "message": "Logged in successfully",
  "accessToken": "...",
  "user": { ... },
  "organization": {
    "_id": "orgId",
    "name": "Store Name",
    "slug": "store-slug",
    "role": "Cashier",
    "permissions": [...],
    "locations": ["locationId1", "locationId2"]
  }
}
```

**Response (no organizationId):**
```json
{
  "message": "Select an organization to continue",
  "user": { ... },
  "organizations": [
    {
      "organizationId": "orgId",
      "name": "Store Name",
      "slug": "store-slug",
      "role": "Cashier",
      "status": "active",
      "locations": ["locationId1", "locationId2"]
    }
  ]
}
```

---

##### UPDATED: GET `/users/organizations`
Now returns locations for each organization.

**Response:**
```json
{
  "organizations": [
    {
      "organizationId": "orgId",
      "name": "Store Name",
      "slug": "store-slug",
      "role": "Cashier",
      "status": "active",
      "locations": ["locationId1", "locationId2"]
    }
  ]
}
```

---

##### UPDATED: POST `/users/switch-organization`
Now includes locations and permissions in response.

**Response:**
```json
{
  "message": "Switched organization",
  "accessToken": "...",
  "organization": {
    "_id": "orgId",
    "name": "Store Name",
    "slug": "store-slug",
    "role": "Cashier",
    "permissions": [...],
    "locations": ["locationId1", "locationId2"]
  }
}
```

---

#### Sales.js

##### UPDATED: POST `/sales`
**NEW:** Location access validation via `validateLocationAccess` middleware
- Checks `locationId` in request body
- User can only create sales at assigned locations
- Owner/Manager bypass restriction

**Note:** Existing request body unchanged. Validation now enforced.

---

##### UPDATED: GET `/sales`
**NEW:** Automatic filtering by user's accessible locations
- Employees with assigned locations see only their location's sales
- Owner/Manager see all sales
- locationId query param still works but filters within user's accessible set

**Query params (unchanged):**
```
?locationId=...&status=...&paymentMethod=...&startDate=...&endDate=...&limit=...&page=...
```

---

#### Inventory.js

##### UPDATED: POST `/inventory`
**NEW:** Location access validation via `validateLocationAccess` middleware
- Checks `locationId` in request body
- User can only create inventory at assigned locations
- Owner/Manager bypass restriction

---

##### UPDATED: GET `/inventory`
**NEW:** Automatic filtering by user's accessible locations
- Employees with assigned locations see only their location's inventory
- Owner/Manager see all inventory
- variantId and locationId query params still work but filter within user's accessible set

**Query params (unchanged):**
```
?variantId=...&locationId=...&skip=...&limit=...
```

---

##### UPDATED: PUT `/inventory/:variantId/:locationId/adjust`
**NEW:** Location access validation via `validateLocationAccess` middleware
- User can only adjust inventory at assigned locations
- Owner/Manager bypass restriction

---

## Backward Compatibility

✅ **Fully backward compatible** - existing code works unchanged:
- Users with empty `locations` array = full organization access
- Existing Owners/Managers automatically get full access
- Existing API clients work without modification
- Only new restriction applies to specifically assigned location users

---

## Migration Notes

If you want to restrict existing Cashiers/Employees to specific locations:

```bash
# Use the new endpoint to assign locations per user
PUT /organizations/{orgId}/members/{userId}/locations
{
  "locations": ["location1", "location2"]
}
```

Without this assignment, they retain full access (backward compatible).

---

## Frontend Implementation Checklist

### Auth Flow
- [ ] Login response now includes `locations` array
- [ ] Organization selector shows `locations` for each org
- [ ] Pass `locations` to POS location picker component
- [ ] If user has 1 location, auto-select; if multiple, show picker
- [ ] If user has empty locations array, show all locations (Owner/Manager)

### POS Location Selection
- [ ] When creating sale, validate `locationId` is in user's `locations`
- [ ] Frontend-side validation: show only assigned locations in dropdown
- [ ] Backend enforces: request fails with 403 if location not assigned

### Admin Console (Location Management)
- [ ] New endpoint: PUT `/organizations/{orgId}/members/{userId}/locations`
- [ ] Allow Owners/Managers to assign locations per user
- [ ] Show current location assignments in user list
- [ ] Update invite endpoint to include locations field

### Invite Flow
- [ ] When inviting user, include optional `locations` array
- [ ] Show location checkboxes during invite
- [ ] Validation: only allow selecting existing organization locations

### Error Handling
- [ ] Handle `403 LOCATION_ACCESS_DENIED` error code
- [ ] Show user-friendly message: "You do not have access to this location"
- [ ] Retry logic for location conflicts

---

## API Testing with Postman

See updated POSTMAN_MASTER_COLLECTION.json for:
1. New "Update Member Locations" request
2. Updated invite request with locations parameter
3. Updated login/org responses showing locations
4. Updated sales/inventory list requests with filtering behavior

---

## Questions/Edge Cases

**Q: What if a user is assigned to 0 locations but has location restrictions set?**
A: They cannot access any location. Use empty array or null to grant full access.

**Q: Can an Employee assign locations to another Employee?**
A: No, only Owner/Manager. Enforced at endpoint level.

**Q: What happens to sales/inventory from locations a user loses access to?**
A: They become invisible in list endpoints but database records persist. Access revocation doesn't delete data.

**Q: Does location access affect Shopify inventory sync?**
A: No, sync happens at org level. Location assignment only affects POS user access.
