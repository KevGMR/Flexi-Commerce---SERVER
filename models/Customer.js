const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const customerSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    fullname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
    },
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    loyaltyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: String,
    tags: [String],
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

customerSchema.index({ organizationId: 1, fullname: 1 });
customerSchema.index({ organizationId: 1, email: 1 });
customerSchema.index({ organizationId: 1, loyaltyPoints: -1 });

const Customer = mongoose.model("Customer", customerSchema);
module.exports = Customer;