const express = require("express");
const router = express.Router();

const InventoryAudit = require("../models/InventoryAudit");
const { verifyToken } = require("../middleware/auth");

/**
 * Get inventory audit trail
 * GET /inventory-audit
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { variantId, locationId, eventType, startDate, endDate, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (variantId) query.variantId = variantId;
    if (locationId) query.locationId = locationId;
    if (eventType) query.eventType = eventType;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const audits = await InventoryAudit.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .populate("userId")
      .sort({ createdAt: -1 });

    const total = await InventoryAudit.countDocuments(query);

    return res.status(200).json({ audits, total });
  } catch (error) {
    console.error("Get inventory audit error:", error);
    return res.status(500).json({ error: "Failed to fetch audit trail" });
  }
});

/**
 * Get audit trail for specific variant at specific location
 * GET /inventory-audit/:variantId/:locationId
 */
router.get("/:variantId/:locationId", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { skip = 0, limit = 50 } = req.query;

    const audits = await InventoryAudit.find({
      organizationId,
      variantId: req.params.variantId,
      locationId: req.params.locationId,
    })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .populate("userId")
      .sort({ createdAt: -1 });

    return res.status(200).json({ audits });
  } catch (error) {
    console.error("Get variant audit error:", error);
    return res.status(500).json({ error: "Failed to fetch audit trail" });
  }
});

module.exports = router;
