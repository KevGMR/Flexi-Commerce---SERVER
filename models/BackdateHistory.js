const mongoose = require("mongoose");

const backdateHistorySchema = new mongoose.Schema(
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
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShiftSession",
      required: true,
      index: true,
    },
    targetDate: {
      type: Date,
      required: true,
    },
    // Snapshot of the state before backdate
    originalState: {
      shift: { type: mongoose.Schema.Types.Mixed, required: true },
      sales: { type: [mongoose.Schema.Types.Mixed], required: true },
      receivables: { type: [mongoose.Schema.Types.Mixed], required: true },
      expenses: { type: [mongoose.Schema.Types.Mixed], required: true },
      deliveryFees: { type: [mongoose.Schema.Types.Mixed], required: true },
      zReports: { type: [mongoose.Schema.Types.Mixed], required: true },
    },
    // Summary of what was changed
    changes: {
      salesCount: { type: Number, default: 0 },
      salesIds: { type: [mongoose.Schema.Types.ObjectId], ref: "Sale" },
      expensesCount: { type: Number, default: 0 },
      expenseIds: { type: [mongoose.Schema.Types.ObjectId], ref: "Expense" },
      deliveryFeesCount: { type: Number, default: 0 },
      deliveryFeeIds: { type: [mongoose.Schema.Types.ObjectId], ref: "DeliveryFee" },
      receivablesCount: { type: Number, default: 0 },
      receivableIds: { type: [mongoose.Schema.Types.ObjectId], ref: "Receivable" },
      zReportsCount: { type: Number, default: 0 },
      zReportIds: { type: [mongoose.Schema.Types.ObjectId], ref: "ZReport" },
    },
    status: {
      type: String,
      enum: ["applied", "rolled-back"],
      default: "applied",
      index: true,
    },
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    rolledBackBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rolledBackAt: Date,
    rollbackReason: String,
    notes: String,
  },
  { timestamps: true }
);

backdateHistorySchema.index({ organizationId: 1, appliedAt: -1 });
backdateHistorySchema.index({ shiftId: 1, status: 1 });

module.exports = mongoose.model("BackdateHistory", backdateHistorySchema);