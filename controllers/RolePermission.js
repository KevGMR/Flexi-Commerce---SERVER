const express = require("express");
const User = require("../models/User");
const Role = require("../models/Role");
const { PERMISSIONS, getPermissionsForRole } = require("../config/permissions");
const { requirePermission } = require("../middleware/permissionCheck");
const {
  logRolePermissionChange,
  logRoleChange,
  savePermissionHistory,
  revokeAllUserTokens,
} = require("../services/auditLogger");
const {
  sendPermissionChangeNotification,
  sendRoleChangeNotification,
} = require("../services/emailNotifier");

const router = express.Router();

/**
 * Get all roles
 * GET /role-permission/roles
 */
router.get("/roles", requirePermission(PERMISSIONS.VIEW_ROLES), async (req, res) => {
  try {
    const roles = await Role.find().populate("createdBy", "fullname email");

    res.status(200).json({ roles });
  } catch (error) {
    console.error("Get roles error:", error);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

/**
 * Create new role
 * POST /role-permission/roles
 */
router.post("/roles", requirePermission(PERMISSIONS.MANAGE_ROLES), async (req, res) => {
  try {
    const { name, permissions, description } = req.body;

    if (!name || !permissions) {
      return res.status(400).json({ error: "Name and permissions are required" });
    }

    // Check if role already exists
    const existingRole = await Role.findOne({ name });
    if (existingRole) {
      return res.status(409).json({ error: "Role already exists" });
    }

    const role = new Role({
      name,
      permissions,
      description,
      createdBy: req.user.userId,
      isSystem: false,
    });

    await role.save();

    await logRoleChange(req.user.userId, role._id, "created", req.ip, {
      details: `Role created: ${name}`,
      permissions,
    });

    res.status(201).json({ role });
  } catch (error) {
    console.error("Create role error:", error);
    res.status(500).json({ error: "Failed to create role" });
  }
});

/**
 * Update role permissions
 * PUT /role-permission/roles/:roleId
 */
router.put("/roles/:roleId", requirePermission(PERMISSIONS.MANAGE_ROLES), async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissions, description } = req.body;

    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({ error: "Role not found" });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: "Cannot modify system roles" });
    }

    const oldPermissions = [...role.permissions];

    if (permissions) {
      role.permissions = permissions;
    }
    if (description !== undefined) {
      role.description = description;
    }

    await role.save();

    // Revoke all tokens for users with this role
    const usersWithRole = await User.find({ role: role.name });
    for (const user of usersWithRole) {
      await revokeAllUserTokens(user._id, "role_changed");
      
      // Send email notification
      const admin = await User.findById(req.user.userId);
      await sendPermissionChangeNotification(
        user.email,
        user.fullname,
        {
          type: "role_updated",
          oldPermissions,
          newPermissions: role.permissions,
        },
        admin.fullname
      );
    }

    await logRoleChange(req.user.userId, roleId, "updated", req.ip, {
      details: `Role updated: ${role.name}`,
      oldPermissions,
      newPermissions: role.permissions,
    });

    res.status(200).json({ role });
  } catch (error) {
    console.error("Update role error:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
});

/**
 * Delete role
 * DELETE /role-permission/roles/:roleId
 */
router.delete("/roles/:roleId", requirePermission(PERMISSIONS.MANAGE_ROLES), async (req, res) => {
  try {
    const { roleId } = req.params;

    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({ error: "Role not found" });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: "Cannot delete system roles" });
    }

    // Reassign users to Employee role
    const usersWithRole = await User.find({ role: role.name });
    const employeePermissions = getPermissionsForRole("Employee");

    for (const user of usersWithRole) {
      user.role = "Employee";
      user.permissions = employeePermissions;
      await user.save();
      await revokeAllUserTokens(user._id, "role_changed");

      const admin = await User.findById(req.user.userId);
      await sendRoleChangeNotification(
        user.email,
        user.fullname,
        role.name,
        "Employee",
        admin.fullname
      );
    }

    await role.deleteOne();

    await logRoleChange(req.user.userId, roleId, "deleted", req.ip, {
      details: `Role deleted: ${role.name}, ${usersWithRole.length} users reassigned to Employee`,
    });

    res.status(200).json({
      message: `Role deleted. ${usersWithRole.length} users reassigned to Employee role.`,
    });
  } catch (error) {
    console.error("Delete role error:", error);
    res.status(500).json({ error: "Failed to delete role" });
  }
});

/**
 * Get all available permissions
 * GET /role-permission/permissions
 */
router.get("/permissions", requirePermission(PERMISSIONS.VIEW_ROLES), async (req, res) => {
  try {
    const permissions = Object.entries(PERMISSIONS).map(([key, value]) => ({
      key,
      value,
    }));

    res.status(200).json({ permissions });
  } catch (error) {
    console.error("Get permissions error:", error);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

/**
 * Grant permission to user
 * POST /role-permission/users/:userId/permissions
 */
router.post(
  "/users/:userId/permissions",
  requirePermission(PERMISSIONS.ASSIGN_PERMISSIONS),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { permission } = req.body;

      if (!permission) {
        return res.status(400).json({ error: "Permission is required" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.permissions.includes(permission)) {
        return res.status(400).json({ error: "User already has this permission" });
      }

      const oldPermissions = [...user.permissions];
      user.permissions.push(permission);
      user.lastPermissionChange = new Date();
      await user.save();

      // Save to permission history
      await savePermissionHistory(
        userId,
        req.user.userId,
        "permission_granted",
        permission,
        oldPermissions,
        user.permissions,
        req.body.reason || "Manual permission grant"
      );

      // Revoke all tokens
      await revokeAllUserTokens(userId, "permission_granted");

      // Send email notification
      const admin = await User.findById(req.user.userId);
      await sendPermissionChangeNotification(
        user.email,
        user.fullname,
        { type: "granted", permission, oldPermissions, newPermissions: user.permissions },
        admin.fullname
      );

      await logRolePermissionChange(
        req.user.userId,
        userId,
        "permission_granted",
        permission,
        oldPermissions,
        user.permissions,
        { details: `Permission ${permission} granted to ${user.fullname}` }
      );

      res.status(200).json({
        message: "Permission granted successfully",
        permissions: user.permissions,
      });
    } catch (error) {
      console.error("Grant permission error:", error);
      res.status(500).json({ error: "Failed to grant permission" });
    }
  }
);

/**
 * Revoke permission from user
 * DELETE /role-permission/users/:userId/permissions/:permission
 */
router.delete(
  "/users/:userId/permissions/:permission",
  requirePermission(PERMISSIONS.ASSIGN_PERMISSIONS),
  async (req, res) => {
    try {
      const { userId, permission } = req.params;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.permissions.includes(permission)) {
        return res.status(400).json({ error: "User does not have this permission" });
      }

      const oldPermissions = [...user.permissions];
      user.permissions = user.permissions.filter((p) => p !== permission);
      user.lastPermissionChange = new Date();
      await user.save();

      // Save to permission history
      await savePermissionHistory(
        userId,
        req.user.userId,
        "permission_revoked",
        permission,
        oldPermissions,
        user.permissions,
        req.body.reason || "Manual permission revocation"
      );

      // Revoke all tokens
      await revokeAllUserTokens(userId, "permission_revoked");

      // Send email notification
      const admin = await User.findById(req.user.userId);
      await sendPermissionChangeNotification(
        user.email,
        user.fullname,
        { type: "revoked", permission, oldPermissions, newPermissions: user.permissions },
        admin.fullname
      );

      await logRolePermissionChange(
        req.user.userId,
        userId,
        "permission_revoked",
        permission,
        oldPermissions,
        user.permissions,
        { details: `Permission ${permission} revoked from ${user.fullname}` }
      );

      res.status(200).json({
        message: "Permission revoked successfully",
        permissions: user.permissions,
      });
    } catch (error) {
      console.error("Revoke permission error:", error);
      res.status(500).json({ error: "Failed to revoke permission" });
    }
  }
);

/**
 * Restore permissions from history
 * POST /role-permission/users/:userId/permissions/restore/:historyId
 */
router.post(
  "/users/:userId/permissions/restore/:historyId",
  requirePermission(PERMISSIONS.ASSIGN_PERMISSIONS),
  async (req, res) => {
    try {
      const { userId, historyId } = req.params;

      const PermissionHistory = require("../models/PermissionHistory");
      const history = await PermissionHistory.findById(historyId);

      if (!history) {
        return res.status(404).json({ error: "Permission history not found" });
      }

      if (history.userId.toString() !== userId) {
        return res.status(400).json({ error: "History does not match user" });
      }

      if (!history.restorable) {
        return res.status(400).json({ error: "This change cannot be restored" });
      }

      if (history.restored) {
        return res.status(400).json({ error: "Permissions already restored" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const currentPermissions = [...user.permissions];
      user.permissions = history.oldPermissions;
      user.lastPermissionChange = new Date();
      await user.save();

      // Update history
      history.restored = true;
      history.restoredAt = new Date();
      history.restoredBy = req.user.userId;
      history.restoreCount += 1;
      await history.save();

      // Revoke tokens
      await revokeAllUserTokens(userId, "permissions_restored");

      // Send notification
      const admin = await User.findById(req.user.userId);
      await sendPermissionChangeNotification(
        user.email,
        user.fullname,
        { type: "restored", oldPermissions: currentPermissions, newPermissions: user.permissions },
        admin.fullname
      );

      await logRolePermissionChange(
        req.user.userId,
        userId,
        "permissions_restored",
        null,
        currentPermissions,
        user.permissions,
        { details: `Permissions restored from history` }
      );

      res.status(200).json({
        message: "Permissions restored successfully",
        permissions: user.permissions,
      });
    } catch (error) {
      console.error("Restore permissions error:", error);
      res.status(500).json({ error: "Failed to restore permissions" });
    }
  }
);

/**
 * Deactivate user
 * POST /role-permission/users/:userId/deactivate
 */
router.post(
  "/users/:userId/deactivate",
  requirePermission(PERMISSIONS.MANAGE_USERS),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      user.status = "inactive";
      await user.save();

      await revokeAllUserTokens(userId, "user_deactivated");

      const { logUserStatusChange } = require("../services/auditLogger");
      await logUserStatusChange(req.user.userId, userId, "inactive", reason);

      const { sendStatusChangeNotification } = require("../services/emailNotifier");
      await sendStatusChangeNotification(user.email, user.fullname, "inactive", reason);

      res.status(200).json({ message: "User deactivated successfully" });
    } catch (error) {
      console.error("Deactivate user error:", error);
      res.status(500).json({ error: "Failed to deactivate user" });
    }
  }
);

/**
 * Ban user
 * POST /role-permission/users/:userId/ban
 */
router.post("/users/:userId/ban", requirePermission(PERMISSIONS.BAN_USER), async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.status = "banned";
    await user.save();

    await revokeAllUserTokens(userId, "ban");

    const { logUserStatusChange } = require("../services/auditLogger");
    await logUserStatusChange(req.user.userId, userId, "banned", reason);

    const { sendStatusChangeNotification } = require("../services/emailNotifier");
    await sendStatusChangeNotification(user.email, user.fullname, "banned", reason);

    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
    console.error("Ban user error:", error);
    res.status(500).json({ error: "Failed to ban user" });
  }
});

/**
 * Reactivate user
 * POST /role-permission/users/:userId/reactivate
 */
router.post(
  "/users/:userId/reactivate",
  requirePermission(PERMISSIONS.MANAGE_USERS),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      user.status = "active";
      await user.save();

      const { logUserStatusChange } = require("../services/auditLogger");
      await logUserStatusChange(req.user.userId, userId, "active", "Account reactivated");

      const { sendStatusChangeNotification } = require("../services/emailNotifier");
      await sendStatusChangeNotification(
        user.email,
        user.fullname,
        "active",
        "Your account has been reactivated"
      );

      res.status(200).json({ message: "User reactivated successfully" });
    } catch (error) {
      console.error("Reactivate user error:", error);
      res.status(500).json({ error: "Failed to reactivate user" });
    }
  }
);

module.exports = router;
