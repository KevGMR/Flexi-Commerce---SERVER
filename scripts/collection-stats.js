require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');
(async () => {
  await m.connect(process.env.MONGO_URI, { tls: true, ssl: true, family: 4 });
  const db = m.connection.db;
  const org = await db.collection('organizations').findOne({});
  if (!org) {
    console.log('no org');
    process.exit(0);
  }
  const total = await db
    .collection('collections')
    .countDocuments({ organizationId: org._id });
  const roots = await db.collection('collections').countDocuments({
    organizationId: org._id,
    parentCollectionId: null,
  });
  const siblings = await db
    .collection('collections')
    .aggregate([
      { $match: { organizationId: org._id } },
      { $group: { _id: '$parentCollectionId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 },
    ])
    .toArray();
  console.log('total collections:', total);
  console.log('root collections:', roots);
  console.log('largest sibling groups:', JSON.stringify(siblings, null, 2));
  await m.disconnect();
})();
