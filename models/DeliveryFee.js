const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deliveryFeeSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    shiftSessionId: {
      type: Schema.Types.ObjectId,
      ref: "ShiftSession",
      index: true,
    },
    saleId: {
      type: Schema.Types.ObjectId,
      ref: "Sale",
      index: true,
      sparse: true, // Optional - allows standalone deliveries
    },
    // Category-based fee configuration
    deliveryCategory: String,
    deliveryOption: String,
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    isTaxable: {
      type: Boolean,
      default: false,
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
    // Delivery address
    deliveryAddress: {
      street: {
        type: String,
        required: true,
      },
      city: {
        type: String,
        required: true,
      },
      state: String,
      postalCode: String,
      country: {
        type: String,
        default: "Kenya",
      },
      landmark: String, // Optional landmark for easier location
    },
    // Recipient information
    recipientName: {
      type: String,
      required: true,
    },
    recipientPhone: {
      type: String,
      required: true,
    },
    recipientEmail: String,
    // Category-specific lifecycle status (follows custom workflow for selected category)
    categoryStatus: String,
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      index: true,
    },
    assignedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    // Tracking and estimates
    trackingNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    estimatedDelivery: Date,
    actualDelivery: Date,
    // Additional information
    notes: String,
    deliveryInstructions: String,
    cancelReason: String,
    failReason: String,
    // Proof of delivery
    signatureUrl: String,
    photoUrl: String,
    receivedByName: String,
    // Audit
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    // Transaction Audit & Validation
    validationStatus: {
      type: String,
      enum: ["pending", "validated", "disputed"],
      default: "pending",
      index: true,
    },
    validatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
    },
    validatedAt: Date,
    validationNotes: String,
  },
  { timestamps: true }
);

// Compound indexes for common queries
deliveryFeeSchema.index({ organizationId: 1, categoryStatus: 1, createdAt: -1 });
deliveryFeeSchema.index({ organizationId: 1, locationId: 1, createdAt: -1 });
deliveryFeeSchema.index({ organizationId: 1, driverId: 1, categoryStatus: 1 });
deliveryFeeSchema.index({ organizationId: 1, createdAt: -1 });
deliveryFeeSchema.index({ shiftSessionId: 1, validationStatus: 1 }); // Shift deliveries & validation
// Note: saleId and trackingNumber already have indexes via field-level definitions

// Pre-save middleware to generate tracking number
deliveryFeeSchema.pre("save", async function () {
  if (this.isNew && !this.trackingNumber) {
    const orgId = this.organizationId.toString().slice(-6).toUpperCase();
    this.trackingNumber = `DEL-${orgId}-${Date.now()}`;
  }
});

const DeliveryFee = mongoose.model("DeliveryFee", deliveryFeeSchema);

module.exports = DeliveryFee;
