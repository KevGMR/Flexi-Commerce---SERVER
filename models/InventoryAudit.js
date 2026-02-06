const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const inventoryAuditSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "Variant",
      required: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    // Event type
    eventType: {
      type: String,
      enum: [
        "manual_adjustment",
        "order_reserved", // committed
        "order_fulfilled", // onHand decreased
        "order_cancelled", // committed released
        "purchase_order_received",
        "transfer_sent",
        "transfer_received",
        "inventory_count",
        "damage_reported",
        "loss_reported",
      ],
    },
    // Change amounts
    previousValues: {
      onHand: Number,
      available: Number,
      committed: Number,
      unavailable: Number,
    },
    newValues: {
      onHand: Number,
      available: Number,
      committed: Number,
      unavailable: Number,
    },
    // Reference to related record
    reference: {
      type: String, // order ID, PO ID, transfer ID
    },
    referenceType: {
      type: String, // "order", "purchase_order", "transfer"
    },
    // User who made the change
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reason: String,
    notes: String,
  },
  { timestamps: true }
);

// Indexes
inventoryAuditSchema.index({ organizationId: 1, variantId: 1 });
inventoryAuditSchema.index({ organizationId: 1, locationId: 1 });
inventoryAuditSchema.index({ organizationId: 1, createdAt: -1 });
inventoryAuditSchema.index({ reference: 1, referenceType: 1 });

const InventoryAudit = mongoose.model("InventoryAudit", inventoryAuditSchema);

module.exports = InventoryAudit;
