const express = require("express");
const router = express.Router();

const Sale = require("../models/Sale");
const Organization = require("../models/Organization");
const Inventory = require("../models/Inventory");
const Variant = require("../models/Variant");
const daraja = require("../services/daraja");
const {
  sendStorefrontOrderConfirmation,
  sendStorefrontPaymentFailed,
} = require("../services/emailNotifier");

const { processInventoryUpdates } = require("../services/inventoryUpdater");

/**
 * POST /storefront/mpesa/callback
 *
 * Called by Safaricom Daraja when an STK push completes.
 * This route is NOT protected by orgFromHost — Safaricom's servers don't
 * send X-Storefront-Key or X-Organization-Slug. The org is resolved from
 * the CheckoutRequestID in the payload.
 *
 * MUST respond 200 quickly. Safaricom retries failed callbacks.
 */

async function handleMpesaCallback(req, res) {
  const ack = () =>
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const parsed = daraja.parseStkCallback(req.body);

    if (!parsed.checkoutRequestId) {
      console.warn("[MpesaCallback] missing CheckoutRequestID in callback");
      return ack();
    }

    const sale = await Sale.findOne({
      checkoutRequestId: parsed.checkoutRequestId,
    });

    if (!sale) {
      console.warn(
        "[MpesaCallback] no sale for CheckoutRequestID",
        parsed.checkoutRequestId,
      );
      return ack();
    }

    const isPos = sale.salesChannel === "pos";

    // Idempotency: if we've already processed this callback, ack and exit.
    if (sale.paymentStatus === "completed" || sale.paymentStatus === "failed") {
      return ack();
    }

    const org = await Organization.findById(sale.organizationId)
      .select("name settings.currency daraja.callbackSecret")
      .lean();

    const providedKey = req.query.key;
    const expectedKey = org?.daraja?.callbackSecret;
    // Only enforce key match for storefront sales. For POS sales we still
    // enforce it — same key, same org.
    if (expectedKey && providedKey !== expectedKey) {
      console.warn(
        "[MpesaCallback] callback secret mismatch for sale",
        sale._id,
      );
      return ack();
    }

    // ---------- Payment failed ----------
    if (!parsed.ok) {
      if (isPos) {
        // POS: leave the sale pending. The cashier can retry, switch to
        // mark-paid-manual, or cancel (which deletes the sale). Just clear
        // pendingMpesa so a retry can start fresh.
        sale.pendingMpesa = undefined;
        await sale.save();
        console.log(
          `[MpesaCallback][POS] STK failed for sale ${sale._id}: ${parsed.resultDesc}`,
        );
        return ack();
      }

      // Storefront: existing behavior — void the sale.
      sale.paymentStatus = "failed";
      sale.status = "voided";
      sale.voidReason = `M-Pesa declined: ${parsed.resultDesc}`;
      sale.voidedAt = new Date();
      sale.payments.push({
        method: "mpesa",
        amount: 0,
        status: "failed",
        reference: null,
        paidAt: new Date(),
      });
      await sale.save();

      if (sale.customerEmail && org) {
        sendStorefrontPaymentFailed(sale.customerEmail, sale.toObject(), org).catch(
          (err) =>
            console.error(
              "[MpesaCallback] payment-failed email failed:",
              err.message,
            ),
        );
      }

      return ack();
    }

    // ---------- Payment succeeded ----------
    const paidAmount = Number(parsed.amount) || 0;
    if (paidAmount <= 0) {
      console.warn("[MpesaCallback] successful callback with zero amount");
      return ack();
    }

    sale.payments.push({
      method: "mpesa",
      amount: paidAmount,
      reference: parsed.mpesaReceiptNumber || null,
      status: "completed",
      source: "stk",
      paidAt: new Date(),
    });

    const totalPaid = sale.payments
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    sale.paymentStatus =
      totalPaid >= sale.totalAmount - 0.01 ? "completed" : "partial";
    sale.status = "completed";
    sale.completedAt = new Date();
    sale.pendingMpesa = undefined;

    // Deduct inventory. For POS sales nothing was deducted at create-time
    // (we deferred it). For storefront sales, the original code also
    // deducted here. Same call for both.
    try {
      await processInventoryUpdates(sale, sale.organizationId, null);
    } catch (invErr) {
      console.error(
        "[MpesaCallback] inventory deduction failed:",
        invErr.message,
      );
      sale.inventoryStatus = "failed";
    }

    await sale.save();

    console.log(
      `[MpesaCallback] sale ${sale._id} paid: ${paidAmount} KES (receipt ${parsed.mpesaReceiptNumber})${isPos ? " [POS]" : ""}`,
    );

    // Storefront-only: send confirmation email.
    if (!isPos && sale.customerEmail && org) {
      sendStorefrontOrderConfirmation(
        sale.customerEmail,
        sale.toObject(),
        org,
        { siteUrl: sale.storefrontUrl || "" },
      ).catch((err) =>
        console.error(
          "[MpesaCallback] order confirmation email failed:",
          err.message,
        ),
      );
    }

    return ack();
  } catch (err) {
    console.error("[MpesaCallback] error:", err);
    return ack();
  }
}


router.post("/mpesa/callback", handleMpesaCallback);

module.exports = router;