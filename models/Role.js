const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const roleSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    permissions: {
      type: [String],
      required: true,
      default: [],
    },
    description: {
      type: String,
      trim: true,
    },
    isSystem: {
      type: Boolean,
      default: false, // System roles (Owner, Manager, Cashier, Employee) cannot be deleted
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes handled by unique constraint on name field

const Role = mongoose.model("Role", roleSchema);

module.exports = Role;
