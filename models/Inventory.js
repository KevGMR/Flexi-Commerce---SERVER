const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const inventorySchema = new Schema(
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
    // Inventory quantities
    onHand: {
      type: Number,
      default: 0,
      min: 0,
    },
    available: {
      type: Number,
      default: 0,
      min: 0,
      // Calculated: onHand - committed
    },
    committed: {
      type: Number,
      default: 0,
      min: 0,
      // Reserved for orders
    },
    unavailable: {
      type: Number,
      default: 0,
      min: 0,
      // Damaged, lost, etc.
    },
    // Reorder levels
    reorderPoint: Number,
    reorderQuantity: Number,
    // Last audit
    lastAuditedAt: Date,
    auditedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Compound unique index: one inventory record per variant per location
inventorySchema.index(
  { organizationId: 1, variantId: 1, locationId: 1 },
  { unique: true }
);

// Indexes for queries
inventorySchema.index({ organizationId: 1, locationId: 1 });
inventorySchema.index({ organizationId: 1, variantId: 1 });

const Inventory = mongoose.model("Inventory", inventorySchema);

module.exports = Inventory;
