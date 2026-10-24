#!/usr/bin/env node
/**
 * Pre-import image upload pass — DISK-FIRST.
 *
 * Reads products-export.json, uploads every UNIQUE image in imageMap[] to
 * Shopify Files, and writes back a rewritten export + a persistent map.
 *
 * Key design points:
 *   - Files are read from disk (/mnt/ntfsdrive/.../images/<basename>), NOT
 *     downloaded from the old CDN. This is faster, offline-safe, and works
 *     even if the old store is gone.
 *   - imageMap[] is the source of truth for file paths (relativePath carries
 *     the actual filename; the inline product.images[]._local.path can point
 *     at a different product — the shared-image quirk).
 *   - Idempotent: rerun with --resume to continue; --only-failed retries errors.
 *   - Missing disk files are logged, not fatal.
 *
 * Usage:
 *   node server/scripts/upload-export-images.js
 *   node server/scripts/upload-export-images.js --limit=5 --concurrency=2 --dry-run
 *   node server/scripts/upload-export-images.js --resume
 *   node server/scripts/upload-export-images.js --only-failed
 *
 * Env:
 *   DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_API_VERSION
 *     (see data/shopifyAuth.js + services/shopifyFiles.js)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const {
  uploadBuffer,
  mimeFromExt,
  extFromUrl,
  isShopifySupported,
} = require("../services/shopifyFiles");

// ---------- CLI ----------
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const flag = (k) => args.includes(`--${k}`);

const IN_PATH = path.resolve(
  getArg("in", "/mnt/ntfsdrive/shopify-export/house-of-queens-ke/products-export.json")
);
const IMAGES_DIR = path.resolve(
  getArg("images-dir", "/mnt/ntfsdrive/shopify-export/house-of-queens-ke/images")
);
const OUT_PATH = path.resolve(getArg("out", "data/products-export.with-uploads.json"));
const MAP_PATH = path.resolve(getArg("map", "data/image-upload-map.json"));
const MISSING_PATH = path.resolve(getArg("missing", "data/missing-images.json"));
const FAILED_PATH = path.resolve(getArg("failed", "data/failed-images.json"));

const CONCURRENCY = Number(getArg("concurrency", "3"));
const LIMIT = getArg("limit", null) ? Number(getArg("limit")) : null;
const RESUME = flag("resume");
const ONLY_FAILED = flag("only-failed");
const DRY_RUN = flag("dry-run");

// ---------- helpers ----------
const gidNum = (gid) => (gid ? Number(String(gid).split("/").pop()) : null);

/** Derive on-disk filename from an imageMap record. relativePath wins. */
function diskBasename(entry, gid) {
  // Prefer relativePath ("images\\product-...-img-....jpg")
  if (entry?.relativePath) {
    const parts = String(entry.relativePath).split(/[\\/]/);
    return parts[parts.length - 1];
  }
  // Fall back to localPath (Windows or Unix)
  if (entry?.localPath) {
    const parts = String(entry.localPath).split(/[\\/]/);
    return parts[parts.length - 1];
  }
  // Last resort: synthesize from GID
  return `product-${gid}-img-${gid}.jpg`;
}

/** Ext derived from disk filename (extFromUrl expects a URL — give it one). */
function extFromBasename(basename) {
  const clean = String(basename).split("?")[0];
  return path.extname(clean).toLowerCase() || ".jpg";
}

function pool(items, size, worker) {
  const queue = [...items];
  const active = new Set();
  let idx = 0;
  const results = new Array(items.length);

  return new Promise((resolve) => {
    const kick = () => {
      while (active.size < size && queue.length) {
        const i = idx++;
        const item = queue.shift();
        const p = Promise.resolve()
          .then(() => worker(item, i))
          .then((r) => { results[i] = r; })
          .catch((e) => { results[i] = { error: e.message }; })
          .finally(() => {
            active.delete(p);
            if (queue.length) kick();
            else if (!active.size) resolve(results);
          });
        active.add(p);
      }
      if (!queue.length && !active.size) resolve(results);
    };
    kick();
  });
}

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ---------- main ----------
async function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Input not found: ${IN_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`Images dir not found: ${IMAGES_DIR}`);
    process.exit(1);
  }

  const raw = readJSON(IN_PATH);
  const products = raw.products || [];
  const imageMap = raw.imageMap || {};
  const imageEntries = Object.entries(imageMap); // [gidString, entry]

  console.log(`[upload] ${products.length} products, ${imageEntries.length} images in imageMap`);
  console.log(`[upload] images dir: ${IMAGES_DIR}`);

  // ----- load previous map (for --resume / --only-failed) -----
  let prevMap = {};
  if ((RESUME || ONLY_FAILED) && fs.existsSync(MAP_PATH)) {
    prevMap = readJSON(MAP_PATH, {});
    console.log(`[upload] loaded ${Object.keys(prevMap).length} entries from map`);
  }

  // ----- decide work set -----
  // Missing-file detection is cheap; do it for the full set first so we know
  // exactly what's gone before we spend time on Shopify.
  const all = imageEntries.map(([gidStr, entry]) => {
    const numericId = gidNum(gidStr);
    const basename = diskBasename(entry, numericId);
    const absPath = path.join(IMAGES_DIR, basename);
    const exists = fs.existsSync(absPath);
    return { gidStr, numericId, entry, basename, absPath, exists };
  });

  const missingOnDisk = all.filter((x) => !x.exists);
  const presentOnDisk = all.filter((x) => x.exists);

  console.log(
    `[upload] disk check: ${presentOnDisk.length} present, ${missingOnDisk.length} missing`
  );

  if (missingOnDisk.length) {
    fs.mkdirSync(path.dirname(MISSING_PATH), { recursive: true });
    fs.writeFileSync(
      MISSING_PATH,
      JSON.stringify(
        missingOnDisk.map((x) => ({
          shopifyImageGid: x.gidStr,
          shopifyImageNumericId: x.numericId,
          expectedBasename: x.basename,
          expectedPath: x.absPath,
          relativePath: x.entry?.relativePath || null,
          localPath: x.entry?.localPath || null,
        })),
        null,
        2
      )
    );
    console.log(`[upload] wrote missing list → ${MISSING_PATH}`);
  }

  // ----- filter -----
  let work = presentOnDisk;
  if (ONLY_FAILED) {
    work = work.filter((x) => prevMap[x.numericId]?.error);
  } else if (RESUME) {
    work = work.filter((x) => !prevMap[x.numericId]?.url);
  }
  if (LIMIT) work = work.slice(0, LIMIT);

  console.log(
    `[upload] to process: ${work.length} (concurrency ${CONCURRENCY}${DRY_RUN ? ", DRY RUN" : ""})`
  );

  // ----- upload -----
  const uploadMap = { ...prevMap };
  let done = 0;
  let failed = 0;
  let skipped = 0;
  const t0 = Date.now();

  await pool(work, CONCURRENCY, async (item) => {
    const { gidStr, numericId, entry, basename, absPath } = item;

    let ext = extFromBasename(basename);
    if (!isShopifySupported(ext)) {
      uploadMap[numericId] = {
        shopifyImageGid: gidStr,
        src: absPath,
        error: `unsupported_extension:${ext}`,
        attemptedAt: new Date().toISOString(),
      };
      skipped++;
      console.warn(`[skip] ${numericId} ${ext} (unsupported)`);
      return;
    }

    if (DRY_RUN) {
      console.log(`[dry] ${numericId} would upload ${basename}`);
      return;
    }

    try {
      const buffer = fs.readFileSync(absPath);
      const mimeType = mimeFromExt(ext);
      const filename = basename;

      const result = await uploadBuffer({ buffer, filename, mimeType, alt: "" });

      uploadMap[numericId] = {
        shopifyImageGid: gidStr,
        src: absPath,
        shopifyFileId: result.shopifyFileId,
        url: result.url,
        width: result.width,
        height: result.height,
        bytes: buffer.length,
        uploadedAt: new Date().toISOString(),
      };
      done++;

      if (done % 20 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`[upload] ${done}/${work.length} (${rate.toFixed(1)}/s)`);
      }
    } catch (err) {
      failed++;
      uploadMap[numericId] = {
        shopifyImageGid: gidStr,
        src: absPath,
        error: err.message,
        attemptedAt: new Date().toISOString(),
      };
      console.error(`[fail] ${numericId}: ${err.message}`);
    }
  });

  // ----- persist map -----
  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
    fs.writeFileSync(MAP_PATH, JSON.stringify(uploadMap, null, 2));
    console.log(`[upload] wrote map → ${MAP_PATH}`);
  }

  // ----- rewrite export with new URLs -----
  if (!DRY_RUN) {
    const rewritten = JSON.parse(JSON.stringify(raw));
    let rewrittenCount = 0;

    // 1) rewrite imageMap in place
    for (const [gidStr, entry] of Object.entries(rewritten.imageMap || {})) {
      const numericId = gidNum(gidStr);
      const u = uploadMap[numericId];
      if (!u) continue;

      if (u.url) {
        entry.uploadedUrl = u.url;
        entry.shopifyFileId = u.shopifyFileId;
        entry.uploadedWidth = u.width;
        entry.uploadedHeight = u.height;
        entry.uploadedBytes = u.bytes;
        entry.uploadedAt = u.uploadedAt;
        rewrittenCount++;
      } else if (u.error) {
        entry.uploadError = u.error;
      }
    }

    // 2) rewrite each product.images[] to point at new URL (for legacy compat)
    for (const p of rewritten.products || []) {
      for (const img of p.images || []) {
        const numericId = gidNum(img.id);
        const u = uploadMap[numericId];
        if (u?.url) {
          img.shopifyFileId = u.shopifyFileId;
          img.shopifyCdnUrl = img.originalSrc || img.url;
          img.url = u.url;
          img.originalSrc = u.url;
          if (u.width) img.width = u.width;
          if (u.height) img.height = u.height;
        } else if (u?.error) {
          img.uploadError = u.error;
        }
      }

      // 3) also rewrite variant.image if present
      for (const v of p.variants || []) {
        if (v.image?.id) {
          const numericId = gidNum(v.image.id);
          const u = uploadMap[numericId];
          if (u?.url) {
            v.image.shopifyFileId = u.shopifyFileId;
            v.image.url = u.url;
            v.image.originalSrc = u.url;
          }
        }
      }
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(rewritten, null, 2));
    console.log(`[upload] rewrote ${rewrittenCount} image refs → ${OUT_PATH}`);
  }

  // ----- failed report -----
  const failedEntries = Object.values(uploadMap).filter((v) => v.error);
  if (failedEntries.length) {
    fs.mkdirSync(path.dirname(FAILED_PATH), { recursive: true });
    fs.writeFileSync(FAILED_PATH, JSON.stringify(failedEntries, null, 2));
    console.log(`[upload] wrote ${failedEntries.length} failures → ${FAILED_PATH}`);
  }

  // ----- summary -----
  const totalFailed = failedEntries.length;
  console.log("\n===== SUMMARY =====");
  console.log(`imageMap entries: ${imageEntries.length}`);
  console.log(`present on disk:  ${presentOnDisk.length}`);
  console.log(`missing on disk:  ${missingOnDisk.length}`);
  console.log(`processed:        ${work.length}`);
  console.log(`uploaded ok:      ${done}`);
  console.log(`failed this run:  ${failed}`);
  console.log(`skipped:          ${skipped}`);
  console.log(`cumulative fail:  ${totalFailed}`);
  console.log(`elapsed:          ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (DRY_RUN) console.log("\n[dry-run] no writes performed");
}

main().catch((e) => {
  console.error("[upload] fatal:", e);
  process.exit(1);
});