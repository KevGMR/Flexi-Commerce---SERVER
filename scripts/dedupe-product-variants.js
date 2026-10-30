require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

const APPLY = process.argv.includes('--apply');
const PRODUCT_HANDLE = 'moraa-skater-dress';

(async () => {
  const uri = process.env.PROD_MONGO_URI || process.env.MONGO_URI;
  await m.connect(uri, { tls: true, ssl: true, family: 4 });
  const db = m.connection.db;

  const product = await db.collection('products').findOne({ handle: PRODUCT_HANDLE });
  if (!product) { console.log('product not found'); process.exit(0); }
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Product: ${product.name}\n`);

  const variants = await db.collection('variants').find({ productId: product._id }).toArray();
  const variantIds = variants.map(v => v._id);
  const inv = await db.collection('inventories').find({ variantId: { $in: variantIds } }).toArray();

  const invByVariant = new Map();
  for (const i of inv) {
    const k = String(i.variantId);
    if (!invByVariant.has(k)) invByVariant.set(k, []);
    invByVariant.get(k).push(i);
  }

  const keyOf = (v) =>
    (v.selectedOptions || [])
      .map(o => `${o.name}=${o.value}`)
      .sort()
      .join('|');

  const groups = new Map();
  for (const v of variants) {
    const k = keyOf(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }

  for (const [k, group] of groups) {
    // (Add this at the top of the loop, before the dup-check)
    if (group.length === 1) {
      const v = group[0];
      if (!v.optionsKey && APPLY) {
        await db.collection('variants').updateOne(
          { _id: v._id },
          { $set: { optionsKey: k, updatedAt: new Date() } }
        );
      }
      continue;
    }
    console.log(`\n▸ ${k}`);

    const scored = group.map(v => {
      const rows = invByVariant.get(String(v._id)) || [];
      const totalAvail = rows.reduce((s, r) => s + (r.available || 0), 0);
      const totalOnHand = rows.reduce((s, r) => s + (r.onHand || 0), 0);
      return { v, totalAvail, totalOnHand, rows };
    });

    scored.sort((a, b) => {
      if (b.totalAvail !== a.totalAvail) return b.totalAvail - a.totalAvail;
      if ((b.v.status === 'active') - (a.v.status === 'active')) return (b.v.status === 'active' ? 1 : 0) - (a.v.status === 'active' ? 1 : 0);
      return 0;
    });

    const winner = scored[0];
    const losers = scored.slice(1);

    console.log(`  winner: ${winner.v.sku}  status=${winner.v.status}  avail=${winner.totalAvail}`);
    for (const l of losers) {
      console.log(`  loser : ${l.v.sku}  status=${l.v.status}  avail=${l.totalAvail}`);
    }

    if (!APPLY) continue;

    // Set optionsKey on the winner so the unique index applies to it
    await db.collection('variants').updateOne(
      { _id: winner.v._id },
      { $set: { optionsKey: k, updatedAt: new Date() } }
    );

    // Transfer inventory rows from losers to winner
    const locMap = new Map();
    for (const row of winner.rows) {
      locMap.set(String(row.locationId), row);
    }
    for (const l of losers) {
      for (const row of l.rows) {
        const locKey = String(row.locationId);
        const existing = locMap.get(locKey);
        if (existing) {
          await db.collection('inventories').updateOne(
            { _id: existing._id },
            {
              $inc: {
                onHand: row.onHand || 0,
                available: row.available || 0,
                committed: row.committed || 0,
                unavailable: row.unavailable || 0,
              },
              $set: { lastModified: new Date() },
            }
          );
        } else {
          await db.collection('inventories').insertOne({
            organizationId: row.organizationId,
            variantId: winner.v._id,
            locationId: row.locationId,
            onHand: row.onHand || 0,
            available: row.available || 0,
            committed: row.committed || 0,
            unavailable: row.unavailable || 0,
            lastModified: new Date(),
          });
        }
        await db.collection('inventories').deleteOne({ _id: row._id });
      }
    }

    // Ensure winner active, archive losers
    await db.collection('variants').updateOne(
      { _id: winner.v._id },
      { $set: { status: 'active', updatedAt: new Date() } }
    );
    await db.collection('variants').updateMany(
      { _id: { $in: losers.map(l => l.v._id) } },
      { $set: { status: 'archived', updatedAt: new Date() } }
    );
  }

  await m.disconnect();
  console.log(APPLY ? '\nDone.' : '\nDry run. Pass --apply to write.');
})();
