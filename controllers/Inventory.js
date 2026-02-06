const express = require("express");
const router = express.Router();

const Inventory = require("../models/Inventory");
const InventoryAudit = require("../models/InventoryAudit");
const Variant = require("../models/Variant");
const Location = require("../models/Location");
const UserOrganization = require("../models/UserOrganization");
const { verifyToken } = require("../middleware/auth");
const { validateLocationAccess } = require("../middleware/locationAccess");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Get inventory levels for variant at all locations
 * GET /inventory?variantId=:variantId
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { variantId, locationId, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };

    // Apply location restrictions for non-Owner/Manager users
    if (!["Owner", "Manager"].includes(role)) {
      const membership = await UserOrganization.findOne({
        userId,
        organizationId,
        status: "active",
      }).select("locations").lean();

      if (membership && membership.locations && membership.locations.length > 0) {
        // User has location restrictions - filter by accessible locations
        query.locationId = { $in: membership.locations };
      }
    }

    if (variantId) query.variantId = variantId;
    if (locationId) query.locationId = locationId;

    const inventory = await Inventory.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .populate("variantId locationId");

    const total = await Inventory.countDocuments(query);

    return res.status(200).json({ inventory, total });
  } catch (error) {
    console.error("Get inventory error:", error);
    return res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

/**
 * Get inventory for specific variant at specific location
 * GET /inventory/:variantId/:locationId
 */
router.get("/:variantId/:locationId", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const inventory = await Inventory.findOne({
      organizationId,
      variantId: req.params.variantId,
      locationId: req.params.locationId,
    }).populate("variantId locationId");

    if (!inventory) {
      return res.status(404).json({ error: "Inventory not found" });
    }

    return res.status(200).json({ inventory });
  } catch (error) {
    console.error("Get inventory detail error:", error);
    return res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

/**
 * Create/Initialize inventory
 * POST /inventory
 */
router.post("/", verifyToken, validateLocationAccess, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { variantId, locationId, onHand, reorderPoint, reorderQuantity } = req.body;

    if (!variantId || !locationId || onHand === undefined) {
      return res.status(400).json({ error: "variantId, locationId, and onHand are required" });
    }

    // Verify variant and location exist
    const variant = await Variant.findOne({ _id: variantId, organizationId });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    const location = await Location.findOne({ _id: locationId, organizationId });
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    // Check if already exists
    const existing = await Inventory.findOne({ organizationId, variantId, locationId });
    if (existing) {
      return res.status(409).json({ error: "Inventory already exists for this variant at this location" });
    }

    const inventory = new Inventory({
      organizationId,
      variantId,
      locationId,
      onHand,
      available: onHand,
      committed: 0,
      unavailable: 0,
      reorderPoint,
      reorderQuantity,
    });

    await inventory.save();

    // Log to audit trail
    await InventoryAudit.create({
      organizationId,
      variantId,
      locationId,
      eventType: "inventory_count",
      previousValues: { onHand: 0, available: 0, committed: 0, unavailable: 0 },
      newValues: { onHand, available: onHand, committed: 0, unavailable: 0 },
      userId: req.user.userId,
      reason: "Initial inventory setup",
    });

    await logTokenEvent(req.user.userId, organizationId, "inventory_created", req.ip, req.get("user-agent"), {
      details: `Inventory initialized for variant at location`,
    });

    return res.status(201).json({ message: "Inventory created", inventory });
  } catch (error) {
    console.error("Create inventory error:", error);
    return res.status(500).json({ error: "Failed to create inventory" });
  }
});

/**
 * Adjust inventory manually
 * PUT /inventory/:variantId/:locationId/adjust
 */
router.put("/:variantId/:locationId/adjust", verifyToken, validateLocationAccess, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { onHandAdjustment, reason } = req.body;

    if (onHandAdjustment === undefined) {
      return res.status(400).json({ error: "onHandAdjustment is required" });
    }

    const inventory = await Inventory.findOne({
      organizationId,
      variantId: req.params.variantId,
      locationId: req.params.locationId,
    });

    if (!inventory) {
      return res.status(404).json({ error: "Inventory not found" });
    }

    const previousValues = {
      onHand: inventory.onHand,
      available: inventory.available,
      committed: inventory.committed,
      unavailable: inventory.unavailable,
    };

    inventory.onHand += onHandAdjustment;
    inventory.available = inventory.onHand - inventory.committed;

    if (inventory.onHand < 0) inventory.onHand = 0;
    if (inventory.available < 0) inventory.available = 0;

    await inventory.save();

    const newValues = {
      onHand: inventory.onHand,
      available: inventory.available,
      committed: inventory.committed,
      unavailable: inventory.unavailable,
    };

    // Log to audit trail
    await InventoryAudit.create({
      organizationId,
      variantId: req.params.variantId,
      locationId: req.params.locationId,
      eventType: "manual_adjustment",
      previousValues,
      newValues,
      userId: req.user.userId,
      reason: reason || "Manual adjustment",
    });

    await logTokenEvent(req.user.userId, organizationId, "inventory_adjusted", req.ip, req.get("user-agent"), {
      details: `Inventory adjusted by ${onHandAdjustment}`,
    });

    return res.status(200).json({ message: "Inventory adjusted", inventory });
  } catch (error) {
    console.error("Adjust inventory error:", error);
    return res.status(500).json({ error: "Failed to adjust inventory" });
  }
});

/**
 * Update reorder levels
 * PUT /inventory/:variantId/:locationId
 */
router.put("/:variantId/:locationId", verifyToken, validateLocationAccess, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { reorderPoint, reorderQuantity } = req.body;

    const inventory = await Inventory.findOne({
      organizationId,
      variantId: req.params.variantId,
      locationId: req.params.locationId,
    });

    if (!inventory) {
      return res.status(404).json({ error: "Inventory not found" });
    }

    if (reorderPoint !== undefined) inventory.reorderPoint = reorderPoint;
    if (reorderQuantity !== undefined) inventory.reorderQuantity = reorderQuantity;

    await inventory.save();

    return res.status(200).json({ message: "Inventory updated", inventory });
  } catch (error) {
    console.error("Update inventory error:", error);
    return res.status(500).json({ error: "Failed to update inventory" });
  }
});

module.exports = router;
