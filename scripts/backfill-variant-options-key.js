require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

const APPLY = process.argv.includes('--apply');

const keyOf = (opts) => {
  if (!Array.isArray(opts) || opts.length === 0) return null;
  return opts
    .map((o) => `${o.name}=${o.value}`)
    .sort()
    .join('|');
};

(async () => {
  const uri = process.env.PROD_MONGO_URI || process.env.MONGO_URI;
  await m.connect(uri, { tls: true, ssl: true, family: 4 });
  const db = m.connection.db;

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const total = await db.collection('variants').countDocuments({});
  const missing = await db
    .collection('variants')
    .countDocuments({ optionsKey: null });
  console.log(`Total variants: ${total}  |  missing optionsKey: ${missing}\n`);

  if (missing === 0) {
    console.log('Nothing to backfill.');
    await m.disconnect();
    return;
  }

  // Pre-check: any active duplicates that would trip the unique index?
  const activeVariants = await db
    .collection('variants')
    .find({ status: 'active' })
    .project({ _id: 1, organizationId: 1, productId: 1, sku: 1, selectedOptions: 1 })
    .toArray();

  const byTuple = new Map();
  for (const v of activeVariants) {
    const k = keyOf(v.selectedOptions);
    if (!k) continue;
    const compound = `${v.organizationId}|${v.productId}|${k}`;
    if (!byTuple.has(compound)) byTuple.set(compound, []);
    byTuple.get(compound).push(v);
  }

  const conflicts = [...byTuple.entries()].filter(([, group]) => group.length > 1);
  if (conflicts.length > 0) {
    console.log(`⚠ ${conflicts.length} duplicate active-variant groups exist.`);
    for (const [key, group] of conflicts) {
      console.log(`  ${key}`);
      for (const v of group) console.log(`    ${v.sku}  (${v._id})`);
    }
    console.log('\nDedupe those products first, then re-run this.');
    await m.disconnect();
    process.exit(1);
  }

  console.log('No active duplicates. Safe to backfill.\n');

  if (!APPLY) {
    console.log(`Would backfill ${missing} variants. Pass --apply to write.`);
    await m.disconnect();
    return;
  }

  // Batch: pull all variants needing keys, build bulkWrite ops, flush 500 at a time
  const all = await db
    .collection('variants')
    .find({ optionsKey: null })
    .project({ _id: 1, selectedOptions: 1 })
    .toArray();

  const BATCH = 500;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < all.length; i += BATCH) {
    const slice = all.slice(i, i + BATCH);
    const ops = [];
    for (const v of slice) {
      const k = keyOf(v.selectedOptions);
      if (!k) {
        skipped += 1;
        continue;
      }
      ops.push({
        updateOne: {
          filter: { _id: v._id, optionsKey: null },
          update: { $set: { optionsKey: k } },
        },
      });
    }
    if (ops.length === 0) continue;

    try {
      const res = await db.collection('variants').bulkWrite(ops, {
        ordered: false,
      });
      updated += res.modifiedCount;
      const dupErrors = (res.writeErrors || []).filter(
        (e) => e.code === 11000,
      );
      if (dupErrors.length > 0) {
        console.warn(
          `  batch ${i / BATCH}: ${dupErrors.length} duplicate-key errors (skipped)`,
        );
      }
    } catch (err) {
      console.error(`  batch ${i / BATCH} failed:`, err.message);
    }

    process.stdout.write(
      `\r  progress: ${Math.min(i + BATCH, all.length)} / ${all.length}`,
    );
  }
  process.stdout.write('\n');
  console.log(`Backfilled ${updated} variants  (${skipped} skipped — no options).`);

  const stillMissing = await db
    .collection('variants')
    .countDocuments({ optionsKey: null });
  console.log(`Remaining missing optionsKey: ${stillMissing}`);

  await m.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});