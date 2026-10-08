#!/usr/bin/env node
/**
 * Storefront diagnostic script.
 *
 * Reproduces exactly what GET /storefront/products and
 * GET /storefront/collections do, but with verbose step-by-step output
 * so you can see where the query collapses to zero.
 *
 * Usage:
 *   node scripts/debug-storefront.js --slug <org-slug> [--location <id>] [--search <term>]
 *
 * Example:
 *   node scripts/debug-storefront.js --slug flexi-pos
 *   node scripts/debug-storefront.js --slug flexi-pos --search "shirt"
 *   node scripts/debug-storefront.js --slug flexi-pos --location 65abc...
 *
 * Requires the same env as the server (MONGO_URI).
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");

const Organization = require("../models/Organization");
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const Collection = require("../models/Collection");
const Inventory = require("../models/Inventory");
const Location = require("../models/Location");

// ---------- CLI args ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { slug: null, location: null, search: null };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];
    if (key === "--slug" && val) { out.slug = val; i++; }
    else if (key === "--location" && val) { out.location = val; i++; }
    else if (key === "--search" && val) { out.search = val; i++; }
  }
  return out;
}

// ---------- pretty printers ----------
const HR = "─".repeat(72);

function header(title) {
  console.log("\n" + HR);
  console.log("  " + title);
  console.log(HR);
}

function step(n, label) {
  console.log(`\n[${n}] ${label}`);
}

function ok(msg) {
  console.log(`    ✓ ${msg}`);
}

function warn(msg) {
  console.log(`    ⚠ ${msg}`);
}

function fail(msg) {
  console.log(`    ✗ ${msg}`);
}

function info(label, value) {
  console.log(`    ${label}: ${value}`);
}

// ---------- main ----------
async function main() {
  const { slug, location, search } = parseArgs();

  if (!slug) {
    console.error(
      "Missing required --slug <org-slug>. Example:\n" +
        "  node scripts/debug-storefront.js --slug flexi-pos",
    );
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI / MONGODB_URI is not set in .env");
    process.exit(1);
  }

  header("Storefront Diagnostic");
  console.log(`  Slug:     ${slug}`);
  console.log(`  Location: ${location || "(auto-resolve)"}`);
  console.log(`  Search:   ${search || "(none)"}`);

  await mongoose.connect(uri, { tls: true, ssl: true, family: 4 });
  console.log("\n  Connected to MongoDB.");

  // ---------- 1. Resolve org ----------
  step(1, "Resolve organization from slug");
  const org = await Organization.findOne({
    slug: String(slug).toLowerCase().trim(),
    status: "active",
  })
    .select("_id name slug settings website")
    .lean();

  if (!org) {
    fail("No organization found with that slug and status: 'active'");
    console.log(
      "\n    Check with:\n" +
        `      db.organizations.findOne({ slug: "${slug}" })\n`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  ok(`Found org: "${org.name}"`);
  info("_id", org._id.toString());
  info("slug", org.slug);
  info("currency", org.settings?.currency || "—");
  info("website.domain", org.website?.domain || "—");
  info("website.subdomain", org.website?.subdomain || "—");
  info("website.published", org.website?.published ?? "—");

  const organizationId = org._id;

  // ---------- 2. Resolve location ----------
  step(2, "Resolve location");

  let locationId = null;

  if (location && mongoose.Types.ObjectId.isValid(location)) {
    locationId = location;
    ok(`Using locationId from --location: ${locationId}`);
  } else {
    const defaultLoc = await Location.findOne({
      organizationId,
      isDefault: true,
      status: "active",
    })
      .select("_id name")
      .lean();

    if (defaultLoc) {
      locationId = defaultLoc._id;
      ok(`Using default Location: "${defaultLoc.name}"`);
      info("_id", defaultLoc._id.toString());
    } else {
      const firstActive = await Location.findOne({
        organizationId,
        status: "active",
      })
        .select("_id name")
        .lean();

      if (firstActive) {
        locationId = firstActive._id;
        ok(`No default set. Using first active: "${firstActive.name}"`);
        info("_id", firstActive._id.toString());
      } else {
        warn("No active Location found for this org");
        warn("Availability will be empty for all variants");
      }
    }
  }

  // ---------- 3. Product counts (progressive filter) ----------
  step(3, "Product counts — progressive filter");

  const total = await Product.countDocuments({ organizationId });
  info("total in org", total);

  const activeOnly = await Product.countDocuments({
    organizationId,
    status: "active",
  });
  info("+ status: 'active'", activeOnly);

  const publishedOnly = await Product.countDocuments({
    organizationId,
    status: "active",
    published: true,
  });
  info("+ published: true", publishedOnly);

  console.log();
  if (publishedOnly > 0) {
    ok(`Storefront will return ${publishedOnly} product(s)`);
  } else if (activeOnly > 0) {
    fail("Products exist but none are published: true");
    console.log(
      "\n    To publish them:\n" +
        `      db.products.updateMany(\n` +
        `        { organizationId: ObjectId("${organizationId}"), status: "active" },\n` +
        `        { $set: { published: true, publishedAt: new Date() } }\n` +
        `      )\n`,
    );
  } else if (total > 0) {
    fail("Products exist but none have status: 'active'");
    console.log(
      "\n    Check statuses:\n" +
        `      db.products.aggregate([\n` +
        `        { $match: { organizationId: ObjectId("${organizationId}") } },\n` +
        `        { $group: { _id: "$status", count: { $sum: 1 } } }\n` +
        `      ])\n`,
    );
  } else {
    fail("No products at all for this organization");
    warn("Either products belong to a different org, or none exist yet");
  }

  // ---------- 4. Status breakdown ----------
  step(4, "Status breakdown");

  const statusBreakdown = await Product.aggregate([
    { $match: { organizationId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (statusBreakdown.length === 0) {
    warn("No products to break down");
  } else {
    for (const row of statusBreakdown) {
      info(row._id || "(missing)", row.count);
    }
  }

  // ---------- 5. Published breakdown ----------
  step(5, "Published flag breakdown");

  const publishedBreakdown = await Product.aggregate([
    { $match: { organizationId } },
    { $group: { _id: "$published", count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]);

  if (publishedBreakdown.length === 0) {
    warn("No products to break down");
  } else {
    for (const row of publishedBreakdown) {
      const label = row._id === true ? "true" : row._id === false ? "false" : "(missing)";
      info(label, row.count);
    }
  }

  // ---------- 6. Sample products ----------
  step(6, "Sample products (first 5 in org, any status)");

  const sample = await Product.find({ organizationId })
    .select("_id name sku status published handle variants")
    .limit(5)
    .lean();

  if (sample.length === 0) {
    warn("No products to sample");
  } else {
    for (const p of sample) {
      console.log(
        `    • ${p.name}  [${p.status}${p.published ? " / published" : " / unpublished"}]`,
      );
      info("  _id", p._id.toString());
      info("  sku", p.sku || "—");
      info("  handle", p.handle || "—");
    }
  }

  // ---------- 7. Duplicate handle check ----------
  step(7, "Duplicate handle check");

  const dupHandles = await Product.aggregate([
    { $match: { organizationId, handle: { $ne: null } } },
    { $group: { _id: "$handle", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (dupHandles.length === 0) {
    ok("No duplicate handles");
  } else {
    fail(`${dupHandles.length} handle(s) with duplicates`);
    for (const row of dupHandles.slice(0, 10)) {
      info(row._id, `${row.count} products`);
    }
  }

  // ---------- 8. Variants ----------
  step(8, "Variants");

  const variantTotal = await Variant.countDocuments({ organizationId });
  info("total in org", variantTotal);

  const variantActive = await Variant.countDocuments({
    organizationId,
    status: "active",
  });
  info("+ status: 'active'", variantActive);

  const trackedVariants = await Variant.countDocuments({
    organizationId,
    status: "active",
    trackInventory: { $ne: false },
  });
  info("+ trackInventory !== false", trackedVariants);

  // ---------- 9. Inventory ----------
  step(9, "Inventory");

  if (locationId) {
    const invCount = await Inventory.countDocuments({
      organizationId,
      locationId,
    });
    info("docs at resolved location", invCount);

    if (invCount > 0) {
      const positive = await Inventory.countDocuments({
        organizationId,
        locationId,
        available: { $gt: 0 },
      });
      info("with available > 0", positive);

      const zeroOrNeg = await Inventory.countDocuments({
        organizationId,
        locationId,
        available: { $lte: 0 },
      });
      info("with available <= 0", zeroOrNeg);
    }
  } else {
    warn("No location resolved — skipping inventory checks");
  }

  // ---------- 10. Collections ----------
  step(10, "Collections");

  const colTotal = await Collection.countDocuments({ organizationId });
  info("total in org", colTotal);

  const colActive = await Collection.countDocuments({
    organizationId,
    status: "active",
  });
  info("+ status: 'active'", colActive);

  const colPublished = await Collection.countDocuments({
    organizationId,
    status: "active",
    published: true,
  });
  info("+ published: true", colPublished);

  if (colPublished > 0) {
    ok(`Storefront will return ${colPublished} collection(s)`);
  } else if (colActive > 0) {
    fail("Collections exist but none are published: true");
    console.log(
      "\n    To publish them:\n" +
        `      db.collections.updateMany(\n` +
        `        { organizationId: ObjectId("${organizationId}"), status: "active" },\n` +
        `        { $set: { published: true, publishedAt: new Date() } }\n` +
        `      )\n`,
    );
  } else if (colTotal > 0) {
    fail("Collections exist but none have status: 'active'");
  } else {
    warn("No collections for this organization");
  }

  // ---------- 11. Search filter (if provided) ----------
  if (search && search.trim()) {
    step(11, `Search filter simulation: "${search}"`);

    const q = search.trim();
    const searchQuery = {
      organizationId,
      status: "active",
      published: true,
      $or: [
        { name: new RegExp(q, "i") },
        { sku: new RegExp(q, "i") },
        { tags: new RegExp(q, "i") },
        { vendor: new RegExp(q, "i") },
      ],
    };

    const searchCount = await Product.countDocuments(searchQuery);
    info("matches", searchCount);

    if (searchCount === 0) {
      warn("Search filters everything out — try a different term");
    } else {
      const matches = await Product.find(searchQuery)
        .select("_id name sku")
        .limit(5)
        .lean();
      for (const p of matches) {
        console.log(`    • ${p.name}  (${p.sku || "no sku"})`);
      }
    }
  }

  // ---------- 12. Final simulation ----------
  step(12, "Simulate the actual storefront query");

  const finalQuery = {
    organizationId,
    status: "active",
    published: true,
  };

  const finalCount = await Product.countDocuments(finalQuery);
  info("would return", finalCount);

  if (finalCount > 0) {
    const preview = await Product.find(finalQuery)
      .select("_id name sku handle published")
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();

    console.log("\n    First 3 results the storefront would see:");
    for (const p of preview) {
      console.log(`      • ${p.name}  (handle: ${p.handle || "—"})`);
    }

    ok("Storefront endpoint should return data");
    console.log(
      "\n    If the endpoint still returns empty, check that the org slug\n" +
        "    and X-Storefront-Key headers exactly match what this script used.",
    );
  } else {
    fail("Storefront endpoint would return empty");
    console.log(
      "\n    Root cause is in the data, not the code.\n" +
        "    Fix the data (publish products / activate them / etc.) and retry.",
    );
  }

  // ---------- summary ----------
  header("Summary");

  const diagnosis = [];
  if (!org) diagnosis.push("Org not found — check --slug");
  else {
    if (total === 0) diagnosis.push("No products for this org");
    else {
      if (activeOnly === 0) diagnosis.push("Products exist but none are status: 'active'");
      else if (publishedOnly === 0) diagnosis.push("Products are active but none are published: true");
    }

    if (colTotal === 0) diagnosis.push("No collections for this org (optional)");
    else if (colActive === 0) diagnosis.push("Collections exist but none are status: 'active'");
    else if (colPublished === 0) diagnosis.push("Collections are active but none are published: true");

    if (variantTotal === 0) diagnosis.push("No variants for this org");
    else if (variantActive === 0) diagnosis.push("Variants exist but none are status: 'active'");

    if (locationId && (await Inventory.countDocuments({ organizationId, locationId })) === 0) {
      diagnosis.push("No inventory docs at the resolved location — all availabilities will be 0");
    }
  }

  if (diagnosis.length === 0) {
    console.log("  ✓ No obvious data issues found.");
    console.log("  Endpoint should return data. If it doesn't, the problem is");
    console.log("  in the request headers, middleware, or route registration.");
  } else {
    for (const line of diagnosis) {
      console.log("  • " + line);
    }
  }

  console.log();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});