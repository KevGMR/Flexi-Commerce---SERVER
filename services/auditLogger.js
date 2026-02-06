const TokenAuditLog = require("../models/TokenAuditLog");
const PermissionHistory = require("../models/PermissionHistory");
const RefreshToken = require("../models/RefreshToken");

/**
 * Log token-related event
 * @param {String} userId - User ID
 * @param {String} organizationId - Organization ID (tenant context)
 * @param {String} eventType - Event type
 * @param {String} ipAddress - IP address
 * @param {String} userAgent - User agent
 * @param {Object} details - Additional details
 */
const logTokenEvent = async (
  userId,
  organizationId,
  eventType,
  ipAddress,
  userAgent,
  details = {}
) => {
  try {
    const auditLog = new TokenAuditLog({
      userId,
      organizationId,
      eventType,
      ipAddress,
      userAgent,
      ...details,
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging token event:", error);
  }
};

/**
 * Log failed authentication attempt
 * @param {String} email - Email attempted
 * @param {String} ipAddress - IP address
 * @param {String} reason - Failure reason
 */
const logFailedAuth = async (email, ipAddress, reason) => {
  try {
    const auditLog = new TokenAuditLog({
      email,
      eventType: "login_failed",
      ipAddress,
      details: reason,
      success: false,
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging failed auth:", error);
  }
};

/**
 * Log permission denied event
 * @param {String} userId - User ID
 * @param {String} permission - Permission denied
 * @param {String} endpoint - API endpoint
 * @param {String} ipAddress - IP address
 * @param {String} reason - Denial reason
 */
const logPermissionDenied = async (
  userId,
  permission,
  endpoint,
  ipAddress,
  reason = "Insufficient permissions"
) => {
  try {
    const auditLog = new TokenAuditLog({
      userId,
      eventType: "permission_denied",
      permission,
      endpoint,
      ipAddress,
      details: reason,
      success: false,
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging permission denied:", error);
  }
};

/**
 * Log password reset event
 * @param {String} userId - User ID
 * @param {String} ipAddress - IP address
 */
const logPasswordReset = async (userId, ipAddress) => {
  try {
    const auditLog = new TokenAuditLog({
      userId,
      eventType: "password_reset",
      ipAddress,
      details: "Password reset completed, all tokens revoked",
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging password reset:", error);
  }
};

/**
 * Log role/permission change
 * @param {String} adminId - Admin who made change
 * @param {String} targetUserId - User whose permissions changed
 * @param {String} changeType - Type of change
 * @param {String} permission - Specific permission (if applicable)
 * @param {Array} oldPermissions - Old permissions
 * @param {Array} newPermissions - New permissions
 * @param {Object} details - Additional details
 */
const logRolePermissionChange = async (
  adminId,
  targetUserId,
  changeType,
  permission,
  oldPermissions,
  newPermissions,
  details = {}
) => {
  try {
    const auditLog = new TokenAuditLog({
      userId: targetUserId,
      adminId,
      eventType: changeType,
      permission,
      oldPermissions,
      newPermissions,
      ...details,
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging role/permission change:", error);
  }
};

/**
 * Log user status change (deactivation, ban, reactivation)
 * @param {String} adminId - Admin who made change
 * @param {String} targetUserId - User whose status changed
 * @param {String} newStatus - New status
 * @param {String} reason - Reason for change
 */
const logUserStatusChange = async (
  adminId,
  targetUserId,
  newStatus,
  reason
) => {
  try {
    let eventType;
    if (newStatus === "banned") eventType = "user_banned";
    else if (newStatus === "inactive") eventType = "user_deactivated";
    else if (newStatus === "active") eventType = "user_reactivated";

    const auditLog = new TokenAuditLog({
      userId: targetUserId,
      adminId,
      eventType,
      details: reason,
      reason,
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging user status change:", error);
  }
};

/**
 * Log role change
 * @param {String} adminId - Admin who made change
 * @param {String} roleId - Role ID
 * @param {String} action - Action (created, updated, deleted)
 * @param {Object} details - Additional details
 */
const logRoleChange = async (adminId, roleId, action, details = {}) => {
  try {
    const auditLog = new TokenAuditLog({
      adminId,
      eventType: "role_changed",
      details: `Role ${action}: ${roleId}`,
      ...details,
    });

    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error("Error logging role change:", error);
  }
};

/**
 * Save permission history for restoration
 * @param {String} userId - User ID
 * @param {String} adminId - Admin who made change
 * @param {String} changeType - Type of change
 * @param {String} permission - Specific permission
 * @param {Array} oldPermissions - Old permissions
 * @param {Array} newPermissions - New permissions
 * @param {String} reason - Reason for change
 * @returns {Object} Permission history document
 */
const savePermissionHistory = async (
  userId,
  adminId,
  changeType,
  permission,
  oldPermissions,
  newPermissions,
  reason = ""
) => {
  try {
    const history = new PermissionHistory({
      userId,
      adminId,
      changeType,
      permission,
      oldPermissions,
      newPermissions,
      reason,
      restorable: true,
    });

    await history.save();
    return history;
  } catch (error) {
    console.error("Error saving permission history:", error);
    throw error;
  }
};

/**
 * Revoke all user tokens
 * @param {String} userId - User ID
 * @param {String} reason - Revocation reason
 */
const revokeAllUserTokens = async (userId, reason) => {
  try {
    const result = await RefreshToken.updateMany(
      { userId, revoked: false },
      {
        $set: {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: reason,
        },
      }
    );

    await logTokenEvent(userId, null, "token_revoked", "system", "system", {
      details: `All tokens revoked: ${reason}`,
      reason,
    });

    return result;
  } catch (error) {
    console.error("Error revoking all user tokens:", error);
    throw error;
  }
};

/**
 * Get token history for user
 * @param {String} userId - User ID
 * @param {String} deviceId - Optional device ID filter
 * @param {Number} limit - Limit results
 * @returns {Array} Audit logs
 */
const getTokenHistory = async (userId, deviceId = null, limit = 50) => {
  try {
    const query = { userId };
    if (deviceId) {
      query.deviceId = deviceId;
    }

    const logs = await TokenAuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("adminId", "fullname email");

    return logs;
  } catch (error) {
    console.error("Error getting token history:", error);
    throw error;
  }
};

module.exports = {
  logTokenEvent,
  logFailedAuth,
  logPermissionDenied,
  logPasswordReset,
  logRolePermissionChange,
  logUserStatusChange,
  logRoleChange,
  savePermissionHistory,
  revokeAllUserTokens,
  getTokenHistory,
};
