#!/usr/bin/env node
/**
 * One-shot Shopify product migration — WITH IMAGE RESOLUTION.
 *
 * Reads the rewritten export (data/products-export.with-uploads.json) and the
 * upload map (data/image-upload-map.json), then upserts Product / Variant /
 * ProductImage / Inventory into Mongo.
 *
 * Idempotent: reruns upsert on shopifyNumericId. Safe to resume.
 *
 * Usage:
 *   node server/scripts/import-shopify-products.js --org=<ORG_ID> [--location="<Name>"] [--dry-run] [--limit=N]
 *
 * Path overrides:
 *   --in=<path>    (default: data/products-export.with-uploads.json)
 *   --map=<path>   (default: data/image-upload-map.json)
 *
 * Env:
 *   MONGO_URI or MONGODB_URI
 *   SHOPIFY_EXPORT_PATH, SHOPIFY_UPLOAD_MAP_PATH, SHOPIFY_FAILED_PATH  (optional)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Product = require("../models/Product");
const Variant = require("../models/Variant");
const Inventory = require("../models/Inventory");
const Location = require("../models/Location");
const ProductImage = require("../models/ProductImage");


const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

// -------- CLI (parse once, before path defaults) --------
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const DRY_RUN = args.includes("--dry-run");
const ORG_ID = getArg("org", process.env.ORG_ID);
const LOCATION_NAME = getArg("location", null);
const LIMIT = getArg("limit", null) ? Number(getArg("limit")) : null;

if (!ORG_ID) {
  console.error("Missing --org=<ORG_ID> (or ORG_ID env)");
  process.exit(1);
}

// -------- paths (CWD-relative by default, override-able) --------
const EXPORT_PATH = path.resolve(
  getArg("in", null) ||
    process.env.SHOPIFY_EXPORT_PATH ||
    "data/products-export.with-uploads.json"
);
const UPLOAD_MAP_PATH = path.resolve(
  getArg("map", null) ||
    process.env.SHOPIFY_UPLOAD_MAP_PATH ||
    "data/image-upload-map.json"
);
const FAILED_PATH = path.resolve(
  getArg("failed", null) ||
    process.env.SHOPIFY_FAILED_PATH ||
    "data/failed-products.json"
);

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
  const priced = (variants || [])
    .map((v) => Number(v.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  return priced.length ? Math.min(...priced) : 0;
}

function clampInventory(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

function detectFlags(p, imageStats) {
  const flags = [];
  const prices = (p.variants || []).map((v) => Number(v.price));
  if (prices.some((x) => x === 0)) flags.push("price_zero");
  if (prices.some((x) => x > 100000)) flags.push("price_outlier");
  if ((p.variants || []).some((v) => Number(v.inventoryQuantity) < 0))
    flags.push("negative_inventory");
  if ((p.options || []).length > 2) flags.push("extra_option");
  if (/^untitled|^sample |^test /i.test(p.title || "")) flags.push("junk_title");
  if (imageStats.total === 0) flags.push("no_images");
  if (imageStats.missing > 0) flags.push("images_partially_missing");
  if (imageStats.uploadFailed > 0) flags.push("images_upload_failed");
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

// Sequential-unique handle generator (in-memory; DB's sparse unique index on
// (organizationId, handle) + upsert-by-gid keeps reruns clean)
function makeHandleFactory() {
  const seen = new Map();
  return function next(title) {
    const base = slugify(title);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// -------- image resolution --------
/**
 * For one Shopify image record, produce:
 *   - a Mongo-resolvable payload for ProductImage upsert, OR
 *   - a "missing" / "upload_failed" record with a reason.
 *
 * Source of truth for the new URL: uploadMap[numericId].url
 * (written by scripts/upload-export-images.js).
 */
async function resolveImage({ shopifyImageGid, inlineImg, uploadMap }) {
  const numericId = gidNum(shopifyImageGid);
  const up = uploadMap[numericId];

  if (up?.error) {
    return { status: "upload_failed", numericId, reason: up.error, inlineImg };
  }
  if (!up?.url) {
    return { status: "missing", numericId, reason: "not_in_upload_map", inlineImg };
  }

  const doc = {
    shopifyImageNumericId: numericId,
    shopifyImageGid,
    shopifyFileId: up.shopifyFileId || null,
    fileStatus: up.status || "READY",
    uploadedAt: up.uploadedAt ? new Date(up.uploadedAt) : new Date(),
    url: up.url,
    originalSourceUrl: inlineImg?.originalSrc || inlineImg?.url || null,
    alt: inlineImg?.altText || inlineImg?.alt || "",
    width: up.width ?? inlineImg?.width ?? null,
    height: up.height ?? inlineImg?.height ?? null,
    bytes: up.bytes ?? null,
    localRelativePath: up.relativePath || null,
    localPath: up.src || null,
    diskExists: true,
  };

  const imageDoc = await ProductImage.findOneAndUpdate(
    { shopifyImageNumericId: numericId },
    doc,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    status: "ok",
    numericId,
    imageDoc,
    url: up.url,
    shopifyFileId: up.shopifyFileId,
    width: up.width,
    height: up.height,
    alt: inlineImg?.altText || "",
    originalSrc: inlineImg?.originalSrc || inlineImg?.url || null,
    inlineImg,
  };
}

// -------- main --------
async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGODB_URI / MONGO_URI missing");

  console.log(`[import] export:  ${EXPORT_PATH}`);
  console.log(`[import] map:     ${UPLOAD_MAP_PATH}`);
  console.log(`[import] dry-run: ${DRY_RUN}`);
  console.log(`[import] org:     ${ORG_ID}`);

  await mongoose.connect(mongoUri, {
    tls: true,
    ssl: true,
    family: 4 
  });
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
        'No default Location found. Set one, or pass --location="<Name>".'
      );
    }
  }
  console.log(`[import] target location: ${location.name} (${location._id})`);

  // -------- load export + upload map --------
  if (!fs.existsSync(EXPORT_PATH)) {
    throw new Error(
      `Export not found: ${EXPORT_PATH}\n` +
        `Run upload-export-images.js first (without --dry-run) to produce it.`
    );
  }
  if (!fs.existsSync(UPLOAD_MAP_PATH)) {
    throw new Error(
      `Upload map not found: ${UPLOAD_MAP_PATH}\n` +
        `Run upload-export-images.js first (without --dry-run) to produce it.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(EXPORT_PATH, "utf8"));
  const products = raw.products || [];
  const uploadMap = JSON.parse(fs.readFileSync(UPLOAD_MAP_PATH, "utf8"));

  const uploadedCount = Object.values(uploadMap).filter((v) => v?.url).length;
  const errorCount = Object.values(uploadMap).filter((v) => v?.error).length;

  console.log(
    `[import] ${products.length} products; upload map: ${uploadedCount} uploaded, ${errorCount} errors`
  );

  if (uploadedCount === 0) {
    console.warn(
      "[import] WARNING: 0 uploaded images in map — all products will import with no images."
    );
  }

  const nextHandle = makeHandleFactory();

  // -------- counters --------
  const report = {
    productsCreated: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    variantsUpserted: 0,
    inventoryUpserted: 0,
    productImagesUpserted: 0,
    imagesMissing: 0,
    imagesUploadFailed: 0,
    flagged: [],
    errors: [],
  };

  const sliced = LIMIT ? products.slice(0, LIMIT) : products;
  console.log(
    `[import] processing ${sliced.length} products${DRY_RUN ? " (DRY RUN)" : ""}`
  );

  const t0 = Date.now();

  // -------- walk --------
  for (const sp of sliced) {
    try {
      const productNumericId = gidNum(sp.id);
      const handle = nextHandle(sp.title);

      // ---- resolve images ----
      const resolvedImages = [];
      const imageStats = { total: 0, ok: 0, missing: 0, uploadFailed: 0 };

      for (let idx = 0; idx < (sp.images || []).length; idx++) {
        const inlineImg = sp.images[idx];
        const gid = inlineImg.id;
        imageStats.total++;

        const r = await resolveImage({
          shopifyImageGid: gid,
          inlineImg,
          uploadMap,
        });

        if (r.status === "ok") {
          imageStats.ok++;
          resolvedImages.push({
            ...r,
            position: idx,
            isDefault: idx === 0,
          });
        } else if (r.status === "upload_failed") {
          imageStats.uploadFailed++;
          report.imagesUploadFailed++;
        } else {
          imageStats.missing++;
          report.imagesMissing++;
        }
      }

      const flags = detectFlags(sp, imageStats);

      // ---- build Product doc ----
      const isGiftCard = sp.handle === "gift-card";
      const trackInventory = isGiftCard
        ? false
        : sp.variants?.[0]?.inventoryItem?.tracked ?? true;

      const embeddedImages = resolvedImages.map((r) => ({
        url: r.url,
        alt: r.alt,
        isDefault: r.isDefault,
        shopifyImageId: r.numericId,
        shopifyFileId: r.shopifyFileId || null,
        width: r.width ?? null,
        height: r.height ?? null,
        pendingUpload: false,
      }));

      const imageIds = resolvedImages.map((r) => r.imageDoc._id);

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
        metafields: buildMetafields(sp),

        vendor: sp.vendor || "",
        tags: sp.tags || [],
        status: (sp.status || "draft").toLowerCase(),
        price: productPriceFromVariants(sp.variants),
        images: embeddedImages,
        imageIds,
        trackInventory,
        type: "physical",
      };

      if (DRY_RUN) {
        const existing = await Product.findOne(
          { organizationId: orgId, shopifyNumericId: productNumericId },
          { _id: 1 }
        ).lean();
        console.log(
          `[dry] ${existing ? "would UPDATE" : "would CREATE"} product ${productNumericId} ` +
            `"${sp.title}" handle=${handle} status=${doc.status} ` +
            `variants=${sp.variants?.length ?? 0} images=${resolvedImages.length}/${imageStats.total} ` +
            `flags=${flags.join(",") || "-"}`
        );
        if (existing) report.productsUpdated++;
        else report.productsCreated++;
        report.productImagesUpserted += resolvedImages.length;
        report.variantsUpserted += sp.variants?.length ?? 0;
        continue;
      }

      // ---- upsert Product ----
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
      report.productImagesUpserted += resolvedImages.length;

      // ---- variants ----
      for (let i = 0; i < (sp.variants || []).length; i++) {
        const sv = sp.variants[i];
        const variantNumericId = gidNum(sv.id);

        // Variant image (optional)
        const variantImages = [];
        const variantImageIds = [];
        if (sv.image?.id) {
          const r = await resolveImage({
            shopifyImageGid: sv.image.id,
            inlineImg: sv.image,
            uploadMap,
          });
          if (r.status === "ok") {
            variantImages.push({
              url: r.url,
              alt: r.alt || "",
              isDefault: true,
              shopifyFileId: r.shopifyFileId || null,
              shopifyImageNumericId: r.numericId,
              width: r.width ?? null,
              height: r.height ?? null,
            });
            variantImageIds.push(r.imageDoc._id);
          }
        }

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
          compareAtPrice:
            sv.compareAtPrice != null ? Number(sv.compareAtPrice) : undefined,
          position: i,
          trackInventory: sv.inventoryItem?.tracked ?? true,
          status: "active",
          images: variantImages,
          imageIds: variantImageIds,
        };

        const variantDocFinal = await Variant.findOneAndUpdate(
          { organizationId: orgId, shopifyNumericId: variantNumericId },
          variantDoc,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        report.variantsUpserted++;

        // ---- inventory ----
        if (variantDocFinal.trackInventory && !isGiftCard) {
          const qty = clampInventory(sv.inventoryQuantity);

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
              migratedFromQuantity: Number(sv.inventoryQuantity) || 0,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          report.inventoryUpserted++;
        }
      }

      if (flags.length) {
        report.flagged.push({ id: productNumericId, title: sp.title, flags });
      }

      // Light progress every 25 products
      const processedNow =
        report.productsCreated + report.productsUpdated;
      if (processedNow % 25 === 0) {
        const rate = processedNow / ((Date.now() - t0) / 1000);
        console.log(
          `[import] ${processedNow}/${sliced.length} (${rate.toFixed(1)}/s)`
        );
      }
    } catch (err) {
      console.error(
        `[import] FAILED product ${sp.id} "${sp.title}": ${err.message}`
      );
      report.errors.push({ id: sp.id, title: sp.title, error: err.message });
    }
  }

  // ----- report -----
  console.log("\n===== IMPORT REPORT =====");
  console.log({
    productsCreated: report.productsCreated,
    productsUpdated: report.productsUpdated,
    variantsUpserted: report.variantsUpserted,
    inventoryUpserted: report.inventoryUpserted,
    productImagesUpserted: report.productImagesUpserted,
    imagesMissing: report.imagesMissing,
    imagesUploadFailed: report.imagesUploadFailed,
    flagged: report.flagged.length,
    errors: report.errors.length,
  });

  if (report.flagged.length) {
    console.log("\nFlags (first 20):");
    for (const f of report.flagged.slice(0, 20)) {
      console.log(`  ${f.id} "${f.title}" → ${f.flags.join(",")}`);
    }
    if (report.flagged.length > 20) {
      console.log(`  …and ${report.flagged.length - 20} more`);
    }
  }

  if (report.errors.length) {
    fs.mkdirSync(path.dirname(FAILED_PATH), { recursive: true });
    fs.writeFileSync(FAILED_PATH, JSON.stringify(report, null, 2));
    console.log(`\n[import] wrote failures → ${FAILED_PATH}`);
  }

  if (DRY_RUN) console.log("\n[dry-run] no writes performed");

  await mongoose.disconnect();
  console.log("[import] done");
}

main().catch((err) => {
  console.error("[import] fatal:", err);
  process.exit(1);
});