const express = require("express");
const router = express.Router();

const Sale = require("../models/Sale");
const Organization = require("../models/Organization");
const Inventory = require("../models/Inventory");
const Variant = require("../models/Variant");
const secretBox = require("../services/secretBox");
const daraja = require("../services/daraja");

/**
 * POST /storefront/mpesa/callback
 *
 * Called by Safaricom Daraja when an STK push completes.
 * This route is NOT protected by orgFromHost — Safaricom's servers don't
 * send X-Storefront-Key or X-Organization-Slug. The org is resolved from
 * the CheckoutRequestID in the payload.
 *
 * MUST respond 200 quickly (Safaricom retries otherwise). All heavy work
 * should happen synchronously but fast; if we ever need async, queue it.
 */

async function handleMpesaCallback(req, res) {
  // Always respond 200 — even on error — or Safaricom retries the callback
  // up to 3 times and may mark the transaction as failed.
  const ack = () => res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

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

    // Idempotency: if we've already processed this callback, ack and exit.
    if (sale.paymentStatus === "completed" || sale.paymentStatus === "failed") {
      return ack();
    }

    // Verify the callback secret against the org's stored value.
    // Safaricom lets us append arbitrary query params to the CallBackURL.
    const providedKey = req.query.key;
    const org = await Organization.findById(sale.organizationId)
      .select("daraja.callbackSecret")
      .lean();

    const expectedKey = org?.daraja?.callbackSecret;
    if (expectedKey && providedKey !== expectedKey) {
      console.warn(
        "[MpesaCallback] callback secret mismatch for sale",
        sale._id,
      );
      return ack(); // Don't leak the discrepancy to the caller
    }

    if (!parsed.ok) {
      // Payment failed / cancelled / insufficient funds
      sale.paymentStatus = "failed";
      sale.payments.push({
        method: "mpesa",
        amount: 0,
        status: "failed",
        reference: null,
        paidAt: new Date(),
      });
      sale.notes = `${sale.notes || ""}\nM-Pesa failed: ${parsed.resultDesc}`.trim();
      await sale.save();

      console.log(
        `[MpesaCallback] sale ${sale._id} failed: ${parsed.resultDesc} (code ${parsed.resultCode})`,
      );
      return ack();
    }

    // Payment succeeded
    const paidAmount = Number(parsed.amount) || 0;
    if (paidAmount <= 0) {
      console.warn("[MpesaCallback] successful callback with zero amount");
      return ack();
    }

    // Record payment
    sale.payments.push({
      method: "mpesa",
      amount: paidAmount,
      status: "completed",
      reference: parsed.mpesaReceiptNumber || null,
      paidAt: new Date(),
    });

    const totalPaid = sale.payments
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    sale.paymentStatus =
      totalPaid >= sale.totalAmount - 0.01 ? "completed" : "partial";
    sale.status = "completed";
    sale.completedAt = new Date();

    // Deduct inventory — reuse the same logic the POS uses, but simplified
    // for storefront orders (all items are "flexi", no Shopify).
    try {
      await deductStorefrontInventory(sale);
    } catch (invErr) {
      console.error(
        "[MpesaCallback] inventory deduction failed:",
        invErr.message,
      );
      // Don't fail the callback — payment is confirmed; we'll reconcile later.
      sale.inventoryStatus = "failed";
    }

    await sale.save();

    console.log(
      `[MpesaCallback] sale ${sale._id} paid: ${paidAmount} KES (receipt ${parsed.mpesaReceiptNumber})`,
    );

    return ack();
  } catch (err) {
    console.error("[MpesaCallback] error:", err);
    // Still ack — Safaricom retries don't help us here; we log and move on.
    return ack();
  }
}

/**
 * Deduct inventory for a confirmed storefront sale.
 * Storefront orders only contain "flexi" items (verified at checkout).
 */
async function deductStorefrontInventory(sale) {
  const organizationId = sale.organizationId;
  const locationId = sale.locationId;

  for (let i = 0; i < sale.items.length; i++) {
    const item = sale.items[i];
    if (item.type !== "flexi") continue;
    if (!item.variantId) continue;

    const variant = await Variant.findById(item.variantId)
      .select("trackInventory continueSellingWhenOutOfStock")
      .lean();

    if (variant?.trackInventory === false) {
      sale.inventoryUpdates.push({
        itemId: String(i),
        type: "flexi",
        variantId: item.variantId,
        productId: item.productId,
        quantityDeducted: item.quantity,
        status: "success",
      });
      continue;
    }

    const canOversell = variant?.continueSellingWhenOutOfStock === true;

    const inventory = await Inventory.findOne({
      organizationId,
      variantId: item.variantId,
      locationId,
    });

    if (!inventory) {
      sale.inventoryUpdates.push({
        itemId: String(i),
        type: "flexi",
        variantId: item.variantId,
        productId: item.productId,
        quantityDeducted: item.quantity,
        status: "failed",
        error: `No inventory row for variant ${item.variantId} at location ${locationId}`,
      });
      continue;
    }

    const previousOnHand = inventory.onHand || 0;
    const previousAvailable = inventory.available ?? inventory.onHand ?? 0;

    if (!canOversell && previousAvailable < item.quantity) {
      sale.inventoryUpdates.push({
        itemId: String(i),
        type: "flexi",
        variantId: item.variantId,
        productId: item.productId,
        quantityDeducted: item.quantity,
        status: "failed",
        error: `Insufficient stock (available ${previousAvailable}, requested ${item.quantity}) — customer was charged, reconcile manually`,
      });
      continue;
    }

    const newOnHand = previousOnHand - item.quantity;
    const newAvailable = previousAvailable - item.quantity;

    await Inventory.updateOne(
      { _id: inventory._id },
      {
        $set: {
          onHand: newOnHand,
          available: newAvailable,
          lastModified: new Date(),
        },
      },
    );

    sale.inventoryUpdates.push({
      itemId: String(i),
      type: "flexi",
      variantId: item.variantId,
      productId: item.productId,
      quantityDeducted: item.quantity,
      previousStock: previousOnHand,
      newStock: newOnHand,
      status: "success",
    });
  }

  sale.inventoryStatus = sale.inventoryUpdates.every((u) => u.status === "success")
    ? "completed"
    : "partial";
}

router.post("/callback", handleMpesaCallback);

module.exports = router;