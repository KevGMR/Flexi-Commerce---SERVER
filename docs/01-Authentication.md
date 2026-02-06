# Authentication & Organizations

Complete guide for user registration, authentication, and multi-tenant organization management in FLEXI-POS.

## Table of Contents

1. [Overview](#overview)
2. [Authentication Flow](#authentication-flow)
3. [User Registration](#user-registration)
4. [Organization Management](#organization-management)
5. [Session Management](#session-management)
6. [Error Handling](#error-handling)

---

## Overview

FLEXI-POS uses a multi-tenant architecture where users can:
- Register and create organizations
- Invite other users to join organizations
- Switch between organizations
- Manage authentication tokens with refresh capability
- View audit logs of account activities

**Base URL:** `http://localhost:9200`  
**Authentication Method:** Bearer Token (JWT)  
**Content-Type:** `application/json`

---

## Authentication Flow

### 1. User Registration (Create Organization)

Creates a new user and their first organization in a single request.

**Endpoint:** `POST /users/new`

**Request Body:**
```json
{
  "fullname": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "organizationName": "My Store",
  "phone": "+1234567890"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "email": "john@example.com",
    "fullname": "John Doe",
    "phone": "+1234567890",
    "status": "active"
  },
  "organization": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "My Store",
    "slug": "my-store",
    "owner": "507f1f77bcf86cd799439011"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Save these values to environment:**
- `{{userId}}` = user._id
- `{{organizationId}}` = organization._id
- `{{organizationSlug}}` = organization.slug
- `{{accessToken}}` = accessToken
- `{{userEmail}}` = email

### 2. Email Verification

Verify email address after registration.

**Endpoint:** `POST /email-verification/send`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:** Sends verification email to registered address

**Verify Token:**

**Endpoint:** `POST /email-verification/verify`

**Request Body:**
```json
{
  "token": "verification-token-from-email"
}
```

### 3. Login (Organization Selection)

Get list of user's organizations.

**Endpoint:** `GET /organizations/my`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response (200 OK):**
```json
{
  "success": true,
  "organizations": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "My Store",
      "slug": "my-store",
      "members": 3
    }
  ]
}
```

---

## User Registration

### Password Requirements

- Minimum 8 characters
- At least one uppercase letter
- At least one number
- At least one special character

### Email Verification

After registration, users receive an email with verification link. They must verify email within 24 hours or request new verification email.

**Resend Verification Email:**

**Endpoint:** `POST /email-verification/resend`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Organization Management

### Get Organization Details

**Endpoint:** `GET /organizations/:organizationId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "organization": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "My Store",
    "slug": "my-store",
    "owner": "507f1f77bcf86cd799439011",
    "members": [
      {
        "user": "507f1f77bcf86cd799439011",
        "role": "owner",
        "status": "active",
        "joinedAt": "2026-01-22T22:00:00Z"
      }
    ],
    "settings": {
      "theme": "light",
      "currency": "USD",
      "timezone": "UTC"
    }
  }
}
```

### Get Organization Members

**Endpoint:** `GET /organizations/:organizationId/members`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

### Update Organization Settings

**Endpoint:** `PUT /organizations/:organizationId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "name": "Updated Store Name",
  "settings": {
    "theme": "dark",
    "currency": "USD",
    "timezone": "America/New_York"
  }
}
```

### Create New Organization

**Endpoint:** `POST /organizations`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "name": "Second Store",
  "description": "Optional description"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "organization": {
    "_id": "507f1f77bcf86cd799439020",
    "name": "Second Store",
    "slug": "second-store",
    "owner": "507f1f77bcf86cd799439011"
  }
}
```

### User Invitations

#### Invite User to Organization

**Endpoint:** `POST /organizations/:organizationId/invitations`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "role": "manager"
}
```

**Valid Roles:**
- `viewer` - Read-only access
- `editor` - Can modify items
- `manager` - Can manage team members
- `owner` - Full administrative access

**Response (201 Created):**
```json
{
  "success": true,
  "invitation": {
    "_id": "507f1f77bcf86cd799439030",
    "email": "newuser@example.com",
    "role": "manager",
    "organizationId": "507f1f77bcf86cd799439012",
    "token": "invitation-token",
    "expiresAt": "2026-02-22T22:00:00Z",
    "status": "pending"
  }
}
```

#### Register with Invitation Token

**Endpoint:** `POST /users/register-with-invitation`

**Request Body:**
```json
{
  "fullname": "New User",
  "email": "newuser@example.com",
  "password": "SecurePass123!",
  "invitationToken": "invitation-token"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "user": {
    "_id": "507f1f77bcf86cd799439031",
    "email": "newuser@example.com",
    "fullname": "New User"
  },
  "accessToken": "...",
  "refreshToken": "..."
}
```

#### Remove Organization Member

**Endpoint:** `DELETE /organizations/:organizationId/members/:userId`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

---

## Session Management

### Switch Organization

**Endpoint:** `POST /organizations/:organizationId/switch`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response (200 OK):**
```json
{
  "success": true,
  "organization": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "My Store"
  },
  "newAccessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Save the `newAccessToken` to `{{accessToken}}` environment variable.

### Refresh Token

**Endpoint:** `POST /auth/refresh`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Get Active Sessions

**Endpoint:** `GET /auth/sessions`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "device": "Chrome on Windows",
      "lastActive": "2026-01-22T22:05:00Z",
      "location": "New York, US",
      "ipAddress": "192.168.1.100"
    }
  ]
}
```

### Logout

**Endpoint:** `POST /auth/logout`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Password Management

### Request Password Reset

**Endpoint:** `POST /auth/password-reset/request`

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response:** Email sent with reset link (valid for 1 hour)

### Reset Password with Token

**Endpoint:** `POST /auth/password-reset/confirm`

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "newPassword": "NewSecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

---

## Audit Logging

### Get Audit Logs

**Endpoint:** `GET /organizations/:organizationId/audit-logs`

**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Query Parameters:**
- `page` (optional) - Page number, default: 1
- `limit` (optional) - Results per page, default: 20
- `action` (optional) - Filter by action type (LOGIN, CREATE, UPDATE, DELETE, etc.)
- `userId` (optional) - Filter by specific user
- `startDate` (optional) - ISO 8601 date (e.g., 2026-01-01T00:00:00Z)
- `endDate` (optional) - ISO 8601 date

**Example:**
```
GET /organizations/507f1f77bcf86cd799439012/audit-logs?page=1&limit=20&action=LOGIN
```

**Response:**
```json
{
  "success": true,
  "logs": [
    {
      "_id": "507f1f77bcf86cd799439040",
      "userId": "507f1f77bcf86cd799439011",
      "userEmail": "john@example.com",
      "action": "LOGIN",
      "resource": "authentication",
      "changes": {
        "device": "Chrome on Windows",
        "ipAddress": "192.168.1.100"
      },
      "timestamp": "2026-01-22T22:05:00Z",
      "status": "success"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

---

## Error Handling

### Common HTTP Status Codes

| Status | Meaning | Example |
|--------|---------|---------|
| 200 | OK | Successful GET, POST, or PUT |
| 201 | Created | Successful resource creation |
| 400 | Bad Request | Missing/invalid fields in request |
| 401 | Unauthorized | Missing or invalid token |
| 403 | Forbidden | User lacks permission for resource |
| 404 | Not Found | Organization/user doesn't exist |
| 409 | Conflict | Email already registered |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Unexpected error |

### Error Response Format

```json
{
  "success": false,
  "error": "Invalid credentials",
  "code": "AUTH_INVALID_CREDENTIALS",
  "details": [
    {
      "field": "password",
      "message": "Password is incorrect"
    }
  ]
}
```

### Common Errors

**Duplicate Email**
```json
{
  "success": false,
  "error": "Email already registered",
  "code": "AUTH_EMAIL_EXISTS"
}
```

**Invalid Token**
```json
{
  "success": false,
  "error": "Token expired or invalid",
  "code": "AUTH_TOKEN_INVALID"
}
```

**Organization Not Found**
```json
{
  "success": false,
  "error": "Organization not found",
  "code": "ORG_NOT_FOUND"
}
```

---

## Testing Workflow

1. **Register first user** → Get initial token and organization ID
2. **Verify email** → Confirm email (check email inbox)
3. **Create organization** → Create a second organization
4. **Invite user** → Invite another user to first organization
5. **Get organization members** → Verify member list
6. **Switch organization** → Get new token for second organization
7. **Get audit logs** → Verify all activities logged

---

## Token Management Best Practices

- Store `accessToken` in memory (short-lived: 1 hour)
- Store `refreshToken` securely (long-lived: 7 days)
- Use refresh token to get new access token before expiry
- Always include `Authorization: Bearer {{accessToken}}` header
- Never commit tokens to version control
- Logout on app close to invalidate tokens

---

## Rate Limiting

- **Authentication endpoints:** 5 requests per minute per IP
- **General API endpoints:** 100 requests per minute per user
- **Response header:** `X-RateLimit-Remaining` shows remaining requests

When rate limited (429):
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

---

## Related Guides

- [E-Commerce CRUD Operations](03-E-Commerce-CRUD.md) - Product and inventory management
- [Sales Operations](04-Sales.md) - POS sales and transactions
- [Shopify Integration](05-Shopify-Integration.md) - Connect and sync with Shopify
- [Advanced Features](06-Advanced-Features.md) - Error handling, webhooks, permissions
