require("dotenv").config();
const mongoose = require("mongoose");

const Location = require("../models/Location");

const MONGO_URI = process.env.MONGO_URI;

async function buildWorkflowStartStatusMap() {
  const locations = await Location.find(
    {},
    { _id: 1, deliveryCategories: 1 }
  ).lean();

  const map = new Map();

  for (const location of locations) {
    const categoryMap = new Map();
    for (const category of location.deliveryCategories || []) {
      const workflow = Array.isArray(category.statusWorkflow)
        ? [...category.statusWorkflow].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [];
      const startStatus = workflow[0]?.status || "pending";
      categoryMap.set(category.categoryName, startStatus);
    }
    map.set(String(location._id), categoryMap);
  }

  return map;
}

async function backfillDeliveryCategoryStatus() {
  await mongoose.connect(MONGO_URI);

  const db = mongoose.connection.db;
  const deliveryFeesCollection = db.collection("deliveryfees");
  const salesCollection = db.collection("sales");

  const workflowStartMap = await buildWorkflowStartStatusMap();

  const cursor = deliveryFeesCollection.find(
    {
      $or: [{ categoryStatus: { $exists: false } }, { categoryStatus: null }],
    },
    {
      projection: {
        _id: 1,
        saleId: 1,
        status: 1,
        deliveryCategory: 1,
        locationId: 1,
      },
    }
  );

  const deliveryOps = [];
  const saleOps = [];

  let scanned = 0;
  let updatedDeliveries = 0;
  let updatedSales = 0;

  while (await cursor.hasNext()) {
    const delivery = await cursor.next();
    scanned += 1;

    let nextCategoryStatus = null;

    if (typeof delivery.status === "string" && delivery.status.trim()) {
      nextCategoryStatus = delivery.status.trim();
    }

    if (!nextCategoryStatus && delivery.deliveryCategory && delivery.locationId) {
      const locationCategoryMap = workflowStartMap.get(String(delivery.locationId));
      nextCategoryStatus = locationCategoryMap?.get(delivery.deliveryCategory) || null;
    }

    if (!nextCategoryStatus) {
      nextCategoryStatus = "pending";
    }

    deliveryOps.push({
      updateOne: {
        filter: { _id: delivery._id },
        update: {
          $set: { categoryStatus: nextCategoryStatus },
          $unset: { status: "" },
        },
      },
    });
    updatedDeliveries += 1;

    if (delivery.saleId) {
      saleOps.push({
        updateOne: {
          filter: { _id: delivery.saleId },
          update: {
            $set: {
              categoryStatus: nextCategoryStatus,
              deliveryStatus: nextCategoryStatus,
              deliveryStatusSyncedAt: new Date(),
            },
          },
        },
      });
      updatedSales += 1;
    }
  }

  if (deliveryOps.length > 0) {
    await deliveryFeesCollection.bulkWrite(deliveryOps, { ordered: false });
  }

  if (saleOps.length > 0) {
    await salesCollection.bulkWrite(saleOps, { ordered: false });
  }

  console.log("Backfill complete");
  console.log(`Scanned deliveries: ${scanned}`);
  console.log(`Updated deliveries: ${updatedDeliveries}`);
  console.log(`Updated linked sales: ${updatedSales}`);

  await mongoose.connection.close();
}

backfillDeliveryCategoryStatus()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Backfill failed:", error.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  });
