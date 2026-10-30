require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

(async () => {
  const uri = process.env.PROD_MONGO_URI || process.env.MONGO_URI;
  await m.connect(uri, { tls: true, ssl: true, family: 4 });
  const db = m.connection.db;

  const productId = new m.Types.ObjectId('6ad79132e6028fe791f5074a');
  const product = await db.collection('products').findOne({ _id: productId });
  if (!product) {
    console.log('product not found');
    process.exit(0);
  }

  console.log('PRODUCT:', product.name, '| status:', product.status, '| published:', product.published);

  const variants = await db
    .collection('variants')
    .find({ productId })
    .toArray();

  console.log('\nVARIANTS:', variants.length);
  for (const v of variants) {
    const opts = (v.selectedOptions || []).map((o) => o.value).join(' / ');
    console.log(
      ' ',
      (v.sku || 'no-sku').padEnd(28),
      '|',
      opts.padEnd(28),
      '| status:',
      v.status,
      '| track:',
      v.trackInventory !== false,
    );
  }

  const variantIds = variants.map((v) => v._id);
  const inv = await db
    .collection('inventories')
    .find({ variantId: { $in: variantIds } })
    .toArray();

  console.log('\nINVENTORY ROWS:', inv.length);

  // List every location that has rows for this product
  const locIds = [...new Set(inv.map((i) => String(i.locationId)))];
  const locs = await db
    .collection('locations')
    .find({ _id: { $in: locIds.map((id) => new m.Types.ObjectId(id)) } })
    .toArray();
  const locMap = new Map(locs.map((l) => [String(l._id), l.name]));

  const byVariant = new Map();
  for (const i of inv) {
    const key = String(i.variantId);
    if (!byVariant.has(key)) byVariant.set(key, []);
    byVariant.get(key).push(i);
  }

  for (const v of variants) {
    const opts = (v.selectedOptions || []).map((o) => o.value).join(' / ');
    const rows = byVariant.get(String(v._id)) || [];
    if (rows.length === 0) {
      console.log(' ', opts.padEnd(28), '| NO inventory rows');
    } else {
      for (const r of rows) {
        console.log(
          ' ',
          opts.padEnd(28),
          '|',
          String(locMap.get(String(r.locationId)) || r.locationId).padEnd(20),
          '| onHand:',
          r.onHand ?? '—',
          '| available:',
          r.available ?? '—',
        );
      }
    }
  }

  await m.disconnect();
})();
