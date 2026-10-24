const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const productSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: { type: String, required: true },
    description: { type: String, default: "" },

    // ---- Shopify migration fields ----
    shopifyId: { type: String },
    shopifyNumericId: { type: Number },
    handle: { type: String },
    productType: { type: String, default: "" },
    sourceCreatedAt: Date,
    sourceUpdatedAt: Date,
    importedAt: Date,
    migrationFlags: { type: [String], default: [] },

    // ---- Product-level options (mirrors Shopify) ----
    options: [
      {
        name: { type: String, required: true },
        position: { type: Number, default: 0 },
        values: { type: [String], default: [] },
      },
    ],

    // ---- Product-level metafields ----
    metafields: [
      {
        namespace: { type: String, required: true },
        key: { type: String, required: true },
        value: { type: String },
        type: { type: String },
      },
    ],

    sku: { type: String, required: true },
    type: {
      type: String,
      enum: ["physical", "digital", "service"],
      default: "physical",
    },
    serviceKind: {
      type: String,
      enum: ["single", "bundle"],
      default: "single",
    },

    // --- DEPRECATED: old bundle structure (kept for backward compatibility) ---
    serviceBundleComponents: [
      {
        serviceProductId: { type: Schema.Types.ObjectId, ref: "Product" },
        quantity: { type: Number, default: 1, min: 1 },
        nameSnapshot: String,
        skuSnapshot: String,
        priceSnapshot: { type: Number, min: 0 },
      },
    ],
    // --- NEW: inline bundle sub‑services (used when serviceKind === 'bundle') ---
    bundleSubServices: [
      {
        name: { type: String, required: true },
        laborCost: { type: Number, default: 0, min: 0 },
        commissionDeductionTiming: {
          type: String,
          enum: ["before_commission", "after_deductions"],
          default: "before_commission",
        },
        commissionType: {
          type: String,
          enum: ["percentage", "fixed"],
          default: "percentage",
        },
        commissionValue: { type: Number, default: 0, min: 0 },
        isAggregator: { type: Boolean, default: false },
        defaultAssignedUser: { type: Schema.Types.ObjectId, ref: "User" },
      },
    ],
    commissionType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    commissionValue: { type: Number, default: 0, min: 0 },
    laborCost: { type: Number, default: 0, min: 0 },
    productCost: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ["active", "archived", "draft", "unlisted"], // added unlisted
      default: "active",
    },

    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    cost: { type: Number, min: 0 },
    weight: { type: Number, min: 0 },
    weightUnit: { type: String, enum: ["kg", "g", "lb", "oz"], default: "kg" },

    images: [
      {
        url: String,
        alt: String,
        isDefault: Boolean,
        // migration-only traceability
        shopifyImageId: { type: Number },
        pendingUpload: { type: Boolean, default: false },
        shopifyFileId: { type: String, default: null },   // gid://shopify/MediaImage/...
        width: { type: Number, default: null },           // NEW
        height: { type: Number, default: null },          // NEW
      },
    ],

    imageIds: [{ type: Schema.Types.ObjectId, ref: "ProductImage" }],

    tags: [String],
    collectionIds: [{ type: Schema.Types.ObjectId, ref: "Collection" }],
    metafieldDefinitions: [
      {
        key: String,
        namespace: String,
        required: Boolean,
      },
    ],
    vendor: String,
    seoTitle: String,
    seoDescription: String,

    trackInventory: { type: Boolean, default: true },
    published: { type: Boolean, default: true },
    publishedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

productSchema.index({ organizationId: 1, status: 1 });
productSchema.index({ organizationId: 1, name: 1 });
productSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
productSchema.index({ organizationId: 1, tags: 1 });
productSchema.index({ organizationId: 1, collectionIds: 1 });
productSchema.index({ organizationId: 1, createdAt: -1 });
productSchema.index({ organizationId: 1, serviceKind: 1 });

productSchema.index({ imageIds: 1 });

// migration-safe uniques
productSchema.index(
  { organizationId: 1, shopifyNumericId: 1 },
  {
    unique: true,
    partialFilterExpression: { shopifyNumericId: { $type: "number" } },
  }
);
productSchema.index(
  { organizationId: 1, handle: 1 },
  { unique: true, sparse: true }
);
productSchema.index({ updatedAt: 1 });

const Product = mongoose.model("Product", productSchema);
module.exports = Product;