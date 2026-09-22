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

    sku: { type: String, required: true },        // synthesized: SHOP-{variantNumericId}
    sourceSku: { type: String, default: null },   // original Shopify sku (usually null)

    // ---- Shopify migration fields ----
    shopifyId: { type: String },
    shopifyNumericId: { type: Number },
    inventoryItemId: { type: String },            // gid://shopify/InventoryItem/...
    selectedOptions: [
      {
        name: { type: String, required: true },
        value: { type: String, required: true },
      },
    ],

    price: Number,
    compareAtPrice: Number,
    cost: Number,
    weight: Number,
    weightUnit: String,
    images: [
      {
        url: String,
        alt: String,
        isDefault: Boolean,
      },
    ],
    metafields: [
      {
        key: String,
        value: String,
        namespace: { type: String, default: "custom" },
      },
    ],
    barcode: String,
    digitalContent: {
      downloadUrl: String,
      fileName: String,
    },
    position: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    trackInventory: Boolean,
    taxClass: String,
    continueSellingWhenOutOfStock: { type: Boolean, default: false },
  },
  { timestamps: true }
);

variantSchema.index({ organizationId: 1, productId: 1 });
variantSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
variantSchema.index({ organizationId: 1, status: 1 });
variantSchema.index({ productId: 1, position: 1 });
variantSchema.index(
  { organizationId: 1, shopifyNumericId: 1 },
  {
    unique: true,
    partialFilterExpression: { shopifyNumericId: { $type: "number" } },
  }
);

const Variant = mongoose.model("Variant", variantSchema);
module.exports = Variant;