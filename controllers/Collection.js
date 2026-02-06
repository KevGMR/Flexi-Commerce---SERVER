const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Collection = require("../models/Collection");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

// Helper to generate unique slug
async function generateUniqueSlug(organizationId, name, collectionId = null) {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  let counter = 0;
  let uniqueSlug = slug;
  while (true) {
    const existing = await Collection.findOne({ organizationId, slug: uniqueSlug, _id: { $ne: collectionId } });
    if (!existing) break;
    counter++;
    uniqueSlug = `${slug}-${counter}`;
  }
  return uniqueSlug;
}

/**
 * Create collection
 * POST /collections
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, description, parentCollectionId, type, rules, productIds, image, seoTitle, seoDescription, published } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const slug = await generateUniqueSlug(organizationId, name);

    const collection = new Collection({
      organizationId,
      name,
      slug,
      description,
      parentCollectionId,
      type: type || "manual",
      rules,
      productIds: productIds || [],
      image,
      seoTitle,
      seoDescription,
      published: published !== undefined ? published : true,
    });

    await collection.save();

    await logTokenEvent(req.user.userId, organizationId, "collection_created", req.ip, req.get("user-agent"), {
      details: `Collection created: ${name}`,
    });

    return res.status(201).json({ message: "Collection created", collection });
  } catch (error) {
    console.error("Create collection error:", error);
    return res.status(500).json({ error: "Failed to create collection" });
  }
});

/**
 * Get all collections
 * GET /collections
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { parentCollectionId, type, status, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (parentCollectionId) query.parentCollectionId = parentCollectionId;
    if (type) query.type = type;
    if (status) query.status = status;

    const collections = await Collection.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Collection.countDocuments(query);

    return res.status(200).json({ collections, total });
  } catch (error) {
    console.error("Get collections error:", error);
    return res.status(500).json({ error: "Failed to fetch collections" });
  }
});

/**
 * Get collection by ID
 * GET /collections/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const collection = await Collection.findOne({ _id: req.params.id, organizationId });

    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    return res.status(200).json({ collection });
  } catch (error) {
    console.error("Get collection error:", error);
    return res.status(500).json({ error: "Failed to fetch collection" });
  }
});

/**
 * Update collection
 * PUT /collections/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, description, parentCollectionId, type, rules, productIds, image, seoTitle, seoDescription, status, published } = req.body;

    const collection = await Collection.findOne({ _id: req.params.id, organizationId });
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    if (name && name !== collection.name) {
      collection.slug = await generateUniqueSlug(organizationId, name, collection._id);
      collection.name = name;
    }

    if (description !== undefined) collection.description = description;
    if (parentCollectionId !== undefined) collection.parentCollectionId = parentCollectionId;
    if (type) collection.type = type;
    if (rules) collection.rules = rules;
    if (productIds) collection.productIds = productIds;
    if (image) collection.image = image;
    if (seoTitle) collection.seoTitle = seoTitle;
    if (seoDescription) collection.seoDescription = seoDescription;
    if (status) collection.status = status;
    if (published !== undefined) collection.published = published;

    await collection.save();

    await logTokenEvent(req.user.userId, organizationId, "collection_updated", req.ip, req.get("user-agent"), {
      details: `Collection updated: ${collection.name}`,
    });

    return res.status(200).json({ message: "Collection updated", collection });
  } catch (error) {
    console.error("Update collection error:", error);
    return res.status(500).json({ error: "Failed to update collection" });
  }
});

/**
 * Delete collection
 * DELETE /collections/:id
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const collection = await Collection.findOneAndDelete({ _id: req.params.id, organizationId });
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Unset as parent in child collections
    await Collection.updateMany({ parentCollectionId: collection._id }, { parentCollectionId: null });

    await logTokenEvent(req.user.userId, organizationId, "collection_deleted", req.ip, req.get("user-agent"), {
      details: `Collection deleted: ${collection.name}`,
    });

    return res.status(200).json({ message: "Collection deleted" });
  } catch (error) {
    console.error("Delete collection error:", error);
    return res.status(500).json({ error: "Failed to delete collection" });
  }
});

module.exports = router;
