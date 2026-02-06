const express = require("express");
const router = express.Router();

const Transfer = require("../models/Transfer");
const InventoryAudit = require("../models/InventoryAudit");
const Inventory = require("../models/Inventory");
const Variant = require("../models/Variant");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Create transfer
 * POST /transfers
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { fromLocationId, toLocationId, items, reason, notes } = req.body;

    if (!fromLocationId || !toLocationId || !items || items.length === 0) {
      return res.status(400).json({ error: "fromLocationId, toLocationId, and items array are required" });
    }

    if (fromLocationId === toLocationId) {
      return res.status(400).json({ error: "Cannot transfer to the same location" });
    }

    // Verify variants exist and have sufficient inventory
    for (const item of items) {
      const variant = await Variant.findOne({ _id: item.variantId, organizationId });
      if (!variant) {
        return res.status(404).json({ error: `Variant ${item.variantId} not found` });
      }

      const inventory = await Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: fromLocationId,
      });

      if (!inventory || inventory.available < item.quantity) {
        return res.status(400).json({ error: `Insufficient inventory for variant ${item.variantId} at source location` });
      }
    }

    // Generate transfer number
    const lastTransfer = await Transfer.findOne({ organizationId }).sort({ createdAt: -1 });
    const transferNumber = lastTransfer ? `TRF-${parseInt(lastTransfer.transferNumber.split("-")[1]) + 1}` : "TRF-1001";

    const transfer = new Transfer({
      organizationId,
      transferNumber,
      fromLocationId,
      toLocationId,
      items: items.map((i) => ({ ...i, receivedQuantity: 0 })),
      reason: reason || "rebalancing",
      notes,
      status: "pending",
      initiatedBy: req.user.userId,
    });

    await transfer.save();

    // Commit inventory at source location
    for (const item of items) {
      const inventory = await Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: fromLocationId,
      });

      if (inventory) {
        inventory.committed += item.quantity;
        inventory.available -= item.quantity;
        await inventory.save();
      }
    }

    await logTokenEvent(req.user.userId, organizationId, "transfer_created", req.ip, req.get("user-agent"), {
      details: `Transfer created: ${transferNumber}`,
    });

    return res.status(201).json({ message: "Transfer created", transfer });
  } catch (error) {
    console.error("Create transfer error:", error);
    return res.status(500).json({ error: "Failed to create transfer" });
  }
});

/**
 * Get all transfers
 * GET /transfers
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { fromLocationId, toLocationId, status, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (fromLocationId) query.fromLocationId = fromLocationId;
    if (toLocationId) query.toLocationId = toLocationId;
    if (status) query.status = status;

    const transfers = await Transfer.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .populate("fromLocationId toLocationId")
      .sort({ createdAt: -1 });

    const total = await Transfer.countDocuments(query);

    return res.status(200).json({ transfers, total });
  } catch (error) {
    console.error("Get transfers error:", error);
    return res.status(500).json({ error: "Failed to fetch transfers" });
  }
});

/**
 * Get transfer by ID
 * GET /transfers/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const transfer = await Transfer.findOne({ _id: req.params.id, organizationId })
      .populate("fromLocationId toLocationId")
      .populate("items.variantId");

    if (!transfer) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    return res.status(200).json({ transfer });
  } catch (error) {
    console.error("Get transfer error:", error);
    return res.status(500).json({ error: "Failed to fetch transfer" });
  }
});

/**
 * Ship transfer
 * PUT /transfers/:id/ship
 */
router.put("/:id/ship", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const transfer = await Transfer.findOne({ _id: req.params.id, organizationId });

    if (!transfer) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    if (transfer.status !== "pending") {
      return res.status(400).json({ error: "Only pending transfers can be shipped" });
    }

    transfer.status = "in_transit";
    transfer.shippedAt = new Date();
    await transfer.save();

    await logTokenEvent(req.user.userId, organizationId, "transfer_shipped", req.ip, req.get("user-agent"), {
      details: `Transfer shipped: ${transfer.transferNumber}`,
    });

    return res.status(200).json({ message: "Transfer shipped", transfer });
  } catch (error) {
    console.error("Ship transfer error:", error);
    return res.status(500).json({ error: "Failed to ship transfer" });
  }
});

/**
 * Receive transfer
 * PUT /transfers/:id/receive
 */
router.put("/:id/receive", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { itemReceivingQty } = req.body; // Array of { variantId, receivedQuantity }

    if (!itemReceivingQty || !Array.isArray(itemReceivingQty)) {
      return res.status(400).json({ error: "itemReceivingQty array is required" });
    }

    const transfer = await Transfer.findOne({ _id: req.params.id, organizationId });
    if (!transfer) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    if (transfer.status !== "in_transit") {
      return res.status(400).json({ error: "Only in-transit transfers can be received" });
    }

    for (const receiving of itemReceivingQty) {
      const item = transfer.items.find((i) => i.variantId.toString() === receiving.variantId);
      if (!item) {
        return res.status(400).json({ error: `Variant ${receiving.variantId} not in this transfer` });
      }

      item.receivedQuantity = receiving.receivedQuantity;

      // Update source location inventory (release committed)
      const sourceInventory = await Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: transfer.fromLocationId,
      });

      if (sourceInventory) {
        const prevSourceValues = {
          onHand: sourceInventory.onHand,
          available: sourceInventory.available,
          committed: sourceInventory.committed,
          unavailable: sourceInventory.unavailable,
        };

        sourceInventory.onHand -= receiving.receivedQuantity;
        sourceInventory.committed -= receiving.receivedQuantity;
        sourceInventory.available = sourceInventory.onHand - sourceInventory.committed;
        await sourceInventory.save();

        // Log audit for source location
        await InventoryAudit.create({
          organizationId,
          variantId: item.variantId,
          locationId: transfer.fromLocationId,
          eventType: "transfer_sent",
          previousValues: prevSourceValues,
          newValues: {
            onHand: sourceInventory.onHand,
            available: sourceInventory.available,
            committed: sourceInventory.committed,
            unavailable: sourceInventory.unavailable,
          },
          reference: transfer._id,
          referenceType: "transfer",
          userId: req.user.userId,
          reason: `Items transferred via ${transfer.transferNumber}`,
        });
      }

      // Update destination location inventory (add stock)
      let destInventory = await Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: transfer.toLocationId,
      });

      if (!destInventory) {
        destInventory = new Inventory({
          organizationId,
          variantId: item.variantId,
          locationId: transfer.toLocationId,
          onHand: 0,
          available: 0,
          committed: 0,
          unavailable: 0,
        });
      }

      const prevDestValues = {
        onHand: destInventory.onHand,
        available: destInventory.available,
        committed: destInventory.committed,
        unavailable: destInventory.unavailable,
      };

      destInventory.onHand += receiving.receivedQuantity;
      destInventory.available = destInventory.onHand - destInventory.committed;
      await destInventory.save();

      // Log audit for destination location
      await InventoryAudit.create({
        organizationId,
        variantId: item.variantId,
        locationId: transfer.toLocationId,
        eventType: "transfer_received",
        previousValues: prevDestValues,
        newValues: {
          onHand: destInventory.onHand,
          available: destInventory.available,
          committed: destInventory.committed,
          unavailable: destInventory.unavailable,
        },
        reference: transfer._id,
        referenceType: "transfer",
        userId: req.user.userId,
        reason: `Items received via ${transfer.transferNumber}`,
      });
    }

    transfer.status = "delivered";
    transfer.deliveredAt = new Date();
    transfer.receivedBy = req.user.userId;
    await transfer.save();

    await logTokenEvent(req.user.userId, organizationId, "transfer_received", req.ip, req.get("user-agent"), {
      details: `Transfer received: ${transfer.transferNumber}`,
    });

    return res.status(200).json({ message: "Transfer received", transfer });
  } catch (error) {
    console.error("Receive transfer error:", error);
    return res.status(500).json({ error: "Failed to receive transfer" });
  }
});

/**
 * Cancel transfer
 * PUT /transfers/:id/cancel
 */
router.put("/:id/cancel", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const transfer = await Transfer.findOne({ _id: req.params.id, organizationId });

    if (!transfer) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    if (!["pending", "in_transit"].includes(transfer.status)) {
      return res.status(400).json({ error: "Only pending or in-transit transfers can be cancelled" });
    }

    // Release committed inventory at source
    for (const item of transfer.items) {
      const inventory = await Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: transfer.fromLocationId,
      });

      if (inventory) {
        inventory.committed -= item.quantity;
        inventory.available = inventory.onHand - inventory.committed;
        await inventory.save();
      }
    }

    transfer.status = "cancelled";
    await transfer.save();

    return res.status(200).json({ message: "Transfer cancelled", transfer });
  } catch (error) {
    console.error("Cancel transfer error:", error);
    return res.status(500).json({ error: "Failed to cancel transfer" });
  }
});

module.exports = router;
