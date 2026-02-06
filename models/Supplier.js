const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const supplierSchema = new Schema(
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
    email: String,
    phone: String,
    // Address
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    // Contact info
    contactPerson: String,
    // Payment/Terms
    paymentTerms: String, // e.g., "Net 30"
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "credit_card", "check", "paypal", "other"],
    },
    taxId: String, // Supplier tax ID
    // Currency
    currency: {
      type: String,
      default: "USD",
    },
    // Supplier rating/notes
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    notes: String,
    // Status
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Indexes
supplierSchema.index({ organizationId: 1, status: 1 });
supplierSchema.index({ organizationId: 1, name: 1 });

const Supplier = mongoose.model("Supplier", supplierSchema);

module.exports = Supplier;
