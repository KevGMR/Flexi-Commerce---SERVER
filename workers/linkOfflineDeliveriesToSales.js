const cron = require("node-cron");
const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const DeliveryFee = require("../models/DeliveryFee");

// Track job status
let isRunning = false;
let lastRun = null;
let linkedCount = 0;
let errorCount = 0;

/**
 * Worker to link offline-created deliveries to their synced sales
 * Runs periodically to match orphaned deliveries with sales
 * 
 * Issue: When a sale is created offline with delivery info, both are saved to IndexedDB
 * separately. On sync, they sync independently without a link.
 * This worker matches them up based on:
 * 1. idempotencyKey match (if both have same key from same transaction)
 * 2. Recipient + location + creation time proximity
 */

const linkOfflineDeliveriesToSales = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.log(
      "[LinkOfflineDeliveries] MongoDB is not connected, skipping this cycle"
    );
    return { linked: 0, errors: 0, skipped: true };
  }

  // Prevent overlapping runs
  if (isRunning) {
    console.log(
      "[LinkOfflineDeliveries] Job already running, skipping this cycle"
    );
    return;
  }

  isRunning = true;
  const startTime = new Date();
  let linked = 0;
  let errors = 0;

  try {
    console.log("[LinkOfflineDeliveries] Starting worker...");

    // Find sales that:
    // 1. Have no deliveryFeeId (not yet linked)
    // 2. Have requiresDelivery = true
    // 3. Were created recently (last 24 hours) - likely offline created
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const unlinkedSales = await Sale.find({
      deliveryFeeId: { $exists: false },
      requiresDelivery: true,
      createdAt: { $gte: twentyFourHoursAgo },
    }).select(
      "_id organizationId locationId idempotencyKey recipientName recipientPhone deliveryCategory deliveryOption createdAt"
    );

    console.log(`[LinkOfflineDeliveries] Found ${unlinkedSales.length} unlinked sales`);

    for (const sale of unlinkedSales) {
      try {
        // Try to find matching delivery by idempotencyKey first
        let delivery = null;

        if (sale.idempotencyKey) {
          // Check if there's a delivery with matching idempotency pattern
          // (idempotency keys might include a prefix like "delivery_" or "sale_")
          delivery = await DeliveryFee.findOne({
            organizationId: sale.organizationId,
            locationId: sale.locationId,
            saleId: { $exists: false }, // Not yet linked
            $or: [
              { idempotencyKey: sale.idempotencyKey },
              {
                // Or match by derived idempotency key pattern
                createdAt: {
                  $gte: new Date(sale.createdAt - 30000), // Within 30 seconds
                  $lte: new Date(sale.createdAt + 30000),
                },
              },
            ],
          });
        }

        // If no idempotency match, try fuzzy matching
        if (!delivery) {
          delivery = await DeliveryFee.findOne({
            organizationId: sale.organizationId,
            locationId: sale.locationId,
            saleId: { $exists: false },
            recipientPhone: sale.recipientPhone || "",
            createdAt: {
              $gte: new Date(sale.createdAt - 60000), // Within 60 seconds
              $lte: new Date(sale.createdAt + 60000),
            },
          }).sort({ createdAt: -1 }); // Get the most recent if multiple matches
        }

        if (delivery) {
          // Link them together
          await Sale.findByIdAndUpdate(sale._id, {
            deliveryFeeId: delivery._id,
            deliveryStatus: delivery.categoryStatus,
            categoryStatus: delivery.categoryStatus,
            deliveryStatusSyncedAt: new Date(),
          });

          await DeliveryFee.findByIdAndUpdate(delivery._id, {
            saleId: sale._id,
          });

          linked++;
          console.log(
            `[LinkOfflineDeliveries] Linked sale ${sale._id} to delivery ${delivery._id}`
          );
        }
      } catch (saleErr) {
        errors++;
        console.error(
          `[LinkOfflineDeliveries] Error processing sale ${sale._id}:`,
          saleErr.message
        );
      }
    }

    linkedCount += linked;
    errorCount += errors;
    lastRun = new Date();

    const duration = Date.now() - startTime.getTime();
    console.log(
      `[LinkOfflineDeliveries] Complete. Linked: ${linked}, Errors: ${errors}, Duration: ${duration}ms`
    );

    isRunning = false;
    return { linked, errors, duration };
  } catch (error) {
    console.error("[LinkOfflineDeliveries] Worker error:", error);
    errorCount++;
    isRunning = false;
    throw error;
  }
};

// Start the worker with cron scheduling
function startLinkOfflineDeliveriesToSales() {
  console.log("[LinkOfflineDeliveries] Scheduling worker to run every 5 minutes...");

  // Run every 5 minutes
  const job = cron.schedule("*/5 * * * *", linkOfflineDeliveriesToSales);

  // Also run once on startup
  linkOfflineDeliveriesToSales();

  return job;
}

// Health check function
function getJobStatus() {
  return {
    isRunning,
    lastRun,
    linkedCount,
    errorCount,
  };
}

module.exports = {
  startLinkOfflineDeliveriesToSales,
  linkOfflineDeliveriesToSales,
  getJobStatus,
};
