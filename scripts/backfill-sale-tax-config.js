require("dotenv").config();
const mongoose = require("mongoose");

const Sale = require("../models/Sale");
const Location = require("../models/Location");
const Organization = require("../models/Organization");

const hasFlag = (flag) => process.argv.includes(flag);

const VALID_TAX_MODES = ["inclusive", "exclusive"];

const resolveTaxMode = ({ location, organization }) => {
  if (VALID_TAX_MODES.includes(location?.taxMode)) {
    return location.taxMode;
  }

  if (VALID_TAX_MODES.includes(organization?.settings?.taxMode)) {
    return organization.settings.taxMode;
  }

  return "inclusive";
};

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const stats = {
    salesScanned: 0,
    salesUpdated: 0,
    locationsMissing: 0,
    organizationsMissing: 0,
    modeUpdated: 0,
    rateUpdated: 0,
  };

  const locationCache = new Map();
  const orgCache = new Map();

  const cursor = Sale.find({
    $or: [{ taxMode: { $exists: false } }, { taxRateUsed: { $exists: false } }],
  })
    .select("organizationId locationId taxMode taxRateUsed")
    .cursor();

  for await (const sale of cursor) {
    stats.salesScanned += 1;

    const locationId = String(sale.locationId || "");
    const organizationId = String(sale.organizationId || "");

    let location = locationCache.get(locationId);
    if (location === undefined) {
      location = await Location.findById(sale.locationId)
        .select("taxRate taxMode")
        .lean();
      locationCache.set(locationId, location || null);
    }

    let organization = orgCache.get(organizationId);
    if (organization === undefined) {
      organization = await Organization.findById(sale.organizationId)
        .select("settings.taxMode")
        .lean();
      orgCache.set(organizationId, organization || null);
    }

    if (!location) {
      stats.locationsMissing += 1;
    }
    if (!organization) {
      stats.organizationsMissing += 1;
    }

    const effectiveTaxMode = resolveTaxMode({ location, organization });
    const effectiveTaxRate = Number(location?.taxRate) || 0;

    let hasChange = false;

    if (!VALID_TAX_MODES.includes(sale.taxMode)) {
      sale.taxMode = effectiveTaxMode;
      stats.modeUpdated += 1;
      hasChange = true;
    }

    if (sale.taxRateUsed === undefined || sale.taxRateUsed === null) {
      sale.taxRateUsed = effectiveTaxRate;
      stats.rateUpdated += 1;
      hasChange = true;
    }

    if (!hasChange) {
      continue;
    }

    stats.salesUpdated += 1;

    if (!dryRun) {
      await sale.save();
    }
  }

  console.log("\nBackfill sale tax config summary");
  console.table(stats);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  await mongoose.disconnect();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Backfill failed:", error.message);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect cleanly:", disconnectError.message);
    }
    process.exit(1);
  });
