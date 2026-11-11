// server/scripts/sync-sale-indexes.js
//
// One-shot index migration for the Sale model.
// Run once after editing server/models/Sale.js to apply the
// partial-filter unique index on { organizationId, idempotencyKey }.
//
// Usage:  node server/scripts/sync-sale-indexes.js
//         (safe to re-run; idempotent)

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

(async () => {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    process.env.DB_URI;

  if (!uri) {
    console.error(
      "[sync-sale-indexes] No MongoDB URI found in env. " +
        "Checked: MONGODB_URI, MONGO_URI, DATABASE_URL, DB_URI",
    );
    process.exit(1);
  }

  // Mask credentials for the log line.
  const masked = uri.replace(/\/\/([^@]+)@/, "//***@");
  console.log("[sync-sale-indexes] connecting to", masked);

  try {
    await mongoose.connect(uri, {
        tls: true,
        ssl: true,
        family: 4,
        serverSelectionTimeoutMS: 10000 
    });
    console.log("[sync-sale-indexes] connected to db:", mongoose.connection.name);

    // Require AFTER connect — some models use connection-scoped plugins.
    const Sale = require("../models/Sale");

    // Show what's there now.
    let before = [];
    try {
      before = await Sale.collection.indexes();
      console.log("\n[sync-sale-indexes] BEFORE:");
      before.forEach((i) =>
        console.log(
          "  -",
          i.name,
          JSON.stringify(i.key),
          i.unique ? "(unique)" : "",
          i.partialFilterExpression
            ? `(partial: ${JSON.stringify(i.partialFilterExpression)})`
            : "",
        ),
      );
    } catch (e) {
      console.log("[sync-sale-indexes] could not list indexes:", e.message);
    }

    // Show what sync would do (non-destructive).
    try {
      const diff = await Sale.diffIndexes();
      console.log("\n[sync-sale-indexes] DIFF (what will change):");
      console.log("  drop:  ", diff.toDrop);
      console.log("  create:", diff.toCreate);
    } catch (e) {
      console.log("[sync-sale-indexes] diffIndexes failed:", e.message);
    }

    // Apply.
    const dropped = await Sale.syncIndexes();
    console.log("\n[sync-sale-indexes] syncIndexes result (dropped):", dropped);

    // Show the post state.
    const after = await Sale.collection.indexes();
    console.log("\n[sync-sale-indexes] AFTER:");
    after.forEach((i) =>
      console.log(
        "  -",
        i.name,
        JSON.stringify(i.key),
        i.unique ? "(unique)" : "",
        i.partialFilterExpression
          ? `(partial: ${JSON.stringify(i.partialFilterExpression)})`
          : "",
      ),
    );

    // Explicit verification: is the partial filter present on the compound index?
    const compound = after.find(
      (i) => i.name === "organizationId_1_idempotencyKey_1",
    );
    if (!compound) {
      console.error(
        "\n[sync-sale-indexes] ❌ compound index organizationId_1_idempotencyKey_1 is MISSING after sync",
      );
      process.exitCode = 1;
    } else if (!compound.partialFilterExpression) {
      console.error(
        "\n[sync-sale-indexes] ❌ compound index exists but has NO partialFilterExpression",
      );
      process.exitCode = 1;
    } else {
      console.log(
        "\n[sync-sale-indexes] ✅ compound index has partial filter:",
        JSON.stringify(compound.partialFilterExpression),
      );
    }
  } catch (err) {
    console.error("\n[sync-sale-indexes] FATAL:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit(process.exitCode || 0);
  }
})();