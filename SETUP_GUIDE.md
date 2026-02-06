# FLEXI-POS Setup Guide - Complete Authentication System

## Quick Start (5 minutes)

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Setup Environment
```bash
cp .env.example .env
```

Edit `.env` and configure:
- `MONGO_URI` - MongoDB connection string (replica set required for transactions)
- `JWT_SECRET` - Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `MAILER_ADDRESS` and `MAILER_PASS` - Gmail credentials

### MongoDB Replica Set (Required for Sales Transactions)
Sales creation uses MongoDB transactions, which require a replica set. For local development, run a single-node replica set.

**Windows (local dev):**
1. Start MongoDB with replica set enabled:
```
mongod --dbpath C:\data\db --replSet rs0
```
2. In a new shell, initialize the replica set:
```
mongosh
rs.initiate()
```
3. Update `.env` to include the replica set name:
```
MONGO_URI=mongodb://localhost:27017/flexi-pos?replicaSet=rs0
```

If you use MongoDB Atlas, the cluster is already a replica set—use the Atlas connection string as `MONGO_URI`.

### 3. Initialize Database Roles
```bash
node seeds/initializeRoles.js
```

Output should show:
```
✓ Connected to MongoDB
✓ Created role: Owner
✓ Created role: Manager
✓ Created role: Cashier
✓ Created role: Employee

✓ Roles initialization complete!
```

### 4. Start Server
```bash
npm run dev
```

Server running on `http://localhost:9200`

---

## Authentication Architecture

### User Registration Flow
```
1. Register (POST /users/new)
   ↓
2. Email verification token sent
   ↓
3. User clicks link or enters token
   ↓
4. Email verified
   ↓
5. User can login
```

### Login Flow
```
1. Login (POST /users/login) with email + password
   ↓
2. Password validated with bcrypt
   ↓
3. Device tracked (X-Device-ID header)
   ↓
4. Two tokens generated:
   - Access Token (15 min, in memory)
   - Refresh Token (7 days, httpOnly cookie)
   ↓
5. User receives both tokens
```

### Token Refresh Flow
```
1. Access token expires
   ↓
2. Client detects 401 TOKEN_EXPIRED
   ↓
3. Client calls POST /users/refresh with Device ID
   ↓
4. New access token issued
   ↓
5. Old refresh token rotated to new one
```

---

## Role System - Dynamic & Extensible

### Default Roles (System Roles)
These roles are created by `initializeRoles.js`:

- **Owner** - Full system access (all 40+ permissions)
- **Manager** - Sales, inventory, reporting, limited user management
- **Cashier** - Sales, invoices, view-only access
- **Employee** - Minimal read-only access

### Adding New Custom Roles

#### Via API
```bash
POST /role-permission/roles
Authorization: Bearer <ownerToken>
X-Device-ID: device-id

{
  "name": "Supervisor",
  "description": "Store supervisor with elevated permissions",
  "permissions": [
    "create_sale",
    "view_reports",
    "manage_inventory",
    "view_invoices"
  ]
}
```

#### Via Database
```javascript
const role = new Role({
  name: "Supervisor",
  description: "Store supervisor with elevated permissions",
  permissions: ["create_sale", "view_reports", "manage_inventory"],
  isSystem: false
});
await role.save();
```

### Assigning Roles to Users

During Registration:
```bash
POST /users/new

{
  "fullname": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "company": "My Store",
  "role": "Manager"  ← Must exist in database
}
```

**Note**: Role must exist in database before assigning to user. If role doesn't exist, returns `400 Bad Request: Role "Manager" does not exist`

---

## Permission System - 40+ Granular Permissions

### Permission Categories

**Sales**
- `create_sale` - Create new sales transactions
- `view_sale` - View sales data
- `edit_sale` - Edit existing sales
- `delete_sale` - Delete sales
- `refund_sale` - Process refunds

**Reporting**
- `view_reports` - Access reports
- `export_reports` - Export report data
- `financial_reports` - View financial data
- `view_sales_report` - Sales-specific reports

**Inventory**
- `manage_inventory` - Add/edit/delete inventory
- `view_inventory` - View inventory data
- `adjust_stock` - Adjust inventory quantities
- `manage_variants` - Manage product variants

**Products**
- `create_product` - Create new products
- `view_products` - View product data
- `edit_product` - Edit product details
- `delete_product` - Delete products

**Invoices**
- `create_invoice` - Create invoices
- `view_invoices` - View invoice data
- `edit_invoice` - Edit invoices
- `delete_invoice` - Delete invoices

**Vault**
- `manage_vault` - Full vault access
- `view_vault` - View vault data
- `create_vault_entry` - Create vault entries
- `delete_vault_entry` - Delete vault entries

**Users & Roles**
- `manage_users` - Create/edit/delete users
- `ban_users` - Ban user accounts
- `manage_roles` - Create/edit/delete roles
- `assign_permissions` - Grant/revoke permissions
- `revoke_permissions` - Revoke user permissions

**Audit**
- `manage_audit_logs` - Full audit log access
- `view_audit_logs` - View audit logs
- `export_audit_logs` - Export audit data
- `purge_audit_logs` - Delete old logs

### Granting Permissions

```bash
POST /role-permission/users/{userId}/permissions
Authorization: Bearer <adminToken>
X-Device-ID: device-id

{
  "permission": "create_sale",
  "reason": "Promoted to sales team"
}
```

**Effect:**
1. Permission added to user
2. All user tokens revoked (immediate)
3. User receives email notification
4. Change logged in audit trail
5. User must re-login to get new token

### Revoking Permissions

```bash
DELETE /role-permission/users/{userId}/permissions/{permission}
Authorization: Bearer <adminToken>
X-Device-ID: device-id

{
  "reason": "Access no longer needed"
}
```

**Same effect as granting** - immediate revocation, email notification, audit log

---

## Critical Features

### 1. Device Tracking
Every login/request must include `X-Device-ID` header:

```bash
Headers:
X-Device-ID: unique-device-identifier
X-Device-Name: Device Description (optional)
```

**Tracking captures:**
- Device ID (required)
- Device name (optional, for display)
- IP address
- User agent
- Last activity timestamp

**View active sessions:**
```bash
GET /users/devices
Authorization: Bearer <token>
X-Device-ID: device-id
```

**Revoke specific device:**
```bash
DELETE /users/devices/{deviceId}
Authorization: Bearer <token>
X-Device-ID: current-device-id
```

### 2. Multi-Device Session Management
Users can login from multiple devices simultaneously. Each device has:
- Separate refresh token
- Individual revocation capability
- Independent tracking

### 3. Audit Logging - Complete Security Trail
Every action logged with:
- User ID
- IP address
- Device ID
- Device name
- User agent
- Event type
- Permissions involved
- Timestamp

**View logs:**
```bash
GET /audit-logs?eventType=login_success&page=1&limit=50
```

**Supported filters:**
- `eventType` - Type of event
- `userId` - Specific user
- `ipAddress` - IP address
- `deviceId` - Device ID
- `startDate` - Start date (YYYY-MM-DD)
- `endDate` - End date (YYYY-MM-DD)
- `page` - Page number
- `limit` - Results per page

**Download logs:**
```bash
POST /audit-logs/download
{
  "format": "csv", // or "json"
  "eventType": "login_success",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31"
}
```

**Auto-purge:** Logs older than 120 days automatically deleted

### 4. Rate Limiting - Brute Force Protection
- **Login:** 5 attempts per 15 minutes per IP
- **Registration:** 5 per hour per IP
- **Password Reset:** 3 per hour per IP
- **Token Refresh:** 20 per 5 minutes per IP
- **General API:** 100 per 15 minutes per IP

### 5. Email Verification - Required Before Login
1. Register user → Email sent with verification link
2. User clicks link (24-hour expiry)
3. Email verified → Can login
4. If not verified → Cannot login (email verification required)

### 6. Password Reset - Secure Token Flow
1. Request reset → Email sent with token
2. Token expires after 1 hour
3. Reset with token → All tokens revoked
4. Must login with new password

### 7. User Status Management
States: `active`, `inactive`, `banned`

**Deactivate user:**
```bash
POST /role-permission/users/{userId}/deactivate
{
  "reason": "User left company"
}
```
- Blocks API access
- Revokes all tokens
- Keeps data preserved

**Ban user:**
```bash
POST /role-permission/users/{userId}/ban
{
  "reason": "Suspicious activity"
}
```
- Blocks login
- Revokes all tokens
- Cannot be reactivated (only Owner can)

---

## Testing with Postman

### Import Collection
1. Open Postman
2. Click Import
3. Select `POSTMAN_COLLECTION.json`

### Setup Environment
Create environment with variables:
```
accessToken: (auto-filled after login)
userId: (auto-filled after login)
userEmail: john@example.com
```

### Test Sequence

**1. Health Check**
```bash
GET /health
Expected: 200 OK
```

**2. Register User**
```bash
POST /users/new
{
  "fullname": "Test User",
  "email": "test@example.com",
  "password": "SecurePass123!",
  "company": "Test Co",
  "role": "Employee"
}
Expected: 201 Created
```

**3. Verify Email**
- Check server console for verification token
- Copy token from logs
- POST /email-verification/verify/{token}

**4. Login**
```bash
POST /users/login
Headers: X-Device-ID: test-device-001
{
  "email": "test@example.com",
  "password": "SecurePass123!"
}
Expected: 200 OK
Auto-saves accessToken and userId
```

**5. Test Protected Route**
```bash
GET /users/devices
Authorization: Bearer {{accessToken}}
X-Device-ID: test-device-001
Expected: 200 OK (shows active sessions)
```

**6. Refresh Token**
```bash
POST /users/refresh
X-Device-ID: test-device-001
Expected: 200 OK
Auto-saves new accessToken
```

See `POSTMAN_TESTING_GUIDE.md` for 20 comprehensive test scenarios

---

## Error Codes Reference

### Authentication Errors
| Code | Status | Meaning |
|------|--------|---------|
| `NO_TOKEN` | 401 | Missing Authorization header |
| `INVALID_TOKEN` | 401 | Token malformed or tampered |
| `TOKEN_EXPIRED` | 401 | Access token expired (refresh needed) |
| `INVALID_DEVICE` | 401 | Device ID mismatch |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |

### Permission Errors
| Code | Status | Meaning |
|------|--------|---------|
| `NO_PERMISSION` | 403 | User lacks required permission |
| `PERMISSION_REVOKED` | 403 | Permission was revoked |
| `CRITICAL_PERMISSION_REVOKED` | 403 | Critical permission denied |

### User Status Errors
| Code | Status | Meaning |
|------|--------|---------|
| `USER_INACTIVE` | 403 | User account deactivated |
| `USER_BANNED` | 403 | User account banned |
| `EMAIL_NOT_VERIFIED` | 403 | Email not yet verified |

### Rate Limiting
| Code | Status | Meaning |
|------|--------|---------|
| `RATE_LIMITED` | 429 | Too many requests |

### Validation Errors
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_EMAIL` | 400 | Email format invalid |
| `WEAK_PASSWORD` | 400 | Password too short |
| `USER_EXISTS` | 409 | Email already registered |
| `ROLE_NOT_FOUND` | 400 | Role doesn't exist |

---

## Troubleshooting

### "Role does not exist"
**Problem**: Tried to register with role that doesn't exist
**Solution**: 
1. Create role first via API
2. Or run: `node seeds/initializeRoles.js`
3. Check Role collection in MongoDB

### "Email verification required"
**Problem**: Trying to login before email verified
**Solution**:
1. Check email for verification link
2. Use resend endpoint if needed
3. Token expires after 24 hours

### "Token expired"
**Problem**: Access token no longer valid
**Solution**: 
1. Call refresh endpoint: `POST /users/refresh`
2. Include X-Device-ID header
3. New access token returned automatically

### "Rate limit exceeded"
**Problem**: Too many requests from same IP
**Solution**:
1. Wait 15-60 minutes (depends on endpoint)
2. Limits reset per IP address
3. Check status code 429

### "Device ID mismatch"
**Problem**: Token used with different device
**Solution**:
1. Use same X-Device-ID for all requests with that token
2. Different device? Create new session (login again)
3. Each device gets own refresh token

---

## Production Deployment

### Before Going Live

1. **Change JWT Secret**
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

2. **Configure MongoDB**
   - Use production MongoDB URI
   - Enable authentication
   - Enable backups
   - Monitor performance

3. **Setup Email Service**
   - Verify domain in Gmail/Sendgrid
   - Or use production email service
   - Test email delivery

4. **Configure CORS**
   - Set `CORS_ORIGINS` to frontend URL only
   - Remove localhost entries

5. **Enable HTTPS**
   - Get SSL certificate
   - Redirect HTTP to HTTPS
   - Set Secure flag on cookies

6. **Set NODE_ENV**
   ```bash
   NODE_ENV=production
   ```

7. **Run Database Migrations**
   ```bash
   node seeds/initializeRoles.js
   ```

8. **Enable Logging**
   - Send logs to external service
   - Monitor error rates
   - Set up alerts

---

## Next Steps

1. ✅ Install dependencies
2. ✅ Setup .env file
3. ✅ Initialize roles
4. ✅ Start server
5. ✅ Test with Postman
6. → Integrate frontend
7. → Deploy to staging
8. → Production deployment

Happy coding! 🚀
