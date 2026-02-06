const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const purchaseOrderSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // PO number (auto-generated or user-provided)
    poNumber: {
      type: String,
      required: true,
    },
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    // Items
    items: [
      {
        variantId: {
          type: Schema.Types.ObjectId,
          ref: "Variant",
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        unitCost: {
          type: Number,
          required: true,
          min: 0,
        },
        receivedQuantity: {
          type: Number,
          default: 0,
        },
      },
    ],
    // Location to receive inventory
    receivingLocationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    // Totals
    subtotal: Number,
    tax: Number,
    shipping: Number,
    total: Number,
    // Status
    status: {
      type: String,
      enum: ["draft", "sent", "confirmed", "partially_received", "received", "cancelled"],
      default: "draft",
    },
    // Shipment details
    shipmentDetails: {
      trackingNumber: String,
      carrier: String,
      expectedDeliveryDate: Date,
      actualDeliveryDate: Date,
    },
    // Dates
    orderDate: {
      type: Date,
      default: Date.now,
    },
    expectedDeliveryDate: Date,
    receivedDate: Date,
    // Notes
    notes: String,
    // Created by
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes
purchaseOrderSchema.index({ organizationId: 1, status: 1 });
purchaseOrderSchema.index({ organizationId: 1, poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ organizationId: 1, supplierId: 1 });
purchaseOrderSchema.index({ organizationId: 1, createdAt: -1 });

const PurchaseOrder = mongoose.model("PurchaseOrder", purchaseOrderSchema);

module.exports = PurchaseOrder;
