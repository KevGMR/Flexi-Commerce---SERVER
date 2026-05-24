const mongoose = require("mongoose");

const shiftSessionSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    cashierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    shiftCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
    openedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    closedAt: Date,
    openingCash: {
      type: Number,
      default: 0,
      min: 0,
    },
    expectedCashSales: {
      type: Number,
      default: 0,
    },
    expectedClosingCash: {
      type: Number,
      default: 0,
    },
    closingCash: {
      type: Number,
      default: 0,
      min: 0,
    },
    cashVariance: {
      type: Number,
      default: 0,
    },
    reconciliationStatus: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
      index: true,
    },
    reconciliationSessionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ReconciliationSession",
      },
    ],
    openNotes: String,
    closeNotes: String,
    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

shiftSessionSchema.index({ organizationId: 1, locationId: 1, cashierId: 1, status: 1 });
shiftSessionSchema.index({ organizationId: 1, openedAt: -1 });

module.exports = mongoose.model("ShiftSession", shiftSessionSchema);
