const mongoose = require("mongoose");

const journalLineSchema = new mongoose.Schema(
  {
    accountCode: {
      type: String,
      required: true,
    },
    accountName: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
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
    periodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingPeriod",
      index: true,
    },
    expenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      index: true,
      sparse: true,
    },
    entryCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ["expense", "shift_closure", "manual"],
      required: true,
      index: true,
    },
    entryDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    description: {
      type: String,
      required: true,
    },
    reference: String,
    debitLines: {
      type: [journalLineSchema],
      default: [],
    },
    creditLines: {
      type: [journalLineSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["posted", "draft", "reversed", "skipped"],
      default: "posted",
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
  },
  { timestamps: true }
);

journalEntrySchema.index({ organizationId: 1, sourceType: 1, entryDate: -1 });

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
