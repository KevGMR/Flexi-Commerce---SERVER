#!/usr/bin/env node
/**
 * Batch A part 2 — move Organization.paymentMethods into website.paymentMethods.
 *
 * Idempotent: re-running is safe. If a doc already has website.paymentMethods
 * and no top-level paymentMethods, it's skipped. If both exist, website wins
 * and the top-level is unset.
 *
 * Usage:
 *   node scripts/migrate-batch-a2.js           # dry run
 *   node scripts/migrate-batch-a2.js --apply   # write
 */

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const uri = process.env.PROD_MONGO_URI;
if (!uri) {
  console.error("PROD_MONGO_URI not set");
  process.exit(1);
}
const isLocal = /localhost|127\.0\.0\.1/.test(uri);
if (isLocal && !process.argv.includes("--force-local")) {
  console.error("PROD_MONGO_URI looks local. Pass --force-local to override.");
  process.exit(1);
}

(async () => {
  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);
  console.log(`URI:  ${isLocal ? "LOCAL" : "REMOTE (prod)"}\n`);

  await mongoose.connect(uri, {
    tls: true,
    ssl: true,
    family: 4 
  });
  const db = mongoose.connection.db;
  const orgs = db.collection("organizations");

  const all = await orgs.find({}).toArray();
  let moved = 0;
  let skipped = 0;
  let conflicted = 0;

  for (const org of all) {
    const topLevel = org.paymentMethods;
    const nested = org.website?.paymentMethods;

    const hasTop = Array.isArray(topLevel) && topLevel.length > 0;
    const hasNested = Array.isArray(nested) && nested.length > 0;

    if (hasNested && !hasTop) {
      skipped += 1;
      console.log(`  ${org.website?.subdomain || org._id}  already migrated`);
      continue;
    }

    if (hasNested && hasTop) {
      conflicted += 1;
      console.log(
        `  ${org.website?.subdomain || org._id}  conflict: both exist, keeping website`,
      );
      if (APPLY) {
        await orgs.updateOne(
          { _id: org._id },
          { $unset: { paymentMethods: "" } },
        );
      }
      continue;
    }

    if (!hasTop) {
      skipped += 1;
      console.log(
        `  ${org.website?.subdomain || org._id}  nothing to move (empty top-level)`,
      );
      continue;
    }

    console.log(
      `  ${org.website?.subdomain || org._id}  moving ${topLevel.length} methods`,
    );
    if (APPLY) {
      await orgs.updateOne(
        { _id: org._id },
        {
          $set: { "website.paymentMethods": topLevel },
          $unset: { paymentMethods: "" },
        },
      );
    }
    moved += 1;
  }

  console.log(
    `\nSummary: ${all.length} orgs — ${moved} to move, ${skipped} skipped, ${conflicted} conflicts`,
  );

  await mongoose.disconnect();
  console.log(APPLY ? "Done (applied)." : "Done (dry run — pass --apply to write).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});