const express = require("express");
const router = express.Router();

const PurchaseOrder = require("../models/PurchaseOrder");
const InventoryAudit = require("../models/InventoryAudit");
const Inventory = require("../models/Inventory");
const Supplier = require("../models/Supplier");
const Variant = require("../models/Variant");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Create purchase order
 * POST /purchase-orders
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { supplierId, items, receivingLocationId, totals, notes } = req.body;

    if (!supplierId || !items || items.length === 0 || !receivingLocationId) {
      return res.status(400).json({ error: "supplierId, items array, and receivingLocationId are required" });
    }

    // Verify supplier exists
    const supplier = await Supplier.findOne({ _id: supplierId, organizationId });
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    // Verify variants exist
    for (const item of items) {
      const variant = await Variant.findOne({ _id: item.variantId, organizationId });
      if (!variant) {
        return res.status(404).json({ error: `Variant ${item.variantId} not found` });
      }
    }

    // Generate PO number
    const lastPO = await PurchaseOrder.findOne({ organizationId }).sort({ createdAt: -1 });
    const poNumber = lastPO ? `PO-${parseInt(lastPO.poNumber.split("-")[1]) + 1}` : "PO-1001";

    const po = new PurchaseOrder({
      organizationId,
      poNumber,
      supplierId,
      items,
      receivingLocationId,
      totals: totals || { subtotal: 0, tax: 0, shipping: 0, total: 0 },
      status: "draft",
      notes,
      createdBy: req.user.userId,
    });

    await po.save();

    await logTokenEvent(req.user.userId, organizationId, "purchase_order_created", req.ip, req.get("user-agent"), {
      details: `Purchase order created: ${poNumber}`,
    });

    return res.status(201).json({ message: "Purchase order created", po });
  } catch (error) {
    console.error("Create purchase order error:", error);
    return res.status(500).json({ error: "Failed to create purchase order" });
  }
});

/**
 * Get all purchase orders
 * GET /purchase-orders
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { supplierId, status, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (supplierId) query.supplierId = supplierId;
    if (status) query.status = status;

    const pos = await PurchaseOrder.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .populate("supplierId")
      .sort({ createdAt: -1 });

    const total = await PurchaseOrder.countDocuments(query);

    return res.status(200).json({ pos, total });
  } catch (error) {
    console.error("Get purchase orders error:", error);
    return res.status(500).json({ error: "Failed to fetch purchase orders" });
  }
});

/**
 * Get purchase order by ID
 * GET /purchase-orders/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, organizationId })
      .populate("supplierId")
      .populate("receivingLocationId")
      .populate("items.variantId");

    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    return res.status(200).json({ po });
  } catch (error) {
    console.error("Get purchase order error:", error);
    return res.status(500).json({ error: "Failed to fetch purchase order" });
  }
});

/**
 * Update purchase order
 * PUT /purchase-orders/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { items, totals, notes } = req.body;

    const po = await PurchaseOrder.findOne({ _id: req.params.id, organizationId });
    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    // Only draft orders can be edited
    if (po.status !== "draft") {
      return res.status(400).json({ error: "Only draft purchase orders can be edited" });
    }

    if (items) po.items = items;
    if (totals) po.totals = totals;
    if (notes !== undefined) po.notes = notes;

    await po.save();

    return res.status(200).json({ message: "Purchase order updated", po });
  } catch (error) {
    console.error("Update purchase order error:", error);
    return res.status(500).json({ error: "Failed to update purchase order" });
  }
});

/**
 * Send purchase order to supplier
 * PUT /purchase-orders/:id/send
 */
router.put("/:id/send", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, organizationId });

    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    if (po.status !== "draft") {
      return res.status(400).json({ error: "Only draft orders can be sent" });
    }

    po.status = "sent";
    po.orderDate = new Date();
    await po.save();

    await logTokenEvent(req.user.userId, organizationId, "purchase_order_sent", req.ip, req.get("user-agent"), {
      details: `Purchase order sent: ${po.poNumber}`,
    });

    return res.status(200).json({ message: "Purchase order sent", po });
  } catch (error) {
    console.error("Send purchase order error:", error);
    return res.status(500).json({ error: "Failed to send purchase order" });
  }
});

/**
 * Confirm purchase order (supplier confirmed)
 * PUT /purchase-orders/:id/confirm
 */
router.put("/:id/confirm", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, organizationId });

    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    if (po.status !== "sent") {
      return res.status(400).json({ error: "Only sent orders can be confirmed" });
    }

    po.status = "confirmed";
    await po.save();

    return res.status(200).json({ message: "Purchase order confirmed", po });
  } catch (error) {
    console.error("Confirm purchase order error:", error);
    return res.status(500).json({ error: "Failed to confirm purchase order" });
  }
});

/**
 * Receive purchase order items
 * PUT /purchase-orders/:id/receive
 */
router.put("/:id/receive", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { itemReceivingQty } = req.body; // Array of { variantId, receivedQuantity }

    if (!itemReceivingQty || !Array.isArray(itemReceivingQty)) {
      return res.status(400).json({ error: "itemReceivingQty array is required" });
    }

    const po = await PurchaseOrder.findOne({ _id: req.params.id, organizationId });
    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    if (!["confirmed", "partially_received"].includes(po.status)) {
      return res.status(400).json({ error: "Order must be confirmed or partially received" });
    }

    let allReceived = true;

    for (const receiving of itemReceivingQty) {
      const item = po.items.find((i) => i.variantId.toString() === receiving.variantId);
      if (!item) {
        return res.status(400).json({ error: `Variant ${receiving.variantId} not in this PO` });
      }

      item.receivedQuantity = (item.receivedQuantity || 0) + receiving.receivedQuantity;

      // Update inventory
      const inventory = await Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: po.receivingLocationId,
      });

      if (inventory) {
        const previousValues = {
          onHand: inventory.onHand,
          available: inventory.available,
          committed: inventory.committed,
          unavailable: inventory.unavailable,
        };

        inventory.onHand += receiving.receivedQuantity;
        inventory.available = inventory.onHand - inventory.committed;
        await inventory.save();

        // Log to inventory audit
        await InventoryAudit.create({
          organizationId,
          variantId: item.variantId,
          locationId: po.receivingLocationId,
          eventType: "purchase_order_received",
          previousValues,
          newValues: {
            onHand: inventory.onHand,
            available: inventory.available,
            committed: inventory.committed,
            unavailable: inventory.unavailable,
          },
          reference: po._id,
          referenceType: "purchase_order",
          userId: req.user.userId,
          reason: `Items received from PO ${po.poNumber}`,
        });
      }

      if (item.receivedQuantity < item.quantity) {
        allReceived = false;
      }
    }

    po.status = allReceived ? "received" : "partially_received";
    if (allReceived) po.receivedDate = new Date();
    po.receivedBy = req.user.userId;
    await po.save();

    await logTokenEvent(req.user.userId, organizationId, "purchase_order_received", req.ip, req.get("user-agent"), {
      details: `Purchase order items received: ${po.poNumber}`,
    });

    return res.status(200).json({ message: "Items received", po });
  } catch (error) {
    console.error("Receive purchase order error:", error);
    return res.status(500).json({ error: "Failed to receive items" });
  }
});

/**
 * Cancel purchase order
 * PUT /purchase-orders/:id/cancel
 */
router.put("/:id/cancel", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, organizationId });

    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    if (po.status === "received") {
      return res.status(400).json({ error: "Cannot cancel received purchase orders" });
    }

    po.status = "cancelled";
    await po.save();

    return res.status(200).json({ message: "Purchase order cancelled", po });
  } catch (error) {
    console.error("Cancel purchase order error:", error);
    return res.status(500).json({ error: "Failed to cancel purchase order" });
  }
});

module.exports = router;
