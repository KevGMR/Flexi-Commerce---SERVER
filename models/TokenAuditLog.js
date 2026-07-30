// server/models/TokenAuditLog.js

const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const tokenAuditLogSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
    },
    email: {
      type: String, // For failed login attempts where user doesn't exist
    },
    deviceId: {
      type: String,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        "login_success",
        "login_failed",
        "token_issued",
        "token_rotated",
        "token_revoked",
        "logout",
        "permission_denied",
        "permission_granted",
        "permission_revoked",
        "role_changed",
        "user_registered",
        "user_deactivated",
        "user_reactivated",
        "user_banned",
        "password_reset",
        "password_reset_requested",
        "email_verified",
        "email_verification_sent",
        "email_verification_resent",
        "org_switched",
        "organization_created",
        "user_invited",
        "org_updated", 
        "member_removed",
        "member_locations_updated",
        "location_updated",
        "attempted_use_revoked_token",
        "security_breach",
        "location_created",
        "delivery_category_updated",
        "delivery_category_created",
        "delivery_option_updated",
        "delivery_option_created",
        "product_updated",
        "product_created",
        "invitation_resent",
        "user_permissions_synced",
        "backdate_applied",
        "backdate_rolled_back"
      ],
    },
    permission: {
      type: String, // Specific permission involved (for permission_denied events)
    },
    permissions: {
      type: [String], // Array of permissions (for snapshot)
    },
    oldPermissions: {
      type: [String], // Permissions before change
    },
    newPermissions: {
      type: [String], // Permissions after change
    },
    endpoint: {
      type: String, // API endpoint accessed
    },
    details: {
      type: String, // Additional context
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User", // Admin who performed the action
    },
    reason: {
      type: String, // Reason for action (e.g., why user was banned)
    },
    success: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Indexes for faster queries
tokenAuditLogSchema.index({ userId: 1, createdAt: -1 });
tokenAuditLogSchema.index({ organizationId: 1, createdAt: -1 });
tokenAuditLogSchema.index({ eventType: 1, createdAt: -1 });
tokenAuditLogSchema.index({ ipAddress: 1, createdAt: -1 });
tokenAuditLogSchema.index({ permission: 1, createdAt: -1 });

// TTL index to auto-delete logs after 120 days
tokenAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 10368000 }); // 120 days

const TokenAuditLog = mongoose.model("TokenAuditLog", tokenAuditLogSchema);

module.exports = TokenAuditLog;
