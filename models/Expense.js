// server/models/Expense.js

const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
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
    expenseCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expenseDate: {
      type: Date,
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "mobile", "mpesa", "bank_transfer", "check", "credit", "other"],
      default: "cash",
    },
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "unpaid",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected"],
      default: "draft",
      index: true,
    },
    vendorName: {
      type: String,
      trim: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    submittedAt: Date,
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectedAt: Date,
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },
    shiftSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShiftSession",
      index: true,
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
    // Transaction Audit & Validation
    validationStatus: {
      type: String,
      enum: ["pending", "validated", "disputed"],
      default: "pending",
      index: true,
    },
    validatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
    },
    validatedAt: Date,
    validationNotes: String,
  },
  { timestamps: true }
);

expenseSchema.index({ organizationId: 1, locationId: 1, expenseDate: -1 });
expenseSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
expenseSchema.index({ shiftSessionId: 1, validationStatus: 1 }); // Shift expenses & validation

expenseSchema.pre("validate", function preValidate() {
  if (!this.expenseCode) {
    const orgSuffix = String(this.organizationId || "ORG").slice(-6).toUpperCase();
    this.expenseCode = `EXP-${orgSuffix}-${Date.now()}`;
  }
});

module.exports = mongoose.model("Expense", expenseSchema);
