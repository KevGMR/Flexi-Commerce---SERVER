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
    serviceBundleComponents: [
      {
        serviceProductId: { type: Schema.Types.ObjectId, ref: "Product" },
        quantity: { type: Number, default: 1, min: 1 },
        nameSnapshot: String,
        skuSnapshot: String,
        priceSnapshot: { type: Number, min: 0 },
      },
    ],
    // Commission defaults
    commissionType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    commissionValue: { type: Number, default: 0, min: 0 },
    // --- NEW cost fields ---
    laborCost: { type: Number, default: 0, min: 0 },
    productCost: { type: Number, default: 0, min: 0 },
    // ---
    status: {
      type: String,
      enum: ["active", "archived", "draft"],
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
      },
    ],
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
    published: { type: Boolean, default: false },
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

const Product = mongoose.model("Product", productSchema);
module.exports = Product;