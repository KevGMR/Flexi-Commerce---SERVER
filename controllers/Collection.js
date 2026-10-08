const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Collection = require("../models/Collection");
const Product = require("../models/Product");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");
const { validateRule } = require("../services/collectionRules");
const {
  syncCollectionProducts,
  recomputeAutomaticCollections,
} = require("../services/collectionSync");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateUniqueSlug(organizationId, name, collectionId = null) {
  const base =
    String(name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "collection";

  let counter = 0;
  let candidate = base;
  while (true) {
    const query = { organizationId, slug: candidate };
    if (collectionId) query._id = { $ne: collectionId };
    const exists = await Collection.findOne(query).select("_id").lean();
    if (!exists) return candidate;
    counter++;
    candidate = `${base}-${counter}`;
  }
}

async function isDescendant(organizationId, ancestorId, candidateChildId) {
  let currentId = candidateChildId;
  const seen = new Set();

  while (currentId) {
    const key = String(currentId);
    if (seen.has(key)) return true;
    seen.add(key);
    if (key === String(ancestorId)) return true;

    const parent = await Collection.findOne({
      _id: currentId,
      organizationId,
    })
      .select("parentCollectionId")
      .lean();

    if (!parent || !parent.parentCollectionId) return false;
    currentId = parent.parentCollectionId;
  }
  return false;
}

function validateRules(rules) {
  if (!Array.isArray(rules)) return;
  rules.forEach((rule, i) => validateRule(rule, { index: i }));
}

/**
 * Dedupe + cast to ObjectId. Used everywhere we accept a productIds list.
 */
function normalizeProductIds(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const str = String(id);
    if (!str || seen.has(str)) continue;
    if (!mongoose.Types.ObjectId.isValid(str)) continue;
    seen.add(str);
    out.push(new mongoose.Types.ObjectId(str));
  }
  return out;
}

// ---------------------------------------------------------------------------
// POST /collections
// ---------------------------------------------------------------------------

router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      name,
      slug: rawSlug,
      description,
      parentCollectionId,
      type,
      rules,
      ruleLogic,
      productIds,
      image,
      seoTitle,
      seoDescription,
      status,
      published,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const collectionType = type === "automatic" ? "automatic" : "manual";

    if (collectionType === "automatic") {
      try {
        validateRules(rules);
      } catch (err) {
        return res.status(400).json({ error: err.message, code: "INVALID_RULE" });
      }
    }

    if (parentCollectionId) {
      const parent = await Collection.findOne({
        _id: parentCollectionId,
        organizationId,
      }).select("_id");
      if (!parent) {
        return res.status(400).json({ error: "Parent collection not found" });
      }
    }

    const slug = rawSlug
      ? await generateUniqueSlug(organizationId, rawSlug)
      : await generateUniqueSlug(organizationId, name);

    const normalizedProductIds =
      collectionType === "manual" ? normalizeProductIds(productIds) : [];

    const collection = new Collection({
      organizationId,
      name,
      slug,
      description: description || "",
      parentCollectionId: parentCollectionId || null,
      type: collectionType,
      rules: collectionType === "automatic" ? rules || [] : [],
      ruleLogic: ruleLogic === "OR" ? "OR" : "AND",
      productIds: normalizedProductIds,
      productCount: normalizedProductIds.length,
      image: image || undefined,
      seoTitle,
      seoDescription,
      status: status || "active",
      published: published !== undefined ? published : false,
      publishedAt: published ? new Date() : undefined,
    });

    await collection.save();

    // Two-way sync for manual collections
    if (collectionType === "manual" && normalizedProductIds.length > 0) {
      await syncCollectionProducts({
        organizationId,
        collectionId: collection._id,
        oldProductIds: [],
        newProductIds: normalizedProductIds,
      });
    }

    // First evaluation for automatic collections
    if (collectionType === "automatic") {
      try {
        const ids = await Product.find({ organizationId }).distinct("_id");
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          await recomputeAutomaticCollections({
            organizationId,
            productIds: ids.slice(i, i + CHUNK),
            forceFullSweep: true,
          });
        }
      } catch (err) {
        console.error(
          "[Collection] initial auto-recompute failed:",
          err.message,
        );
      }
    }

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "collection_created",
      req.ip,
      req.get("user-agent"),
      { details: `Collection created: ${name}` },
    );

    return res.status(201).json({ message: "Collection created", collection });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ error: "A collection with this slug already exists" });
    }
    console.error("Create collection error:", error);
    return res.status(500).json({ error: "Failed to create collection" });
  }
});

// ---------------------------------------------------------------------------
// GET /collections
// ---------------------------------------------------------------------------

router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      parentCollectionId,
      type,
      status,
      search,
      skip = 0,
      limit = 200,
    } = req.query;

    const query = { organizationId };
    if (parentCollectionId !== undefined) {
      query.parentCollectionId = parentCollectionId || null;
    }
    if (type) query.type = type;
    if (status) query.status = status;
    if (search) query.name = new RegExp(search, "i");

    const collections = await Collection.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ name: 1 })
      .lean();

    const total = await Collection.countDocuments(query);

    return res.status(200).json({ collections, total });
  } catch (error) {
    console.error("Get collections error:", error);
    return res.status(500).json({ error: "Failed to fetch collections" });
  }
});

// ---------------------------------------------------------------------------
// GET /collections/:id
// Returns metadata + productIds + productCount. Does NOT populate products.
// Use GET /collections/:id/products for paginated product previews.
// ---------------------------------------------------------------------------

router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid collection id" });
    }

    const collection = await Collection.findOne({
      _id: req.params.id,
      organizationId,
    }).lean();

    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    return res.status(200).json({ collection });
  } catch (error) {
    console.error("Get collection error:", error);
    return res.status(500).json({ error: "Failed to fetch collection" });
  }
});

// ---------------------------------------------------------------------------
// GET /collections/:id/products
// Paginated, searchable list of products in a collection.
// Reads collection.productIds as the source of truth.
// ---------------------------------------------------------------------------

router.get("/:id/products", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { search = "", skip = 0, limit = 50 } = req.query;

    const collection = await Collection.findOne({
      _id: req.params.id,
      organizationId,
    })
      .select("_id name type productIds productCount")
      .lean();

    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    const ids = (collection.productIds || []).map(String);
    const skipNum = Math.max(0, parseInt(skip) || 0);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 50), 200);

    // No search: paginate by productIds order (deterministic, preserves add order)
    if (!search.trim()) {
      const pageIds = ids.slice(skipNum, skipNum + limitNum);

      if (pageIds.length === 0) {
        return res.status(200).json({
          products: [],
          total: ids.length,
          skip: skipNum,
          limit: limitNum,
        });
      }

      const docs = await Product.find({
        _id: { $in: pageIds },
        organizationId,
      })
        .select("_id name sku images price status")
        .lean();

      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const ordered = pageIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((p) => ({
          _id: p._id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          status: p.status,
          image:
            (p.images || []).find((i) => i.isDefault) ||
            (p.images || [])[0] ||
            null,
        }));

      return res.status(200).json({
        products: ordered,
        total: ids.length,
        skip: skipNum,
        limit: limitNum,
      });
    }

    // With search: match by name/sku, then intersect with the collection's IDs.
    // For large collections this reads more from Mongo but is correct and
    // paginates cleanly, since matching is done at the DB layer.
    const q = search.trim();
    const searchQuery = {
      _id: { $in: collection.productIds },
      organizationId,
      $or: [
        { name: new RegExp(q, "i") },
        { sku: new RegExp(q, "i") },
      ],
    };

    const [matching, total] = await Promise.all([
      Product.find(searchQuery)
        .select("_id name sku images price status")
        .sort({ name: 1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(searchQuery),
    ]);

    const payload = matching.map((p) => ({
      _id: p._id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      status: p.status,
      image:
        (p.images || []).find((i) => i.isDefault) || (p.images || [])[0] || null,
    }));

    return res.status(200).json({
      products: payload,
      total,
      skip: skipNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Get collection products error:", error);
    return res.status(500).json({ error: "Failed to fetch collection products" });
  }
});

// ---------------------------------------------------------------------------
// PUT /collections/:id
// Metadata only. Does NOT accept productIds — use the /products delta endpoints.
// ---------------------------------------------------------------------------

router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const {
      name,
      slug: rawSlug,
      description,
      parentCollectionId,
      type,
      rules,
      ruleLogic,
      image,
      seoTitle,
      seoDescription,
      status,
      published,
    } = req.body;

    const collection = await Collection.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    const nextType =
      type === "automatic"
        ? "automatic"
        : type === "manual"
          ? "manual"
          : collection.type;

    if (nextType === "automatic") {
      const rulesToValidate = rules !== undefined ? rules : collection.rules;
      try {
        validateRules(rulesToValidate);
      } catch (err) {
        return res
          .status(400)
          .json({ error: err.message, code: "INVALID_RULE" });
      }
    }

    if (
      parentCollectionId !== undefined &&
      parentCollectionId &&
      String(parentCollectionId) === String(collection._id)
    ) {
      return res
        .status(400)
        .json({ error: "A collection cannot be its own parent" });
    }
    if (parentCollectionId) {
      const cycle = await isDescendant(
        organizationId,
        collection._id,
        parentCollectionId,
      );
      if (cycle) {
        return res
          .status(400)
          .json({ error: "Parent would create a hierarchy cycle" });
      }
    }

    if (name && name !== collection.name && rawSlug === undefined) {
      collection.slug = await generateUniqueSlug(
        organizationId,
        name,
        collection._id,
      );
      collection.name = name;
    } else if (rawSlug && rawSlug !== collection.slug) {
      collection.slug = await generateUniqueSlug(
        organizationId,
        rawSlug,
        collection._id,
      );
    } else if (name) {
      collection.name = name;
    }

    if (description !== undefined) collection.description = description;
    if (parentCollectionId !== undefined) {
      collection.parentCollectionId = parentCollectionId || null;
    }

    const typeChanged = nextType !== collection.type;
    collection.type = nextType;

    // Switching from automatic to manual: keep existing productIds but leave
    // them editable. Switching from manual to automatic: clear productIds
    // (they'll be recomputed) and clear rules were already the plan.
    if (typeChanged) {
      if (nextType === "automatic") {
        // Old manual productIds become stale — let the recompute repopulate.
        collection.productIds = [];
        collection.productCount = 0;
      }
      // If switching to manual, keep productIds as-is so the user can edit.
    }

    if (nextType === "automatic" && rules !== undefined) {
      collection.rules = rules;
    }
    if (nextType === "automatic" && ruleLogic !== undefined) {
      collection.ruleLogic = ruleLogic === "OR" ? "OR" : "AND";
    }
    if (nextType === "manual" && typeChanged) {
      // Manual collections have no rules
      collection.rules = [];
    }

    if (image !== undefined) collection.image = image;
    if (seoTitle !== undefined) collection.seoTitle = seoTitle;
    if (seoDescription !== undefined) collection.seoDescription = seoDescription;
    if (status) collection.status = status;
    if (published !== undefined) {
      const wasPublished = collection.published;
      collection.published = published;
      if (published && !wasPublished) collection.publishedAt = new Date();
    }

    await collection.save();

    // If it's now automatic or its rules changed, recompute
    if (nextType === "automatic" && (rules !== undefined || typeChanged)) {
      try {
        const ids = await Product.find({ organizationId }).distinct("_id");
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          await recomputeAutomaticCollections({
            organizationId,
            productIds: ids.slice(i, i + CHUNK),
            forceFullSweep: true,
          });
        }
      } catch (err) {
        console.error(
          "[Collection] auto-recompute after rules change failed:",
          err.message,
        );
      }
    }

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "collection_updated",
      req.ip,
      req.get("user-agent"),
      { details: `Collection updated: ${collection.name}` },
    );

    return res.status(200).json({ message: "Collection updated", collection });
  } catch (error) {
    console.error("Update collection error:", error);
    return res.status(500).json({ error: "Failed to update collection" });
  }
});

// ---------------------------------------------------------------------------
// POST /collections/:id/products
// Add products to a manual collection. Body: { productIds: [...] }
// ---------------------------------------------------------------------------

router.post("/:id/products", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "productIds array is required" });
    }

    const collection = await Collection.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    if (collection.type !== "manual") {
      return res
        .status(400)
        .json({ error: "Only manual collections support manual product edits" });
    }

    const incoming = normalizeProductIds(productIds);
    const existingSet = new Set(collection.productIds.map(String));
    const toAdd = incoming.filter((id) => !existingSet.has(String(id)));

    if (toAdd.length === 0) {
      return res.status(200).json({
        message: "No new products to add",
        added: 0,
        productCount: collection.productCount,
      });
    }

    collection.productIds = [...collection.productIds, ...toAdd];
    collection.productCount = collection.productIds.length;
    await collection.save();

    await syncCollectionProducts({
      organizationId,
      collectionId: collection._id,
      oldProductIds: [],
      newProductIds: toAdd,
    });

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "collection_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Added ${toAdd.length} products to collection: ${collection.name}`,
      },
    );

    return res.status(200).json({
      message: "Products added",
      added: toAdd.length,
      productCount: collection.productCount,
    });
  } catch (error) {
    console.error("Add collection products error:", error);
    return res.status(500).json({ error: "Failed to add products" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /collections/:id/products
// Remove products from a manual collection. Body: { productIds: [...] }
// ---------------------------------------------------------------------------

router.delete("/:id/products", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "productIds array is required" });
    }

    const collection = await Collection.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    if (collection.type !== "manual") {
      return res
        .status(400)
        .json({ error: "Only manual collections support manual product edits" });
    }

    const incoming = normalizeProductIds(productIds);
    const removeSet = new Set(incoming.map(String));
    const toRemove = collection.productIds.filter((id) =>
      removeSet.has(String(id)),
    );

    if (toRemove.length === 0) {
      return res.status(200).json({
        message: "No products to remove",
        removed: 0,
        productCount: collection.productCount,
      });
    }

    collection.productIds = collection.productIds.filter(
      (id) => !removeSet.has(String(id)),
    );
    collection.productCount = collection.productIds.length;
    await collection.save();

    await syncCollectionProducts({
      organizationId,
      collectionId: collection._id,
      oldProductIds: toRemove,
      newProductIds: [],
    });

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "collection_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Removed ${toRemove.length} products from collection: ${collection.name}`,
      },
    );

    return res.status(200).json({
      message: "Products removed",
      removed: toRemove.length,
      productCount: collection.productCount,
    });
  } catch (error) {
    console.error("Remove collection products error:", error);
    return res.status(500).json({ error: "Failed to remove products" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /collections/:id
// ---------------------------------------------------------------------------

router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const collection = await Collection.findOne({
      _id: req.params.id,
      organizationId,
    });
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    const childCount = await Collection.countDocuments({
      organizationId,
      parentCollectionId: collection._id,
    });
    if (childCount > 0) {
      return res.status(409).json({
        error: `Collection has ${childCount} child collection${childCount === 1 ? "" : "s"}. Reassign or delete them first.`,
        code: "COLLECTION_HAS_CHILDREN",
      });
    }

    if (collection.productIds && collection.productIds.length > 0) {
      await Product.updateMany(
        { _id: { $in: collection.productIds }, organizationId },
        { $pull: { collectionIds: collection._id } },
      );
    }

    await Collection.deleteOne({ _id: collection._id });

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "collection_deleted",
      req.ip,
      req.get("user-agent"),
      { details: `Collection deleted: ${collection.name}` },
    );

    return res.status(200).json({ message: "Collection deleted" });
  } catch (error) {
    console.error("Delete collection error:", error);
    return res.status(500).json({ error: "Failed to delete collection" });
  }
});

module.exports = router;