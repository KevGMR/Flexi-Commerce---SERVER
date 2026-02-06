const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const permissionHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changeType: {
      type: String,
      required: true,
      enum: [
        "permission_granted",
        "permission_revoked",
        "role_changed",
        "permissions_restored",
        "bulk_update",
      ],
    },
    permission: {
      type: String, // Specific permission changed (if single permission)
    },
    oldPermissions: {
      type: [String],
      required: true,
    },
    newPermissions: {
      type: [String],
      required: true,
    },
    oldRole: {
      type: String,
    },
    newRole: {
      type: String,
    },
    reason: {
      type: String,
    },
    restorable: {
      type: Boolean,
      default: true, // Can this change be restored?
    },
    restored: {
      type: Boolean,
      default: false,
    },
    restoredAt: {
      type: Date,
    },
    restoredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    restoreCount: {
      type: Number,
      default: 0, // Track how many times permissions have been restored
    },
  },
  { timestamps: true }
);

// Indexes for faster queries
permissionHistorySchema.index({ userId: 1, createdAt: -1 });
permissionHistorySchema.index({ adminId: 1, createdAt: -1 });
permissionHistorySchema.index({ changeType: 1, createdAt: -1 });
permissionHistorySchema.index({ restorable: 1, restored: 1 });

const PermissionHistory = mongoose.model(
  "PermissionHistory",
  permissionHistorySchema
);

module.exports = PermissionHistory;
