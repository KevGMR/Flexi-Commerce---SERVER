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
    taxMode: {
      type: String,
      enum: ["inclusive", "exclusive"],
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
    // NEW: Toggle for enabling product cost on services
    enableProductCost: {
      type: Boolean,
      default: false,
    },
    // Delivery fee settings (legacy - kept for backward compatibility)
    deliveryFeeSettings: {
      enableDeliveryFees: {
        type: Boolean,
        default: true,
      },
      taxDeliveryFees: {
        type: Boolean,
        default: true, // Use location tax rate for delivery fees
      },
      standardFee: {
        type: Number,
        default: 5.0,
        min: 0,
      },
      expressFee: {
        type: Number,
        default: 10.0,
        min: 0,
      },
      overnightFee: {
        type: Number,
        default: 15.0,
        min: 0,
      },
      defaultFeeType: {
        type: String,
        enum: ["standard", "express", "overnight", "custom"],
        default: "standard",
      },
      allowCustomFees: {
        type: Boolean,
        default: true,
      },
    },
    // Delivery categories (customizable per organization)
    deliveryCategories: [
      {
        _id: Schema.Types.ObjectId,
        categoryName: {
          type: String,
          required: true,
        },
        description: String,
        isActive: {
          type: Boolean,
          default: true,
        },
        // Custom status workflow for this category
        statusWorkflow: [
          {
            status: String,
            displayName: String,
            order: Number,
          },
        ],
        // Child options under this category
        childOptions: [
          {
            _id: Schema.Types.ObjectId,
            optionName: {
              type: String,
              required: true,
            },
            price: {
              type: Number,
              required: true,
              min: 0,
            },
            estimatedDays: Number,
            description: String,
            isActive: {
              type: Boolean,
              default: true,
            },
          },
        ],
        createdAt: Date,
        updatedAt: Date,
      },
    ],
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