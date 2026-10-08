require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Organization = require("../models/Organization");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri, { tls: true, ssl: true, family: 4 });

  const [slug, subdomain] = process.argv.slice(2);
  if (!slug || !subdomain) {
    console.error("Usage: node scripts/set-org-subdomain.js <slug> <subdomain>");
    process.exit(1);
  }

  const res = await Organization.updateOne(
    { slug },
    { $set: { "website.subdomain": subdomain } },
  );

  console.log(`Updated ${res.modifiedCount} org. ${slug} → subdomain: ${subdomain}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
