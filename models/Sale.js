const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
  {
    // Transaction Identifiers
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    receiptNumber: {
      type: String,
      required: true,
      index: true,
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      sparse: true,
      index: true,
    },

    // Items Sold
    items: [
      {
        type: {
          type: String,
          enum: ["flexi", "shopify"],
          required: true,
        },
        productId: mongoose.Schema.Types.ObjectId, // FLEXI product ref (if type=flexi)
        shopifyVariantId: String, // Shopify variant ref (if type=shopify)
        productName: String, // Snapshot
        sku: String, // Snapshot
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        quantityRefunded: {
          type: Number,
          default: 0,
          min: 0,
        },
        unitPrice: {
          type: Number,
          required: true,
          min: 0,
        },
        lineTotal: {
          type: Number,
          required: true,
          min: 0,
        },
        discount: {
          type: Number,
          default: 0,
          min: 0,
        },
        taxAmount: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],

    // Customer (Optional)
    customerId: mongoose.Schema.Types.ObjectId,
    customerName: String,
    customerPhone: String,
    customerEmail: String,

    // Pricing
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Payment (legacy single-field + new split payments)
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "mobile", "check", "credit", "mpesa"],
      required: false,
    },
    cardLast4: String, // If card payment (legacy)
    cardBrand: String, // visa, mastercard, amex, etc. (legacy)
    transactionRef: String, // Payment processor reference (legacy)
    payments: [
      {
        method: {
          type: String,
          enum: ["cash", "card", "mobile", "check", "credit", "mpesa"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        reference: String,
        status: {
          type: String,
          enum: ["completed", "pending", "failed"],
          default: "completed",
        },
        cardLast4: String,
        cardBrand: String,
      },
    ],
    paymentStatus: {
      type: String,
      enum: ["completed", "pending", "failed"],
      default: "pending",
    },

    // Inventory Impact
    inventoryUpdates: [
      {
        itemId: String, // Reference to sale item index
        type: {
          type: String,
          enum: ["flexi", "shopify"],
        },
        productId: mongoose.Schema.Types.ObjectId, // FLEXI product
        shopifyVariantId: String, // Shopify variant
        quantityDeducted: Number,
        previousStock: Number,
        newStock: Number,
        status: {
          type: String,
          enum: ["pending", "success", "failed"],
          default: "pending",
        },
        error: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Shopify Sync
    shopifySyncStatus: {
      type: String,
      enum: ["pending", "synced", "failed", "partial"],
      default: "pending",
    },
    shopifySyncLog: [
      {
        shopifyVariantId: String,
        itemIndex: Number,
        status: {
          type: String,
          enum: ["pending", "success", "failed"],
        },
        error: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Inventory Status (Transaction safety)
    inventoryStatus: {
      type: String,
      enum: ["pending", "completed", "failed", "partial"],
      default: "pending",
    },

    // Staff
    cashierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    supervisorId: mongoose.Schema.Types.ObjectId, // Who approved overrides

    // Adjustments (Void/Refund)
    status: {
      type: String,
      enum: ["completed", "voided", "pending", "partial_refund"],
      default: "completed",
      index: true,
    },
    voidReason: String,
    voidedBy: mongoose.Schema.Types.ObjectId,
    voidedAt: Date,
    refundAmount: Number,
    refundReason: String,
    refundedAt: Date,
    refundTransactionRef: String,

    // Refund History (for partial refunds audit)
    refundHistory: [
      {
        refundedBy: mongoose.Schema.Types.ObjectId,
        refundedAt: Date,
        reason: String,
        amount: Number,
        items: [
          {
            itemIndex: Number,
            quantity: Number,
            refundAmount: Number,
          },
        ],
      },
    ],

    // Metadata
    notes: String,
    tags: [String], // 'training', 'return', 'bulk_order', 'adjustment', etc.

    // Timestamps & Audit
    completedAt: Date,
    lastModified: {
      type: Date,
      default: Date.now,
    },
    modifiedBy: mongoose.Schema.Types.ObjectId,
  },
  {
    timestamps: true, // createdAt, updatedAt
  },
);

// Indexes
saleSchema.index({ organizationId: 1, createdAt: -1 }); // Recent sales
saleSchema.index({ locationId: 1, createdAt: -1 }); // Sales by location
saleSchema.index({ cashierId: 1, createdAt: -1 }); // Cashier performance
saleSchema.index({ status: 1, createdAt: -1 }); // Find voids/refunds
saleSchema.index({ shopifySyncStatus: 1 }); // Find failed Shopify syncs
saleSchema.index({ "items.type": 1, createdAt: -1 }); // Filter by catalog type
saleSchema.index({ totalAmount: 1, createdAt: -1 }); // Revenue reports
saleSchema.index(
  { organizationId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true },
);

module.exports = mongoose.model("Sale", saleSchema);
