const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const locationSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    locationType: {
      type: String,
      enum: ["warehouse", "retail", "fulfillment"],
      default: "warehouse",
    },
    // Address
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    phone: String,
    email: String,
    // Tax settings (per location/region)
    taxRate: {
      type: Number,
      default: 0,
    },
    taxId: String, // Tax registration ID for this location
    // Currency (for multi-currency support in future)
    currency: {
      type: String,
      default: "USD",
    },
    // Default location (for orders if not specified)
    isDefault: {
      type: Boolean,
      default: false,
    },
    // Status
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    // Metafield definitions for this location (overrides org-level)
    metafieldDefinitions: [
      {
        key: String,
        namespace: String,
        options: [String],
      },
    ],
    // Shopify location mapping (for multi-location inventory sync)
    shopifyLocationId: String, // e.g., "gid://shopify/Location/123456"
    shopifyLocationName: String, // Human-readable name from Shopify (snapshot)
    shopifyLocationActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Indexes
locationSchema.index({ organizationId: 1, status: 1 });
locationSchema.index({ organizationId: 1, isDefault: 1 });

const Location = mongoose.model("Location", locationSchema);

module.exports = Location;
