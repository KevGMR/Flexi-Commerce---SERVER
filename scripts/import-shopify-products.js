#!/usr/bin/env node
/**
 * One-shot Shopify product migration.
 *
 * Usage:
 *   node server/scripts/import-shopify-products.js --org=<ORG_ID> [--location="<Name>"] [--dry-run]
 *
 * Idempotent: re-runs upsert on shopifyNumericId. Safe to resume.
 */

require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

const Product = require("../models/Product");
const Variant = require("../models/Variant");
const Inventory = require("../models/Inventory");
const Location = require("../models/Location");

const EXPORT_PATH =
  process.env.SHOPIFY_EXPORT_PATH ||
  path.resolve(__dirname, "../../data/products-export.json");

// -------- CLI --------
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ORG_ARG = args.find((a) => a.startsWith("--org="));
const LOC_ARG = args.find((a) => a.startsWith("--location="));
const ORG_ID = ORG_ARG ? ORG_ARG.split("=")[1] : process.env.ORG_ID;
const LOCATION_NAME = LOC_ARG ? LOC_ARG.split("=")[1].replace(/^"|"$/g, "") : null;

if (!ORG_ID) {
  console.error("Missing --org=<ORG_ID> (or ORG_ID env)");
  process.exit(1);
}

// -------- helpers --------
const gidNum = (gid) => (gid ? Number(String(gid).split("/").pop()) : null);

function slugify(str) {
  const s = String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return s || "untitled";
}

function synthesizeVariantSku(variantNumericId) {
  return `SHOP-${variantNumericId}`;
}

function synthesizeProductSku(productNumericId) {
  return `SHOP-P-${productNumericId}`;
}

function productPriceFromVariants(variants) {
  const priced = variants
    .map((v) => Number(v.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  return priced.length ? Math.min(...priced) : 0;
}

function detectFlags(p) {
  const flags = [];
  const prices = p.variants.map((v) => Number(v.price));
  if (prices.some((x) => x === 0)) flags.push("price_zero");
  if (prices.some((x) => x > 100000)) flags.push("price_outlier");
  if (p.variants.some((v) => v.inventoryQuantity < 0)) flags.push("negative_inventory");
  if ((p.options || []).length > 2) flags.push("extra_option");
  if (/^untitled|^sample |^test /i.test(p.title)) flags.push("junk_title");
  if (!p.images || p.images.length === 0) flags.push("no_images");
  if (p.handle === "gift-card") flags.push("gift_card_product");
  if ((p.metafields?.edges || []).some((e) => /metaobject_reference/.test(e.node.type)))
    flags.push("dangling_metaobject");
  return flags;
}

function buildMetafields(product) {
  return (product.metafields?.edges || []).map((e) => ({
    namespace: e.node.namespace,
    key: e.node.key,
    value: e.node.value,
    type: e.node.type,
  }));
}

// Sequential-unique handle generator
function makeHandleFactory() {
  const seen = new Map();
  return function next(title) {
    const base = slugify(title);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// -------- main --------
async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGODB_URI missing");

  await mongoose.connect(mongoUri);
  console.log("[import] connected");

  const orgId = new mongoose.Types.ObjectId(ORG_ID);

  // -------- resolve location --------
  let location;
  if (LOCATION_NAME) {
    location = await Location.findOne({ organizationId: orgId, name: LOCATION_NAME });
    if (!location) throw new Error(`Location not found by name: ${LOCATION_NAME}`);
  } else {
    location = await Location.findOne({ organizationId: orgId, isDefault: true });
    if (!location) {
      throw new Error(
        "No default Location found. Set one, or pass --location=\"<Name>\"."
      );
    }
  }
  console.log(`[import] target location: ${location.name} (${location._id})`);

  // -------- load export --------
  const raw = require(EXPORT_PATH);
  const products = raw.products || [];
  console.log(`[import] loaded ${products.length} products from ${EXPORT_PATH}`);

  const nextHandle = makeHandleFactory();

  // -------- dedupe images across all products (report only) --------
  const uniqueImageIds = new Set();
  for (const p of products) {
    for (const img of p.images || []) uniqueImageIds.add(gidNum(img.id));
  }
  console.log(`[import] unique images across export: ${uniqueImageIds.size}`);

  // -------- counters --------
  const report = {
    productsCreated: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    variantsUpserted: 0,
    inventoryUpserted: 0,
    flagged: [],
    errors: [],
  };

  // -------- walk --------
  for (const sp of products) {
    try {
      const productNumericId = gidNum(sp.id);
      const flags = detectFlags(sp);

      if (flags.length) {
        report.flagged.push({ id: productNumericId, title: sp.title, flags });
      }

      const handle = nextHandle(sp.title);
      const metafields = buildMetafields(sp);

      // Images: embed with original CDN urls, mark pendingUpload
      const images = (sp.images || []).map((img, idx) => ({
        url: img.originalSrc || img.url,
        alt: img.altText || "",
        isDefault: idx === 0,
        shopifyImageId: gidNum(img.id),
        pendingUpload: true,
      }));

      const isGiftCard = sp.handle === "gift-card";
      const trackInventory = isGiftCard
        ? false
        : (sp.variants[0]?.inventoryItem?.tracked ?? true);

      const doc = {
        organizationId: orgId,
        name: sp.title,
        description: sp.description || "",
        sku: synthesizeProductSku(productNumericId),

        shopifyId: sp.id,
        shopifyNumericId: productNumericId,
        handle,
        productType: sp.productType || "",
        sourceCreatedAt: sp.createdAt ? new Date(sp.createdAt) : undefined,
        sourceUpdatedAt: sp.updatedAt ? new Date(sp.updatedAt) : undefined,
        importedAt: new Date(),
        migrationFlags: flags,

        options: (sp.options || []).map((o, i) => ({
          name: o.name,
          position: i,
          values: o.values || [],
        })),
        metafields,

        vendor: sp.vendor || "",
        tags: sp.tags || [],
        status: (sp.status || "draft").toLowerCase(), // ACTIVE|DRAFT|ARCHIVED|UNLISTED
        price: productPriceFromVariants(sp.variants),
        images,
        trackInventory,
        type: "physical",
      };

      if (DRY_RUN) {
        console.log(`[dry] would upsert product ${productNumericId} "${sp.title}" handle=${handle} status=${doc.status} variants=${sp.variants.length} flags=${flags.join(",") || "-"}`);
        report.productsCreated++;
        continue;
      }

      const existing = await Product.findOne({
        organizationId: orgId,
        shopifyNumericId: productNumericId,
      });

      let productDoc;
      if (existing) {
        productDoc = await Product.findByIdAndUpdate(existing._id, doc, {
          new: true,
        });
        report.productsUpdated++;
      } else {
        productDoc = await Product.create(doc);
        report.productsCreated++;
      }

      // -------- variants --------
      for (let i = 0; i < sp.variants.length; i++) {
        const sv = sp.variants[i];
        const variantNumericId = gidNum(sv.id);

        const variantDoc = {
          organizationId: orgId,
          productId: productDoc._id,
          sku: synthesizeVariantSku(variantNumericId),
          sourceSku: sv.sku || null,

          shopifyId: sv.id,
          shopifyNumericId: variantNumericId,
          inventoryItemId: sv.inventoryItem?.id || null,
          selectedOptions: (sv.selectedOptions || []).map((o) => ({
            name: o.name,
            value: o.value,
          })),

          price: Number(sv.price) || 0,
          compareAtPrice: sv.compareAtPrice != null ? Number(sv.compareAtPrice) : undefined,
          weight: undefined,
          position: i,
          trackInventory: sv.inventoryItem?.tracked ?? true,
          status: "active",
        };

        const variantDocFinal = await Variant.findOneAndUpdate(
          { organizationId: orgId, shopifyNumericId: variantNumericId },
          variantDoc,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        report.variantsUpserted++;

        // -------- inventory --------
        if (variantDocFinal.trackInventory && !isGiftCard) {
          const qty = Number(sv.inventoryQuantity) || 0;

          await Inventory.findOneAndUpdate(
            {
              organizationId: orgId,
              variantId: variantDocFinal._id,
              locationId: location._id,
            },
            {
              organizationId: orgId,
              variantId: variantDocFinal._id,
              locationId: location._id,
              onHand: qty,
              available: qty,
              committed: 0,
              unavailable: 0,
              importedAt: new Date(),
              migratedFromQuantity: qty,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          report.inventoryUpserted++;
        }
      }
    } catch (err) {
      console.error(`[import] FAILED product ${sp.id} "${sp.title}": ${err.message}`);
      report.errors.push({ id: sp.id, title: sp.title, error: err.message });
    }
  }

  // -------- report --------
  console.log("\n===== IMPORT REPORT =====");
  console.log(report);
  console.log(`flagged: ${report.flagged.length}`);
  console.log(`errors:  ${report.errors.length}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] no writes performed");
  }

  await mongoose.disconnect();
  console.log("[import] done");
}

main().catch((err) => {
  console.error("[import] fatal:", err);
  process.exit(1);
});