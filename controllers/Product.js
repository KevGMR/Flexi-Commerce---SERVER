const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

// --- Helper to parse numbers ---
const toNumber = (val) => (val !== undefined && val !== null ? Number(val) : undefined);

// --- Helper to validate a sub-service object ---
const validateSubService = (sub, index) => {
  if (!sub.name || typeof sub.name !== "string" || sub.name.trim() === "") {
    return { valid: false, error: `Sub-service at index ${index} must have a name` };
  }
  if (sub.laborCost !== undefined && (typeof sub.laborCost !== "number" || sub.laborCost < 0)) {
    return { valid: false, error: `Sub-service at index ${index} laborCost must be a non-negative number` };
  }
  if (sub.productCost !== undefined && (typeof sub.productCost !== "number" || sub.productCost < 0)) {
    return { valid: false, error: `Sub-service at index ${index} productCost must be a non-negative number` };
  }
  if (sub.commissionType && !["percentage", "fixed"].includes(sub.commissionType)) {
    return { valid: false, error: `Sub-service at index ${index} commissionType must be 'percentage' or 'fixed'` };
  }
  if (sub.commissionValue !== undefined && (typeof sub.commissionValue !== "number" || sub.commissionValue < 0)) {
    return { valid: false, error: `Sub-service at index ${index} commissionValue must be a non-negative number` };
  }
  if (sub.commissionDeductionTiming && !["before_commission", "after_deductions"].includes(sub.commissionDeductionTiming)) {
    return { valid: false, error: `Sub-service at index ${index} commissionDeductionTiming must be 'before_commission' or 'after_deductions'` };
  }
  return { valid: true };
};

// --- Helper to extract price from a product (for bundles) ---
const calculateBundlePrice = (subServices) => {
  if (!subServices || !Array.isArray(subServices)) return 0;
  return subServices.reduce((sum, sub) => sum + (sub.laborCost || 0) + (sub.productCost || 0), 0);
};

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
      bundleSubServices, // new field
      trackInventory,
      price,
      compareAtPrice,
      cost,
      weight,
      weightUnit,
      tags,
      images,
      vendor,
      commissionType,
      commissionValue,
      laborCost,
      productCost,
    } = req.body;

    console.log("[Product POST] Received:", { laborCost, productCost, price, serviceKind, bundleSubServices });

    if (!name || !sku || price === undefined || price === null) {
      return res.status(400).json({ error: "name, sku, and price are required" });
    }

    // For bundle services, require either serviceBundleComponents (legacy) or bundleSubServices (new)
    if (type === "service" && serviceKind === "bundle") {
      const hasLegacy = Array.isArray(serviceBundleComponents) && serviceBundleComponents.length > 0;
      const hasNew = Array.isArray(bundleSubServices) && bundleSubServices.length > 0;
      if (!hasLegacy && !hasNew) {
        return res.status(400).json({
          error: "bundleSubServices (or serviceBundleComponents) are required when creating a bundled service",
        });
      }
      // If both are provided, prefer bundleSubServices
      if (hasNew) {
        // Validate each sub-service
        for (let i = 0; i < bundleSubServices.length; i++) {
          const result = validateSubService(bundleSubServices[i], i);
          if (!result.valid) {
            return res.status(400).json({ error: result.error });
          }
        }
      }
    }

    const existingSku = await Product.findOne({ organizationId, sku });
    if (existingSku) {
      return res.status(409).json({ error: "SKU already exists" });
    }

    let finalPrice = Number(price) || 0;
    let finalLabor = 0,
      finalProduct = 0;
    let finalCommissionType = "percentage",
      finalCommissionValue = 0;
    let finalBundleSubServices = bundleSubServices;

    if (type === "service") {
      // Commission
      if (commissionType && !["percentage", "fixed"].includes(commissionType)) {
        return res.status(400).json({ error: "commissionType must be 'percentage' or 'fixed'" });
      }
      if (commissionValue !== undefined && (typeof commissionValue !== "number" || commissionValue < 0)) {
        return res.status(400).json({ error: "commissionValue must be non-negative" });
      }
      finalCommissionType = commissionType || "percentage";
      finalCommissionValue = commissionValue !== undefined ? commissionValue : 0;

      // Labor & Product
      const labor = toNumber(laborCost) ?? 0;
      const product = toNumber(productCost) ?? 0;
      if (labor < 0 || product < 0) {
        return res.status(400).json({ error: "laborCost and productCost cannot be negative" });
      }
      if (serviceKind !== "bundle") {
        // For single services, enforce labor+product=price
        if (labor + product !== finalPrice) {
          return res.status(400).json({
            error: `Price (${finalPrice}) must equal laborCost (${labor}) + productCost (${product})`,
          });
        }
      }
      finalLabor = labor;
      finalProduct = product;

      // For bundles, compute price from sub-services if not provided
      if (serviceKind === "bundle") {
        // If price was provided, we could still use it, but we recommend using the sum.
        // We'll use the sum anyway.
        const subServicesToUse = finalBundleSubServices || serviceBundleComponents || [];
        const computedPrice = calculateBundlePrice(subServicesToUse);
        if (computedPrice !== finalPrice) {
          // Warn but don't reject; we can allow override, but we'll set to computed for safety.
          // We'll set the price to the computed sum.
          finalPrice = computedPrice;
        }
        // Ensure the subServices are stored
        if (finalBundleSubServices && finalBundleSubServices.length > 0) {
          // Use the new field
        } else if (serviceBundleComponents && serviceBundleComponents.length > 0) {
          // Fallback to legacy
          finalBundleSubServices = serviceBundleComponents.map(comp => ({
            name: comp.nameSnapshot || "Unnamed",
            laborCost: comp.priceSnapshot || 0,
            productCost: 0,
            commissionDeductionTiming: "before_commission",
            commissionType: "percentage",
            commissionValue: 0,
            defaultAssignedUser: null,
          }));
        } else {
          // Should not happen due to validation
          return res.status(400).json({ error: "No sub-services found for bundle" });
        }
      }
    }

    const product = new Product({
      organizationId,
      name,
      description,
      sku,
      type: type || "physical",
      serviceKind: type === "service" ? serviceKind || "single" : "single",
      serviceBundleComponents: Array.isArray(serviceBundleComponents) ? serviceBundleComponents : [],
      bundleSubServices: finalBundleSubServices || [],
      price: finalPrice,
      compareAtPrice,
      cost,
      weight,
      weightUnit,
      tags,
      images,
      vendor,
      trackInventory: type === "service" ? false : trackInventory,
      createdBy: req.user.userId,
      commissionType: finalCommissionType,
      commissionValue: finalCommissionValue,
      laborCost: finalLabor,
      productCost: finalProduct,
    });

    await product.save();
    console.log("[Product POST] Saved product:", {
      id: product._id,
      laborCost: product.laborCost,
      productCost: product.productCost,
      price: product.price,
      serviceKind: product.serviceKind,
      bundleSubServices: product.bundleSubServices?.length || 0,
    });

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
      bundleSubServices, // new field
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
      commissionType,
      commissionValue,
      laborCost,
      productCost,
    } = req.body;

    console.log("[Product PUT] Received:", { laborCost, productCost, price, serviceKind, bundleSubServices });

    const product = await Product.findOne({ _id: req.params.id, organizationId });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // SKU uniqueness if changed
    if (sku && sku !== product.sku) {
      const existingSku = await Product.findOne({ organizationId, sku });
      if (existingSku) {
        return res.status(409).json({ error: "SKU already exists" });
      }
      product.sku = sku;
    }

    // Basic fields
    if (name) product.name = name;
    if (description !== undefined) product.description = description;
    if (type) product.type = type;
    if (serviceKind) product.serviceKind = serviceKind;
    if (serviceBundleComponents !== undefined) product.serviceBundleComponents = Array.isArray(serviceBundleComponents) ? serviceBundleComponents : [];
    if (bundleSubServices !== undefined) {
      // Validate new bundleSubServices
      if (Array.isArray(bundleSubServices) && bundleSubServices.length > 0) {
        for (let i = 0; i < bundleSubServices.length; i++) {
          const result = validateSubService(bundleSubServices[i], i);
          if (!result.valid) {
            return res.status(400).json({ error: result.error });
          }
        }
        product.bundleSubServices = bundleSubServices;
      } else {
        product.bundleSubServices = [];
      }
    }
    if (trackInventory !== undefined) product.trackInventory = trackInventory;
    if (price !== undefined) product.price = price;
    if (compareAtPrice !== undefined) product.compareAtPrice = compareAtPrice;
    if (cost !== undefined) product.cost = cost;
    if (weight !== undefined) product.weight = weight;
    if (weightUnit) product.weightUnit = weightUnit;
    if (tags) product.tags = tags;
    if (images) product.images = images;
    if (vendor) product.vendor = vendor;
    if (status) product.status = status;

    // Service-specific fields
    if (product.type === "service") {
      product.trackInventory = false;
      if (!product.serviceKind) product.serviceKind = "single";

      // For bundles, ensure we have sub-services if required
      if (product.serviceKind === "bundle") {
        const hasLegacy = Array.isArray(product.serviceBundleComponents) && product.serviceBundleComponents.length > 0;
        const hasNew = Array.isArray(product.bundleSubServices) && product.bundleSubServices.length > 0;
        if (!hasLegacy && !hasNew) {
          return res.status(400).json({
            error: "bundleSubServices (or serviceBundleComponents) are required when saving a bundled service",
          });
        }
        // If we have new sub-services, compute price from them
        if (hasNew) {
          const computedPrice = calculateBundlePrice(product.bundleSubServices);
          // Optionally we can set product.price = computedPrice if not explicitly set
          // If price was provided in request, we can still use it, but we'll default to computed
          if (price === undefined) {
            product.price = computedPrice;
          }
        }
      }

      // Commission
      if (commissionType !== undefined) {
        if (!["percentage", "fixed"].includes(commissionType)) {
          return res.status(400).json({ error: "commissionType must be 'percentage' or 'fixed'" });
        }
        product.commissionType = commissionType;
      }
      if (commissionValue !== undefined) {
        if (typeof commissionValue !== "number" || commissionValue < 0) {
          return res.status(400).json({ error: "commissionValue must be non-negative" });
        }
        product.commissionValue = commissionValue;
      }

      // Labor & Product – for single services enforce sum=price
      const currentLabor = product.laborCost || 0;
      const currentProduct = product.productCost || 0;
      const newLabor = toNumber(laborCost);
      const newProduct = toNumber(productCost);
      const finalLabor = newLabor !== undefined ? newLabor : currentLabor;
      const finalProduct = newProduct !== undefined ? newProduct : currentProduct;

      if (finalLabor < 0 || finalProduct < 0) {
        return res.status(400).json({ error: "laborCost and productCost cannot be negative" });
      }

      let finalPrice = price !== undefined ? Number(price) : product.price;
      if (product.serviceKind !== "bundle") {
        if (finalLabor + finalProduct !== finalPrice) {
          return res.status(400).json({
            error: `Price (${finalPrice}) must equal laborCost (${finalLabor}) + productCost (${finalProduct})`,
          });
        }
      } else {
        // For bundles, we don't enforce sum; we let price be computed from sub-services
        // But we still store labor/product as 0 for the parent.
        product.laborCost = 0;
        product.productCost = 0;
        // price is computed from sub-services or set manually
      }

      product.laborCost = finalLabor;
      product.productCost = finalProduct;

      console.log("[Product PUT] Updated service costs:", {
        laborCost: product.laborCost,
        productCost: product.productCost,
        price: product.price,
      });
    } else {
      // Non-services: reset cost fields
      product.laborCost = 0;
      product.productCost = 0;
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