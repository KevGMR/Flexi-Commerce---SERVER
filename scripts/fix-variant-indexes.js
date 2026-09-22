// server/scripts/fix-variant-indexes.js
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri, {
    tls: true,
    ssl: true,
    family: 4 
  });
  console.log("connected");

  const coll = mongoose.connection.collection("variants");

  // Drop the broken index if it exists
  try {
    await coll.dropIndex("organizationId_1_shopifyNumericId_1");
    console.log("dropped organizationId_1_shopifyNumericId_1");
  } catch (err) {
    console.log("drop skipped:", err.message);
  }

  // Recreate as a partial index that only applies when the field is a real number
  await coll.createIndex(
    { organizationId: 1, shopifyNumericId: 1 },
    {
      unique: true,
      partialFilterExpression: { shopifyNumericId: { $type: "number" } },
      name: "organizationId_1_shopifyNumericId_1",
    }
  );
  console.log("recreated as partial index");

  const productColl = mongoose.connection.collection("products");
try {
  await productColl.dropIndex("organizationId_1_shopifyNumericId_1");
  console.log("dropped products index");
} catch (err) {
  console.log("drop skipped:", err.message);
}
await productColl.createIndex(
  { organizationId: 1, shopifyNumericId: 1 },
  {
    unique: true,
    partialFilterExpression: { shopifyNumericId: { $type: "number" } },
    name: "organizationId_1_shopifyNumericId_1",
  }
);
console.log("recreated products index as partial");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});