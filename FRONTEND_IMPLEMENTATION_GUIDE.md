# Frontend Implementation Guide: Location-Based Access Control

## Quick Summary for Frontend AI Helper

### What Changed
Multi-location POS support added. Users can now be restricted to specific locations. The frontend needs to handle a new `locations` array in auth responses and add location selection UI.

---

## API Response Changes

### 1. Login Response - With Organization Selected
**Endpoint:** `POST /users/login`

**Old Response:**
```json
{
  "message": "Logged in successfully",
  "accessToken": "...",
  "user": { "_id": "...", "email": "...", "fullname": "..." },
  "organization": {
    "_id": "orgId",
    "name": "Store Name",
    "slug": "store-slug",
    "role": "Cashier",
    "permissions": [...]
  }
}
```

**New Response:**
```json
{
  "message": "Logged in successfully",
  "accessToken": "...",
  "user": { "_id": "...", "email": "...", "fullname": "..." },
  "organization": {
    "_id": "orgId",
    "name": "Store Name",
    "slug": "store-slug",
    "role": "Cashier",
    "permissions": [...],
    "locations": ["loc123", "loc456"]  // NEW: Array of location IDs user can access
  }
}
```

**Frontend Action:**
```javascript
// Store locations in state/context
const { locations } = response.organization;
// locations.length === 0 means full org access (Owner/Manager)
// locations.length > 0 means restricted to specific locations
```

---

### 2. Organization Selection List
**Endpoint:** `POST /users/login` (no organizationId provided)

**Old Response:**
```json
{
  "message": "Select an organization to continue",
  "user": { ... },
  "organizations": [
    {
      "organizationId": "org1",
      "name": "Main Store",
      "slug": "main-store",
      "role": "Manager",
      "status": "active"
    }
  ]
}
```

**New Response:**
```json
{
  "message": "Select an organization to continue",
  "user": { ... },
  "organizations": [
    {
      "organizationId": "org1",
      "name": "Main Store",
      "slug": "main-store",
      "role": "Manager",
      "status": "active",
      "locations": []  // NEW: Empty = full access
    },
    {
      "organizationId": "org2",
      "name": "Branch Store",
      "slug": "branch-store",
      "role": "Cashier",
      "status": "active",
      "locations": ["loc789"]  // NEW: Restricted to 1 location
    }
  ]
}
```

---

### 3. Get My Organizations
**Endpoint:** `GET /users/organizations`

**Old Response:**
```json
{
  "organizations": [
    {
      "organizationId": "org1",
      "name": "Main Store",
      "slug": "main-store",
      "role": "Manager",
      "status": "active"
    }
  ]
}
```

**New Response:**
```json
{
  "organizations": [
    {
      "organizationId": "org1",
      "name": "Main Store",
      "slug": "main-store",
      "role": "Manager",
      "status": "active",
      "locations": []  // NEW: Locations array added
    }
  ]
}
```

---

### 4. Switch Organization
**Endpoint:** `POST /users/switch-organization`

**Old Response:**
```json
{
  "message": "Switched organization",
  "accessToken": "...",
  "organization": {
    "_id": "orgId",
    "name": "Store Name",
    "slug": "store-slug"
  }
}
```

**New Response:**
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
    "locations": ["loc123", "loc456"]  // NEW: Locations included
  }
}
```

---

## UI/UX Changes Required

### 1. Location Picker (POS Main Screen)

**Current Behavior:**
```javascript
// Show all locations for the organization
const locations = await fetchAllLocations(orgId);
// User selects location
```

**New Behavior:**
```javascript
// When user logs in, check locations array
const { locations } = authContext.organization;

if (locations.length === 0) {
  // Owner/Manager - show all locations
  const allLocations = await fetchAllLocations(orgId);
  setAvailableLocations(allLocations);
  // Show location picker
} else if (locations.length === 1) {
  // Auto-select single location
  setCurrentLocation(locations[0]);
  // Skip picker, go to POS
} else {
  // Show picker with only assigned locations
  setAvailableLocations(locations);
  // Show location picker
}
```

**UI Checklist:**
- [ ] If user has 1 location, auto-select it (no picker needed)
- [ ] If user has multiple locations, show dropdown/picker
- [ ] If empty locations array (Owner/Manager), show all organization locations
- [ ] Store selected `locationId` in context for all subsequent requests
- [ ] Prevent changing location mid-transaction

---

### 2. Error Handling

**New Error Response** (if user tries to transact at unauthorized location):
```json
{
  "error": "Access denied. You do not have access to this location.",
  "code": "LOCATION_ACCESS_DENIED"
}
```

**Frontend Handler:**
```javascript
if (error.code === 'LOCATION_ACCESS_DENIED') {
  showAlert('You do not have access to this location');
  // Reset location picker
  setCurrentLocation(null);
  showLocationPicker();
}
```

---

### 3. Admin Console Changes

**New Endpoint for Admin:**
```javascript
// Update employee's location assignments
PUT /organizations/{orgId}/members/{userId}/locations
Body: { "locations": ["loc1", "loc2"] }
```

**Admin UI Additions:**
- [ ] When viewing organization members, show current location assignments
- [ ] Add "Edit Locations" button for each user (Owner/Manager only)
- [ ] Location assignment modal/form:
  - Show all org locations as checkboxes
  - Allow bulk location selection
  - Save via PUT endpoint above

**Example Modal:**
```javascript
<LocationAssignmentModal>
  <h3>Assign Locations to {employee.name}</h3>
  <Checkbox value="loc1">Main Store</Checkbox>
  <Checkbox value="loc2">Branch Store</Checkbox>
  <Button onClick={() => updateMemberLocations(memberId, selectedLocations)}>
    Save
  </Button>
</LocationAssignmentModal>
```

---

### 4. Invite User Flow (Updated)

**Old Invite Payload:**
```json
{
  "email": "cashier@example.com",
  "role": "Cashier"
}
```

**New Invite Payload:**
```json
{
  "email": "cashier@example.com",
  "role": "Cashier",
  "locations": ["loc1", "loc2"]  // NEW: Optional locations
}
```

**Frontend Invite Form:**
- [ ] Add location checkboxes to invite modal
- [ ] Make locations optional
- [ ] Default: empty array (full access until restricted)
- [ ] Show only for Cashier/Employee roles (Manager/Owner get full access)

```javascript
<InviteUserModal>
  <input name="email" placeholder="user@example.com" />
  <select name="role">
    <option>Cashier</option>
    <option>Employee</option>
    <option>Manager</option>
  </select>
  
  {/* Only show locations for Cashier/Employee */}
  {selectedRole !== 'Owner' && (
    <div>
      <h4>Assign Locations (Optional)</h4>
      {locations.map(loc => (
        <Checkbox 
          key={loc._id} 
          value={loc._id}
          onChange={e => toggleLocation(e.target.value)}
        >
          {loc.name}
        </Checkbox>
      ))}
    </div>
  )}
  
  <Button onClick={inviteUser}>Send Invite</Button>
</InviteUserModal>
```

---

## State Management Updates

```javascript
// Context/Redux state additions:
{
  auth: {
    user: { ... },
    accessToken: "...",
    organization: {
      _id: "orgId",
      name: "Store Name",
      role: "Cashier",
      permissions: [...],
      locations: []  // NEW
    }
  },
  pos: {
    currentLocationId: "loc123",  // NEW: Selected location for transactions
    availableLocations: [...]  // NEW: Locations user can work at
  }
}
```

---

## API Call Changes

### Creating a Sale

**Old:**
```javascript
const response = await api.post('/sales', {
  locationId: selectedLocationId,
  items: [...],
  paymentMethod: 'cash'
});
```

**New (No code change needed):**
```javascript
// Same as before, but now validation happens on backend
// Frontend should validate locationId is in user's locations first

if (!context.organization.locations.includes(locationId)) {
  throw new Error('Location not accessible');
}
```

### Creating Inventory

**Old:**
```javascript
const response = await api.post('/inventory', {
  locationId: selectedLocationId,
  variantId: "...",
  onHand: 100
});
```

**New (No code change needed):**
```javascript
// Same request, backend now enforces location access
// Frontend should validate locationId is in user's locations first
```

---

## Backward Compatibility

✅ **Fully backward compatible:**
- Existing code without location handling still works
- `locations` field is optional in responses
- Empty `locations` array = full access (current behavior)
- No breaking changes to existing endpoints

---

## Testing Checklist for Frontend Team

- [ ] Login returns `locations` array
- [ ] Organization list shows `locations` for each org
- [ ] Single-location user auto-selects location
- [ ] Multi-location user sees location picker
- [ ] Owner/Manager sees all locations (empty array)
- [ ] Location picker prevents transaction at unauthorized location
- [ ] `LOCATION_ACCESS_DENIED` error handled gracefully
- [ ] Admin can assign locations to users
- [ ] Invite modal shows location checkboxes
- [ ] Location persists across pages within transaction
- [ ] Switching organization refreshes locations
- [ ] Switching organization within same app shows location picker

---

## Integration Notes

**For your AI Front-end Helper:**
1. All the updates are **in the responses**, not the request structure
2. Most existing code will continue to work
3. Main changes: Handle `locations` array in auth and add location picker/admin UI
4. No token changes - same JWT auth flow, just new fields in payload
5. All location validation happens on backend (safe for frontend)
6. Backward compatible - can roll out gradually

**Key Files to Update:**
- Auth context/store (handle locations)
- Login flow (show location picker)
- POS dashboard (location selector)
- Admin console (location assignment)
- Error handlers (handle LOCATION_ACCESS_DENIED)
