const User = require("../models/User");
const { isCriticalPermission } = require("../config/permissions");
const { logPermissionDenied } = require("../services/auditLogger");

/**
 * Require specific permission middleware
 * @param {String} permission - Required permission
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      const { userId, permissions } = req.user;

      // For critical permissions, check database for latest permissions
      if (isCriticalPermission(permission)) {
        const user = await User.findById(userId).select("permissions status");

        if (!user) {
          return res.status(401).json({
            error: "User not found",
          });
        }

        if (user.status !== "active") {
          await logPermissionDenied(
            userId,
            permission,
            req.originalUrl,
            req.ip,
            "User account is not active"
          );

          return res.status(403).json({
            error: "User account is not active",
          });
        }

        // Check if user has the permission in database
        if (!user.permissions.includes(permission)) {
          await logPermissionDenied(
            userId,
            permission,
            req.originalUrl,
            req.ip,
            "Insufficient permissions (critical check)"
          );

          return res.status(403).json({
            error: "Access denied. Insufficient permissions.",
            requiredPermission: permission,
          });
        }
      } else {
        // For non-critical permissions, trust JWT
        if (!permissions.includes(permission)) {
          await logPermissionDenied(
            userId,
            permission,
            req.originalUrl,
            req.ip,
            "Insufficient permissions (JWT check)"
          );

          return res.status(403).json({
            error: "Access denied. Insufficient permissions.",
            requiredPermission: permission,
          });
        }
      }

      next();
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({
        error: "Error checking permissions",
      });
    }
  };
};

/**
 * Require any of the specified permissions
 * @param {Array} permissions - Array of permissions (user needs at least one)
 */
const requireAnyPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      const { userId, permissions: userPermissions } = req.user;

      // Check if any permission is critical
      const hasCritical = permissions.some((p) => isCriticalPermission(p));

      if (hasCritical) {
        const user = await User.findById(userId).select("permissions status");

        if (!user || user.status !== "active") {
          await logPermissionDenied(
            userId,
            permissions.join(", "),
            req.originalUrl,
            req.ip,
            "User account is not active or not found"
          );

          return res.status(403).json({
            error: "Access denied",
          });
        }

        // Check if user has any of the permissions
        const hasPermission = permissions.some((p) =>
          user.permissions.includes(p)
        );

        if (!hasPermission) {
          await logPermissionDenied(
            userId,
            permissions.join(", "),
            req.originalUrl,
            req.ip,
            "Insufficient permissions (requires any)"
          );

          return res.status(403).json({
            error: "Access denied. Insufficient permissions.",
            requiredPermissions: permissions,
          });
        }
      } else {
        // Trust JWT for non-critical
        const hasPermission = permissions.some((p) =>
          userPermissions.includes(p)
        );

        if (!hasPermission) {
          await logPermissionDenied(
            userId,
            permissions.join(", "),
            req.originalUrl,
            req.ip,
            "Insufficient permissions (JWT, requires any)"
          );

          return res.status(403).json({
            error: "Access denied. Insufficient permissions.",
            requiredPermissions: permissions,
          });
        }
      }

      next();
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({
        error: "Error checking permissions",
      });
    }
  };
};

/**
 * Require all specified permissions
 * @param {Array} permissions - Array of permissions (user needs all)
 */
const requireAllPermissions = (permissions) => {
  return async (req, res, next) => {
    try {
      const { userId, permissions: userPermissions } = req.user;

      // Check if any permission is critical
      const hasCritical = permissions.some((p) => isCriticalPermission(p));

      if (hasCritical) {
        const user = await User.findById(userId).select("permissions status");

        if (!user || user.status !== "active") {
          await logPermissionDenied(
            userId,
            permissions.join(", "),
            req.originalUrl,
            req.ip,
            "User account is not active or not found"
          );

          return res.status(403).json({
            error: "Access denied",
          });
        }

        // Check if user has all permissions
        const hasAllPermissions = permissions.every((p) =>
          user.permissions.includes(p)
        );

        if (!hasAllPermissions) {
          await logPermissionDenied(
            userId,
            permissions.join(", "),
            req.originalUrl,
            req.ip,
            "Insufficient permissions (requires all)"
          );

          return res.status(403).json({
            error: "Access denied. Insufficient permissions.",
            requiredPermissions: permissions,
          });
        }
      } else {
        // Trust JWT for non-critical
        const hasAllPermissions = permissions.every((p) =>
          userPermissions.includes(p)
        );

        if (!hasAllPermissions) {
          await logPermissionDenied(
            userId,
            permissions.join(", "),
            req.originalUrl,
            req.ip,
            "Insufficient permissions (JWT, requires all)"
          );

          return res.status(403).json({
            error: "Access denied. Insufficient permissions.",
            requiredPermissions: permissions,
          });
        }
      }

      next();
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({
        error: "Error checking permissions",
      });
    }
  };
};

/**
 * Require admin permission (shorthand)
 */
const requireAdmin = () => {
  return requirePermission("manage_users");
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireAdmin,
};
