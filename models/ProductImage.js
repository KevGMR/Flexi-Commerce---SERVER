const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * Canonical image record, keyed by Shopify image numeric ID.
 * Many-to-many bridge: one ProductImage can be referenced by many Products
 * and many Variants.
 *
 * Why a separate collection:
 *   - Shared images (same Shopify GID on multiple products) resolve to ONE doc.
 *   - Re-uploads/deletes are idempotent.
 *   - Backward-compat with Product.images[] / Variant.images[] is preserved
 *     (those still exist; this is the join layer).
 */
const productImageSchema = new Schema(
  {
    // Shopify identity
    shopifyImageNumericId: { type: Number, required: true },
    shopifyImageGid: { type: String, default: null },

    // Shopify Files identity (after upload)
    shopifyFileId: { type: String, default: null }, // gid://shopify/MediaImage/...
    fileStatus: { type: String, default: null }, // READY | FAILED | ...
    uploadedAt: { type: Date, default: null },

    // CDN / content
    url: { type: String, required: true },
    originalSourceUrl: { type: String, default: null }, // old store's originalSrc, for traceability
    alt: { type: String, default: "" },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },

    // Local disk traceability (import-time only)
    localRelativePath: { type: String, default: null },
    localPath: { type: String, default: null },
    diskExists: { type: Boolean, default: null },

    // Migration flags
    migrationFlags: { type: [String], default: [] },
  },
  { timestamps: true }
);

// The unique key is (org-less, global) numeric image ID — images belong to the
// env Shopify store, not to any one org.
productImageSchema.index(
  { shopifyImageNumericId: 1 },
  { unique: true, partialFilterExpression: { shopifyImageNumericId: { $type: "number" } } }
);
productImageSchema.index(
  { shopifyFileId: 1 },
  { unique: true, sparse: true }
);
productImageSchema.index({ updatedAt: 1 });

const ProductImage = mongoose.model("ProductImage", productImageSchema);
module.exports = ProductImage;