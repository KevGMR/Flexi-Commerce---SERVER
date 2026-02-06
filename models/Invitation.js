const mongoose = require("mongoose");
const { Schema } = mongoose;

const invitationSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      default: "Employee",
      enum: ["Owner", "Manager", "Cashier", "Employee"],
    },
    permissions: {
      type: [String],
      default: [],
    },
    locations: {
      type: [String],
      default: [],
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "accepted", "revoked", "expired"],
    },
    acceptedAt: Date,
    acceptedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

invitationSchema.index({ organizationId: 1, status: 1 });
invitationSchema.index({ email: 1, organizationId: 1 });
invitationSchema.index({ token: 1 });
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired

module.exports = mongoose.model("Invitation", invitationSchema);
