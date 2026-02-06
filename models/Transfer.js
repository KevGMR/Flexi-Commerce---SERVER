const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const transferSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // Transfer details
    transferNumber: {
      type: String,
      required: true,
    },
    fromLocationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    toLocationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    // Items being transferred
    items: [
      {
        variantId: {
          type: Schema.Types.ObjectId,
          ref: "Variant",
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        receivedQuantity: {
          type: Number,
          default: 0,
        },
      },
    ],
    // Status
    status: {
      type: String,
      enum: ["pending", "in_transit", "delivered", "cancelled"],
      default: "pending",
    },
    // Dates
    initiatedAt: {
      type: Date,
      default: Date.now,
    },
    shippedAt: Date,
    deliveredAt: Date,
    // Initiated by / Received by
    initiatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    // Notes
    notes: String,
    reason: {
      type: String,
      enum: ["rebalancing", "fulfillment", "storage_optimization", "other"],
    },
  },
  { timestamps: true }
);

// Indexes
transferSchema.index({ organizationId: 1, status: 1 });
transferSchema.index({ organizationId: 1, transferNumber: 1 }, { unique: true });
transferSchema.index({ organizationId: 1, fromLocationId: 1 });
transferSchema.index({ organizationId: 1, toLocationId: 1 });
transferSchema.index({ organizationId: 1, createdAt: -1 });

const Transfer = mongoose.model("Transfer", transferSchema);

module.exports = Transfer;
