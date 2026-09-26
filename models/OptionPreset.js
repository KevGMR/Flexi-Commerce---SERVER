const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const optionPresetSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    values: {
      type: [String],
      default: [],
    },
    // Marks the seeded defaults so we can identify them if needed
    isSystem: {
      type: Boolean,
      default: false,
    },
    position: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

// One preset per (org, name), case-insensitive
optionPresetSchema.index(
  { organizationId: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

optionPresetSchema.index({ organizationId: 1, position: 1 });

const OptionPreset = mongoose.model("OptionPreset", optionPresetSchema);
module.exports = OptionPreset;