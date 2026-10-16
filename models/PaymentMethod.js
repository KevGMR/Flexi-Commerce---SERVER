// server/models/PaymentMethod.js
//
// Shared subdocument schema for payment methods on Organization and Location.
// The same shape is used in both places; Location entries fully override
// Organization defaults when present.

const mongoose = require("mongoose");
const { Schema } = mongoose;

const paymentMethodSchema = new Schema(
  {
    // Stable identifier used in Sale.payments[].method and POS button keys.
    // Base methods: "cash" | "card" | "mpesa" | "gift_card"
    // Custom methods: anything the org defines (lowercase, snake_case).
    key: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z][a-z0-9_]{0,39}$/,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    // Emoji, single character, or a URL (http(s):// or /path).
    // POS renders `<img>` if it looks like a URL, else as text.
    icon: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    // true for org-defined methods beyond the base four.
    // Base four cannot be deleted, only disabled.
    custom: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

// Base methods — always present in the org defaults; cannot be removed.
const BASE_PAYMENT_METHODS = [
  { key: "cash",      label: "Cash",      icon: "💵", custom: false },
  { key: "card",      label: "Card",      icon: "💳", custom: false },
  { key: "mpesa",     label: "M-Pesa",    icon: "📱", custom: false },
  { key: "gift_card", label: "Gift Card", icon: "🎁", custom: false },
];

function defaultOrgPaymentMethods() {
  return BASE_PAYMENT_METHODS.map((m, idx) => ({
    ...m,
    enabled: true,
    isDefault: idx === 0, // cash is default
  }));
}

module.exports = {
  paymentMethodSchema,
  BASE_PAYMENT_METHODS,
  defaultOrgPaymentMethods,
};