const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const collectionSchema = new Schema(
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
    slug: {
      type: String,
      required: true,
    },
    description: String,
    // Hierarchy support
    parentCollectionId: {
      type: Schema.Types.ObjectId,
      ref: "Collection",
      default: null,
    },
    // Collection type
    type: {
      type: String,
      enum: ["manual", "automatic"],
      default: "manual",
    },
    // Automatic collection rules
    // Example: { field: "tag", operator: "contains", value: "summer" }
    rules: [
      {
        field: String, // "tag", "price", "status", "vendor", etc.
        operator: String, // "contains", "equals", "greaterThan", "lessThan"
        value: mongoose.Schema.Types.Mixed,
      },
    ],
    // Rule logic (AND or OR)
    ruleLogic: {
      type: String,
      enum: ["AND", "OR"],
      default: "AND",
    },
    // Manual product IDs (for manual collections)
    productIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    // Collection image
    image: {
      url: String,
      alt: String,
    },
    // SEO
    seoTitle: String,
    seoDescription: String,
    // Status
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    published: {
      type: Boolean,
      default: false,
    },
    publishedAt: Date,
  },
  { timestamps: true }
);

// Indexes
collectionSchema.index({ organizationId: 1, status: 1 });
collectionSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
collectionSchema.index({ organizationId: 1, parentCollectionId: 1 });
collectionSchema.index({ organizationId: 1, type: 1 });

const Collection = mongoose.model("Collection", collectionSchema);

module.exports = Collection;
