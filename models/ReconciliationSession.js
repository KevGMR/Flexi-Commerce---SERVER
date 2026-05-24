const mongoose = require("mongoose");

const reconciliationLineSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ["cash", "card", "mobile", "check", "credit", "mpesa"],
      required: true,
    },
    expectedAmount: {
      type: Number,
      default: 0,
    },
    countedAmount: {
      type: Number,
      default: 0,
    },
    settledAmount: {
      type: Number,
      default: 0,
    },
    varianceAmount: {
      type: Number,
      default: 0,
    },
    reference: String,
    notes: String,
  },
  { _id: false }
);

const reconciliationSessionSchema = new mongoose.Schema(
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
      index: true,
    },
    sessionCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    windowStart: {
      type: Date,
      required: true,
      index: true,
    },
    windowEnd: {
      type: Date,
      required: true,
      index: true,
    },
    expectedByMethod: {
      type: [reconciliationLineSchema],
      default: [],
    },
    countedByMethod: {
      type: [reconciliationLineSchema],
      default: [],
    },
    totalExpected: {
      type: Number,
      default: 0,
    },
    totalCounted: {
      type: Number,
      default: 0,
    },
    totalVariance: {
      type: Number,
      default: 0,
    },
    varianceThreshold: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["open", "reconciled", "needs_review"],
      default: "open",
      index: true,
    },
    notes: String,
    submittedAt: Date,
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

reconciliationSessionSchema.index({ organizationId: 1, locationId: 1, windowStart: -1 });
reconciliationSessionSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("ReconciliationSession", reconciliationSessionSchema);
