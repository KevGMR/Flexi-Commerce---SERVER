const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const variantSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // SKU (can override product SKU)
    sku: {
      type: String,
      required: true,
    },
    // Pricing (override product defaults)
    price: Number,
    compareAtPrice: Number,
    cost: Number,
    // Physical attributes
    weight: Number,
    weightUnit: String,
    // Variant-specific images
    images: [
      {
        url: String,
        alt: String,
        isDefault: Boolean,
      },
    ],
    // Metafields (custom key-value pairs)
    // Example: { key: "color", value: "red" }, { key: "size", value: "M" }
    metafields: [
      {
        key: String,
        value: String,
        namespace: {
          type: String,
          default: "custom",
        },
      },
    ],
    // Barcode
    barcode: String,
    // Digital product (if product type is digital)
    digitalContent: {
      downloadUrl: String,
      fileName: String,
    },
    // Variant position in product
    position: Number,
    // Status
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    // Inventory tracking settings (can override product)
    trackInventory: Boolean,
    // Tax class
    taxClass: String,
  },
  { timestamps: true }
);

// Indexes
variantSchema.index({ organizationId: 1, productId: 1 });
variantSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
variantSchema.index({ organizationId: 1, status: 1 });
variantSchema.index({ productId: 1, position: 1 });

const Variant = mongoose.model("Variant", variantSchema);

module.exports = Variant;
