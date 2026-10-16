#!/usr/bin/env node
/**
 * Batch A migration.
 *   1. Add paymentMethods to every Organization that doesn't have them.
 *   2. Ensure Location.paymentMethods defaults to [] and mpesaStkEnabled
 *      to null on every location (Mongoose defaults handle this on write,
 *      but existing docs need an explicit pass to make queries reliable).
 *   3. Verify all DeliveryFee docs have saleId populated.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   node scripts/migrate-batch-a.js              # dry run
 *   node scripts/migrate-batch-a.js --apply      # write
 */

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const uri = process.env.PROD_MONGO_URI;
if (!uri) {
  console.error("PROD_MONGO_URI not set in server/.env");
  process.exit(1);
}
const isLocal = /localhost|127\.0\.0\.1/.test(uri);
if (isLocal && !process.argv.includes("--force-local")) {
  console.error("PROD_MONGO_URI looks local. Pass --force-local to override.");
  process.exit(1);
}

const { defaultOrgPaymentMethods } = require("../models/PaymentMethod");

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
  const locations = db.collection("locations");
  const deliveryfees = db.collection("deliveryfees");

  // 1. Orgs without paymentMethods
  const orgsNeeding = await orgs.countDocuments({
    $or: [
      { paymentMethods: { $exists: false } },
      { paymentMethods: { $size: 0 } },
    ],
  });
  console.log(`Orgs without paymentMethods: ${orgsNeeding}`);
  if (APPLY && orgsNeeding > 0) {
    const res = await orgs.updateMany(
      {
        $or: [
          { paymentMethods: { $exists: false } },
          { paymentMethods: { $size: 0 } },
        ],
      },
      { $set: { paymentMethods: defaultOrgPaymentMethods() } },
    );
    console.log(`  → updated ${res.modifiedCount}`);
  }

  // 2. Orgs without daraja.mpesaStkEnabled
  const orgsNeedingStk = await orgs.countDocuments({
    "daraja.mpesaStkEnabled": { $exists: false },
  });
  console.log(`Orgs without daraja.mpesaStkEnabled: ${orgsNeedingStk}`);
  if (APPLY && orgsNeedingStk > 0) {
    const res = await orgs.updateMany(
      { "daraja.mpesaStkEnabled": { $exists: false } },
      { $set: { "daraja.mpesaStkEnabled": false } },
    );
    console.log(`  → updated ${res.modifiedCount}`);
  }

  // 3. Locations without paymentMethods (empty array is fine, but absent is not)
  const locsNeeding = await locations.countDocuments({
    paymentMethods: { $exists: false },
  });
  console.log(`Locations without paymentMethods field: ${locsNeeding}`);
  if (APPLY && locsNeeding > 0) {
    const res = await locations.updateMany(
      { paymentMethods: { $exists: false } },
      { $set: { paymentMethods: [] } },
    );
    console.log(`  → updated ${res.modifiedCount}`);
  }

  // 4. Locations without mpesaStkEnabled
  const locsNeedingStk = await locations.countDocuments({
    mpesaStkEnabled: { $exists: false },
  });
  console.log(`Locations without mpesaStkEnabled field: ${locsNeedingStk}`);
  if (APPLY && locsNeedingStk > 0) {
    const res = await locations.updateMany(
      { mpesaStkEnabled: { $exists: false } },
      { $set: { mpesaStkEnabled: null } },
    );
    console.log(`  → updated ${res.modifiedCount}`);
  }

  // 5. DeliveryFee docs missing saleId (should be zero, but verify)
  const dfMissing = await deliveryfees.countDocuments({ saleId: { $exists: false } });
  const dfTotal = await deliveryfees.countDocuments({});
  console.log(`DeliveryFees total: ${dfTotal}  missing saleId: ${dfMissing}`);
  if (dfMissing > 0) {
    console.log(
      "  ! Some DeliveryFees have no saleId. They may be standalone deliveries.",
    );
  }

  await mongoose.disconnect();
  console.log(APPLY ? "\nDone (applied)." : "\nDone (dry run — pass --apply to write).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});