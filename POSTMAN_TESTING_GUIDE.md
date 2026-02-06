# Postman Testing Guide - FLEXI-POS Multi-Tenant Authentication

## 📥 Import Collection

1. **Download Postman** - https://www.postman.com/downloads/
2. **Open Postman**
3. **Import Collection**:
   - Click "Import" button (top left)
   - Select `POSTMAN_COLLECTION.json` from this folder
   - Collection will appear in left sidebar

## 🔧 Setup Environment Variables

Before running tests, configure these variables in Postman:

1. **Open Environment Settings** (click gear icon → "Manage Environments")
2. **Create New Environment** called "FLEXI-POS Development"
3. **Add Variables** (most will be auto-filled):
   ```
   accessToken: (auto-filled after login)
   userId: (auto-filled after registration/login)
   userEmail: john@example.com (can change this)
   organizationId: (auto-filled after registration/login)
   organizationSlug: (auto-filled after registration)
   ```

## ⚙️ Prerequisites

Before testing, ensure:

1. **Server is running**:
   ```bash
   cd server
   npm install
   npm run dev
   ```
   Should see: `✓ Server running on port 9200`

2. **Environment file is configured** (`.env`):
   ```
   MONGO_URI=mongodb://localhost:27017/flexipos
   JWT_SECRET=your-secret-key
   MAILER_ADDRESS=your-gmail@gmail.com
   MAILER_PASS=your-app-password
   CLIENT_URL=http://localhost:3000
   CORS_ORIGINS=http://localhost:3000,http://localhost:5173
   ```

3. **MongoDB is running** (if local):
   ```bash
   mongod
   ```

## 🧪 Test Scenarios

### Scenario 1: First User Registration & Organization Creation ✅

**Step 1: Register First User (Create Organization)**
- Request: `1. Register First User (Create Organization)`
- Change email to something unique: `owner@example.com`
- Provide organization details:
  ```json
  {
    "fullname": "John Doe",
    "email": "owner@example.com",
    "password": "SecurePass123!",
    "organizationName": "My Store",
    "phone": "+1234567890"
  }
  ```
- Expected: Status 201, creates user AND organization
- **✓ Auto-saves userId, organizationId, organizationSlug to environment**
- **✓ Slug is auto-generated from organizationName** ("My Store" → "my-store")
- User becomes **Owner** of the organization
- Check console logs for verification link

**Expected Response**:
```json
{
  "message": "Registration successful. Check email to verify.",
  "user": {
    "_id": "user-id-here",
    "email": "owner@example.com",
    "fullname": "John Doe",
    "emailVerified": false
  },
  "organization": {
    "_id": "org-id-here",
    "name": "My Store",
    "slug": "my-store",
    "ownerId": "user-id-here",
    "status": "active"
  }
}
```

**Step 2: Verify Email**
- Request: `2. Verify Email`
- Copy the token from server console logs
- Paste in URL: `/email-verification/verify/TOKEN_HERE`
- Expected: Status 200, `{ "message": "Email verified successfully" }`

**Step 3: Login - Step 1 (Get Organizations)**
- Request: `3. Login - Step 1 (Get Organizations)`
- Use email/password WITHOUT organizationId
- Expected: Status 200, returns list of organizations
- **✓ Auto-saves first organizationId to environment**

**Expected Response**:
```json
{
  "message": "Please select an organization",
  "organizations": [
    {
      "organizationId": "org-id-here",
      "name": "My Store",
      "slug": "my-store",
      "role": "Owner",
      "status": "active"
    }
  ]
}
```

**Step 4: Login - Step 2 (Select Organization)**
- Request: `4. Login - Step 2 (Select Organization)`
- Includes organizationId: `{{organizationId}}`
- Expected: Status 200, returns accessToken + user data + organization
- **✓ Auto-saves accessToken and organizationId to environment**
- Refresh token sent as httpOnly cookie (organization-scoped)

**Expected Response**:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "user-id-here",
    "email": "owner@example.com",
    "fullname": "John Doe",
    "role": "Owner",
    "permissions": ["all"],
    "status": "active"
  },
  "organization": {
    "_id": "org-id-here",
    "name": "My Store",
    "slug": "my-store"
  }
}
```

### Scenario 2: Organization Management 🏢

**Step 5: Get My Organizations**
- Request: `5. Get My Organizations`
- Expected: Status 200, list of all organizations user belongs to
- Shows role and permissions for each org

**Step 6: Get Organization Details**
- Request: `6. Get Organization Details`
- Uses {{organizationId}} from environment
- Expected: Status 200, full organization details
- Includes settings (timezone, currency, language, taxRate)

**Step 7: Update Organization Settings**
- Request: `7. Update Organization Settings`
- **Requires Owner or Manager role**
- Can update: name, settings, website, plan
- Expected: Status 200, updated organization

**Example Request Body**:
```json
{
  "name": "My Updated Store",
  "settings": {
    "timezone": "America/New_York",
    "currency": "USD",
    "language": "en",
    "taxRate": 8.5
  }
}
```

### Scenario 2b: Create Additional Organization 🏪

**Step 8: Create New Organization (Existing User)**
- Request: `8. Create New Organization (Existing User)`
- For users who already have accounts and want to create another organization
- **Requires**: Valid JWT accessToken (any organization context)
- Expected: Status 201, new organization created
- User automatically becomes **Owner** of new organization
- Logged with `organization_created` event in audit trail

**Example Request Body**:
```json
{
  "organizationName": "Second Store"
}
```

**Expected Response**:
```json
{
  "message": "Organization created successfully",
  "organization": {
    "_id": "new-org-id",
    "name": "Second Store",
    "slug": "second-store"
  }
}
```

**Note**: Slug is auto-generated from organizationName:
- "Second Store" → "second-store"
- "My Company LLC" → "my-company-llc"
- If slug exists, auto-increments: "my-store", "my-store-2", "my-store-3"

**Use Case**: 
- User "John Doe" owns "My Store"
- Creates another organization "Partner Store"
- Can now switch between both stores
- Each has separate settings, members, products, and permissions

**Error Cases**:
- Status 400: Missing organizationName
- Status 401: Missing or invalid JWT token

### Scenario 3: Invitation & Team Management 👥

**Step 9: Invite User to Organization**
- Request: `9. Invite User to Organization`
- **Requires Owner or Manager role**
- Send invitation email with role assignment
- Expected: Status 201, invitation created
- Check console for invitation token

**Example Request Body**:
```json
{
  "email": "employee@example.com",
  "role": "Employee"
}
```

**Available Roles**:
- `Owner` - Full control (cannot be assigned via invitation)
- `Manager` - Can manage users and settings
- `Cashier` - Can process sales
- `Employee` - Basic access

**Step 10: Register with Invitation Token**
- Request: `10. Register with Invitation Token`
- New user registers using invitation token
- Expected: Status 201, user joins organization with specified role
- No need to create organization (joins existing one)

**Example Request Body**:
```json
{
  "fullname": "Jane Smith",
  "email": "employee@example.com",
  "password": "SecurePass123!",
  "invitationToken": "PASTE_TOKEN_FROM_EMAIL",
  "phone": "+1234567891"
}
```

**Step 11: Get Organization Members**
- Request: `11. Get Organization Members`
- Expected: Status 200, list of active members
- Shows: fullname, email, role, permissions, joinedAt

### Scenario 5: Multi-Organization Support 🔄

**Step 12: Switch Organization**
- Request: `12. Switch Organization`
- For users belonging to multiple organizations
- Expected: Status 200, new accessToken for different org
- **✓ Auto-saves new accessToken and organizationId**
- All subsequent requests use new organization context

**Use Case**: User is Owner of "My Store" and Employee at "Partner Store"
- Login to "My Store" first
- Call this endpoint with "Partner Store" organizationId
- Now accessing "Partner Store" with Employee permissions

### Scenario 6: Token & Session Management 🔄

**Step 13: Refresh Token**
- Request: `13. Refresh Token`
- Expected: Status 200, new accessToken (same organization)
- **✓ Auto-saves new accessToken to environment**
- Old token becomes invalid
- Same device must be used

**Step 14: Get Active Sessions/Devices**
- Request: `14. Get Active Sessions/Devices`
- Expected: Status 200, list of active devices for current org
- Shows: Device ID, Device Name, IP Address, Last Activity, Organization

**Step 16: Logout**
- Request: `16. Logout`
- Expected: Status 200
- Refresh token revoked for current organization
- Try using old accessToken → should fail after expiry

### Scenario 7: Member Management 👤

**Step 15: Remove Organization Member**
- Request: `15. Remove Organization Member`
- **Requires Owner or Manager role**
- Cannot remove the Owner
- Replace `USER_ID_TO_REMOVE` in URL
- Expected: Status 200, member removed from organization
- Removed user's tokens for this org are revoked

### Scenario 8: Password Reset Flow 🔐

**Step 17: Request Password Reset**
- Request: `17. Request Password Reset`
- Enter email
- Expected: Status 200, reset link in console
- Email: "Password reset link sent"

**Step 18: Reset Password with Token**
- Request: `18. Reset Password with Token`
- Copy reset token from console
- Paste in URL
- Enter new password: `NewPassword123!`
- Expected: Status 200
- Try logging in with old password → should fail
- Try logging in with new password → should work

**Step 19: Resend Email Verification**
- Request: `19. Resend Email Verification`
- Expected: Status 200, new verification email sent

### Scenario 9: Security & Audit Logging 📊

**Step 20: Get Audit Logs**
- Request: `20. Get Audit Logs`
- Filter by eventType: `login_success`, `organization_switched`, `member_removed`
- Expected: Status 200, paginated results with organizationId context
- Can use filters:
  ```
  ?eventType=login_success
  &userId=user-id
  &page=1
  &limit=50
  &startDate=2024-01-01
  &endDate=2024-01-31
  ```

**Step 21: Test - Missing Organization Context**
- Request: `21. Test - Missing Organization Context`
- No Authorization header
- Expected: Status 401, `{ "code": "NO_TOKEN", "message": "No authorization token" }`

## 📋 Checklist for Complete Testing

### Multi-Tenant Architecture ✓
- [ ] First user registration creates organization
- [ ] User becomes Owner of their organization
- [ ] Organization ID stored and auto-used
- [ ] Organization slug is unique

### Invitation Flow ✓
- [ ] Owner/Manager can invite users
- [ ] Invitation email sent with token
- [ ] Invited user can register with token
- [ ] Invited user joins org with specified role
- [ ] Cannot register without valid invitation (if not first user)

### Authentication ✓
- [ ] Registration → Email verification → Login works
- [ ] Login without orgId returns organization list
- [ ] Login with orgId returns org-scoped token
- [ ] Access token includes organizationId in payload
- [ ] Refresh token tied to organization
- [ ] Device tracking recorded per organization

### Organization Management ✓
- [ ] Can view organization details
- [ ] Owner/Manager can update settings
- [ ] Can view list of organizations user belongs to
- [ ] Settings include timezone, currency, language, taxRate
- [ ] Organization status tracked (active/suspended/cancelled)

### Multi-Organization Support ✓
- [ ] User can belong to multiple organizations
- [ ] Can switch between organizations
- [ ] Each org has separate role/permissions
- [ ] Switching org issues new token
- [ ] Data isolated by organizationId

### Team Management ✓
- [ ] Can view organization members
- [ ] Owner/Manager can remove members
- [ ] Cannot remove Owner
- [ ] Removing member revokes their org tokens
- [ ] Member list shows role and permissions

### Token Management ✓
- [ ] Can refresh token with X-Device-ID
- [ ] Refresh preserves organization context
- [ ] Old token becomes invalid after refresh
- [ ] Expired token returns 401 with TOKEN_EXPIRED code
- [ ] Missing token returns 401 with NO_TOKEN code

### Sessions & Devices ✓
- [ ] Can view active sessions per organization
- [ ] Device info includes organization context
- [ ] Logout revokes org-specific refresh token

### Password Reset ✓
- [ ] Request reset sends email
- [ ] Token in email is valid
- [ ] Can set new password with token
- [ ] Old password no longer works
- [ ] New password allows login to all organizations

### Security ✓
- [ ] Rate limiting on login (5/15min)
- [ ] Rate limiting on password reset (3/hour)
- [ ] Rate limiting on token refresh (20/5min)
- [ ] Missing Authorization header returns 401
- [ ] Invalid token format returns 401
- [ ] Wrong device ID returns 401
- [ ] Organization context validated on protected routes

### Audit Trail ✓
- [ ] Login attempts logged with organizationId
- [ ] Organization switches logged
- [ ] Member additions/removals logged
- [ ] Token rotations logged per organization
- [ ] Audit logs filterable by organization
- [ ] Audit logs are paginated

## 🔧 Common Issues & Fixes

### "ECONNREFUSED - Connection refused"
**Problem**: Server not running
**Fix**: 
```bash
cd server
npm run dev
```

### "MONGO CONNECTION FAILED"
**Problem**: MongoDB not running or connection string wrong
**Fix**:
```bash
mongod
# or check MONGO_URI in .env
```

### "Email not sending"
**Problem**: Gmail credentials wrong
**Fix**:
- Check MAILER_ADDRESS and MAILER_PASS in .env
- Generate new Gmail app password
- Enable 2FA on Gmail account

### "CORS error in browser"
**Problem**: Frontend URL not in CORS_ORIGINS
**Fix**: Add to CORS_ORIGINS in .env: `http://localhost:5173,http://localhost:3000`

### "Token not auto-saving"
**Problem**: Tests script not working
**Fix**:
- Make sure response status is exactly 200
- Check that accessToken key exists in response
- Manually set: Click {{accessToken}} → Set as variable

### "Can't verify email"
**Problem**: Token expired (24 hour expiry)
**Fix**: Use Step 18 to resend verification email

### "Organization not found"
**Problem**: Trying to access org user doesn't belong to
**Fix**: 
- Check {{organizationId}} variable matches your org
- Use Step 5 to list all organizations
- Use Step 11 to switch to correct organization

### "Insufficient permissions"
**Problem**: Current role doesn't have required permissions
**Fix**:
- Check your role: Owner > Manager > Cashier > Employee
- Only Owner/Manager can invite users or update settings
- Cannot remove the Owner from organization

### "Invitation expired"
**Problem**: Invitation token older than 7 days
**Fix**: Have Owner/Manager send new invitation via Step 8

### "Cannot create organization"
**Problem**: Trying to register without invitation when not first user
**Fix**: Get invitation token from organization Owner/Manager

## 📊 Testing Report Template

After running all tests, fill this in:

```
Date: ___________
Server Version: ___________
Node Version: ___________

✓ Registration & Organization Creation: PASS / FAIL
✓ Email Verification: PASS / FAIL
✓ Login with Organization Selection: PASS / FAIL
✓ Organization Management: PASS / FAIL
✓ User Invitation Flow: PASS / FAIL
✓ Multi-Organization Support: PASS / FAIL
✓ Token Refresh: PASS / FAIL
✓ Team Member Management: PASS / FAIL
✓ Organization Switching: PASS / FAIL
✓ Password Reset: PASS / FAIL
✓ Logout: PASS / FAIL
✓ Rate Limiting: PASS / FAIL
✓ Error Handling: PASS / FAIL
✓ Audit Logging: PASS / FAIL

Overall Status: PASS / FAIL

Issues Found:
- Issue 1: ___________
- Issue 2: ___________

Notes: ___________
```

## 🚀 Next Steps

1. **Test locally** using this guide
2. **Fix any issues** found
3. **Test rate limiting** by making rapid requests
4. **Test with frontend** by integrating authentication
5. **Deploy to staging** and test with real data
6. **Production deployment** with production credentials

## 💡 Pro Tips

- **Copy/Paste Variables**: Use `{{variableName}}` in URLs/bodies
- **Test Multiple Organizations**: 
  - Register first user → Creates "Store A" (Owner)
  - Send invitation from "Store A"
  - Register second user → Creates "Store B" (Owner)
  - Second user can also join "Store A" as Employee
  - Test switching between orgs
- **Role Hierarchy**: Owner > Manager > Cashier > Employee
- **Batch Testing**: Use Postman's "Run Collection" feature
- **Save Responses**: Right-click response → Save as example
- **View Cookies**: Click "Cookies" button to see refreshToken
- **Monitor Network**: Open Postman console (Cmd+Alt+C) to see all requests
- **Check JWT Payload**: Copy accessToken → Paste at jwt.io to see organizationId

---

Happy Testing! 🎉
