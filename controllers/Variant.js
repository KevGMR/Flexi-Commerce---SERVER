const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Variant = require("../models/Variant");
const Product = require("../models/Product");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Create variant
 * POST /variants
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { productId, sku, price, compareAtPrice, cost, weight, metafields, barcode, digitalContent, position, status } = req.body;

    if (!productId || !sku) {
      return res.status(400).json({ error: "productId and sku are required" });
    }

    // Verify product exists
    const product = await Product.findOne({ _id: productId, organizationId });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Check SKU uniqueness per org
    const existingSku = await Variant.findOne({ organizationId, sku });
    if (existingSku) {
      return res.status(409).json({ error: "SKU already exists" });
    }

    const variant = new Variant({
      organizationId,
      productId,
      sku,
      price: price !== undefined ? price : product.price,
      compareAtPrice,
      cost,
      weight,
      metafields,
      barcode,
      digitalContent,
      position,
      status,
    });

    await variant.save();

    await logTokenEvent(req.user.userId, organizationId, "variant_created", req.ip, req.get("user-agent"), {
      details: `Variant created for product: ${product.name}`,
    });

    return res.status(201).json({ message: "Variant created", variant });
  } catch (error) {
    console.error("Create variant error:", error);
    return res.status(500).json({ error: "Failed to create variant" });
  }
});

/**
 * Get variants by product
 * GET /variants?productId=:productId
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { productId, status, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (productId) query.productId = productId;
    if (status) query.status = status;

    const variants = await Variant.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ position: 1, createdAt: -1 });

    const total = await Variant.countDocuments(query);

    return res.status(200).json({ variants, total });
  } catch (error) {
    console.error("Get variants error:", error);
    return res.status(500).json({ error: "Failed to fetch variants" });
  }
});

/**
 * Get variant by ID
 * GET /variants/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const variant = await Variant.findOne({ _id: req.params.id, organizationId }).populate("productId");

    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    return res.status(200).json({ variant });
  } catch (error) {
    console.error("Get variant error:", error);
    return res.status(500).json({ error: "Failed to fetch variant" });
  }
});

/**
 * Update variant
 * PUT /variants/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { sku, price, compareAtPrice, cost, weight, metafields, barcode, digitalContent, position, status, trackInventory, taxClass } = req.body;

    const variant = await Variant.findOne({ _id: req.params.id, organizationId });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    // Check SKU uniqueness if changed
    if (sku && sku !== variant.sku) {
      const existingSku = await Variant.findOne({ organizationId, sku });
      if (existingSku) {
        return res.status(409).json({ error: "SKU already exists" });
      }
      variant.sku = sku;
    }

    if (price !== undefined) variant.price = price;
    if (compareAtPrice !== undefined) variant.compareAtPrice = compareAtPrice;
    if (cost !== undefined) variant.cost = cost;
    if (weight !== undefined) variant.weight = weight;
    if (metafields) variant.metafields = metafields;
    if (barcode !== undefined) variant.barcode = barcode;
    if (digitalContent) variant.digitalContent = digitalContent;
    if (position !== undefined) variant.position = position;
    if (status) variant.status = status;
    if (trackInventory !== undefined) variant.trackInventory = trackInventory;
    if (taxClass !== undefined) variant.taxClass = taxClass;

    await variant.save();

    await logTokenEvent(req.user.userId, organizationId, "variant_updated", req.ip, req.get("user-agent"), {
      details: `Variant updated: ${variant.sku}`,
    });

    return res.status(200).json({ message: "Variant updated", variant });
  } catch (error) {
    console.error("Update variant error:", error);
    return res.status(500).json({ error: "Failed to update variant" });
  }
});

/**
 * Delete variant
 * DELETE /variants/:id
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const variant = await Variant.findOneAndDelete({ _id: req.params.id, organizationId });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    await logTokenEvent(req.user.userId, organizationId, "variant_deleted", req.ip, req.get("user-agent"), {
      details: `Variant deleted: ${variant.sku}`,
    });

    return res.status(200).json({ message: "Variant deleted" });
  } catch (error) {
    console.error("Delete variant error:", error);
    return res.status(500).json({ error: "Failed to delete variant" });
  }
});

module.exports = router;
