const mongoose = require("mongoose");
const { Schema } = mongoose;

const userOrganizationSchema = new Schema(
  {
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
    role: {
      type: String,
      default: "Employee",
    },
    permissions: {
      type: [String],
      default: [],
    },
    customPermissions: { type: [String], default: [] },
    locations: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      default: "active",
      enum: ["active", "inactive"],
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Compound unique: a user may belong to many organizations, but only once
// per organization. Do NOT change this to a single-field unique on userId.
userOrganizationSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
userOrganizationSchema.index({ organizationId: 1, status: 1 });
userOrganizationSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("UserOrganization", userOrganizationSchema);