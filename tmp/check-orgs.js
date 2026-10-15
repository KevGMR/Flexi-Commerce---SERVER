const dns = require('dns');
dns.setServers(['8.8.8.8','1.1.1.1']);
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.PROD_MONGO_URI;
if (!uri) { console.error('PROD_MONGO_URI not set'); process.exit(1); }
const remote = !/localhost|127\.0\.0\.1/.test(uri);
console.log('Connecting to', remote ? 'REMOTE (prod)' : 'LOCAL', '...');

(async () => {
  await mongoose.connect(uri);
  const Org = mongoose.connection.collection('organizations');
  const Collection = mongoose.connection.collection('collections');
  const Product = mongoose.connection.collection('products');

  const orgs = await Org.find({})
    .project({ name: 1, 'website.subdomain': 1, 'website.published': 1, _id: 1 })
    .toArray();

  console.log('\nORGS:');
  for (const o of orgs) {
    const slug = o.website?.subdomain;
    const pub = o.website?.published;
    const cTotal = await Collection.countDocuments({ organizationId: o._id });
    const cPub   = await Collection.countDocuments({ organizationId: o._id, published: true });
    const pTotal = await Product.countDocuments({ organizationId: o._id });
    const pPub   = await Product.countDocuments({ organizationId: o._id, published: true, status: 'active' });
    console.log(`  ${slug || '(no subdomain)'}  [${o.name}]  websitePublished=${pub}`);
    console.log(`     collections: ${cPub}/${cTotal} published   products(active+published): ${pPub}/${pTotal}`);
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
