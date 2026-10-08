/**
 * Two-way sync between Product.collectionIds and Collection.productIds,
 * plus targeted recompute of automatic collections.
 *
 * Design notes:
 *   - Manual collections: synced synchronously from the Product controller
 *     when a product's collectionIds change. Also from the Collection
 *     controller when a collection's productIds change.
 *   - Automatic collections: recomputed by the worker, never touched by
 *     product/collection saves.
 *   - All syncs are deltas — we compute add/remove sets and only write rows
 *     that actually changed. This keeps writes small and idempotent.
 */

const mongoose = require("mongoose");
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const Inventory = require("../models/Inventory");
const Collection = require("../models/Collection");
const { evaluateRuleSet, fieldsOverlap, LOCATION_FIELDS } = require("./collectionRules");

// ---------------------------------------------------------------------------
// Two-way sync (manual collections)
// ---------------------------------------------------------------------------

/**
 * Sync a product's collection memberships.
 *
 * Called from Product POST/PUT when `collectionIds` was present in the payload.
 * Updates `Collection.productIds` for every collection whose membership
 * changed, and updates `productCount`.
 *
 * Only touches manual collections. Automatic collections are ignored here.
 *
 * @param {object} args
 * @param {ObjectId} args.organizationId
 * @param {ObjectId} args.productId
 * @param {ObjectId[]} args.oldCollectionIds - what the product had before
 * @param {ObjectId[]} args.newCollectionIds - what the product has now
 * @param {ClientSession} [args.session]
 */
async function syncProductCollections({
  organizationId,
  productId,
  oldCollectionIds = [],
  newCollectionIds = [],
  session,
}) {
  const oldSet = new Set(oldCollectionIds.map(String));
  const newSet = new Set(newCollectionIds.map(String));

  const toAdd = [...newSet].filter((id) => !oldSet.has(id));
  const toRemove = [...oldSet].filter((id) => !newSet.has(id));

  if (toAdd.length === 0 && toRemove.length === 0) return { added: 0, removed: 0 };

  const opts = session ? { session } : {};

  // Add product to the collections that gained it
  if (toAdd.length > 0) {
    await Collection.updateMany(
      { _id: { $in: toAdd }, organizationId, type: "manual" },
      { $addToSet: { productIds: productId } },
      opts,
    );
    // Bump productCount for those collections
    await Collection.updateMany(
      { _id: { $in: toAdd }, organizationId, type: "manual" },
      { $inc: { productCount: 1 } },
      opts,
    );
  }

  // Remove product from the collections that lost it
  if (toRemove.length > 0) {
    await Collection.updateMany(
      { _id: { $in: toRemove }, organizationId, type: "manual" },
      { $pull: { productIds: productId } },
      opts,
    );
    await Collection.updateMany(
      { _id: { $in: toRemove }, organizationId, type: "manual" },
      { $inc: { productCount: -1 } },
      opts,
    );
  }

  // Repair negative counts if any collections drifted
  await Collection.updateMany(
    { organizationId, type: "manual", productCount: { $lt: 0 } },
    [{ $set: { productCount: { $max: [0, "$productCount"] } } }],
    opts,
  );

  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * Sync a manual collection's product list.
 *
 * Called from Collection PUT and PUT /:id/products.
 * Updates `Product.collectionIds` for every product whose membership changed.
 *
 * @param {object} args
 * @param {ObjectId} args.organizationId
 * @param {ObjectId} args.collectionId
 * @param {ObjectId[]} args.oldProductIds
 * @param {ObjectId[]} args.newProductIds
 * @param {ClientSession} [args.session]
 */
async function syncCollectionProducts({
  organizationId,
  collectionId,
  oldProductIds = [],
  newProductIds = [],
  session,
}) {
  const oldSet = new Set(oldProductIds.map(String));
  const newSet = new Set(newProductIds.map(String));

  const toAdd = [...newSet].filter((id) => !oldSet.has(id));
  const toRemove = [...oldSet].filter((id) => !newSet.has(id));

  if (toAdd.length === 0 && toRemove.length === 0) return { added: 0, removed: 0 };

  const opts = session ? { session } : {};

  if (toAdd.length > 0) {
    await Product.updateMany(
      { _id: { $in: toAdd }, organizationId },
      { $addToSet: { collectionIds: collectionId } },
      opts,
    );
  }
  if (toRemove.length > 0) {
    await Product.updateMany(
      { _id: { $in: toRemove }, organizationId },
      { $pull: { collectionIds: collectionId } },
      opts,
    );
  }

  return { added: toAdd.length, removed: toRemove.length };
}

// ---------------------------------------------------------------------------
// Automatic collection recompute
// ---------------------------------------------------------------------------

/**
 * Load products, variants, and inventory for a set of products.
 * Returns three Maps for the evaluator.
 */
async function loadEvaluationContext(organizationId, productIds) {
  const products = await Product.find({
    _id: { $in: productIds },
    organizationId,
  }).lean();

  const variants = await Variant.find({
    organizationId,
    productId: { $in: productIds },
    status: { $ne: "archived" },
  }).lean();

  const variantIds = variants.map((v) => v._id);

  const inventory = await Inventory.find({
    organizationId,
    variantId: { $in: variantIds },
  }).lean();

  // Group variants by productId
  const variantsByProduct = new Map();
  for (const v of variants) {
    const key = String(v.productId);
    if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
    variantsByProduct.get(key).push(v);
  }

  // Group inventory by variantId → locationId
  const inventoryByVariantId = new Map();
  for (const inv of inventory) {
    const key = String(inv.variantId);
    if (!inventoryByVariantId.has(key)) inventoryByVariantId.set(key, new Map());
    inventoryByVariantId.get(key).set(String(inv.locationId), inv);
  }

  return { products, variantsByProduct, inventoryByVariantId };
}

/**
 * Recompute automatic collections whose rules might match the given products.
 *
 * @param {object} args
 * @param {ObjectId} args.organizationId
 * @param {ObjectId[]} args.productIds - products to (re)evaluate
 * @param {string[]} [args.changedFields] - optional. If given, only recompute
 *   collections whose rules reference at least one of these fields. Used by
 *   the worker for targeted recompute.
 * @param {boolean} [args.forceFullSweep] - if true, ignore changedFields
 *   and re-evaluate all automatic collections. Used by the periodic sweep.
 */
async function recomputeAutomaticCollections({
  organizationId,
  productIds,
  changedFields,
  forceFullSweep = false,
}) {
  if (!Array.isArray(productIds) || productIds.length === 0) return { updated: 0 };

  const uniqueProductIds = [...new Set(productIds.map(String))];

  // Load automatic collections for this org
  const collections = await Collection.find({
    organizationId,
    type: "automatic",
    status: { $ne: "archived" },
  }).lean();

  if (collections.length === 0) return { updated: 0 };

  // Narrow to collections whose rules might be affected
  const candidates = forceFullSweep
    ? collections
    : collections.filter((c) => fieldsOverlap(changedFields, c.rules));

  if (candidates.length === 0) return { updated: 0 };

  // Load evaluation context once
  const { products, variantsByProduct, inventoryByVariantId } =
    await loadEvaluationContext(organizationId, uniqueProductIds);

  const now = new Date();
  let totalUpdated = 0;

  for (const collection of candidates) {
    const matchingIds = new Set(collection.productIds.map(String));

    for (const product of products) {
      const variants = variantsByProduct.get(String(product._id)) || [];
      const matches = evaluateRuleSet(
        product,
        variants,
        inventoryByVariantId,
        collection.rules,
        collection.ruleLogic,
      );

      if (matches) matchingIds.add(String(product._id));
      else matchingIds.delete(String(product._id));
    }

    // Compare to stored and update if changed
    const before = new Set(collection.productIds.map(String));
    const after = matchingIds;

    let added = 0;
    let removed = 0;
    for (const id of after) if (!before.has(id)) added++;
    for (const id of before) if (!after.has(id)) removed++;

    if (added === 0 && removed === 0) continue;

    await Collection.updateOne(
      { _id: collection._id },
      {
        $set: {
          productIds: [...after].map((id) => new mongoose.Types.ObjectId(id)),
          productCount: after.size,
          lastAutoRecomputeAt: now,
        },
      },
    );
    totalUpdated += 1;
  }

  return { updated: totalUpdated };
}

// ---------------------------------------------------------------------------
// Full-sweep helper (used by the periodic safety-net sweep)
// ---------------------------------------------------------------------------

async function fullSweepAutomaticCollections(organizationId) {
  const collections = await Collection.find({
    organizationId,
    type: "automatic",
    status: { $ne: "archived" },
  })
    .select("_id")
    .lean();

  if (collections.length === 0) return { updated: 0 };

  // Get all active products for the org, paginated to avoid memory blowup
  const PAGE_SIZE = 500;
  let skip = 0;
  let totalUpdated = 0;

  while (true) {
    const page = await Product.find({ organizationId })
      .select("_id")
      .skip(skip)
      .limit(PAGE_SIZE)
      .lean();

    if (page.length === 0) break;

    const ids = page.map((p) => p._id);
    const result = await recomputeAutomaticCollections({
      organizationId,
      productIds: ids,
      forceFullSweep: true,
    });
    totalUpdated += result.updated;

    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return { updated: totalUpdated };
}

module.exports = {
  syncProductCollections,
  syncCollectionProducts,
  recomputeAutomaticCollections,
  fullSweepAutomaticCollections,
  loadEvaluationContext,
};