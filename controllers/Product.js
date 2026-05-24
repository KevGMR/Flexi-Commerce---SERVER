const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Product = require("../models/Product");
const Variant = require("../models/Variant");
const { verifyToken, requireOrganization } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Create product
 * POST /products
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      name,
      description,
      sku,
      type,
      serviceKind,
      serviceBundleComponents,
      trackInventory,
      price,
      compareAtPrice,
      cost,
      weight,
      weightUnit,
      tags,
      images,
      vendor,
    } = req.body;

    if (!name || !sku || price === undefined || price === null) {
      return res.status(400).json({ error: "name, sku, and price are required" });
    }

    if (type === "service" && serviceKind === "bundle") {
      if (!Array.isArray(serviceBundleComponents) || serviceBundleComponents.length === 0) {
        return res.status(400).json({
          error: "serviceBundleComponents are required when creating a bundled service",
        });
      }
    }

    // Check SKU uniqueness per org
    const existingSku = await Product.findOne({ organizationId, sku });
    if (existingSku) {
      return res.status(409).json({ error: "SKU already exists in this organization" });
    }

    const product = new Product({
      organizationId,
      name,
      description,
      sku,
      type: type || "physical",
      serviceKind: type === "service" ? serviceKind || "single" : "single",
      serviceBundleComponents: Array.isArray(serviceBundleComponents)
        ? serviceBundleComponents
        : [],
      price,
      compareAtPrice,
      cost,
      weight,
      weightUnit,
      tags,
      images,
      vendor,
      trackInventory: type === "service" ? false : trackInventory,
      createdBy: req.user.userId,
    });

    await product.save();

    await logTokenEvent(req.user.userId, organizationId, "product_created", req.ip, req.get("user-agent"), {
      details: `Product created: ${product.name}`,
    });

    return res.status(201).json({ message: "Product created", product });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(500).json({ error: "Failed to create product" });
  }
});

/**
 * Get all products
 * GET /products
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { status, search, type, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (status) query.status = status;
    if (type) query.type = type;
    if (search) query.name = new RegExp(search, "i");

    const products = await Product.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    return res.status(200).json({ products, total, skip: parseInt(skip), limit: parseInt(limit) });
  } catch (error) {
    console.error("Get products error:", error);
    return res.status(500).json({ error: "Failed to fetch products" });
  }
});

/**
 * Get product by ID
 * GET /products/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const product = await Product.findOne({ _id: req.params.id, organizationId }).populate("collectionIds");

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Get variants
    const variants = await Variant.find({ productId: product._id });

    return res.status(200).json({ product, variants });
  } catch (error) {
    console.error("Get product error:", error);
    return res.status(500).json({ error: "Failed to fetch product" });
  }
});

/**
 * Update product
 * PUT /products/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      name,
      description,
      sku,
      type,
      serviceKind,
      serviceBundleComponents,
      trackInventory,
      price,
      compareAtPrice,
      cost,
      weight,
      weightUnit,
      tags,
      images,
      vendor,
      status,
    } = req.body;

    const product = await Product.findOne({ _id: req.params.id, organizationId });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Check SKU uniqueness if changed
    if (sku && sku !== product.sku) {
      const existingSku = await Product.findOne({ organizationId, sku });
      if (existingSku) {
        return res.status(409).json({ error: "SKU already exists" });
      }
      product.sku = sku;
    }

    if (name) product.name = name;
    if (description !== undefined) product.description = description;
    if (type) product.type = type;
    if (serviceKind) product.serviceKind = serviceKind;
    if (serviceBundleComponents !== undefined) product.serviceBundleComponents = Array.isArray(serviceBundleComponents) ? serviceBundleComponents : [];
    if (trackInventory !== undefined) {
      product.trackInventory = trackInventory;
    }
    if (price !== undefined) product.price = price;
    if (compareAtPrice !== undefined) product.compareAtPrice = compareAtPrice;
    if (cost !== undefined) product.cost = cost;
    if (weight !== undefined) product.weight = weight;
    if (weightUnit) product.weightUnit = weightUnit;
    if (tags) product.tags = tags;
    if (images) product.images = images;
    if (vendor) product.vendor = vendor;
    if (status) product.status = status;

    if (product.type === "service") {
      product.trackInventory = false;
      if (!product.serviceKind) product.serviceKind = "single";
      if (product.serviceKind === "bundle" && (!product.serviceBundleComponents || product.serviceBundleComponents.length === 0)) {
        return res.status(400).json({
          error: "serviceBundleComponents are required when saving a bundled service",
        });
      }
    }

    await product.save();

    await logTokenEvent(req.user.userId, organizationId, "product_updated", req.ip, req.get("user-agent"), {
      details: `Product updated: ${product.name}`,
    });

    return res.status(200).json({ message: "Product updated", product });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ error: "Failed to update product" });
  }
});

/**
 * Delete product
 * DELETE /products/:id
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    // Check if product has variants
    const variantCount = await Variant.countDocuments({ productId: req.params.id });
    if (variantCount > 0) {
      return res.status(400).json({ error: "Cannot delete product with variants. Delete variants first." });
    }

    const product = await Product.findOneAndDelete({ _id: req.params.id, organizationId });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await logTokenEvent(req.user.userId, organizationId, "product_deleted", req.ip, req.get("user-agent"), {
      details: `Product deleted: ${product.name}`,
    });

    return res.status(200).json({ message: "Product deleted" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ error: "Failed to delete product" });
  }
});

module.exports = router;
