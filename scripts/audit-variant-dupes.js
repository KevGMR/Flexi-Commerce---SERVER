require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

(async () => {
  const uri = process.env.PROD_MONGO_URI || process.env.MONGO_URI;
  await m.connect(uri, { tls: true, ssl: true, family: 4 });
  const db = m.connection.db;

  const products = await db.collection('products').find({}).toArray();
  const variants = await db.collection('variants').find({}).toArray();

  // Bucket variants by (productId, optionTuple)
  const byProduct = new Map();
  for (const v of variants) {
    const pid = String(v.productId);
    if (!byProduct.has(pid)) byProduct.set(pid, new Map());
    const tuple = (v.selectedOptions || [])
      .map((o) => `${o.name}=${o.value}`)
      .sort()
      .join('|');
    if (!byProduct.get(pid).has(tuple)) byProduct.get(pid).set(tuple, []);
    byProduct.get(pid).get(tuple).push(v);
  }

  const productById = new Map(products.map((p) => [String(p._id), p]));

  const invRows = await db.collection('inventories').find({}).toArray();
  const invByVariant = new Map();
  for (const r of invRows) {
    const k = String(r.variantId);
    if (!invByVariant.has(k)) invByVariant.set(k, []);
    invByVariant.get(k).push(r);
  }

  const affected = [];

  for (const [pid, tuples] of byProduct.entries()) {
    const product = productById.get(pid);
    if (!product) continue;

    const dupTuples = [];
    let activeCount = 0;
    let archivedCount = 0;
    let totalVariants = 0;
    let lostStock = 0; // stock sitting on archived duplicates only

    for (const [tuple, group] of tuples.entries()) {
      totalVariants += group.length;
      for (const v of group) {
        if (v.status === 'archived') archivedCount += 1;
        else activeCount += 1;
      }
      if (group.length <= 1) continue;

      dupTuples.push({
        tuple,
        variants: group.map((v) => ({
          sku: v.sku,
          status: v.status,
          available: (invByVariant.get(String(v._id)) || []).reduce(
            (s, r) => s + (r.available || 0),
            0,
          ),
        })),
      });

      // If the only variants with stock are archived, stock is invisible
      const activeWithStock = group.some(
        (v) =>
          v.status !== 'archived' &&
          (invByVariant.get(String(v._id)) || []).some((r) => (r.available || 0) > 0),
      );
      const archivedWithStock = group
        .filter((v) => v.status === 'archived')
        .reduce(
          (s, v) =>
            s +
            (invByVariant.get(String(v._id)) || []).reduce(
              (s2, r) => s2 + (r.available || 0),
              0,
            ),
          0,
        );

      if (!activeWithStock && archivedWithStock > 0) {
        lostStock += archivedWithStock;
      }
    }

    if (dupTuples.length > 0) {
      affected.push({
        productId: pid,
        name: product.name,
        handle: product.handle,
        status: product.status,
        published: product.published,
        activeCount,
        archivedCount,
        totalVariants,
        dupTuples,
        lostStock,
      });
    }
  }

  affected.sort((a, b) => b.lostStock - a.lostStock);

  console.log(`\nProducts with duplicate variants: ${affected.length}`);
  console.log(`Products with stock only on archived dupes: ${affected.filter((p) => p.lostStock > 0).length}\n`);

  for (const a of affected) {
    const hidden = a.lostStock > 0 ? `  ← HIDDEN STOCK: ${a.lostStock}` : '';
    console.log(
      `${a.handle.padEnd(40)} variants=${a.totalVariants} active=${a.activeCount} archived=${a.archivedCount} dupTuples=${a.dupTuples.length}${hidden}`,
    );
  }

  await m.disconnect();
})();
