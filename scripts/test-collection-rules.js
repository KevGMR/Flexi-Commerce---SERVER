// server/scripts/test-collection-rules.js
require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGO_URI not set. Check server/.env");
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    tls: true,
    ssl: true,
    family: 4,
  });

  const Product = require("../models/Product");
  const Variant = require("../models/Variant");
  const Inventory = require("../models/Inventory");
  const {
    evaluateRuleSet,
    validateRule,
  } = require("../services/collectionRules");

  // -------------------------------------------------------------------------
  // Pick a product with variants AND inventory so location-aware tests run
  // -------------------------------------------------------------------------
  const candidates = await Product.find({
    type: "physical",
    status: { $in: ["active", "draft", "unlisted"] },
  })
    .limit(50)
    .lean();

  let product = null;
  let variants = [];
  let inventory = [];

  for (const candidate of candidates) {
    const vs = await Variant.find({
      productId: candidate._id,
      status: { $ne: "archived" },
    }).lean();

    if (vs.length === 0) continue;

    const inv = await Inventory.find({
      variantId: { $in: vs.map((v) => v._id) },
    }).lean();

    if (inv.length === 0) continue;

    product = candidate;
    variants = vs;
    inventory = inv;
    break;
  }

  if (!product) {
    console.log(
      "No physical product with variants + inventory found. Create one via the product form first.",
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  // Build variantId → locationId → inventoryRow map
  const invMap = new Map();
  for (const inv of inventory) {
    const k = String(inv.variantId);
    if (!invMap.has(k)) invMap.set(k, new Map());
    invMap.get(k).set(String(inv.locationId), inv);
  }

  console.log("=".repeat(60));
  console.log(`Product: ${product.name}`);
  console.log(`  type:      ${product.type}`);
  console.log(`  status:    ${product.status}`);
  console.log(`  price:     ${product.price}`);
  console.log(`  variants:  ${variants.length}`);
  console.log(`  inventory: ${inventory.length} row(s) across ${invMap.size} variant(s)`);
  console.log("=".repeat(60));

  // -------------------------------------------------------------------------
  // Test 1: product-scoped
  // -------------------------------------------------------------------------
  const r1 = {
    scope: "product",
    field: "status",
    operator: "equals",
    value: "active",
  };
  console.log(
    `1. status = active →`,
    evaluateRuleSet(product, variants, invMap, [r1], "AND"),
  );

  // -------------------------------------------------------------------------
  // Test 2: variant-scoped "any"
  // -------------------------------------------------------------------------
  const r2 = {
    scope: "variant",
    quantifier: "any",
    field: "price",
    operator: "greater_than",
    value: 0,
  };
  console.log(
    `2. any variant price > 0 →`,
    evaluateRuleSet(product, variants, invMap, [r2], "AND"),
  );

  // -------------------------------------------------------------------------
  // Test 3: variant-scoped "count" with filter + count comparison
  // -------------------------------------------------------------------------
  const r3 = {
    scope: "variant",
    quantifier: "count",
    field: "price",
    operator: "greater_than",
    value: 0,
    countOperator: "greater_than_or_equal",
    countValue: 1,
  };
  console.log(
    `3. count(price>0) >= 1 →`,
    evaluateRuleSet(product, variants, invMap, [r3], "AND"),
  );

  // Test 3b: count with trivial threshold
  const r3b = {
    scope: "variant",
    quantifier: "count",
    field: "sku",
    operator: "is_set",
    value: null,
    countOperator: "greater_than_or_equal",
    countValue: 0,
  };
  console.log(
    `3b. count(has sku) >= 0 →`,
    evaluateRuleSet(product, variants, invMap, [r3b], "AND"),
  );

  // Test 3c: count filter that should fail on some products
  const r3c = {
    scope: "variant",
    quantifier: "count",
    field: "price",
    operator: "greater_than",
    value: 1000000,
    countOperator: "greater_than_or_equal",
    countValue: 1,
  };
  console.log(
    `3c. count(price>1000000) >= 1 →`,
    evaluateRuleSet(product, variants, invMap, [r3c], "AND"),
  );

  // -------------------------------------------------------------------------
  // Test 4: location-aware "any location"
  // -------------------------------------------------------------------------
  const r4 = {
    scope: "variant",
    quantifier: "any",
    field: "availableAtLocation",
    operator: "greater_than",
    value: 0,
    locationScope: "any",
  };
  console.log(
    `4.  in stock at any location →`,
    evaluateRuleSet(product, variants, invMap, [r4], "AND"),
  );

  // -------------------------------------------------------------------------
  // Test 4b: location-aware with negative availability (should return false)
  // -------------------------------------------------------------------------
  const r4b = {
    scope: "variant",
    quantifier: "any",
    field: "availableAtLocation",
    operator: "less_than",
    value: -99999,
    locationScope: "any",
  };
  console.log(
    `4b. available < -99999 at any location →`,
    evaluateRuleSet(product, variants, invMap, [r4b], "AND"),
  );

  // -------------------------------------------------------------------------
  // Test 5: validation rejects unknown fields
  // -------------------------------------------------------------------------
  try {
    validateRule({
      scope: "product",
      field: "nonexistent",
      operator: "equals",
      value: 1,
    });
    console.log(`5.  validation did NOT throw (bug)`);
  } catch (err) {
    console.log(`5.  validation threw as expected: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Test 5b: validation rejects location field with wrong scope
  // -------------------------------------------------------------------------
  try {
    validateRule({
      scope: "product",
      field: "availableAtLocation",
      operator: "greater_than",
      value: 0,
    });
    console.log(`5b. validation did NOT throw (bug)`);
  } catch (err) {
    console.log(`5b. validation threw as expected: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Test 5c: validation rejects count quantifier without countOperator
  // -------------------------------------------------------------------------
  try {
    validateRule({
      scope: "variant",
      quantifier: "count",
      field: "price",
      operator: "greater_than",
      value: 0,
    });
    console.log(`5c. validation did NOT throw (bug)`);
  } catch (err) {
    console.log(`5c. validation threw as expected: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Test 6: AND vs OR logic
  // -------------------------------------------------------------------------
  const alwaysTrue = {
    scope: "product",
    field: "status",
    operator: "is_set",
    value: null,
  };
  const alwaysFalse = {
    scope: "product",
    field: "vendor",
    operator: "equals",
    value: "__nonexistent_vendor__",
  };

  console.log(
    `6.  [true AND false] →`,
    evaluateRuleSet(product, variants, invMap, [alwaysTrue, alwaysFalse], "AND"),
  );
  console.log(
    `6b. [true OR false]  →`,
    evaluateRuleSet(product, variants, invMap, [alwaysTrue, alwaysFalse], "OR"),
  );

  console.log("=".repeat(60));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});