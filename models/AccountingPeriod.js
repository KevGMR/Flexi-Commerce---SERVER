// server/models/AccountingPeriod.js

const mongoose = require("mongoose");

const accountingPeriodSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      index: true,
    },
    periodCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "closed", "locked"],
      default: "open",
      index: true,
    },
    closedAt: Date,
    lockedAt: Date,
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    notes: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

accountingPeriodSchema.index({ organizationId: 1, locationId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("AccountingPeriod", accountingPeriodSchema);
