const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const refreshTokenSchema = new Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    deviceName: {
      type: String,
      default: "Unknown Device",
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      required: true,
    },
    requestId: {
      type: String,
      required: true,
    },
    issuedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revoked: {
      type: Boolean,
      default: false,
    },
    revokedAt: {
      type: Date,
    },
    revokedReason: {
      type: String,
      enum: [
        "user_logout",
        "user_initiated",
        "permission_revoked",
        "permission_granted",
        "user_deactivated",
        "ban",
        "password_reset",
        "role_changed",
        "token_rotated",
        "expired",
        "security_breach",
      ],
    },
    rotatedFrom: {
      type: Schema.Types.ObjectId,
      ref: "RefreshToken",
    },
  },
  { timestamps: true }
);

// Index for faster queries
refreshTokenSchema.index({ userId: 1, deviceId: 1, organizationId: 1 });
refreshTokenSchema.index({ organizationId: 1, revoked: 1 });
refreshTokenSchema.index({ revoked: 1 });

// TTL index to automatically delete expired tokens after 30 days
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

module.exports = RefreshToken;
