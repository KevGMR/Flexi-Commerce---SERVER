const User = require("../models/User");
const TokenAuditLog = require("../models/TokenAuditLog");

/**
 * Check if user status is active
 * This middleware should run after verifyToken
 */
const checkUserStatus = async (req, res, next) => {
  try {
    const { userId } = req.user;

    // Fetch user from database
    const user = await User.findById(userId).select("status");

    if (!user) {
      return res.status(401).json({
        error: "User not found",
      });
    }

    // Check if user is active
    if (user.status === "banned") {
      // Log banned user access attempt
      await new TokenAuditLog({
        userId,
        eventType: "attempted_use_revoked_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        details: "Banned user attempted to access system",
        success: false,
      }).save();

      return res.status(403).json({
        error: "Your account has been banned. Please contact support.",
        code: "ACCOUNT_BANNED",
      });
    }

    if (user.status === "inactive") {
      // Log inactive user access attempt
      await new TokenAuditLog({
        userId,
        eventType: "attempted_use_revoked_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        details: "Inactive user attempted to access system",
        success: false,
      }).save();

      return res.status(403).json({
        error: "Your account is inactive. Please contact support.",
        code: "ACCOUNT_INACTIVE",
      });
    }

    // User is active, proceed
    next();
  } catch (error) {
    console.error("User status check error:", error);
    res.status(500).json({
      error: "Error checking user status",
    });
  }
};

module.exports = {
  checkUserStatus,
};
