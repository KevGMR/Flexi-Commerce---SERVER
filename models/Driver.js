const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const driverSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    status: {
      type: String,
      default: "active",
      enum: ["active", "inactive"],
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficiently querying drivers by organization
driverSchema.index({ organizationId: 1 });
driverSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model("Driver", driverSchema);
