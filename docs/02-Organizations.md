# Organizations & Roles

Comprehensive guide to managing organizations, roles, permissions, and user access control in FLEXI-POS.

## Table of Contents

1. [Overview](#overview)
2. [Organization Structure](#organization-structure)
3. [Roles & Permissions](#roles--permissions)
4. [Member Management](#member-management)
5. [Permission Models](#permission-models)
6. [Audit Trail](#audit-trail)

---

## Overview

FLEXI-POS supports multi-tenant organizations with hierarchical role-based access control. Each organization has:
- Organization owner(s)
- Members with assigned roles
- Granular permissions per role
- Audit trail of all member actions

---

## Organization Structure

### Organization Object

```json
{
  "_id": "507f1f77bcf86cd799439012",
  "name": "My Retail Store",
  "slug": "my-retail-store",
  "owner": "507f1f77bcf86cd799439011",
  "description": "Primary retail location",
  "members": 5,
  "status": "active",
  "settings": {
    "currency": "USD",
    "timezone": "America/New_York",
    "theme": "light",
    "allowMultipleLocations": true,
    "allowShopifySync": true
  },
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-22T22:00:00Z"
}
```

### Get My Organizations

**Endpoint:** `GET /organizations/my`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "organizations": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "My Retail Store",
      "slug": "my-retail-store",
      "role": "owner",
      "members": 5
    }
  ]
}
```

### Get Organization Details

**Endpoint:** `GET /organizations/:organizationId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Roles & Permissions

### Built-in Roles

FLEXI-POS includes 5 pre-configured roles with default permissions:

#### 1. Owner
**Full administrative access to all features.**

Permissions:
- ✅ Manage all users and roles
- ✅ Create/edit/delete all resources
- ✅ Access organization settings
- ✅ Configure Shopify integration
- ✅ View audit logs
- ✅ Manage billing and subscriptions

#### 2. Manager
**Can manage most resources and team members.**

Permissions:
- ✅ Create/edit products, variants, collections
- ✅ Manage inventory and stock levels
- ✅ Process sales and refunds
- ✅ Manage suppliers and purchase orders
- ✅ Invite and remove team members (except owner)
- ✅ Create reports
- ❌ Cannot access organization settings
- ❌ Cannot view audit logs
- ❌ Cannot manage billing

#### 3. Editor
**Can create and modify resources but not manage users.**

Permissions:
- ✅ Create/edit products and collections
- ✅ View and adjust inventory
- ✅ Process sales
- ✅ Create purchase orders
- ✅ View reports
- ❌ Cannot delete resources
- ❌ Cannot manage users
- ❌ Cannot access settings

#### 4. Viewer
**Read-only access to most features.**

Permissions:
- ✅ View all products and collections
- ✅ View inventory levels
- ✅ View sales history
- ✅ View reports
- ❌ Cannot create or edit anything
- ❌ Cannot manage users

#### 5. Guest
**Minimal read-only access, usually temporary.**

Permissions:
- ✅ View products
- ✅ View public reports
- ❌ No inventory or sales access
- ❌ Temporary access (expires after 30 days)

### Permission Matrix

| Feature | Owner | Manager | Editor | Viewer | Guest |
|---------|:-----:|:-------:|:------:|:------:|:-----:|
| **Products** | CRUD | CRUD | CR | R | R |
| **Variants** | CRUD | CRUD | CR | R | R |
| **Collections** | CRUD | CRUD | CR | R | R |
| **Inventory** | CRUD | CRUD | CR | R | R |
| **Sales** | CRUD | CRUD | CR | R | - |
| **Reports** | CRD | CRD | R | R | R |
| **Suppliers** | CRUD | CRUD | - | - | - |
| **Purchase Orders** | CRUD | CRUD | CR | R | - |
| **Users** | CRD | C | - | - | - |
| **Settings** | CRUD | - | - | - | - |

*Legend: C=Create, R=Read, U=Update, D=Delete, -=No access*

---

## Member Management

### Get Organization Members

**Endpoint:** `GET /organizations/:organizationId/members`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `page` (optional) - Default: 1
- `limit` (optional) - Default: 20
- `role` (optional) - Filter by role (owner, manager, editor, viewer, guest)
- `status` (optional) - Filter by status (active, inactive, pending)

**Response:**
```json
{
  "success": true,
  "members": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "user": {
        "_id": "507f1f77bcf86cd799439011",
        "fullname": "John Doe",
        "email": "john@example.com"
      },
      "role": "owner",
      "status": "active",
      "joinedAt": "2026-01-01T00:00:00Z",
      "lastActive": "2026-01-22T22:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "pages": 1
  }
}
```

### Add Member (Invite)

**Endpoint:** `POST /organizations/:organizationId/members/invite`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "email": "newmember@example.com",
  "role": "editor",
  "message": "Welcome to our team!"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "invitation": {
    "_id": "507f1f77bcf86cd799439030",
    "email": "newmember@example.com",
    "role": "editor",
    "status": "pending",
    "inviteToken": "token",
    "expiresAt": "2026-02-22T00:00:00Z"
  }
}
```

Invitation email sent to `newmember@example.com` with registration link.

### Update Member Role

**Endpoint:** `PUT /organizations/:organizationId/members/:userId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "role": "manager"
}
```

**Response:**
```json
{
  "success": true,
  "member": {
    "_id": "507f1f77bcf86cd799439031",
    "user": {
      "fullname": "New User",
      "email": "newuser@example.com"
    },
    "role": "manager",
    "status": "active"
  }
}
```

### Remove Member

**Endpoint:** `DELETE /organizations/:organizationId/members/:userId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Member removed from organization"
}
```

Member loses all access to organization immediately. Their action history is preserved in audit logs.

---

## Permission Models

### Feature-Level Permissions

Permissions are checked at request time:

```
Request → Middleware → Check Authorization Header
        ↓
     Check User Org Access
        ↓
     Check User Role
        ↓
     Check Resource Permissions
        ↓
     Execute Controller Logic
```

### Resource-Level Permissions

Some resources have owner-specific restrictions:

```json
{
  "_id": "507f1f77bcf86cd799439050",
  "name": "Gaming Laptop",
  "createdBy": "507f1f77bcf86cd799439011",
  "organizationId": "507f1f77bcf86cd799439012",
  "accessControl": {
    "canEdit": ["owner", "manager", "507f1f77bcf86cd799439011"],
    "canDelete": ["owner", "507f1f77bcf86cd799439011"],
    "canView": ["owner", "manager", "editor", "viewer", "guest"]
  }
}
```

### Permission Check Flow

```javascript
// Example: Can user edit product?
1. User has valid token? → 401 if NO
2. User in organization? → 403 if NO
3. User's role has "edit products" permission? → 403 if NO
4. Is product in user's organization? → 404 if NO
5. Is user the creator or owner? → 403 if NO
6. ✅ ALLOW EDIT
```

---

## Custom Roles (Enterprise)

### Create Custom Role

**Endpoint:** `POST /organizations/:organizationId/roles`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Note:** Only available to organization owners.

**Request Body:**
```json
{
  "name": "Inventory Manager",
  "description": "Can manage inventory and purchase orders",
  "permissions": [
    "products:read",
    "inventory:read",
    "inventory:update",
    "purchase-orders:create",
    "purchase-orders:read",
    "purchase-orders:update",
    "reports:read"
  ],
  "color": "#4CAF50"
}
```

**Available Permissions:**
- `products:create`, `products:read`, `products:update`, `products:delete`
- `inventory:read`, `inventory:update`, `inventory:adjust`
- `sales:create`, `sales:read`, `sales:void`, `sales:refund`
- `suppliers:create`, `suppliers:read`, `suppliers:update`, `suppliers:delete`
- `purchase-orders:create`, `purchase-orders:read`, `purchase-orders:update`
- `reports:read`, `reports:create`, `reports:delete`
- `users:manage`, `organizations:settings`
- `audit:read`

**Response (201 Created):**
```json
{
  "success": true,
  "role": {
    "_id": "507f1f77bcf86cd799439060",
    "name": "Inventory Manager",
    "organizationId": "507f1f77bcf86cd799439012",
    "permissions": [...]
  }
}
```

---

## Audit Trail

See [Advanced Features - Audit Logging](06-Advanced-Features.md#audit-logging) for complete audit trail documentation.

### Member Action Tracking

Every action by a user is logged:
- Member invited
- Member role changed
- Member removed
- Member logged in/out
- Member created/modified resources

---

## Access Control Examples

### Scenario 1: New Team Member Joins

1. Owner invites `alice@company.com` as Manager
2. Alice receives email with registration link + invitation token
3. Alice registers account
4. System automatically adds Alice to organization with Manager role
5. Alice can now create/edit products but cannot access settings
6. All of Alice's actions are logged

### Scenario 2: Contractor Access (Temporary)

1. Owner invites `contractor@agency.com` as Guest
2. Guest role automatically expires after 30 days
3. Or owner can manually remove access before expiry
4. Access is immediately revoked on removal

### Scenario 3: Permission Escalation

1. Editor requests to manage suppliers
2. Owner upgrades Editor to Manager role
3. Manager immediately gains supplier management permissions
4. All new actions have Manager-level permissions
5. Previous Editor-level actions appear in audit trail with "Editor" role

---

## Related Documentation

- [Authentication & Organizations](01-Authentication.md#organization-management) - Organization CRUD operations
- [Advanced Features - Permissions](06-Advanced-Features.md#permissions-and-rbac) - Deep dive into permission model
- [Advanced Features - Audit Logging](06-Advanced-Features.md#audit-logging) - Track all member actions
