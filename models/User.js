const mongoose = require("mongoose");

const Schema = mongoose.Schema;

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
  },
  { timestamps: true }
);

// Indexes for faster queries
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });

const User = mongoose.model("User", userSchema);

module.exports = User;
