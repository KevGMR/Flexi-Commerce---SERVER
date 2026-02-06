const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const productSchema = new Schema(
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
    description: {
      type: String,
      default: "",
    },
    sku: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["physical", "digital"],
      default: "physical",
    },
    status: {
      type: String,
      enum: ["active", "archived", "draft"],
      default: "active",
    },
    // Pricing (default for variants)
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    compareAtPrice: {
      type: Number,
      min: 0,
    },
    cost: {
      type: Number,
      min: 0,
    },
    // Physical product defaults
    weight: {
      type: Number,
      min: 0,
    },
    weightUnit: {
      type: String,
      enum: ["kg", "g", "lb", "oz"],
      default: "kg",
    },
    // Images (URLs from Shopify or other CDN)
    images: [
      {
        url: String,
        alt: String,
        isDefault: Boolean,
      },
    ],
    // Metadata and collections
    tags: [String],
    collectionIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Collection",
      },
    ],
    // Variant metafields (template)
    metafieldDefinitions: [
      {
        key: String,
        namespace: String,
        required: Boolean,
      },
    ],
    // Vendor/supplier info
    vendor: String,
    // SEO
    seoTitle: String,
    seoDescription: String,
    // Inventory tracking settings
    trackInventory: {
      type: Boolean,
      default: true,
    },
    // Settings
    published: {
      type: Boolean,
      default: false,
    },
    publishedAt: Date,
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes
productSchema.index({ organizationId: 1, status: 1 });
productSchema.index({ organizationId: 1, name: 1 });
productSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
productSchema.index({ organizationId: 1, tags: 1 });
productSchema.index({ organizationId: 1, collectionIds: 1 });
productSchema.index({ organizationId: 1, createdAt: -1 });

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
