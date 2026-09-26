const express = require("express");
const router = express.Router();
const OptionPreset = require("../models/OptionPreset");
const { verifyToken } = require("../middleware/auth");

const DEFAULT_PRESETS = [
  { name: "Size", values: ["XS", "S", "M", "L", "XL", "XXL"] },
  { name: "Color", values: ["Black", "White", "Navy", "Beige", "Grey"] },
  { name: "Material", values: ["Cotton", "Silk", "Linen", "Polyester"] },
  { name: "Style", values: ["Casual", "Formal", "Sport", "Evening"] },
];

/**
 * Seed the default presets for an organization if it has none.
 * Idempotent — runs on every list call, only writes when the org is empty.
 */
async function ensureDefaults(organizationId) {
  const count = await OptionPreset.countDocuments({ organizationId });
  if (count > 0) return;

  const docs = DEFAULT_PRESETS.map((p, i) => ({
    organizationId,
    name: p.name,
    values: p.values,
    isSystem: true,
    position: i,
  }));

  try {
    await OptionPreset.insertMany(docs, { ordered: false });
  } catch (err) {
    // Race: two concurrent list calls both tried to seed. Ignore dup key.
    if (err.code !== 11000) throw err;
  }
}

/**
 * GET /option-presets
 * Returns the org's presets, seeding defaults on first access.
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    await ensureDefaults(organizationId);

    const presets = await OptionPreset.find({ organizationId }).sort({
      position: 1,
      name: 1,
    });

    return res.status(200).json({ presets });
  } catch (error) {
    console.error("List option presets error:", error);
    return res.status(500).json({ error: "Failed to fetch option presets" });
  }
});

/**
 * POST /option-presets
 * Body: { name, values }
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, values } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!Array.isArray(values) || values.length === 0) {
      return res.status(400).json({ error: "values must be a non-empty array" });
    }

    const cleanName = String(name).trim();
    const cleanValues = [
      ...new Set(
        values
          .map((v) => String(v).trim())
          .filter(Boolean),
      ),
    ];

    if (cleanValues.length === 0) {
      return res.status(400).json({ error: "values cannot be empty after trimming" });
    }

    // Case-insensitive duplicate check (index collation will also catch it)
    const existing = await OptionPreset.findOne({
      organizationId,
      name: { $regex: `^${cleanName}$`, $options: "i" },
    });
    if (existing) {
      return res.status(409).json({
        error: `A preset named "${existing.name}" already exists`,
      });
    }

    // Position: append to the end
    const last = await OptionPreset.findOne({ organizationId })
      .sort({ position: -1 })
      .select("position")
      .lean();
    const position = (last?.position ?? -1) + 1;

    const preset = await OptionPreset.create({
      organizationId,
      name: cleanName,
      values: cleanValues,
      position,
      isSystem: false,
    });

    return res.status(201).json({ preset });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "A preset with that name already exists" });
    }
    console.error("Create option preset error:", error);
    return res.status(500).json({ error: "Failed to create option preset" });
  }
});

/**
 * PUT /option-presets/:id
 * Body: { name?, values? }
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, values } = req.body;

    const preset = await OptionPreset.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!preset) {
      return res.status(404).json({ error: "Option preset not found" });
    }

    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) {
        return res.status(400).json({ error: "name cannot be empty" });
      }
      // Check for collision with another preset
      const collision = await OptionPreset.findOne({
        organizationId,
        _id: { $ne: preset._id },
        name: { $regex: `^${cleanName}$`, $options: "i" },
      });
      if (collision) {
        return res.status(409).json({
          error: `A preset named "${collision.name}" already exists`,
        });
      }
      preset.name = cleanName;
    }

    if (values !== undefined) {
      if (!Array.isArray(values)) {
        return res.status(400).json({ error: "values must be an array" });
      }
      const cleanValues = [
        ...new Set(
          values.map((v) => String(v).trim()).filter(Boolean),
        ),
      ];
      if (cleanValues.length === 0) {
        return res.status(400).json({ error: "values cannot be empty" });
      }
      preset.values = cleanValues;
    }

    await preset.save();
    return res.status(200).json({ preset });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "A preset with that name already exists" });
    }
    console.error("Update option preset error:", error);
    return res.status(500).json({ error: "Failed to update option preset" });
  }
});

/**
 * DELETE /option-presets/:id
 * Refuses to delete if any product uses this preset name as an option.
 * (Prevents silently orphaning option references.)
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const preset = await OptionPreset.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!preset) {
      return res.status(404).json({ error: "Option preset not found" });
    }

    // Check whether any product in this org uses an option with this name
    const Product = require("../models/Product");
    const inUse = await Product.countDocuments({
      organizationId,
      "options.name": { $regex: `^${preset.name}$`, $options: "i" },
    });

    if (inUse > 0) {
      return res.status(409).json({
        error: `Cannot delete "${preset.name}" — ${inUse} product${inUse === 1 ? "" : "s"} use an option with this name`,
        code: "PRESET_IN_USE",
        inUseCount: inUse,
      });
    }

    await OptionPreset.deleteOne({ _id: preset._id });
    return res.status(200).json({ message: "Option preset deleted" });
  } catch (error) {
    console.error("Delete option preset error:", error);
    return res.status(500).json({ error: "Failed to delete option preset" });
  }
});

module.exports = router;