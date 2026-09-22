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

    // Relaxed: negatives allowed (Shopify oversell history)
    onHand: { type: Number, default: 0 },
    available: { type: Number, default: 0 },

    committed: { type: Number, default: 0, min: 0 },
    unavailable: { type: Number, default: 0, min: 0 },

    reorderPoint: Number,
    reorderQuantity: Number,
    lastAuditedAt: Date,
    auditedBy: { type: Schema.Types.ObjectId, ref: "User" },

    // migration traceability
    importedAt: Date,
    migratedFromQuantity: Number, // raw value from export (for audit)
  },
  { timestamps: true }
);

inventorySchema.index(
  { organizationId: 1, variantId: 1, locationId: 1 },
  { unique: true }
);
inventorySchema.index({ organizationId: 1, locationId: 1 });
inventorySchema.index({ organizationId: 1, variantId: 1 });

const Inventory = mongoose.model("Inventory", inventorySchema);
module.exports = Inventory;