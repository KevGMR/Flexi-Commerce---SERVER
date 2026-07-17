const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Sub‑schema for commission overrides
const commissionOverrideSchema = new Schema({
  serviceId: {
    type: String,  // was: type: Schema.Types.ObjectId, ref: 'Product'
    required: true,
  },
  commissionType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  },
  commissionValue: {
    type: Number,
    required: true,
    min: 0,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const userSchema = new Schema(
  {
    fullname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
    },
    status: {
      type: String,
      default: "active",
      enum: ["active", "inactive", "banned"],
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
    },
    emailVerificationExpiry: {
      type: Date,
    },
    passwordResetToken: {
      type: String,
    },
    passwordResetExpiry: {
      type: Date,
    },
    lastLogin: {
      type: Date,
    },
    lastPasswordReset: {
      type: Date,
    },
    lastPermissionChange: {
      type: Date,
    },
    // NEW: commission overrides per service (serviceId can be product ID or composite key)
    commissionOverrides: {
      type: [commissionOverrideSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Existing indexes
userSchema.index({ status: 1 });

const User = mongoose.model("User", userSchema);

module.exports = User;