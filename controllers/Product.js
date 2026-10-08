const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const Product = require("../models/Product");
const Variant = require("../models/Variant");
const Inventory = require("../models/Inventory");
const Location = require("../models/Location");

const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");
const {
  syncProductCollections,
  recomputeAutomaticCollections,
} = require("../services/collectionSync");

// ---------------------------------------------------------------
// helpers (existing)
// ---------------------------------------------------------------

const toNumber = (val) =>
  val !== undefined && val !== null ? Number(val) : undefined;

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
  if (
    sub.commissionDeductionTiming &&
    !["before_commission", "after_deductions"].includes(sub.commissionDeductionTiming)
  ) {
    return {
      valid: false,
      error: `Sub-service at index ${index} commissionDeductionTiming must be 'before_commission' or 'after_deductions'`,
    };
  }
  return { valid: true };
};

const calculateBundlePrice = (subServices) => {
  if (!subServices || !Array.isArray(subServices)) return 0;
  return subServices.reduce(
    (sum, sub) => sum + (sub.laborCost || 0) + (sub.productCost || 0),
    0
  );
};

// ---------------------------------------------------------------
// helpers (new — handle / sku / persistence)
// ---------------------------------------------------------------

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function generateProductSku() {
  return `PROD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function generateVariantSku() {
  return `VAR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function ensureUniqueHandle(organizationId, base, excludeId = null) {
  const root = slugify(base) || "product";
  let candidate = root;
  let n = 2;

  while (n < 200) {
    const query = { organizationId, handle: candidate };
    if (excludeId) query._id = { $ne: excludeId };
    const exists = await Product.findOne(query).select("_id").lean();
    if (!exists) return candidate;
    candidate = `${root}-${n++}`;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Persist variants for a product.
 * incomingVariants: array of variant payloads. Each has `_id` (existing) or `_temp` (new).
 * Returns array of { incomingKey, doc }.
 */
async function persistVariants(organizationId, productId, incomingVariants) {
  const saved = [];

  for (let i = 0; i < incomingVariants.length; i++) {
    const v = incomingVariants[i];
    const incomingKey = v._id || v._temp || `idx-${i}`;

    const fields = {
      organizationId,
      productId,
      sku: (v.sku && String(v.sku).trim()) || generateVariantSku(),
      sourceSku: v.sourceSku ?? null,
      shopifyId: v.shopifyId,
      shopifyNumericId: v.shopifyNumericId,
      inventoryItemId: v.inventoryItemId,
      selectedOptions: Array.isArray(v.selectedOptions)
        ? v.selectedOptions.map((o) => ({ name: o.name, value: o.value }))
        : [],
      price: v.price !== undefined && v.price !== null ? Number(v.price) : 0,
      compareAtPrice:
        v.compareAtPrice !== undefined && v.compareAtPrice !== null
          ? Number(v.compareAtPrice)
          : undefined,
      cost: v.cost !== undefined && v.cost !== null ? Number(v.cost) : undefined,
      weight: v.weight !== undefined && v.weight !== null ? Number(v.weight) : undefined,
      weightUnit: v.weightUnit,
      barcode: v.barcode,
      position: v.position !== undefined ? Number(v.position) : i,
      trackInventory: v.trackInventory !== false,
      continueSellingWhenOutOfStock: v.continueSellingWhenOutOfStock === true,
      status: v.status === "archived" ? "archived" : "active",
      images: Array.isArray(v.images) ? v.images : [],
      metafields: Array.isArray(v.metafields) ? v.metafields : [],
    };

    let doc = null;

    if (v._id) {
      doc = await Variant.findOneAndUpdate(
        { _id: v._id, organizationId },
        fields,
        { new: true, runValidators: true }
      );
    }

    if (!doc) {
      try {
        doc = await Variant.create(fields);
      } catch (err) {
        // duplicate SKU → synthesize and retry once
        if (err?.code === 11000) {
          fields.sku = generateVariantSku();
          doc = await Variant.create(fields);
        } else {
          throw err;
        }
      }
    }

    saved.push({ incomingKey, doc });
  }

  return saved;
}

/**
 * Upsert inventory rows for a set of variants.
 * incomingInventory: [{ variantId, locationId, onHand, available?, committed?, unavailable? }]
 *   variantId may be either a real ObjectId or a `_temp` key from the client.
 * keyToRealId: Map<string, ObjectId>
 */
async function persistInventory(organizationId, keyToRealId, incomingInventory) {
  const saved = [];

  for (const inv of incomingInventory) {
    const key = String(inv.variantId ?? "");
    const realVariantId = keyToRealId.get(key) || inv.variantId;
    if (!realVariantId || !inv.locationId) continue;

    const qty = Number(inv.onHand) || 0;
    const doc = await Inventory.findOneAndUpdate(
      {
        organizationId,
        variantId: realVariantId,
        locationId: inv.locationId,
      },
      {
        organizationId,
        variantId: realVariantId,
        locationId: inv.locationId,
        onHand: qty,
        available:
          inv.available !== undefined && inv.available !== null
            ? Number(inv.available)
            : qty,
        committed: Number(inv.committed) || 0,
        unavailable: Number(inv.unavailable) || 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    saved.push(doc);
  }

  return saved;
}

// ---------------------------------------------------------------
// POS catalog — MUST be before /:id
// ---------------------------------------------------------------

router.get("/pos-catalog", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { locationId, search, skip = 0, limit = 100 } = req.query;

    if (!locationId) {
      return res.status(400).json({ error: "locationId is required" });
    }

    const location = await Location.findOne({ _id: locationId, organizationId })
      .select("_id name")
      .lean();
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    const query = {
      organizationId,
      status: { $in: ["active", "draft", "unlisted"] },
    };
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { sku: new RegExp(search, "i") },
        { tags: new RegExp(search, "i") },
      ];
    }

    const products = await Product.find(query)
      .skip(Number(skip))
      .limit(Number(limit))
      .sort({ name: 1 })
      .lean();

    const total = await Product.countDocuments(query);

    const variants = await Variant.find({
      organizationId,
      productId: { $in: products.map((p) => p._id) },
      status: "active",
    })
      .sort({ position: 1 })
      .lean();

    const inventory = await Inventory.find({
      organizationId,
      locationId,
      variantId: { $in: variants.map((v) => v._id) },
    }).lean();

    const invByVariant = new Map(
      inventory.map((i) => [String(i.variantId), i])
    );

    const variantsByProduct = new Map();
    for (const v of variants) {
      const key = String(v.productId);
      if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
      const inv = invByVariant.get(String(v._id));
      variantsByProduct.get(key).push({
        _id: v._id,
        sku: v.sku,
        barcode: v.barcode || null,
        price: v.price ?? 0,
        compareAtPrice: v.compareAtPrice ?? null,
        selectedOptions: v.selectedOptions || [],
        trackInventory: v.trackInventory !== false,
        continueSellingWhenOutOfStock: v.continueSellingWhenOutOfStock === true,
        images: v.images || [],
        availableAtLocation: inv ? inv.available : null,
        onHandAtLocation: inv ? inv.onHand : null,
      });
    }

    const payload = products.map((p) => ({
      _id: p._id,
      name: p.name,
      productType: p.productType || "",
      vendor: p.vendor || "",
      tags: p.tags || [],
      images: p.images || [],
      defaultImage:
        (p.images || []).find((i) => i.isDefault) || (p.images || [])[0] || null,
      variants: variantsByProduct.get(String(p._id)) || [],
    }));

    return res.status(200).json({
      products: payload,
      total,
      locationId,
      locationName: location.name,
    });
  } catch (error) {
    console.error("POS catalog error:", error);
    return res.status(500).json({ error: "Failed to fetch POS catalog" });
  }
});

// ---------------------------------------------------------------
// POST /products
// ---------------------------------------------------------------

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
      bundleSubServices,
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

      // new
      options,
      metafields,
      handle,
      productType,
      shopifyId,
      shopifyNumericId,
      status,
      variants: incomingVariants,
      inventory: incomingInventory,
      collectionIds,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    if (type === "service" && serviceKind === "bundle") {
      const hasLegacy =
        Array.isArray(serviceBundleComponents) && serviceBundleComponents.length > 0;
      const hasNew =
        Array.isArray(bundleSubServices) && bundleSubServices.length > 0;
      if (!hasLegacy && !hasNew) {
        return res.status(400).json({
          error:
            "bundleSubServices (or serviceBundleComponents) are required when creating a bundled service",
        });
      }
      if (hasNew) {
        for (let i = 0; i < bundleSubServices.length; i++) {
          const r = validateSubService(bundleSubServices[i], i);
          if (!r.valid) return res.status(400).json({ error: r.error });
        }
      }
    }

    let finalSku = (sku && String(sku).trim()) || generateProductSku();
    let existingSku = await Product.findOne({ organizationId, sku: finalSku });
    if (existingSku) {
      if (sku) {
        return res.status(409).json({ error: "SKU already exists" });
      }
      finalSku = generateProductSku();
    }

    let finalPrice;
    if (price !== undefined && price !== null) {
      finalPrice = Number(price);
    } else if (Array.isArray(incomingVariants) && incomingVariants.length) {
      const priced = incomingVariants
        .map((v) => Number(v.price))
        .filter((p) => Number.isFinite(p) && p > 0);
      finalPrice = priced.length ? Math.min(...priced) : 0;
    } else {
      finalPrice = 0;
    }

    let finalLabor = 0;
    let finalProduct = 0;
    let finalCommissionType = "percentage";
    let finalCommissionValue = 0;
    let finalBundleSubServices = bundleSubServices;

    if (type === "service") {
      if (commissionType && !["percentage", "fixed"].includes(commissionType)) {
        return res.status(400).json({ error: "commissionType must be 'percentage' or 'fixed'" });
      }
      if (
        commissionValue !== undefined &&
        (typeof commissionValue !== "number" || commissionValue < 0)
      ) {
        return res.status(400).json({ error: "commissionValue must be non-negative" });
      }
      finalCommissionType = commissionType || "percentage";
      finalCommissionValue = commissionValue !== undefined ? commissionValue : 0;

      const labor = toNumber(laborCost) ?? 0;
      const product = toNumber(productCost) ?? 0;
      if (labor < 0 || product < 0) {
        return res.status(400).json({ error: "laborCost and productCost cannot be negative" });
      }
      if (serviceKind !== "bundle") {
        if (labor + product !== finalPrice) {
          return res.status(400).json({
            error: `Price (${finalPrice}) must equal laborCost (${labor}) + productCost (${product})`,
          });
        }
      }
      finalLabor = labor;
      finalProduct = product;

      if (serviceKind === "bundle") {
        const subServicesToUse =
          finalBundleSubServices || serviceBundleComponents || [];
        finalPrice = calculateBundlePrice(subServicesToUse);

        if (finalBundleSubServices && finalBundleSubServices.length > 0) {
          // use new
        } else if (serviceBundleComponents && serviceBundleComponents.length > 0) {
          finalBundleSubServices = serviceBundleComponents.map((comp) => ({
            name: comp.nameSnapshot || "Unnamed",
            laborCost: comp.priceSnapshot || 0,
            productCost: 0,
            commissionDeductionTiming: "before_commission",
            commissionType: "percentage",
            commissionValue: 0,
            defaultAssignedUser: null,
          }));
        } else {
          return res.status(400).json({ error: "No sub-services found for bundle" });
        }
      }
    }

    const finalHandle = handle
      ? await ensureUniqueHandle(organizationId, handle)
      : await ensureUniqueHandle(organizationId, name);

    const product = new Product({
      organizationId,
      name,
      description: description || "",
      sku: finalSku,
      type: type || "physical",
      serviceKind: type === "service" ? serviceKind || "single" : "single",
      serviceBundleComponents: Array.isArray(serviceBundleComponents)
        ? serviceBundleComponents
        : [],
      bundleSubServices: finalBundleSubServices || [],
      price: finalPrice,
      compareAtPrice,
      cost,
      weight,
      weightUnit,
      tags: Array.isArray(tags) ? tags : [],
      images: Array.isArray(images) ? images : [],
      vendor,

      options: Array.isArray(options) ? options : [],
      metafields: Array.isArray(metafields) ? metafields : [],
      handle: finalHandle,
      productType: productType || "",
      shopifyId,
      shopifyNumericId,
      status: ["active", "draft", "unlisted", "archived"].includes(status)
        ? status
        : "active",

      trackInventory: type === "service" ? false : trackInventory !== false,
      createdBy: req.user.userId,
      commissionType: finalCommissionType,
      commissionValue: finalCommissionValue,
      laborCost: finalLabor,
      productCost: finalProduct,

      collectionIds: Array.isArray(collectionIds) ? collectionIds : [],
    });

    await product.save();

    // ---- Collection two-way sync (manual collections) ----
    if (Array.isArray(collectionIds) && collectionIds.length > 0) {
      try {
        await syncProductCollections({
          organizationId,
          productId: product._id,
          oldCollectionIds: [],
          newCollectionIds: collectionIds,
        });
      } catch (err) {
        console.error("[Product] collection sync failed:", err.message);
      }
    }

    // ---- Automatic collection recompute ----
    try {
      await recomputeAutomaticCollections({
        organizationId,
        productIds: [product._id],
        forceFullSweep: true,
      });
    } catch (err) {
      console.error("[Product] auto-collection recompute failed:", err.message);
    }

    // ---- Variants + inventory ----
    let savedVariants = [];
    let savedInventory = [];

    if (Array.isArray(incomingVariants) && incomingVariants.length) {
      savedVariants = await persistVariants(
        organizationId,
        product._id,
        incomingVariants
      );

      if (Array.isArray(incomingInventory) && incomingInventory.length) {
        const keyToRealId = new Map();
        for (const { incomingKey, doc } of savedVariants) {
          keyToRealId.set(String(incomingKey), doc._id);
          keyToRealId.set(String(doc._id), doc._id);
        }
        savedInventory = await persistInventory(
          organizationId,
          keyToRealId,
          incomingInventory
        );
      }

      // Variant changes can affect variant-scoped and location-aware automatic collections
      try {
        await recomputeAutomaticCollections({
          organizationId,
          productIds: [product._id],
          forceFullSweep: true,
        });
      } catch (err) {
        console.error("[Product] variant-triggered recompute failed:", err.message);
      }
    }

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "product_created",
      req.ip,
      req.get("user-agent"),
      { details: `Product created: ${product.name}` }
    );

    return res.status(201).json({
      message: "Product created",
      product,
      variants: savedVariants.map((s) => s.doc),
      inventory: savedInventory,
    });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(500).json({ error: "Failed to create product" });
  }
});

// ---------------------------------------------------------------
// GET /products — enriched list
// ---------------------------------------------------------------

router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { status, search, type, skip = 0, limit = 50 } = req.query;

    const query = { organizationId };
    if (status) query.status = status;
    if (type) query.type = type;
    if (search) query.name = new RegExp(search, "i");

    const products = await Product.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .lean();

    const total = await Product.countDocuments(query);

    const variants = await Variant.find({
      organizationId,
      productId: { $in: products.map((p) => p._id) },
    }).lean();

    const inventory = await Inventory.find({
      organizationId,
      variantId: { $in: variants.map((v) => v._id) },
    }).lean();

    const invByVariant = new Map(inventory.map((i) => [String(i.variantId), i]));
    const variantsByProduct = new Map();
    for (const v of variants) {
      const k = String(v.productId);
      if (!variantsByProduct.has(k)) variantsByProduct.set(k, []);
      const inv = invByVariant.get(String(v._id));
      variantsByProduct.get(k).push({
        _id: v._id,
        price: v.price,
        trackInventory: v.trackInventory !== false,
        totalStock: inv ? inv.onHand : null,
      });
    }

    const enriched = products.map((p) => {
      const vs = variantsByProduct.get(String(p._id)) || [];
      const prices = vs
        .map((v) => v.price)
        .filter((n) => Number.isFinite(n) && n > 0);
      const stocks = vs
        .filter((v) => v.trackInventory)
        .map((v) => v.totalStock || 0);
      return {
        ...p,
        variantCount: vs.length,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        totalStock: stocks.length ? stocks.reduce((a, b) => a + b, 0) : null,
      };
    });

    return res.status(200).json({
      products: enriched,
      total,
      skip: parseInt(skip),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error("Get products error:", error);
    return res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ---------------------------------------------------------------
// GET /products/:id
// ---------------------------------------------------------------

router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const product = await Product.findOne({
      _id: req.params.id,
      organizationId,
    }).populate("collectionIds");

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const variants = await Variant.find({ productId: product._id }).sort({
      position: 1,
    });

    const inventory = await Inventory.find({
      organizationId,
      variantId: { $in: variants.map((v) => v._id) },
    });

    const locations = await Location.find({
      organizationId,
      status: "active",
    })
      .select("_id name locationType isDefault")
      .lean();

    return res.status(200).json({
      product,
      variants,
      inventory,
      locations,
    });
  } catch (error) {
    console.error("Get product error:", error);
    return res.status(500).json({ error: "Failed to fetch product" });
  }
});

// ---------------------------------------------------------------
// PUT /products/:id
// ---------------------------------------------------------------

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
      bundleSubServices,
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

      // new
      options,
      metafields,
      handle,
      productType,
      variants: incomingVariants,
      inventory: incomingInventory,
      clearVariantImages,
      collectionIds,
    } = req.body;

    const product = await Product.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Capture old collectionIds before mutation
    const oldCollectionIds = (product.collectionIds || []).map(String);

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
    if (serviceBundleComponents !== undefined) {
      product.serviceBundleComponents = Array.isArray(serviceBundleComponents)
        ? serviceBundleComponents
        : [];
    }
    if (bundleSubServices !== undefined) {
      if (Array.isArray(bundleSubServices) && bundleSubServices.length > 0) {
        for (let i = 0; i < bundleSubServices.length; i++) {
          const r = validateSubService(bundleSubServices[i], i);
          if (!r.valid) return res.status(400).json({ error: r.error });
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

    if (options !== undefined) {
      product.options = Array.isArray(options) ? options : [];
    }
    if (metafields !== undefined) {
      product.metafields = Array.isArray(metafields) ? metafields : [];
    }
    if (productType !== undefined) product.productType = productType;
    if (handle !== undefined && handle !== product.handle) {
      product.handle = await ensureUniqueHandle(
        organizationId,
        handle || product.name,
        product._id
      );
    }
    if (collectionIds !== undefined) {
      product.collectionIds = Array.isArray(collectionIds) ? collectionIds : [];
    }

    if (product.type === "service") {
      product.trackInventory = false;
      if (!product.serviceKind) product.serviceKind = "single";

      if (product.serviceKind === "bundle") {
        const hasLegacy =
          Array.isArray(product.serviceBundleComponents) &&
          product.serviceBundleComponents.length > 0;
        const hasNew =
          Array.isArray(product.bundleSubServices) &&
          product.bundleSubServices.length > 0;
        if (!hasLegacy && !hasNew) {
          return res.status(400).json({
            error:
              "bundleSubServices (or serviceBundleComponents) are required when saving a bundled service",
          });
        }
        if (hasNew && price === undefined) {
          product.price = calculateBundlePrice(product.bundleSubServices);
        }
      }

      if (commissionType !== undefined) {
        if (!["percentage", "fixed"].includes(commissionType)) {
          return res
            .status(400)
            .json({ error: "commissionType must be 'percentage' or 'fixed'" });
        }
        product.commissionType = commissionType;
      }
      if (commissionValue !== undefined) {
        if (typeof commissionValue !== "number" || commissionValue < 0) {
          return res
            .status(400)
            .json({ error: "commissionValue must be non-negative" });
        }
        product.commissionValue = commissionValue;
      }

      const currentLabor = product.laborCost || 0;
      const currentProduct = product.productCost || 0;
      const newLabor = toNumber(laborCost);
      const newProduct = toNumber(productCost);
      const finalLabor = newLabor !== undefined ? newLabor : currentLabor;
      const finalProduct = newProduct !== undefined ? newProduct : currentProduct;

      if (finalLabor < 0 || finalProduct < 0) {
        return res
          .status(400)
          .json({ error: "laborCost and productCost cannot be negative" });
      }

      const finalPrice = price !== undefined ? Number(price) : product.price;

      if (product.serviceKind !== "bundle") {
        if (finalLabor + finalProduct !== finalPrice) {
          return res.status(400).json({
            error: `Price (${finalPrice}) must equal laborCost (${finalLabor}) + productCost (${finalProduct})`,
          });
        }
      } else {
        product.laborCost = 0;
        product.productCost = 0;
      }

      product.laborCost = finalLabor;
      product.productCost = finalProduct;
    } else {
      product.laborCost = 0;
      product.productCost = 0;
    }

    // ---- Variant image reference check ----
    if (Array.isArray(images)) {
      const existingUrls = new Set(
        (product.images || []).map((i) => i.url).filter(Boolean),
      );
      const incomingUrls = new Set(
        images.map((i) => i.url).filter(Boolean),
      );
      const removedUrls = [...existingUrls].filter((u) => !incomingUrls.has(u));

      if (removedUrls.length > 0) {
        const blockedVariants = await Variant.find({
          organizationId,
          productId: product._id,
          "images.url": { $in: removedUrls },
        })
          .select("_id sku selectedOptions images")
          .lean();

        if (blockedVariants.length > 0 && !clearVariantImages) {
          return res.status(409).json({
            error: "One or more images are still assigned to variants.",
            code: "IMAGE_REFERENCED_BY_VARIANT",
            blockedVariants: blockedVariants.map((v) => ({
              _id: v._id,
              sku: v.sku,
              selectedOptions: v.selectedOptions || [],
            })),
            removedUrls,
          });
        }

        if (blockedVariants.length > 0 && clearVariantImages) {
          for (const v of blockedVariants) {
            const kept = (v.images || []).filter(
              (img) => !removedUrls.includes(img.url),
            );
            await Variant.updateOne(
              { _id: v._id },
              { $set: { images: kept } },
            );
          }
        }
      }
    }

    await product.save();

    // ---- Collection two-way sync ----
    const newCollectionIds = (product.collectionIds || []).map(String);
    const membershipChanged =
      oldCollectionIds.length !== newCollectionIds.length ||
      oldCollectionIds.some((id) => !newCollectionIds.includes(id)) ||
      newCollectionIds.some((id) => !oldCollectionIds.includes(id));

    if (membershipChanged) {
      try {
        await syncProductCollections({
          organizationId,
          productId: product._id,
          oldCollectionIds,
          newCollectionIds,
        });
      } catch (err) {
        console.error("[Product] collection sync failed:", err.message);
      }
    }

    // ---- Automatic collection recompute ----
    try {
      await recomputeAutomaticCollections({
        organizationId,
        productIds: [product._id],
        forceFullSweep: true,
      });
    } catch (err) {
      console.error("[Product] auto-collection recompute failed:", err.message);
    }

    // ---- Variants + inventory ----
    let savedVariants = [];
    let savedInventory = [];

    if (Array.isArray(incomingVariants)) {
      savedVariants = await persistVariants(
        organizationId,
        product._id,
        incomingVariants
      );

      // Archive variants no longer present
      const keptIds = savedVariants.map((s) => s.doc._id);
      await Variant.updateMany(
        {
          organizationId,
          productId: product._id,
          _id: { $nin: keptIds },
          status: { $ne: "archived" },
        },
        { $set: { status: "archived" } }
      );

      if (Array.isArray(incomingInventory) && incomingInventory.length) {
        const keyToRealId = new Map();
        for (const { incomingKey, doc } of savedVariants) {
          keyToRealId.set(String(incomingKey), doc._id);
          keyToRealId.set(String(doc._id), doc._id);
        }
        savedInventory = await persistInventory(
          organizationId,
          keyToRealId,
          incomingInventory
        );
      }

      // Variant changes can affect variant-scoped and location-aware automatic collections
      try {
        await recomputeAutomaticCollections({
          organizationId,
          productIds: [product._id],
          forceFullSweep: true,
        });
      } catch (err) {
        console.error("[Product] variant-triggered recompute failed:", err.message);
      }
    }

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "product_updated",
      req.ip,
      req.get("user-agent"),
      { details: `Product updated: ${product.name}` }
    );

    return res.status(200).json({
      message: "Product updated",
      product,
      variants: savedVariants.map((s) => s.doc),
      inventory: savedInventory,
    });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ error: "Failed to update product" });
  }
});

// ---------------------------------------------------------------
// DELETE /products/:id
// ---------------------------------------------------------------

router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const variantCount = await Variant.countDocuments({
      productId: req.params.id,
    });
    if (variantCount > 0) {
      return res.status(400).json({
        error: "Cannot delete product with variants. Delete variants first.",
      });
    }

    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      organizationId,
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "product_deleted",
      req.ip,
      req.get("user-agent"),
      { details: `Product deleted: ${product.name}` }
    );

    return res.status(200).json({ message: "Product deleted" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ error: "Failed to delete product" });
  }
});

module.exports = router;