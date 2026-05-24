const cron = require('node-cron');
const mongoose = require('mongoose');
const { processRetryQueue } = require('../services/shopifySync');

/**
 * Shopify Sync Retry Worker
 * Processes failed Shopify inventory sync queue items with exponential backoff
 * Runs every 5 minutes
 */

let isRunning = false;

// Schedule job to run every 5 minutes
const retryWorker = cron.schedule('*/5 * * * *', async () => {
  if (mongoose.connection.readyState !== 1) {
    console.log('[Shopify Retry Worker] MongoDB is not connected, skipping this cycle');
    return;
  }

  // Prevent overlapping runs
  if (isRunning) {
    console.log('[Shopify Retry Worker] Previous job still running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[Shopify Retry Worker] Starting queue processing...');
    
    const result = await processRetryQueue();
    
    const duration = Date.now() - startTime;
    console.log(
      `[Shopify Retry Worker] Processed ${result.processed} items in ${duration}ms`
    );
  } catch (error) {
    console.error('[Shopify Retry Worker] Error:', error);
  } finally {
    isRunning = false;
  }
}, {
  scheduled: true,
  timezone: process.env.TZ || 'UTC'
});

// Manual trigger function (for testing or admin endpoints)
async function runNow() {
  if (isRunning) {
    return {
      success: false,
      message: 'Job already running',
    };
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[Shopify Retry Worker] Manual trigger initiated...');
    
    const result = await processRetryQueue();
    
    const duration = Date.now() - startTime;
    
    return {
      success: true,
      processed: result.processed,
      duration,
      timestamp: result.timestamp,
    };
  } catch (error) {
    console.error('[Shopify Retry Worker] Manual run error:', error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    isRunning = false;
  }
}

// Start the worker
function start() {
  retryWorker.start();
  console.log('[Shopify Retry Worker] Started - runs every 5 minutes');
}

// Stop the worker
function stop() {
  retryWorker.stop();
  console.log('[Shopify Retry Worker] Stopped');
}

module.exports = {
  start,
  stop,
  runNow,
};
