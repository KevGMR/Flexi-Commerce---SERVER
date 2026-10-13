require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Organization = require("../models/Organization");

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { tls: true, ssl: true, family: 4 });

  const orgs = await Organization.find({})
    .select("name slug website.subdomain website.domain website.domainVerified status")
    .lean();

  console.log(`Found ${orgs.length} org(s):\n`);
  for (const o of orgs) {
    console.log(JSON.stringify({
      slug: o.slug,
      name: o.name,
      status: o.status,
      subdomain: o.website?.subdomain ?? "(not set)",
      domain: o.website?.domain ?? "(not set)",
      domainVerified: o.website?.domainVerified ?? false,
    }, null, 2));
    console.log("---");
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
