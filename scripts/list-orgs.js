require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const Product = require("../models/Product");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri, { tls: true, ssl: true, family: 4 });

  const orgs = await Organization.find({})
    .select("_id name slug status createdAt")
    .sort({ createdAt: 1 })
    .lean();

  console.log("\nOrgs and their product counts:\n");
  for (const o of orgs) {
    const count = await Product.countDocuments({ organizationId: o._id });
    const active = await Product.countDocuments({ organizationId: o._id, status: "active" });
    const published = await Product.countDocuments({
      organizationId: o._id,
      status: "active",
      published: true,
    });
    console.log(
      `  ${o.slug.padEnd(30)} | ${String(count).padStart(5)} products` +
        ` | ${String(active).padStart(5)} active` +
        ` | ${String(published).padStart(5)} published` +
        ` | ${o.name}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
