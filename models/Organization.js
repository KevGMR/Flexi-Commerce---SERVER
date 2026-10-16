const mongoose = require("mongoose");
const { Schema } = mongoose;
const { paymentMethodSchema, defaultOrgPaymentMethods } = require("./PaymentMethod");

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

    // Org-level default payment methods. Locations may override.
    paymentMethods: {
      type: [paymentMethodSchema],
      default: defaultOrgPaymentMethods,
    },

    // Website builder placeholder

    // Website / storefront
    website: {
      domain: { type: String, lowercase: true, trim: true },
      subdomain: { type: String, lowercase: true, trim: true },
      domainVerified: { type: Boolean, default: false },
      domainVerification: {
        txtName: { type: String, default: "" },
        txtValue: { type: String, default: "" },
        cnameTarget: { type: String, default: "" },
        lastCheckedAt: { type: Date, default: null },
        error: { type: String, default: "" },
      },
      published: { type: Boolean, default: false },

      logoUrl: String,
      faviconUrl: String,
      tagline: String,
      primaryColor: { type: String, default: "#111111" },
      accentColor: { type: String, default: "#2563eb" },
      headerLayout: {
        type: String,
        enum: ["centered", "left"],
        default: "left",
      },

      // Site-wide announcement bar (renders above the header on every page)
      announcement: {
        text: { type: String, default: "" },
        href: { type: String, default: "" },
        isActive: { type: Boolean, default: true },
      },

      // NEW — homepage builder
      homepage: {
        sections: {
          type: [
            {
              _id: false,
              id: { type: String, required: true },
              type: {
                type: String,
                required: true,
                enum: [
                  "hero",
                  "featured-products",
                  "collection",
                  "rich-text",
                  "trust-strip",
                  "banner",
                  "featured-category",
                  "image-text",
                  "announcement",
                ],
              },
              config: { type: mongoose.Schema.Types.Mixed, default: {} },
            },
          ],
          default: [],
        },
      },
    },

    // M-Pesa Daraja integration (per-org credentials)
    // Secret fields are AES-256-GCM encrypted at rest via services/secretBox.
    daraja: {
      enabled: { type: Boolean, default: false },
      environment: {
        type: String,
        enum: ["sandbox", "production"],
        default: "sandbox",
      },
      consumerKey: String,      // encrypted
      consumerSecret: String,   // encrypted
      shortcode: String,        // Paybill or Till
      passkey: String,          // encrypted
      transactionType: {
        type: String,
        enum: ["CustomerPayBillOnline", "CustomerBuyGoodsOnline"],
        default: "CustomerPayBillOnline",
      },
      // Random per-org secret appended to the callback URL as ?key=
      // Used to verify that callbacks actually came from Safaricom.
      callbackSecret: String,
      // Whether the POS should offer the M-Pesa STK prompt at all.
      // This is the org-level default; locations can override per-till.
      // Requires daraja.enabled to be true for the tile to actually appear.
      mpesaStkEnabled: { type: Boolean, default: false },
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
organizationSchema.index({ "daraja.enabled": 1 });

module.exports = mongoose.model("Organization", organizationSchema);
