const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Product = require("../models/Product");
const Collection = require("../models/Collection");
const Variant = require("../models/Variant");
const Inventory = require("../models/Inventory");
const Location = require("../models/Location");
const Organization = require("../models/Organization");
const { defaultOrgPaymentMethods } = require("../models/PaymentMethod");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve effective payment methods for a location.
 *
 * Rules:
 *   - If location.paymentMethods is a non-empty array → use it (full override).
 *   - Else → use org.paymentMethods (or the base four if the org has none).
 *   - Filter to enabled only.
 *   - Output shape is what the POS/Storefront consume: { key, label, icon,
 *     isDefault }. `custom` and `enabled` are stripped because callers only
 *     ever see enabled methods.
 */
function resolvePaymentMethods(org, location) {
  const locPM = Array.isArray(location?.paymentMethods)
    ? location.paymentMethods
    : [];
  const websitePM = org?.website?.paymentMethods;
  const orgPM =
    Array.isArray(websitePM) && websitePM.length > 0
      ? websitePM
      : defaultOrgPaymentMethods();
  const source = locPM.length > 0 ? locPM : orgPM;

  return source
    .filter((pm) => pm && pm.enabled !== false)
    .map((pm) => ({
      key: pm.key,
      label: pm.label,
      icon: pm.icon || "",
      isDefault: pm.isDefault === true,
    }));
}

/**
 * Resolve whether the M-Pesa STK prompt is available for a location.
 *   - Requires org.daraja.enabled === true AND daraja.mpesaStkEnabled === true
 *   - Location override (mpesaStkEnabled) wins if it's a boolean.
 *   - null / undefined → inherit org-level.
 */
function resolveMpesaStkAvailability(org, location) {
  const orgEnabled =
    org?.daraja?.enabled === true && org?.daraja?.mpesaStkEnabled === true;
  const locOverride = location?.mpesaStkEnabled;
  if (locOverride === true) {
    // Location wants STK — still requires org-level Daraja to be on.
    return org?.daraja?.enabled === true && org?.daraja?.mpesaStkEnabled === true;
  }
  if (locOverride === false) return false;
  return orgEnabled;
}

/**
 * Resolve which location the storefront should price/stock against.
 * Priority: ?locationId= query → default Location for the org → first active.
 */
async function resolveLocationId(req, org) {
  const fromQuery = req.query.locationId;
  if (fromQuery && mongoose.Types.ObjectId.isValid(fromQuery)) {
    return fromQuery;
  }

  const defaultLoc = await Location.findOne({
    organizationId: org._id,
    isDefault: true,
    status: "active",
  })
    .select("_id")
    .lean();

  if (defaultLoc) return defaultLoc._id;

  const firstActive = await Location.findOne({
    organizationId: org._id,
    status: "active",
  })
    .select("_id")
    .lean();

  return firstActive?._id || null;
}

/**
 * Shape a product for public consumption. Strips internal fields and
 * attaches per-variant availability from the resolved location.
 */
function publicProduct(p, variantAvailability) {
  const variants = (p.variants || []).map((v) => ({
    id: v._id,
    sku: v.sku,
    title: (v.selectedOptions || []).map((o) => o.value).join(" / "),
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    available: variantAvailability?.[String(v._id)] ?? null,
    image: v.images?.[0]?.url || null,
  }));

  const images = (p.images || []).map((img) => ({
    url: img.url,
    alt: img.alt,
  }));

  let sizes = [];
  if (Array.isArray(p.options) && p.options.length > 0) {
    const sizeOption =
      p.options.find((o) => /^sizes?$/i.test((o.name || "").trim())) ||
      p.options.find(
        (o) =>
          Array.isArray(o.values) &&
          o.values.length >= 3 &&
          o.values.length <= 10,
      );
    if (sizeOption) {
      sizes = (sizeOption.values || []).slice(0, 6);
    }
  }

  return {
    id: p._id,
    name: p.name,
    handle: p.handle,
    description: p.description,
    productType: p.productType,
    vendor: p.vendor,
    tags: p.tags || [],
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    images,
    defaultImage:
      (p.images || []).find((i) => i.isDefault)?.url ||
      (p.images || [])[0]?.url ||
      null,
    hoverImage: images[1]?.url || null,
    sizes,
    variants,
    options: p.options || [],
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    publishedAt: p.publishedAt,
  };
}

/**
 * Load availability map for a set of products.
 */
async function loadAvailability(productIds, locationId, organizationId) {
  if (!locationId || productIds.length === 0) return {};

  const variants = await Variant.find({
    productId: { $in: productIds },
    organizationId,
    status: "active",
  })
    .select("_id trackInventory")
    .lean();

  if (variants.length === 0) return {};

  const map = {};
  const trackedVariantIds = [];
  for (const v of variants) {
    if (v.trackInventory === false) {
      map[String(v._id)] = null;
    } else {
      trackedVariantIds.push(v._id);
    }
  }

  if (trackedVariantIds.length === 0) return map;

  const inventories = await Inventory.find({
    variantId: { $in: trackedVariantIds },
    locationId,
    organizationId,
  })
    .select("variantId available")
    .lean();

  for (const inv of inventories) {
    map[String(inv.variantId)] = inv.available ?? 0;
  }

  for (const id of trackedVariantIds) {
    const key = String(id);
    if (!(key in map)) map[key] = 0;
  }

  return map;
}

/**
 * Batch-load variants for a set of products, grouped by productId.
 */
async function loadVariantsByProduct(productIds, organizationId) {
  if (productIds.length === 0) return {};

  const variants = await Variant.find({
    productId: { $in: productIds },
    organizationId,
    status: "active",
  })
    .sort({ position: 1 })
    .lean();

  const grouped = {};
  for (const v of variants) {
    const key = String(v.productId);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(v);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// GET /storefront/orgs/by-host?host=...
// ---------------------------------------------------------------------------

router.get("/orgs/by-host", async (req, res) => {
  try {
    const { host } = req.query;
    if (!host) {
      return res.status(400).json({ error: "host query param required" });
    }

    const cleanHost = String(host).toLowerCase().split(":")[0];

    let org = await Organization.findOne({
      "website.domain": cleanHost,
      "website.domainVerified": true,
      status: "active",
    })
      .select("slug")
      .lean();

    if (!org) {
      const subdomain = cleanHost.split(".")[0];
      org = await Organization.findOne({
        "website.subdomain": subdomain,
        status: "active",
      })
        .select("slug")
        .lean();
    }

    if (!org) {
      return res.status(404).json({ error: "No org for host" });
    }

    return res.status(200).json({ slug: org.slug });
  } catch (error) {
    console.error("[Storefront] by-host error:", error);
    return res.status(500).json({ error: "Failed to resolve host" });
  }
});

// ---------------------------------------------------------------------------
// GET /storefront/products
// ---------------------------------------------------------------------------

router.get("/products", async (req, res) => {
  try {
    const org = req.storefrontOrg;
    const organizationId = org._id;
    const { search = "", collectionId, limit = 24, skip = 0 } = req.query;

    const locationId = await resolveLocationId(req, org);

    const query = {
      organizationId,
      status: "active",
      published: true,
    };

    if (search.trim()) {
      const q = search.trim();
      query.$or = [
        { name: new RegExp(q, "i") },
        { sku: new RegExp(q, "i") },
        { tags: new RegExp(q, "i") },
        { vendor: new RegExp(q, "i") },
      ];
    }

    if (collectionId && mongoose.Types.ObjectId.isValid(collectionId)) {
      const collection = await Collection.findOne({
        _id: collectionId,
        organizationId,
        status: "active",
        published: true,
      })
        .select("productIds")
        .lean();

      if (!collection) {
        return res.status(200).json({
          products: [],
          total: 0,
          skip: 0,
          limit: 24,
          locationId,
        });
      }
      query._id = { $in: collection.productIds };
    }

    const limitNum = Math.min(Math.max(1, parseInt(limit) || 24), 100);
    const skipNum = Math.max(0, parseInt(skip) || 0);

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    const productIds = products.map((p) => p._id);
    const [availability, variantsByProduct] = await Promise.all([
      loadAvailability(productIds, locationId, organizationId),
      loadVariantsByProduct(productIds, organizationId),
    ]);

    const payload = products.map((p) =>
      publicProduct(
        { ...p, variants: variantsByProduct[String(p._id)] || [] },
        availability,
      ),
    );

    return res.status(200).json({
      products: payload,
      total,
      skip: skipNum,
      limit: limitNum,
      locationId,
    });
  } catch (error) {
    console.error("[Storefront] products error:", error);
    return res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ---------------------------------------------------------------------------
// GET /storefront/products/:handle
// ---------------------------------------------------------------------------

router.get("/products/:handle", async (req, res) => {
  try {
    const org = req.storefrontOrg;
    const organizationId = org._id;
    const { handle } = req.params;

    const locationId = await resolveLocationId(req, org);

    const product = await Product.findOne({
      organizationId,
      handle,
      status: "active",
      published: true,
    }).lean();

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const [variants, availability] = await Promise.all([
      Variant.find({ productId: product._id, organizationId, status: "active" })
        .sort({ position: 1 })
        .lean(),
      loadAvailability([product._id], locationId, organizationId),
    ]);

    const payload = publicProduct({ ...product, variants }, availability);

    return res.status(200).json({ product: payload, locationId });
  } catch (error) {
    console.error("[Storefront] product detail error:", error);
    return res.status(500).json({ error: "Failed to fetch product" });
  }
});

// ---------------------------------------------------------------------------
// GET /storefront/collections
// ---------------------------------------------------------------------------

router.get("/collections", async (req, res) => {
  try {
    const org = req.storefrontOrg;
    const organizationId = org._id;

    const collections = await Collection.find({
      organizationId,
      status: "active",
      published: true,
    })
      .select(
        "_id name slug description image parentCollectionId type productCount",
      )
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({ collections });
  } catch (error) {
    console.error("[Storefront] collections error:", error);
    return res.status(500).json({ error: "Failed to fetch collections" });
  }
});

// ---------------------------------------------------------------------------
// GET /storefront/collections/:slug
// ---------------------------------------------------------------------------

router.get("/collections/:slug", async (req, res) => {
  try {
    const org = req.storefrontOrg;
    const organizationId = org._id;
    const { slug } = req.params;
    const { search = "", limit = 24, skip = 0 } = req.query;

    const locationId = await resolveLocationId(req, org);

    const collection = await Collection.findOne({
      organizationId,
      slug,
      status: "active",
      published: true,
    }).lean();

    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    const query = {
      organizationId,
      status: "active",
      published: true,
      _id: { $in: collection.productIds || [] },
    };

    if (search.trim()) {
      const q = search.trim();
      query.$or = [
        { name: new RegExp(q, "i") },
        { sku: new RegExp(q, "i") },
      ];
    }

    const limitNum = Math.min(Math.max(1, parseInt(limit) || 24), 100);
    const skipNum = Math.max(0, parseInt(skip) || 0);

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ name: 1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    const productIds = products.map((p) => p._id);
    const [availability, variantsByProduct] = await Promise.all([
      loadAvailability(productIds, locationId, organizationId),
      loadVariantsByProduct(productIds, organizationId),
    ]);

    const payload = products.map((p) =>
      publicProduct(
        { ...p, variants: variantsByProduct[String(p._id)] || [] },
        availability,
      ),
    );

    return res.status(200).json({
      collection: {
        id: collection._id,
        name: collection.name,
        slug: collection.slug,
        description: collection.description,
        image: collection.image,
        productCount: collection.productCount,
      },
      products: payload,
      total,
      skip: skipNum,
      limit: limitNum,
      locationId,
    });
  } catch (error) {
    console.error("[Storefront] collection detail error:", error);
    return res.status(500).json({ error: "Failed to fetch collection" });
  }
});

// ---------------------------------------------------------------------------
// Organization lookup by slug
// ---------------------------------------------------------------------------

router.get("/org", async (req, res) => {
  try {
    const org = req.storefrontOrg;

    const locationId = await resolveLocationId(req, org);

    let deliveryCategories = [];
    let locationSummary = null;
    let locationDoc = null;

    if (locationId) {
      const location = await Location.findOne({
        _id: locationId,
        organizationId: org._id,
        status: "active",
      })
        .select("_id name address deliveryCategories paymentMethods mpesaStkEnabled")
        .lean();

      if (location) {
        locationDoc = location;
        locationSummary = {
          id: location._id,
          name: location.name,
          address: location.address || null,
        };

        deliveryCategories = (location.deliveryCategories || [])
          .filter((c) => c.isActive !== false)
          .map((c) => ({
            id: c._id ? String(c._id) : `cat-${c.categoryName}`,
            categoryName: c.categoryName,
            description: c.description || null,
            options: (c.childOptions || [])
              .filter((o) => o.isActive !== false)
              .map((o) => ({
                id: o._id ? String(o._id) : `opt-${o.optionName}`,
                optionName: o.optionName,
                price: Number(o.price) || 0,
                estimatedDays: o.estimatedDays ?? null,
                description: o.description || null,
                requiresAddress: o.requiresAddress !== false,
                requiresLandmark: o.requiresLandmark === true,
              })),
          }))
          .filter((c) => c.options.length > 0);
      }
    }

    const ann = org.website?.announcement || {};

    const paymentMethods = resolvePaymentMethods(org, locationDoc);
    const mpesaStkAvailable = resolveMpesaStkAvailability(org, locationDoc);

    return res.status(200).json({
      organization: {
        id: org._id,
        name: org.name,
        slug: org.slug,
        settings: {
          currency: org.settings?.currency || "KES",
          language: org.settings?.language || "en",
          timezone: org.settings?.timezone || "Africa/Nairobi",
        },
        website: {
          logoUrl: org.website?.logoUrl || null,
          faviconUrl: org.website?.faviconUrl || null,
          tagline: org.website?.tagline || null,
          primaryColor: org.website?.primaryColor || "#111111",
          accentColor: org.website?.accentColor || "#2563eb",
          headerLayout: org.website?.headerLayout || "left",
          published: org.website?.published === true,
          announcement: {
            text: ann.text || null,
            href: ann.href || null,
            isActive: ann.isActive !== false,
          },
          homepage: {
            sections: Array.isArray(org.website?.homepage?.sections)
              ? org.website.homepage.sections
              : [],
          },
        },
        location: locationSummary,
        deliveryCategories,
        paymentMethods,
        mpesaStkAvailable,
      },
    });
  } catch (error) {
    console.error("[Storefront] org error:", error);
    return res.status(500).json({ error: "Failed to fetch organization" });
  }
});

module.exports = router;
module.exports.resolvePaymentMethods = resolvePaymentMethods;
module.exports.resolveMpesaStkAvailability = resolveMpesaStkAvailability;