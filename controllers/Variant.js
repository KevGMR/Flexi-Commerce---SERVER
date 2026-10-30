const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Variant = require("../models/Variant");
const Product = require("../models/Product");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Compute the stable option tuple for a variant — e.g.
 *   "Color=NAVY|Size=S"
 * Used as the identity for a variant within a product. Two variants with
 * the same tuple are duplicates (which the uniqueness guard below blocks).
 */
function optionsKey(selectedOptions) {
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) return null;
  return selectedOptions
    .map((o) => `${o.name}=${o.value}`)
    .sort()
    .join("|");
}

/**
 * POST /variants
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      productId,
      sku,
      price,
      compareAtPrice,
      cost,
      weight,
      metafields,
      barcode,
      digitalContent,
      position,
      status,
      selectedOptions,
    } = req.body;

    if (!productId || !sku) {
      return res.status(400).json({ error: "productId and sku are required" });
    }

    const product = await Product.findOne({ _id: productId, organizationId });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const existingSku = await Variant.findOne({ organizationId, sku });
    if (existingSku) {
      return res.status(409).json({ error: "SKU already exists" });
    }

    // Guard against an active variant with the same option tuple
    const newOptionsKey = optionsKey(selectedOptions);
    if (newOptionsKey) {
      const twin = await Variant.findOne({
        organizationId,
        productId,
        status: "active",
        optionsKey: newOptionsKey,
      });
      if (twin) {
        return res.status(409).json({
          error: "An active variant with the same options already exists",
          code: "DUPLICATE_OPTIONS",
          conflictingVariant: {
            _id: twin._id,
            sku: twin.sku,
            selectedOptions: twin.selectedOptions,
          },
        });
      }
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
      status: status || "active",
      selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
      optionsKey: newOptionsKey,
    });

    await variant.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "variant_created",
      req.ip,
      req.get("user-agent"),
      { details: `Variant created for product: ${product.name}` },
    );

    return res.status(201).json({ message: "Variant created", variant });
  } catch (error) {
    // MongoDB unique index violation on (org, product, optionsKey)
    if (error?.code === 11000 && error?.keyPattern?.optionsKey) {
      return res.status(409).json({
        error: "An active variant with the same options already exists",
        code: "DUPLICATE_OPTIONS",
      });
    }
    console.error("Create variant error:", error);
    return res.status(500).json({ error: "Failed to create variant" });
  }
});

/**
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
 * GET /variants/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const variant = await Variant.findOne({
      _id: req.params.id,
      organizationId,
    }).populate("productId");

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
 * PUT /variants/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      sku,
      price,
      compareAtPrice,
      cost,
      weight,
      metafields,
      barcode,
      digitalContent,
      position,
      status,
      trackInventory,
      taxClass,
      selectedOptions,
    } = req.body;

    const variant = await Variant.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    if (sku && sku !== variant.sku) {
      const existingSku = await Variant.findOne({ organizationId, sku });
      if (existingSku) {
        return res.status(409).json({ error: "SKU already exists" });
      }
      variant.sku = sku;
    }

    // If status is moving to "active", or selectedOptions are changing on an
    // active variant, guard against duplicate option tuples.
    const nextStatus = status || variant.status;
    const nextOptions = Array.isArray(selectedOptions)
      ? selectedOptions
      : variant.selectedOptions;
    const nextOptionsKey = optionsKey(nextOptions);

    if (nextStatus === "active" && nextOptionsKey) {
      const twin = await Variant.findOne({
        organizationId,
        productId: variant.productId,
        status: "active",
        optionsKey: nextOptionsKey,
        _id: { $ne: variant._id },
      });
      if (twin) {
        return res.status(409).json({
          error: "An active variant with the same options already exists",
          code: "DUPLICATE_OPTIONS",
          conflictingVariant: {
            _id: twin._id,
            sku: twin.sku,
            selectedOptions: twin.selectedOptions,
          },
        });
      }
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
    if (Array.isArray(selectedOptions)) {
      variant.selectedOptions = selectedOptions;
      variant.optionsKey = nextOptionsKey;
    }

    await variant.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "variant_updated",
      req.ip,
      req.get("user-agent"),
      { details: `Variant updated: ${variant.sku}` },
    );

    return res.status(200).json({ message: "Variant updated", variant });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.optionsKey) {
      return res.status(409).json({
        error: "An active variant with the same options already exists",
        code: "DUPLICATE_OPTIONS",
      });
    }
    console.error("Update variant error:", error);
    return res.status(500).json({ error: "Failed to update variant" });
  }
});

/**
 * PATCH /variants/:id/restore
 * Un-archive a variant. Refuses if another active variant already has the
 * same option tuple.
 */
router.patch("/:id/restore", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const variant = await Variant.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }
    if (variant.status !== "archived") {
      return res.status(400).json({ error: "Variant is not archived" });
    }

    // Compute the tuple in case optionsKey wasn't populated on legacy docs
    const tupleKey = variant.optionsKey || optionsKey(variant.selectedOptions);

    if (tupleKey) {
      const twin = await Variant.findOne({
        organizationId,
        productId: variant.productId,
        status: "active",
        optionsKey: tupleKey,
        _id: { $ne: variant._id },
      });
      if (twin) {
        return res.status(409).json({
          error: "An active variant with the same options already exists",
          code: "DUPLICATE_OPTIONS",
          conflictingVariant: {
            _id: twin._id,
            sku: twin.sku,
            selectedOptions: twin.selectedOptions,
          },
        });
      }
    }

    variant.status = "active";
    variant.optionsKey = tupleKey;
    await variant.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "variant_restored",
      req.ip,
      req.get("user-agent"),
      { details: `Variant restored: ${variant.sku}` },
    );

    return res.status(200).json({ message: "Variant restored", variant });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.optionsKey) {
      return res.status(409).json({
        error: "An active variant with the same options already exists",
        code: "DUPLICATE_OPTIONS",
      });
    }
    console.error("Restore variant error:", error);
    return res.status(500).json({ error: "Failed to restore variant" });
  }
});

/**
 * DELETE /variants/:id
 * Soft-delete: sets status to "archived". Hard delete is intentionally not
 * exposed — sales history and inventory audits reference variant IDs, and
 * deleting the doc would orphan them. Use PATCH /:id/restore to undo.
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const variant = await Variant.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    if (variant.status === "archived") {
      return res.status(200).json({ message: "Variant already archived", variant });
    }

    variant.status = "archived";
    await variant.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "variant_archived",
      req.ip,
      req.get("user-agent"),
      { details: `Variant archived: ${variant.sku}` },
    );

    return res.status(200).json({ message: "Variant archived", variant });
  } catch (error) {
    console.error("Archive variant error:", error);
    return res.status(500).json({ error: "Failed to archive variant" });
  }
});

module.exports = router;