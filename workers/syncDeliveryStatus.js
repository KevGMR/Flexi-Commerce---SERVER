/**
 * Background job: Sync delivery status from DeliveryFee to Sale
 * Runs every 5 minutes to catch status changes
 * 
 * Usage: Imported and started in server/index.js
 */

const cron = require("node-cron");
const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const DeliveryFee = require("../models/DeliveryFee");

// Track job status
let isRunning = false;
let lastRun = null;
let syncCount = 0;
let errorCount = 0;

async function syncDeliveryStatuses() {
  if (mongoose.connection.readyState !== 1) {
    console.log(
      "[syncDeliveryStatus] MongoDB is not connected, skipping this cycle"
    );
    return { synced: 0, failed: 0, skipped: true };
  }

  // Prevent overlapping runs
  if (isRunning) {
    console.log(
      "[syncDeliveryStatus] Job already running, skipping this cycle"
    );
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    // Find DeliveryFees with status changes in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const updatedFees = await DeliveryFee.find({
      updatedAt: { $gte: fiveMinutesAgo },
      saleId: { $exists: true, $ne: null },
    }).lean();

    if (updatedFees.length === 0) {
      isRunning = false;
      return;
    }

    console.log(
      `[syncDeliveryStatus] Found ${updatedFees.length} delivery fees to sync`
    );

    let synced = 0;
    let failed = 0;

    for (const fee of updatedFees) {
      try {
        const updateData = {
          deliveryStatusSyncedAt: new Date(),
        };

        if (fee.categoryStatus) {
          updateData.categoryStatus = fee.categoryStatus;
          updateData.deliveryStatus = fee.categoryStatus;
        }

        const result = await Sale.updateOne(
          { _id: fee.saleId },
          { $set: updateData }
        );

        if (result.modifiedCount > 0) {
          synced++;
        }
      } catch (error) {
        console.error(
          `[syncDeliveryStatus] Error syncing fee ${fee._id}:`,
          error.message
        );
        failed++;
        errorCount++;
      }
    }

    syncCount += synced;
    lastRun = new Date();
    const duration = Date.now() - startTime;

    console.log(
      `[syncDeliveryStatus] Synced ${synced} sales (${failed} failed) in ${duration}ms`
    );
  } catch (error) {
    console.error("[syncDeliveryStatus] Critical error:", error);
    errorCount++;
  } finally {
    isRunning = false;
  }
}

// Initialize the cron job
function startDeliveryStatusSync() {
  console.log("[syncDeliveryStatus] Initializing delivery status sync job");

  // Run every 5 minutes
  const job = cron.schedule("*/5 * * * *", syncDeliveryStatuses);

  // Also run once on startup
  syncDeliveryStatuses();

  return job;
}

// Health check function
function getJobStatus() {
  return {
    isRunning,
    lastRun,
    syncedCount: syncCount,
    errorCount,
  };
}

module.exports = {
  startDeliveryStatusSync,
  syncDeliveryStatuses,
  getJobStatus,
};
