const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const giftCardSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // Gift card code (unique)
    code: {
      type: String,
      required: true,
      uppercase: true,
    },
    // Initial and current balance
    initialBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    currentBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    // Currency
    currency: {
      type: String,
      default: "USD",
    },
    // Validity
    expiryDate: Date,
    isExpired: {
      type: Boolean,
      default: false,
    },
    // Status
    status: {
      type: String,
      enum: ["active", "inactive", "expired"],
      default: "active",
    },
    // Redemption history
    redemptions: [
      {
        orderId: {
          type: Schema.Types.ObjectId,
          ref: "Order", // Future: Order model
        },
        amountRedeemed: Number,
        redeemedAt: {
          type: Date,
          default: Date.now,
        },
        redeemedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    // Total redeemed
    totalRedeemed: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Issued details
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    issuedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    // Customer (optional)
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer", // Future: Customer model
    },
    // Notes
    notes: String,
  },
  { timestamps: true }
);

// Indexes
giftCardSchema.index({ organizationId: 1, status: 1 });
giftCardSchema.index({ organizationId: 1, code: 1 }, { unique: true });
giftCardSchema.index({ organizationId: 1, customerId: 1 });
giftCardSchema.index({ organizationId: 1, expiryDate: 1 });

const GiftCard = mongoose.model("GiftCard", giftCardSchema);

module.exports = GiftCard;
