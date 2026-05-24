const mongoose = require("mongoose");

const zReportSchema = new mongoose.Schema(
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
    shiftSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShiftSession",
      required: true,
      unique: true,
      index: true,
    },
    reportCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    reportDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    summary: {
      openingCash: {
        type: Number,
        default: 0,
      },
      expectedCashSales: {
        type: Number,
        default: 0,
      },
      expectedClosingCash: {
        type: Number,
        default: 0,
      },
      countedClosingCash: {
        type: Number,
        default: 0,
      },
      variance: {
        type: Number,
        default: 0,
      },
    },
    notes: String,
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

zReportSchema.index({ organizationId: 1, reportDate: -1 });

module.exports = mongoose.model("ZReport", zReportSchema);
