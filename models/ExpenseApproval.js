const mongoose = require("mongoose");

const expenseApprovalSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    expenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["submitted", "approved", "rejected"],
      required: true,
      index: true,
    },
    notes: String,
    actedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

expenseApprovalSchema.index({ organizationId: 1, expenseId: 1, actedAt: -1 });

module.exports = mongoose.model("ExpenseApproval", expenseApprovalSchema);
