require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { tls: true, ssl: true, family: 4 });

  const coll = mongoose.connection.collection("sales");

  // List indexes so you can see what exists
  const indexes = await coll.indexes();
  console.log("\nCurrent indexes on sales:");
  for (const idx of indexes) {
    console.log(`  ${idx.name}  ${JSON.stringify(idx.key)}  ${idx.unique ? "UNIQUE" : ""} ${idx.partialFilterExpression ? "PARTIAL: " + JSON.stringify(idx.partialFilterExpression) : ""}`);
  }

  // Drop the offending index by its known name
  const targetName = "organizationId_1_idempotencyKey_1";
  if (indexes.find((i) => i.name === targetName)) {
    await coll.dropIndex(targetName);
    console.log(`\nDropped index: ${targetName}`);
  } else {
    console.log(`\nIndex ${targetName} not found — nothing to drop`);
  }

  // Also clean up any existing storefront sales with null idempotencyKey
  // that might have been rejected. (Normally not needed, but safe.)
  const nullKeyCount = await coll.countDocuments({ idempotencyKey: null });
  console.log(`\nDocuments with idempotencyKey: null — ${nullKeyCount}`);

  console.log("\nRestart your server now. Mongoose will recreate the index with the new partialFilterExpression.");

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
