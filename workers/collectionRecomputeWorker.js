/**
 * Collection recompute worker.
 *
 * Two responsibilities:
 *   1. Every 60 seconds: find products and inventory rows whose updatedAt
 *      changed since the last tick, and recompute affected automatic
 *      collections. This is the debounce mechanism — 100 writes in a minute
 *      coalesce into one recompute pass.
 *   2. Every 10 minutes: full sweep of every automatic collection, ignoring
 *      change tracking. This is the safety net for any write path we didn't
 *      anticipate (scripts, manual Mongo edits, future features).
 *
 * Does nothing for manual collections. Those are synced synchronously by the
 * Product and Collection controllers.
 */

const Product = require("../models/Product");
const Inventory = require("../models/Inventory");
const {
  recomputeAutomaticCollections,
  fullSweepAutomaticCollections,
} = require("../services/collectionSync");

const TICK_INTERVAL_MS = 60_000; // 1 minute
const FULL_SWEEP_INTERVAL_MS = 10 * 60_000; // 10 minutes

let tickTimer = null;
let sweepTimer = null;
let lastTickAt = null;
let isTickRunning = false;
let isSweepRunning = false;

// ---------------------------------------------------------------------------
// Targeted tick
// ---------------------------------------------------------------------------

async function runTick() {
  if (isTickRunning) return;
  isTickRunning = true;

  const tickStart = new Date();
  const since = lastTickAt || new Date(Date.now() - TICK_INTERVAL_MS);

  try {
    // Products changed since last tick
    const changedProducts = await Product.find({
      updatedAt: { $gt: since },
    })
      .select("_id organizationId")
      .lean();

    // Inventory changed since last tick
    const changedInventory = await Inventory.find({
      updatedAt: { $gt: since },
    })
      .select("variantId organizationId")
      .lean();

    if (changedProducts.length === 0 && changedInventory.length === 0) {
      lastTickAt = tickStart;
      return;
    }

    // Resolve inventory variantIds → productIds
    const variantIdsFromInventory = [
      ...new Set(changedInventory.map((i) => String(i.variantId))),
    ];

    let productsFromInventory = [];
    if (variantIdsFromInventory.length > 0) {
      const variants = await require("../models/Variant")
        .find({ _id: { $in: variantIdsFromInventory } })
        .select("productId organizationId")
        .lean();

      // Group by org so the recompute is properly scoped
      const byOrg = new Map();
      for (const v of variants) {
        const org = String(v.organizationId);
        if (!byOrg.has(org)) byOrg.set(org, new Set());
        byOrg.get(org).add(String(v.productId));
      }
      productsFromInventory = [...byOrg.entries()].map(([org, ids]) => ({
        organizationId: org,
        productIds: [...ids],
      }));
    }

    // Group changed products by org
    const productsByOrg = new Map();
    for (const p of changedProducts) {
      const org = String(p.organizationId);
      if (!productsByOrg.has(org)) productsByOrg.set(org, new Set());
      productsByOrg.get(org).add(String(p._id));
    }

    // Merge inventory-derived products into the same org buckets
    for (const { organizationId, productIds } of productsFromInventory) {
      if (!productsByOrg.has(organizationId)) productsByOrg.set(organizationId, new Set());
      for (const id of productIds) productsByOrg.get(organizationId).add(id);
    }

    // Recompute per org
    let totalUpdated = 0;
    for (const [orgId, productIdSet] of productsByOrg.entries()) {
      const result = await recomputeAutomaticCollections({
        organizationId: orgId,
        productIds: [...productIdSet],
        changedFields: ["__product__", "__variant__"], // conservative: any product/variant change
      });
      totalUpdated += result.updated;
    }

    if (totalUpdated > 0 || productsByOrg.size > 0) {
      console.log(
        `[CollectionWorker] tick: orgs=${productsByOrg.size} product-ids=${[...productsByOrg.values()].reduce((a, s) => a + s.size, 0)} collections-updated=${totalUpdated}`,
      );
    }

    lastTickAt = tickStart;
  } catch (err) {
    console.error("[CollectionWorker] tick error:", err.message);
  } finally {
    isTickRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Full sweep
// ---------------------------------------------------------------------------

async function runFullSweep() {
  if (isSweepRunning) return;
  isSweepRunning = true;

  try {
    // Get all orgs that have at least one automatic collection
    const Collection = require("../models/Collection");
    const orgs = await Collection.distinct("organizationId", {
      type: "automatic",
      status: { $ne: "archived" },
    });

    if (orgs.length === 0) return;

    let totalUpdated = 0;
    for (const orgId of orgs) {
      const result = await fullSweepAutomaticCollections(orgId);
      totalUpdated += result.updated;
    }

    console.log(
      `[CollectionWorker] full sweep: orgs=${orgs.length} collections-updated=${totalUpdated}`,
    );
  } catch (err) {
    console.error("[CollectionWorker] full sweep error:", err.message);
  } finally {
    isSweepRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function start() {
  if (tickTimer || sweepTimer) {
    console.warn("[CollectionWorker] already started");
    return;
  }

  lastTickAt = new Date();

  tickTimer = setInterval(runTick, TICK_INTERVAL_MS);
  sweepTimer = setInterval(runFullSweep, FULL_SWEEP_INTERVAL_MS);

  // Fire one tick shortly after startup so nothing has to wait a full minute
  setTimeout(runTick, 5_000);
  // And one full sweep a bit later so the safety net runs on boot
  setTimeout(runFullSweep, 60_000);

  console.log("[CollectionWorker] Started - tick every 60s, sweep every 10min");
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  tickTimer = null;
  sweepTimer = null;
  console.log("[CollectionWorker] Stopped");
}

// Run once manually — useful for testing
async function runNow() {
  await runTick();
}

module.exports = { start, stop, runNow };