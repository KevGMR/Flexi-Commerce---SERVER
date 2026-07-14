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

userOrganizationSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
userOrganizationSchema.index({ organizationId: 1 });
userOrganizationSchema.index({ status: 1 });

module.exports = mongoose.model("UserOrganization", userOrganizationSchema);
