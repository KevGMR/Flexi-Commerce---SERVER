const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const router = express.Router();

const User = require("../models/User");
const Organization = require("../models/Organization");
const UserOrganization = require("../models/UserOrganization");
const Invitation = require("../models/Invitation");
const RefreshToken = require("../models/RefreshToken");
const Role = require("../models/Role");
const { getPermissionsForRole, PERMISSIONS } = require("../config/permissions");
const { generateAccessToken, generateRefreshToken, rotateRefreshToken } = require("../utils/tokenManager");
const { logTokenEvent, logFailedAuth, revokeAllUserTokens } = require("../services/auditLogger");
const { sendEmailVerification, sendPasswordReset, sendOrganizationInvitation } = require("../services/emailNotifier");
const { verifyToken, verifyRefreshTokenMiddleware, extractDeviceId, requireOrganization } = require("../middleware/auth");
const { checkUserStatus } = require("../middleware/userStatusCheck");
const { loginLimiter, registrationLimiter, refreshLimiter, passwordResetLimiter } = require("../middleware/rateLimiter");
const { getEffectivePermissionsForMembership, getMembershipPermissionsForRole, syncRoleWithConfig } = require("../utils/effectivePermissions");
const { requirePermission } = require("../middleware/permissionCheck");

const saltRounds = Number(process.env.SALT) || 10;

const getRefreshCookieOptions = ({ includeMaxAge = true } = {}) => {
  const configuredSameSite = (process.env.REFRESH_COOKIE_SAMESITE || "").toLowerCase();
  const sameSite = ["strict", "lax", "none"].includes(configuredSameSite)
    ? configuredSameSite
    : process.env.NODE_ENV === "production"
      ? "none"
      : "lax";

  const configuredSecure = process.env.REFRESH_COOKIE_SECURE;
  const secure = configuredSecure
    ? configuredSecure === "true"
    : sameSite === "none" || process.env.NODE_ENV === "production";

  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };

  if (includeMaxAge) {
    options.maxAge = 7 * 24 * 60 * 60 * 1000;
  }

  const cookieDomain = (process.env.REFRESH_COOKIE_DOMAIN || "").trim();
  if (cookieDomain) {
    options.domain = cookieDomain;
  }

  return options;
};

/**
 * Helper function to generate unique organization slug
 */
const generateUniqueSlug = async (name) => {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const reserved = ['admin', 'api', 'auth', 'settings', 'dashboard', 'login', 'signup', 'register'];
  if (reserved.includes(slug)) {
    slug = `${slug}-org`;
  }

  let uniqueSlug = slug;
  let counter = 1;
  while (await Organization.findOne({ slug: uniqueSlug })) {
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }

  return uniqueSlug;
};

/**
 * Register new user (creates org if first user, joins org if invited)
 * POST /users/new
 */
router.post("/new", registrationLimiter, async (req, res) => {
  try {
    const {
      fullname,
      email,
      password,
      organizationName,
      invitationToken,
      avatarUrl,
      phone,
    } = req.body;

    if (!fullname || !email || !password) {
      return res.status(400).json({
        error: "Fullname, email, and password are required",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiry = new Date();
    verificationExpiry.setHours(verificationExpiry.getHours() + 24);

    const user = new User({
      fullname,
      email: email.toLowerCase(),
      avatarUrl,
      password: hashedPassword,
      phone,
      status: "active",
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
    });

    await user.save();

    let organization;
    let userRole = "Employee";

    if (invitationToken) {
      const invitation = await Invitation.findOne({
        token: invitationToken,
        status: "pending",
        expiresAt: { $gt: new Date() },
      });

      if (!invitation) {
        return res.status(400).json({ error: "Invalid or expired invitation token" });
      }

      if (invitation.email !== email.toLowerCase()) {
        return res.status(400).json({
          error: "Invitation email mismatch. Please register with the invited email address.",
        });
      }

      organization = await Organization.findById(invitation.organizationId);
      if (!organization) {
        return res.status(400).json({ error: "Organization not found" });
      }

      userRole = invitation.role;

      const permissions = await getMembershipPermissionsForRole(userRole);
      await UserOrganization.create({
        userId: user._id,
        organizationId: organization._id,
        role: userRole,
        permissions,
        locations: invitation.locations || [],
      });

      invitation.status = "accepted";
      invitation.acceptedBy = user._id;
      invitation.acceptedAt = new Date();
      await invitation.save();
    }
    else if (organizationName) {
      const organizationSlug = await generateUniqueSlug(organizationName);

      organization = new Organization({
        name: organizationName,
        slug: organizationSlug,
        ownerId: user._id,
      });

      await organization.save();

      const ownerPermissions = await getMembershipPermissionsForRole("Owner");
      await UserOrganization.create({
        userId: user._id,
        organizationId: organization._id,
        role: "Owner",
        permissions: ownerPermissions,
      });

      userRole = "Owner";
    } else {
      return res.status(400).json({
        error: "Either organizationName (new account) or invitationToken (join existing) is required",
      });
    }

    await sendEmailVerification(email, verificationToken, fullname);

    await logTokenEvent(
      user._id,
      organization._id,
      "user_registered",
      req.ip,
      req.get("user-agent"),
      {
        details: `New user registered for organization: ${organization.name}`,
      }
    );

    return res.status(201).json({
      message: "Registration successful. Check email to verify.",
      user: {
        _id: user._id,
        email: user.email,
        fullname: user.fullname,
      },
      organization: {
        _id: organization._id,
        name: organization.name,
        slug: organization.slug,
      },
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * Login user - returns organizations or issues org-scoped token
 * POST /users/login
 */
router.post("/login", loginLimiter, extractDeviceId, async (req, res) => {
  try {
    const { email, password, organizationId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      await logFailedAuth(email, req.ip, "User not found");
      return res.status(401).json({
        error: "Invalid email or password",
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Please verify your email before logging in",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (user.status !== "active") {
      await logFailedAuth(email, req.ip, `Account status: ${user.status}`);
      return res.status(403).json({
        error: `Your account is ${user.status}. Please contact support.`,
        code: `ACCOUNT_${user.status.toUpperCase()}`,
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      await logFailedAuth(email, req.ip, "Invalid password");
      return res.status(401).json({
        error: "Invalid email or password",
      });
    }

    const memberships = await UserOrganization.find({
      userId: user._id,
      status: "active",
    })
      .populate("organizationId", "name slug status")
      .lean();

    if (memberships.length === 0) {
      return res.status(403).json({
        error: "No active organization memberships found",
      });
    }

    if (organizationId) {
      const membership = memberships.find(
        (m) => String(m.organizationId._id) === String(organizationId)
      );

      if (!membership) {
        return res.status(403).json({
          error: "No access to this organization",
        });
      }

      if (membership.organizationId.status !== "active") {
        return res.status(403).json({
          error: "Organization is not active",
        });
      }

      const effectiveMembership = await getEffectivePermissionsForMembership({
        userId: user._id,
        organizationId,
      });

      const orgPermissions = effectiveMembership?.permissions || membership.permissions;

      const accessToken = generateAccessToken(
        user._id,
        membership.role,
        orgPermissions,
        req.deviceId,
        organizationId
      );

      const { token: refreshToken, tokenDoc } = await generateRefreshToken(
        user._id,
        req.deviceId,
        req.ip,
        req.get("user-agent"),
        organizationId,
        req.deviceName
      );

      user.lastLogin = new Date();
      await user.save();

      await logTokenEvent(
        user._id,
        organizationId,
        "login_success",
        req.ip,
        req.get("user-agent"),
        {
          details: "User logged in successfully",
          permissions: membership.permissions,
          deviceId: req.deviceId,
        }
      );

      res.cookie("refreshToken", refreshToken, getRefreshCookieOptions());

      return res.status(200).json({
        message: "Logged in successfully",
        accessToken,
        user: {
          _id: user._id,
          email: user.email,
          fullname: user.fullname,
        },
        organization: {
          _id: organizationId,
          name: membership.organizationId.name,
          slug: membership.organizationId.slug,
          role: membership.role,
          permissions: orgPermissions,
          locations: membership.locations || [],
        },
      });
    }

    return res.status(200).json({
      message: "Select an organization to continue",
      user: {
        _id: user._id,
        email: user.email,
        fullname: user.fullname,
      },
      organizations: memberships.map((m) => ({
        organizationId: m.organizationId._id,
        name: m.organizationId.name,
        slug: m.organizationId.slug,
        role: m.role,
        status: m.organizationId.status,
        locations: m.locations || [],
      })),
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * Refresh access token
 * POST /users/refresh
 */
router.post("/refresh", refreshLimiter, extractDeviceId, verifyRefreshTokenMiddleware, async (req, res) => {
  try {
    const tokenDoc = req.refreshTokenDoc;
    const refreshToken = req.refreshToken;

    const user = await User.findById(tokenDoc.userId);

    if (!user) {
      return res.status(401).json({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        error: `Account is ${user.status}`,
        code: `ACCOUNT_${user.status.toUpperCase()}`,
      });
    }

    if (tokenDoc.deviceId !== req.deviceId) {
      return res.status(401).json({ error: "Device ID mismatch", code: "DEVICE_ID_MISMATCH" });
    }

    const membership = await UserOrganization.findOne({
      userId: user._id,
      organizationId: tokenDoc.organizationId,
      status: "active",
    });

    if (!membership) {
      return res.status(403).json({ error: "No access to organization", code: "ORG_ACCESS_REVOKED" });
    }

    const effectiveMembership = await getEffectivePermissionsForMembership({
      userId: user._id,
      organizationId: tokenDoc.organizationId,
    });

    const orgPermissions = effectiveMembership?.permissions || membership.permissions;

    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(
      refreshToken,
      user._id,
      membership.role,
      orgPermissions,
      req.deviceId,
      req.ip,
      req.get("user-agent"),
      tokenDoc.organizationId
    );

    await logTokenEvent(
      user._id,
      tokenDoc.organizationId,
      "token_rotated",
      req.ip,
      req.get("user-agent"),
      {
        details: "Token refreshed successfully",
      }
    );

    res.cookie("refreshToken", newRefreshToken, getRefreshCookieOptions());

    res.status(200).json({
      accessToken,
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    const message = error.message || "Token refresh failed";
    const code = message === "Refresh token expired"
      ? "REFRESH_TOKEN_EXPIRED"
      : message === "Invalid refresh token"
        ? "REFRESH_TOKEN_INVALID"
        : "REFRESH_ROTATION_FAILED";
    res.status(401).json({ error: message, code });
  }
});

/**
 * Logout user
 * POST /users/logout
 */
router.post("/logout", extractDeviceId, verifyToken, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      const hashedToken = crypto.createHash("sha256").update(refreshToken).digest("hex");

      await RefreshToken.findOneAndUpdate(
        { token: hashedToken, userId: req.user.userId, deviceId: req.deviceId },
        {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: "user_logout",
        }
      );
    }

    res.clearCookie("refreshToken", getRefreshCookieOptions({ includeMaxAge: false }));

    await logTokenEvent(
      req.user.userId,
      req.user.organizationId,
      "logout",
      req.ip,
      req.get("user-agent"),
      {
        details: "User logged out",
      }
    );

    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
});

/**
 * Get active devices/sessions
 * GET /users/devices
 */
router.get("/devices", verifyToken, async (req, res) => {
  try {
    const devices = await RefreshToken.find({
      userId: req.user.userId,
      revoked: false,
      expiresAt: { $gt: new Date() },
    }).select("deviceId deviceName ipAddress createdAt issuedAt");

    res.status(200).json({ devices });
  } catch (error) {
    console.error("Get devices error:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

/**
 * Revoke specific device
 * DELETE /users/devices/:deviceId
 */
router.delete("/devices/:deviceId", verifyToken, async (req, res) => {
  try {
    const { deviceId } = req.params;

    const result = await RefreshToken.updateMany(
      { userId: req.user.userId, deviceId, revoked: false },
      {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: "user_initiated",
      }
    );

    await logTokenEvent(
      req.user.userId,
      req.user.organizationId,
      "token_revoked",
      req.ip,
      req.get("user-agent"),
      {
        details: `Device ${deviceId} revoked by user`,
      }
    );

    res.status(200).json({
      message: "Device revoked successfully",
      count: result.modifiedCount,
    });
  } catch (error) {
    console.error("Revoke device error:", error);
    res.status(500).json({ error: "Failed to revoke device" });
  }
});

/**
 * Request password reset
 * POST /users/reset
 */
router.post("/reset", passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(200).json({
        message: "If the email exists, a password reset link has been sent",
      });
    }

    if (!user.emailVerified) {
      return res.status(400).json({
        error: "Please verify your email first",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiry = new Date();
    resetExpiry.setHours(resetExpiry.getHours() + 1);

    user.passwordResetToken = resetToken;
    user.passwordResetExpiry = resetExpiry;
    await user.save();

    await sendPasswordReset(email, resetToken, user.fullname);

    await logTokenEvent(user._id, null, "password_reset_requested", req.ip, req.get("user-agent"), {
      details: "Password reset requested",
    });

    res.status(200).json({
      message: "If the email exists, a password reset link has been sent",
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    res.status(500).json({ error: "Failed to process password reset request" });
  }
});

/**
 * Reset password with token
 * POST /users/reset/:token
 */
router.post("/reset/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        error: "Invalid or expired reset token",
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    user.lastPasswordReset = new Date();
    await user.save();

    await revokeAllUserTokens(user._id, "password_reset");

    const { logPasswordReset } = require("../services/auditLogger");
    await logPasswordReset(user._id, req.ip);

    res.status(200).json({
      message: "Password reset successfully. Please log in with your new password.",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

/**
 * Get user's organizations
 * GET /users/organizations
 */
router.get("/organizations", verifyToken, async (req, res) => {
  try {
    const memberships = await UserOrganization.find({
      userId: req.user.userId,
    })
      .populate("organizationId", "name slug status")
      .lean();

    return res.status(200).json({
      organizations: memberships.map((m) => ({
        organizationId: m.organizationId._id,
        name: m.organizationId.name,
        slug: m.organizationId.slug,
        role: m.role,
        status: m.organizationId.status,
        locations: m.locations || [],
      })),
    });
  } catch (error) {
    console.error("Error fetching organizations:", error);
    return res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

/**
 * Create new organization (for existing users)
 * POST /users/create-organization
 */
router.post("/create-organization", verifyToken, async (req, res) => {
  try {
    const { organizationName } = req.body;

    if (!organizationName) {
      return res.status(400).json({
        error: "organizationName is required",
      });
    }

    const organizationSlug = await generateUniqueSlug(organizationName);

    const organization = new Organization({
      name: organizationName,
      slug: organizationSlug,
      ownerId: req.user.userId,
    });

    await organization.save();

    const ownerPermissions = await getMembershipPermissionsForRole("Owner");
    await UserOrganization.create({
      userId: req.user.userId,
      organizationId: organization._id,
      role: "Owner",
      permissions: ownerPermissions,
    });

    await logTokenEvent(
      req.user.userId,
      organization._id,
      "organization_created",
      req.ip,
      req.get("user-agent"),
      {
        details: `User created new organization: ${organization.name}`,
      }
    );

    return res.status(201).json({
      message: "Organization created successfully",
      organization: {
        _id: organization._id,
        name: organization.name,
        slug: organization.slug,
      },
    });
  } catch (err) {
    console.error("Create organization error:", err);
    return res.status(500).json({ error: "Failed to create organization" });
  }
});

/**
 * Switch organization (get new token for different org)
 * POST /users/switch-organization
 */
router.post("/switch-organization", verifyToken, extractDeviceId, async (req, res) => {
  try {
    const { organizationId } = req.body;

    if (!organizationId) {
      return res.status(400).json({ error: "organizationId is required" });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId,
      status: "active",
    });

    if (!membership) {
      return res.status(403).json({
        error: "No access to this organization",
      });
    }

    const org = await Organization.findById(organizationId).lean();
    if (!org || org.status !== "active") {
      return res.status(403).json({ error: "Organization not active" });
    }

    const effectiveMembership = await getEffectivePermissionsForMembership({
      userId: req.user.userId,
      organizationId,
    });

    const orgPermissions = effectiveMembership?.permissions || membership.permissions;

    const accessToken = generateAccessToken(
      user._id,
      membership.role,
      orgPermissions,
      req.deviceId,
      organizationId
    );

    const { token: refreshToken } = await generateRefreshToken(
      user._id,
      req.deviceId,
      req.ip,
      req.get("user-agent"),
      organizationId,
      req.deviceName
    );

    res.cookie("refreshToken", refreshToken, getRefreshCookieOptions());

    await logTokenEvent(
      user._id,
      organizationId,
      "org_switched",
      req.ip,
      req.get("user-agent"),
      {
        details: `Switched to organization: ${org.name}`,
      }
    );

    return res.status(200).json({
      message: "Switched organization",
      accessToken,
      organization: {
        _id: organizationId,
        name: org.name,
        slug: org.slug,
        role: membership.role,
        permissions: orgPermissions,
        locations: membership.locations || [],
      },
    });
  } catch (error) {
    console.error("Error switching organization:", error);
    return res.status(500).json({ error: "Failed to switch organization" });
  }
});

/**
 * Update user profile (including commission overrides)
 * PUT /users/:userId
 */
router.put("/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullname, phone, avatarUrl, commissionOverrides } = req.body;

    const isSelf = req.user.userId?.toString() === userId;

    if (!isSelf && !req.user.permissions?.includes(PERMISSIONS.EDIT_USER)) {
      return res.status(403).json({
        error: "Access denied. Insufficient permissions.",
        requiredPermission: PERMISSIONS.EDIT_USER,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (fullname !== undefined) user.fullname = fullname;
    if (phone !== undefined) user.phone = phone;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    if (commissionOverrides !== undefined) {
      if (!Array.isArray(commissionOverrides)) {
        return res.status(400).json({ error: "commissionOverrides must be an array" });
      }
      for (const override of commissionOverrides) {
        if (!override.serviceId || !override.commissionType || override.commissionValue === undefined) {
          return res.status(400).json({
            error: "Each override must have serviceId, commissionType, and commissionValue"
          });
        }
        if (!["percentage", "fixed"].includes(override.commissionType)) {
          return res.status(400).json({ error: "commissionType must be 'percentage' or 'fixed'" });
        }
        if (typeof override.commissionValue !== 'number' || override.commissionValue < 0) {
          return res.status(400).json({ error: "commissionValue must be a non-negative number" });
        }
      }
      user.commissionOverrides = commissionOverrides.map(ov => ({
        serviceId: ov.serviceId,
        commissionType: ov.commissionType,
        commissionValue: ov.commissionValue,
        updatedBy: req.user.userId,
        updatedAt: new Date(),
      }));
    }

    await user.save();

    return res.status(200).json({
      message: "User updated successfully",
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        commissionOverrides: user.commissionOverrides,
      },
    });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ error: "Failed to update user" });
  }
});

/**
 * GET /users/:userId
 * Get user details including their organization membership and custom permissions
 */
router.get("/:userId", verifyToken, requirePermission(PERMISSIONS.VIEW_USERS), async (req, res) => {
  try {
    const { userId } = req.params;
    const { organizationId } = req.user;

    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "active",
    });

    if (!membership) {
      return res.status(404).json({ error: "User not found in this organization" });
    }

    const user = await User.findById(userId)
      .select("_id fullname email phone avatarUrl status emailVerified lastLogin createdAt updatedAt commissionOverrides")
      .lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      success: true,
      user: {
        ...user,
        role: membership.role,
        permissions: membership.permissions || [],
        customPermissions: membership.customPermissions || [],
        locations: membership.locations || [],
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

/**
 * PATCH /users/:userId/membership
 * Update user's organization membership (role, locations, customPermissions)
 * Requires MANAGE_USERS or EDIT_USER permission
 */
router.patch("/:userId/membership", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { organizationId } = req.user;
    const { role, locations, customPermissions } = req.body;

    if (!req.user.permissions?.includes(PERMISSIONS.MANAGE_USERS) &&
        !req.user.permissions?.includes(PERMISSIONS.EDIT_USER)) {
      return res.status(403).json({
        error: "Access denied. Insufficient permissions.",
        requiredPermissions: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.EDIT_USER],
      });
    }

    if (role !== undefined) {
      const validRoles = ["Owner", "Manager", "Cashier", "Employee"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be one of: " + validRoles.join(", ") });
      }
    }

    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "active",
    });

    if (!membership) {
      return res.status(404).json({ error: "User not found in this organization" });
    }

    if (role) {
      membership.role = role;
      const permissions = await getMembershipPermissionsForRole(role);
      membership.permissions = permissions;
    }

    if (locations !== undefined) {
      if (!Array.isArray(locations)) {
        return res.status(400).json({ error: "locations must be an array of location IDs" });
      }
      membership.locations = locations;
    }

    if (customPermissions !== undefined) {
      if (!Array.isArray(customPermissions)) {
        return res.status(400).json({ error: "customPermissions must be an array" });
      }
      const { isValidPermission } = require("../config/permissions");
      for (const perm of customPermissions) {
        if (!isValidPermission(perm)) {
          return res.status(400).json({ error: `Invalid permission: ${perm}` });
        }
      }
      membership.customPermissions = customPermissions;
    }

    await membership.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "user_membership_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Updated membership for user ${userId}`,
        changes: { role, locations, customPermissions },
      }
    );

    return res.status(200).json({
      success: true,
      message: "User membership updated successfully",
      membership: {
        role: membership.role,
        permissions: membership.permissions,
        customPermissions: membership.customPermissions,
        locations: membership.locations,
      },
    });
  } catch (error) {
    console.error("Update membership error:", error);
    return res.status(500).json({ error: "Failed to update user membership" });
  }
});

/**
 * POST /users/:userId/sync-permissions
 * Recalculate role-based permissions for a user, preserving customPermissions
 * Also syncs the Role document from config if missing permissions
 * Requires MANAGE_USERS or EDIT_USER permission
 */
router.post("/:userId/sync-permissions", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { organizationId } = req.user;

    if (!req.user.permissions?.includes(PERMISSIONS.MANAGE_USERS) &&
        !req.user.permissions?.includes(PERMISSIONS.EDIT_USER)) {
      return res.status(403).json({
        error: "Access denied. Insufficient permissions.",
        requiredPermissions: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.EDIT_USER],
      });
    }

    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "active",
    });

    if (!membership) {
      return res.status(404).json({ error: "User not found in this organization" });
    }

    // 1. Sync the role definition from config
    const updatedRole = await syncRoleWithConfig(membership.role);
    if (!updatedRole) {
      return res.status(500).json({ error: "Failed to sync role definition" });
    }

    // 2. Now sync the user's permissions from the updated role
    const newPermissions = updatedRole.permissions || [];
    membership.permissions = newPermissions;
    // customPermissions are left untouched
    await membership.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "user_permissions_synced",
      req.ip,
      req.get("user-agent"),
      {
        details: `Synced permissions for user ${userId} based on role ${membership.role}`,
        permissions: newPermissions,
        customPermissions: membership.customPermissions,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Role and user permissions synced successfully",
      membership: {
        role: membership.role,
        permissions: membership.permissions,
        customPermissions: membership.customPermissions,
        locations: membership.locations,
      },
    });
  } catch (error) {
    console.error("Sync permissions error:", error);
    return res.status(500).json({ error: "Failed to sync permissions" });
  }
});

/**
 * List users in the current organization
 * GET /users
 */
router.get("/", verifyToken, requirePermission(PERMISSIONS.VIEW_USERS), async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { search, limit = 50, page = 1, status } = req.query;

    const memberships = await UserOrganization.find({
      organizationId,
      status: "active",
    })
      .select("userId")
      .lean();

    const userIds = memberships.map((m) => m.userId);

    if (userIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          users: [],
          pagination: { page: 1, limit: parseInt(limit), total: 0, pages: 0 },
        },
      });
    }

    const query = { _id: { $in: userIds } };
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { fullname: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select("_id fullname email phone avatarUrl status emailVerified lastLogin createdAt updatedAt commissionOverrides customPermissions")
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

module.exports = router;