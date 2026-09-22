#!/usr/bin/env node
/**
 * Pre-import image upload pass.
 * Reads products-export.json, uploads every UNIQUE image to Shopify Files,
 * writes back a rewritten export + a persistent id→url map.
 * Does NOT touch the database.
 *
 * Usage:
 *   node server/scripts/upload-export-images.js
 *   node server/scripts/upload-export-images.js --limit=20 --concurrency=2
 *   node server/scripts/upload-export-images.js --resume
 *   node server/scripts/upload-export-images.js --only-failed
 *   node server/scripts/upload-export-images.js --convert-heic
 *
 * Requires Node 18+ (native fetch, FormData, Blob).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const {
  downloadImage,
  uploadBuffer,
  convertHeicToJpeg,
  extFromUrl,
  mimeFromExt,
  isShopifySupported,
} = require("../services/shopifyFiles");

// ---------- CLI ----------
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};

const IN_PATH = path.resolve(getArg("in", "data/products-export.json"));
const OUT_PATH = path.resolve(getArg("out", "data/products-export.with-uploads.json"));
const MAP_PATH = path.resolve(getArg("map", "data/image-upload-map.json"));
const CONCURRENCY = Number(getArg("concurrency", "3"));
const LIMIT = getArg("limit", null) ? Number(getArg("limit")) : null;
const RESUME = args.includes("--resume");
const ONLY_FAILED = args.includes("--only-failed");
const CONVERT_HEIC = args.includes("--convert-heic");

// ---------- helpers ----------
const gidNum = (gid) => (gid ? Number(String(gid).split("/").pop()) : null);

function collectUniqueImages(products) {
  const map = new Map();
  for (const p of products) {
    for (const img of p.images || []) {
      const id = gidNum(img.id);
      if (!map.has(id)) {
        map.set(id, {
          shopifyImageId: id,
          src: img.originalSrc || img.url,
          alt: img.altText || "",
        });
      }
    }
  }
  return map;
}

async function pool(items, size, worker) {
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

// ---------- main ----------
async function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Input not found: ${IN_PATH}`);
    console.error(`Pass --in=<path> or place the export at data/products-export.json`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(IN_PATH, "utf8"));
  const products = raw.products || [];

  const unique = collectUniqueImages(products);
  console.log(`[upload] ${products.length} products, ${unique.size} unique images`);
  if (CONVERT_HEIC) console.log(`[upload] HEIC conversion: ON (requires 'sharp')`);

  // load previous map for resume / only-failed
  let prevMap = {};
  if ((RESUME || ONLY_FAILED) && fs.existsSync(MAP_PATH)) {
    prevMap = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
    console.log(`[upload] loaded ${Object.keys(prevMap).length} entries from map`);
  }

  let work = [...unique.values()];
  if (ONLY_FAILED) {
    work = work.filter((w) => prevMap[w.shopifyImageId]?.error);
  } else if (RESUME) {
    work = work.filter((w) => !prevMap[w.shopifyImageId]?.url);
  }
  if (LIMIT) work = work.slice(0, LIMIT);

  console.log(`[upload] to process: ${work.length} (concurrency ${CONCURRENCY})`);

  const uploadMap = { ...prevMap };
  let done = 0, failed = 0, skipped = 0;
  const t0 = Date.now();

  await pool(work, CONCURRENCY, async (item) => {
    const { shopifyImageId, src, alt } = item;

    let ext = extFromUrl(src);

    try {
      const dl = await downloadImage(src);
      let buffer = dl.buffer;
      let mimeType = mimeFromExt(ext);

      // HEIC / unsupported
      if (!isShopifySupported(ext)) {
        if ((ext === ".heic" || ext === ".heif") && CONVERT_HEIC) {
          const conv = await convertHeicToJpeg(buffer);
          buffer = conv.buffer;
          ext = conv.ext;
          mimeType = conv.mimeType;
        } else {
          uploadMap[shopifyImageId] = {
            src,
            error: `unsupported_extension:${ext}`,
            attemptedAt: new Date().toISOString(),
          };
          skipped++;
          console.warn(`[skip] ${shopifyImageId} ${ext}`);
          return;
        }
      }

      const filename = `product-${shopifyImageId}${ext}`;
      const result = await uploadBuffer({ buffer, filename, mimeType, alt });

      uploadMap[shopifyImageId] = {
        src,
        shopifyFileId: result.id,
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
      uploadMap[shopifyImageId] = {
        src,
        error: err.message,
        attemptedAt: new Date().toISOString(),
      };
      console.error(`[fail] ${shopifyImageId}: ${err.message}`);
    }
  });

  // persist map
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
  fs.writeFileSync(MAP_PATH, JSON.stringify(uploadMap, null, 2));
  console.log(`[upload] wrote ${MAP_PATH}`);

  // rewrite export
  const rewritten = JSON.parse(JSON.stringify(raw));
  let rewrittenCount = 0;

  for (const p of rewritten.products || []) {
    for (const img of p.images || []) {
      const id = gidNum(img.id);
      const u = uploadMap[id];
      if (u?.url) {
        img.shopifyFileId = u.shopifyFileId;
        img.shopifyCdnUrl = img.originalSrc || img.url;
        img.url = u.url;
        img.originalSrc = u.url;
        rewrittenCount++;
      }
      if (u?.error) {
        img.uploadError = u.error;
      }
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(rewritten, null, 2));
  console.log(`[upload] rewrote ${rewrittenCount} image refs → ${OUT_PATH}`);

  const totalFailed = Object.values(uploadMap).filter((v) => v.error).length;
  console.log("\n===== SUMMARY =====");
  console.log(`unique images:   ${unique.size}`);
  console.log(`uploaded ok:     ${done}`);
  console.log(`failed:          ${failed}`);
  console.log(`skipped:         ${skipped}`);
  console.log(`cumulative fail: ${totalFailed}`);
  console.log(`elapsed:         ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("[upload] fatal:", e);
  process.exit(1);
});

// cd server
// node scripts/upload-export-images.js --limit=10 --concurrency=2
// # inspect data/image-upload-map.json, then:
// node scripts/upload-export-images.js --concurrency=3
// # rerun failures:
// node scripts/upload-export-images.js --only-failed
// # with HEIC conversion:
// npm i sharp
// node scripts/upload-export-images.js --convert-heic --only-failed