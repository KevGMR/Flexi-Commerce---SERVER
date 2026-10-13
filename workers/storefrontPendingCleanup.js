const Sale = require("../models/Sale");
const Organization = require("../models/Organization");
const { sendStorefrontPaymentFailed } = require("../services/emailNotifier");

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_AFTER_MS = 5 * 60 * 1000;   // mark failed after 5 minutes

let intervalHandle = null;

async function tick() {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  try {
    // Find candidates without updating them yet — we need their IDs
    const stale = await Sale.find({
      salesChannel: "storefront",
      paymentStatus: "pending",
      status: "pending",
      createdAt: { $lt: cutoff },
    })
      .select("_id organizationId customerEmail receiptNumber totalAmount createdAt")
      .lean();

    if (stale.length === 0) return;

    const ids = stale.map((s) => s._id);

    // Bulk update — atomic, avoids race with a late callback
    const result = await Sale.updateMany(
      {
        _id: { $in: ids },
        paymentStatus: "pending", // re-check to avoid clobbering a race
        status: "pending",
      },
      {
        $set: {
          paymentStatus: "failed",
          status: "voided",
          voidReason: "STK timeout — no payment received",
          voidedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount === 0) return;

    console.log(
      `[StorefrontCleanup] Marked ${result.modifiedCount} stale pending sale(s) as failed`,
    );

    // Notify customers who provided an email
    const toNotify = stale.filter(
      (s) => s.customerEmail && s.paymentStatus !== "failed",
    );

    for (const sale of toNotify) {
      try {
        const org = await Organization.findById(sale.organizationId)
          .select("name")
          .lean();
        if (!org) continue;
        await sendStorefrontPaymentFailed(sale.customerEmail, sale, org);
      } catch (err) {
        console.error(
          `[StorefrontCleanup] email failed for sale ${sale._id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("[StorefrontCleanup] tick error:", err.message);
  } finally {
    const duration = Date.now() - startedAt;
    if (duration > 1000) {
      console.log(`[StorefrontCleanup] tick took ${duration}ms`);
    }
  }
}

function start() {
  if (intervalHandle) return;
  // Run once on startup, then on interval
  tick().catch((e) =>
    console.error("[StorefrontCleanup] initial tick failed:", e.message),
  );
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS);
  console.log("[StorefrontCleanup] worker started (5 min interval)");
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { start, stop, tick };