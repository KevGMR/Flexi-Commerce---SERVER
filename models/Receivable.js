const mongoose = require("mongoose");

const receivableSchema = new mongoose.Schema(
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
    saleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      required: true,
      unique: true,
      index: true,
    },
    customerId: mongoose.Schema.Types.ObjectId,
    customerName: String,
    totalDue: {
      type: Number,
      required: true,
      min: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      required: true,
      min: 0,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "partial", "paid", "cancelled"],
      default: "open",
      index: true,
    },
    payments: [
      {
        method: {
          type: String,
          enum: ["cash", "card", "mobile", "check", "credit", "mpesa"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        reference: String,
        status: {
          type: String,
          enum: ["completed", "pending", "failed"],
          default: "completed",
        },
        cardLast4: String,
        cardBrand: String,
        collectedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        collectedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastPaymentAt: Date,
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

receivableSchema.index({ organizationId: 1, locationId: 1, status: 1, createdAt: -1 });
receivableSchema.index({ organizationId: 1, status: 1, balanceDue: -1, createdAt: -1 });

module.exports = mongoose.model("Receivable", receivableSchema);
