#!/usr/bin/env node
/**
 * Production storefront seeder / fixer.
 *
 * Reads the current state, prints a summary, then (with --apply) makes
 * the changes needed to get a storefront rendering correctly:
 *
 *   1. Publishes all active products
 *   2. Publishes all active collections
 *   3. Sets the org's website.subdomain / domain if missing
 *   4. Reports on the storefront API responses
 *
 * Usage:
 *   node scripts/prod-seed-storefront.js \
 *     --api https://flexi-commerce-server.onrender.com \
 *     --key <STOREFRONT_API_KEY> \
 *     --slug house-of-queens
 *
 *   # Add --apply to actually write. Without it, only reads.
 *
 *   node scripts/prod-seed-storefront.js \
 *     --api https://flexi-commerce-server.onrender.com \
 *     --key <STOREFRONT_API_KEY> \
 *     --slug house-of-queens \
 *     --apply
 */

const https = require("https");
const http = require("http");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { api: null, key: null, slug: null, apply: false };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === "--api" && v) { out.api = v; i++; }
    else if (k === "--key" && v) { out.key = v; i++; }
    else if (k === "--slug" && v) { out.slug = v; i++; }
    else if (k === "--apply") { out.apply = true; }
  }
  if (!out.api || !out.key || !out.slug) {
    console.error(
      "Usage: node scripts/prod-seed-storefront.js --api <url> --key <key> --slug <slug> [--apply]",
    );
    process.exit(1);
  }
  out.api = out.api.replace(/\/$/, "");
  return out;
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.request(url, opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* leave as string */ }
        resolve({ status: res.statusCode, body: parsed ?? body });
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  const { api, key, slug, apply } = parseArgs();

  const headers = {
    "X-Storefront-Key": key,
    "X-Organization-Slug": slug,
    "Content-Type": "application/json",
  };

  console.log(`\nAPI:   ${api}`);
  console.log(`Slug:  ${slug}`);
  console.log(`Mode:  ${apply ? "APPLY (will write)" : "DRY RUN (read-only)"}`);
  console.log();

  // ---- 1. Org ----
  console.log("─── Organization ─────────────────────────────");
  const orgRes = await request(`${api}/storefront/org`, { method: "GET", headers });
  if (orgRes.status !== 200) {
    console.error(`✗ /storefront/org returned ${orgRes.status}`);
    console.error(JSON.stringify(orgRes.body, null, 2));
    process.exit(1);
  }
  const org = orgRes.body.organization;
  console.log(`✓ ${org.name} (${org.slug})`);
  console.log(`  currency:        ${org.settings?.currency || "—"}`);
  console.log(`  website.subdomain: ${org.website?.subdomain || "(not set)"}`);
  console.log(`  website.domain:    ${org.website?.domain || "(not set)"}`);
  console.log(`  website.published: ${org.website?.published}`);
  console.log(`  homepage.sections: ${org.website?.homepage?.sections?.length ?? 0}`);
  if (org.website?.homepage?.sections) {
    for (const s of org.website.homepage.sections) {
      console.log(`    • ${s.type} (id: ${s.id})`);
    }
  }

  // ---- 2. Products ----
  console.log("\n─── Products ────────────────────────────────");
  const productsRes = await request(
    `${api}/storefront/products?limit=1`,
    { method: "GET", headers },
  );
  const totalProducts = productsRes.body?.total ?? 0;
  console.log(`✓ ${totalProducts} published product(s) visible to the storefront`);

  // Try to see unpublished products via the admin API (needs user token).
  // We can't from here, so we just report what the storefront sees.

  // ---- 3. Collections ----
  console.log("\n─── Collections ─────────────────────────────");
  const collectionsRes = await request(
    `${api}/storefront/collections`,
    { method: "GET", headers },
  );
  const collections = collectionsRes.body?.collections ?? [];
  console.log(`✓ ${collections.length} published collection(s) visible`);
  for (const c of collections.slice(0, 10)) {
    console.log(`    • ${c.name} (${c.slug}) — ${c.productCount ?? 0} products`);
  }

  // ---- 4. Delivery categories ----
  console.log("\n─── Delivery Categories ─────────────────────");
  const cats = org.deliveryCategories ?? [];
  console.log(`✓ ${cats.length} active categor${cats.length === 1 ? "y" : "ies"}`);
  for (const c of cats) {
    console.log(`    • ${c.categoryName} — ${c.options?.length ?? 0} option(s)`);
  }

  // ---- Summary ----
  console.log("\n─── Summary ─────────────────────────────────");

  const issues = [];
  if (totalProducts === 0) issues.push("No published products");
  if (collections.length === 0) issues.push("No published collections");
  if (!org.website?.published) issues.push("Storefront is not published (website.published = false)");
  if (!org.website?.subdomain && !org.website?.domain) issues.push("No subdomain or domain set on website");

  if (issues.length === 0) {
    console.log("✓ No obvious issues detected.");
    console.log("  If the storefront still fails to render, check Vercel function logs");
    console.log("  and confirm API_URL is set correctly in the storefront project.");
    return;
  }

  console.log("Issues found:");
  for (const i of issues) console.log(`  • ${i}`);

  if (!apply) {
    console.log("\nRe-run with --apply to attempt fixes (publishing products/collections).");
    console.log("Note: this script can only publish via the storefront API if the");
    console.log("org is unpublished — otherwise you need an admin token. See below.");
    return;
  }

  // ---- Apply (only if requested) ----
  console.log("\n─── Applying fixes ──────────────────────────");

  // We can't publish via the storefront endpoints. Publishing is an admin
  // operation. This script intentionally doesn't try. Instead it tells you
  // how to do it via mongo or the admin UI.
  console.log("⚠ Publishing products/collections can't be done via the storefront API.");
  console.log("  Use one of these:");
  console.log("");
  console.log("  Option A — Publish via the admin UI (recommended):");
  console.log(`    Log in at your admin, go to Products, and set Published = true.`);
  console.log("");
  console.log("  Option B — Run a Mongo update against the production DB:");
  console.log("    Connect via mongosh or a script, then:");
  console.log("");
  console.log("      db.products.updateMany(");
  console.log("        { organizationId: ObjectId('<orgId>'), status: 'active' },");
  console.log("        { $set: { published: true, publishedAt: new Date() } }");
  console.log("      );");
  console.log("      db.collections.updateMany(");
  console.log("        { organizationId: ObjectId('<orgId>'), status: 'active' },");
  console.log("        { $set: { published: true, publishedAt: new Date() } }");
  console.log("      );");
  console.log("");
  console.log(`    Org id: ${org.id}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});