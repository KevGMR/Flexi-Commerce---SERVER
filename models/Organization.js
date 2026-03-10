const mongoose = require("mongoose");
const { Schema } = mongoose;

const organizationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      default: "active",
      enum: ["active", "suspended", "deleted"],
    },
    // E-commerce settings
    settings: {
      timezone: { type: String, default: "UTC" },
      currency: { type: String, default: "KES" },
      language: { type: String, default: "en" },
      taxRate: { type: Number, default: 0 },
      taxMode: {
        type: String,
        enum: ["inclusive", "exclusive"],
        default: "inclusive",
      },
    },
    // Website builder placeholder
    website: {
      domain: String,
      theme: String,
      published: { type: Boolean, default: false },
    },
    // Billing/plan
    plan: {
      type: String,
      default: "free",
      enum: ["free", "starter", "professional", "enterprise"],
    },
    subscriptionStatus: {
      type: String,
      default: "active",
      enum: ["active", "trial", "paused", "cancelled"],
    },
    subscriptionExpiry: Date,
    // Locations (warehouses, retail stores, etc.)
    locations: [
      {
        name: { type: String, required: true },
        locationType: {
          type: String,
          enum: ["warehouse", "retail", "fulfillment"],
          default: "warehouse",
        },
        address: {
          street: String,
          city: String,
          state: String,
          postalCode: String,
          country: String,
        },
        phone: String,
        email: String,
        taxRate: Number,
        taxMode: {
          type: String,
          enum: ["inclusive", "exclusive"],
        },
        taxId: String,
        currency: { type: String, default: "USD" },
        isDefault: { type: Boolean, default: false },
        status: {
          type: String,
          enum: ["active", "inactive"],
          default: "active",
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Global metafield definitions (can be overridden per location)
    metafieldDefinitions: [
      {
        key: String,
        namespace: { type: String, default: "custom" },
        options: [String], // Preset values like ["Red", "Blue", "Green"]
      },
    ],
  },
  { timestamps: true }
);

organizationSchema.index({ slug: 1 }, { unique: true });
organizationSchema.index({ ownerId: 1 });
organizationSchema.index({ status: 1 });

module.exports = mongoose.model("Organization", organizationSchema);
