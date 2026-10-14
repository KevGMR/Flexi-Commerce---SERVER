#!/usr/bin/env node
/**
 * Publish all active products and collections for an organization on the
 * production MongoDB.
 *
 * Usage:
 *   # Dry run (read-only — safe to run any time)
 *   node scripts/prod-publish-all.js --slug house-of-queens
 *
 *   # Apply (publishes everything active that isn't already published)
 *   node scripts/prod-publish-all.js --slug house-of-queens --apply
 *
 * Connection order:
 *   1. PROD_MONGO_URI (from .env or shell)
 *   2. MONGO_URI
 *   3. MONGODB_URI
 *
 * Pass --uri <value> to override.
 *
 * WARNING: this is a write operation. Verify the "Connected to" line
 * before running with --apply. If it says "local", stop.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const Product = require("../models/Product");
const Collection = require("../models/Collection");

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]); // Google + Cloudflare

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

function classifyUri(uri) {
  if (!uri) return "unknown";
  if (uri.includes("localhost") || uri.includes("127.0.0.1")) return "LOCAL";
  if (uri.includes("mongodb+srv://")) return "REMOTE (Atlas)";
  if (uri.startsWith("mongodb://")) return "REMOTE";
  return "unknown";
}

function redactUri(uri) {
  if (!uri) return "(none)";
  // Redact password between : and @ in the userinfo section
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+@/, "$1***@");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const slug = arg("--slug");
  const apply = hasFlag("--apply");
  const uriOverride = arg("--uri");

  if (!slug) {
    console.error(
      "Usage: node scripts/prod-publish-all.js --slug <slug> [--apply] [--uri <mongo-uri>]",
    );
    process.exit(1);
  }

  const uri =
    uriOverride ||
    process.env.PROD_MONGO_URI ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI;

  if (!uri) {
    console.error(
      "No Mongo URI found. Set PROD_MONGO_URI in .env, or pass --uri <value>.",
    );
    process.exit(1);
  }

  const kind = classifyUri(uri);

  console.log("");
  console.log("─── Configuration ────────────────────────────");
  console.log(`Slug:       ${slug}`);
  console.log(`Mode:       ${apply ? "APPLY (will write)" : "DRY RUN (read-only)"}`);
  console.log(`URI source: ${
    uriOverride
      ? "--uri flag"
      : process.env.PROD_MONGO_URI
        ? "PROD_MONGO_URI"
        : process.env.MONGO_URI
          ? "MONGO_URI"
          : "MONGODB_URI"
  }`);
  console.log(`Connection: ${kind}`);
  console.log(`URI:        ${redactUri(uri)}`);

  if (apply && kind === "LOCAL") {
    console.error("");
    console.error("✗ Refusing to --apply against a LOCAL database.");
    console.error("  This script is for production. If you really mean to run");
    console.error("  against local, use a different tool.");
    process.exit(1);
  }

  console.log("");
  console.log("Connecting…");

  await mongoose.connect(uri, {
    tls: true,
    ssl: true,
    family: 4,
  });

  console.log("✓ Connected.");

  // -------------------------------------------------------------------------
  // Find the org
  // -------------------------------------------------------------------------

  console.log("");
  console.log("─── Organization ─────────────────────────────");

  const org = await Organization.findOne({ slug }).lean();
  if (!org) {
    console.error(`✗ Org not found: ${slug}`);
    console.error("  Check that you're connected to the right cluster.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`✓ ${org.name}`);
  console.log(`  _id:               ${org._id}`);
  console.log(`  slug:              ${org.slug}`);
  console.log(`  status:            ${org.status}`);
  console.log(`  website.subdomain: ${org.website?.subdomain || "(not set)"}`);
  console.log(`  website.domain:    ${org.website?.domain || "(not set)"}`);
  console.log(`  website.published: ${org.website?.published === true}`);

  // -------------------------------------------------------------------------
  // Count products & collections
  // -------------------------------------------------------------------------

  console.log("");
  console.log("─── Products ─────────────────────────────────");

  const productBase = { organizationId: org._id, status: "active" };
  const productNeedsPublish = { ...productBase, published: { $ne: true } };

  const [totalProducts, unpubProducts] = await Promise.all([
    Product.countDocuments(productBase),
    Product.countDocuments(productNeedsPublish),
  ]);

  console.log(`  Active products:    ${totalProducts}`);
  console.log(`  Need publishing:    ${unpubProducts}`);
  console.log(`  Already published:  ${totalProducts - unpubProducts}`);

  // Show a few sample names if there's anything unpublished
  if (unpubProducts > 0) {
    const samples = await Product.find(productNeedsPublish)
      .select("name sku")
      .limit(5)
      .lean();
    console.log("  Sample:");
    for (const p of samples) {
      console.log(`    • ${p.name}${p.sku ? ` (${p.sku})` : ""}`);
    }
    if (unpubProducts > samples.length) {
      console.log(`    … and ${unpubProducts - samples.length} more`);
    }
  }

  console.log("");
  console.log("─── Collections ──────────────────────────────");

  const collectionBase = { organizationId: org._id, status: "active" };
  const collectionNeedsPublish = {
    ...collectionBase,
    published: { $ne: true },
  };

  const [totalCollections, unpubCollections] = await Promise.all([
    Collection.countDocuments(collectionBase),
    Collection.countDocuments(collectionNeedsPublish),
  ]);

  console.log(`  Active collections: ${totalCollections}`);
  console.log(`  Need publishing:    ${unpubCollections}`);
  console.log(`  Already published:  ${totalCollections - unpubCollections}`);

  if (unpubCollections > 0) {
    const samples = await Collection.find(collectionNeedsPublish)
      .select("name slug")
      .limit(5)
      .lean();
    console.log("  Sample:");
    for (const c of samples) {
      console.log(`    • ${c.name} (${c.slug})`);
    }
    if (unpubCollections > samples.length) {
      console.log(`    … and ${unpubCollections - samples.length} more`);
    }
  }

  // -------------------------------------------------------------------------
  // Apply (or exit)
  // -------------------------------------------------------------------------

  console.log("");
  console.log("─── Summary ──────────────────────────────────");

  const nothingToDo = unpubProducts === 0 && unpubCollections === 0;

  if (nothingToDo) {
    console.log("✓ Nothing to publish. Everything is already public.");
    await mongoose.disconnect();
    return;
  }

  console.log(
    `Would publish: ${unpubProducts} product(s), ${unpubCollections} collection(s)`,
  );

  if (!apply) {
    console.log("");
    console.log("This was a DRY RUN. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  console.log("");
  console.log("─── Applying ─────────────────────────────────");
  console.log("Publishing…");

  const now = new Date();

  const prodRes = await Product.updateMany(productNeedsPublish, {
    $set: { published: true, publishedAt: now },
  });
  console.log(`✓ Products published:    ${prodRes.modifiedCount}`);

  const colRes = await Collection.updateMany(collectionNeedsPublish, {
    $set: { published: true, publishedAt: now },
  });
  console.log(`✓ Collections published: ${colRes.modifiedCount}`);

  console.log("");
  console.log("Done.");
  console.log("");
  console.log("Next:");
  console.log(`  1. Set website.subdomain = "${org.slug}" in the admin`);
  console.log("     (Settings → Website). Otherwise the storefront subdomain");
  console.log("     won't resolve to this org.");
  console.log("  2. Visit the storefront. Products and collections should render.");
  console.log("  3. Build the homepage in Settings → Storefront → Homepage.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("");
  console.error("Fatal:", err.message);
  if (err.stack) {
    console.error(err.stack.split("\n").slice(1, 4).join("\n"));
  }
  process.exit(1);
});