require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Collection = require("../models/Collection");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri, { tls: true, ssl: true, family: 4 });

  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node scripts/publish-all-products.js <org-slug>");
    process.exit(1);
  }

  const Organization = require("../models/Organization");
  const org = await Organization.findOne({ slug }).select("_id").lean();
  if (!org) {
    console.error(`Org not found: ${slug}`);
    process.exit(1);
  }

  const productResult = await Product.updateMany(
    { organizationId: org._id, status: "active", published: { $ne: true } },
    { $set: { published: true, publishedAt: new Date() } },
  );

  const collectionResult = await Collection.updateMany(
    { organizationId: org._id, status: "active", published: { $ne: true } },
    { $set: { published: true, publishedAt: new Date() } },
  );

  console.log(`\nOrg: ${slug} (${org._id})`);
  console.log(`  Products published:     ${productResult.modifiedCount}`);
  console.log(`  Collections published:  ${collectionResult.modifiedCount}`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
