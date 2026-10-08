const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const router = express.Router();

const Sale = require("../models/Sale");
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const Inventory = require("../models/Inventory");
const Location = require("../models/Location");
const Organization = require("../models/Organization");
const secretBox = require("../services/secretBox");
const daraja = require("../services/daraja");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveLocationId(org, requestedLocationId) {
  if (requestedLocationId && mongoose.Types.ObjectId.isValid(requestedLocationId)) {
    return requestedLocationId;
  }
  const defaultLoc = await Location.findOne({
    organizationId: org._id,
    isDefault: true,
    status: "active",
  })
    .select("_id")
    .lean();
  if (defaultLoc) return defaultLoc._id;

  const firstActive = await Location.findOne({
    organizationId: org._id,
    status: "active",
  })
    .select("_id")
    .lean();
  return firstActive?._id || null;
}

function buildCallbackUrl(org, callbackSecret) {
  const base = process.env.PUBLIC_API_URL;
  if (!base) {
    throw new Error("PUBLIC_API_URL is not set (needed for Daraja callback)");
  }
  const url = `${base.replace(/\/$/, "")}/storefront/mpesa/callback`;
  return callbackSecret ? `${url}?key=${encodeURIComponent(callbackSecret)}` : url;
}

function getDecryptedDaraja(org) {
  const d = org.daraja || {};
  return {
    enabled: d.enabled === true,
    environment: d.environment || "sandbox",
    consumerKey: secretBox.decrypt(d.consumerKey),
    consumerSecret: secretBox.decrypt(d.consumerSecret),
    shortcode: d.shortcode,
    passkey: secretBox.decrypt(d.passkey),
    transactionType: d.transactionType || "CustomerPayBillOnline",
    callbackSecret: d.callbackSecret,
  };
}

/**
 * Compute the total from the client's cart, comparing against the DB.
 * Never trust client-submitted prices.
 *
 * Payload shape expected from the storefront:
 *   {
 *     items: [{ variantId, quantity }],
 *     customer: { name, phone, email? },
 *     shipping: { street, city, ... } | null,
 *     notes?: string,
 *   }
 */
async function priceCart(organizationId, locationId, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw Object.assign(new Error("items is required"), { status: 400 });
  }
  if (rawItems.length > 50) {
    throw Object.assign(new Error("too many items"), { status: 400 });
  }

  const variantIds = rawItems.map((i) => i.variantId).filter(Boolean);
  const invalid = rawItems.find(
    (i) => !i.variantId || !mongoose.Types.ObjectId.isValid(i.variantId),
  );
  if (invalid) {
    throw Object.assign(new Error("invalid variantId in items"), { status: 400 });
  }

  const variants = await Variant.find({
    _id: { $in: variantIds },
    organizationId,
    status: "active",
  }).lean();

  const variantById = new Map(variants.map((v) => [String(v._id), v]));

  const productIds = [...new Set(variants.map((v) => String(v.productId)))];
  const products = await Product.find({
    _id: { $in: productIds },
    organizationId,
    status: "active",
    published: true,
  })
    .select("_id name sku published status")
    .lean();

  const productById = new Map(products.map((p) => [String(p._id), p]));

  const inventoryRows = await Inventory.find({
    organizationId,
    locationId,
    variantId: { $in: variantIds },
  }).lean();
  const inventoryByVariant = new Map(
    inventoryRows.map((r) => [String(r.variantId), r]),
  );

  const pricedItems = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const variant = variantById.get(String(raw.variantId));
    if (!variant) {
      throw Object.assign(new Error(`Variant not found: ${raw.variantId}`), {
        status: 404,
      });
    }

    const product = productById.get(String(variant.productId));
    if (!product) {
      throw Object.assign(new Error(`Product not available: ${variant.productId}`), {
        status: 400,
      });
    }

    const qty = Math.floor(Number(raw.quantity) || 0);
    if (qty <= 0 || qty > 100) {
      throw Object.assign(new Error("Quantity must be between 1 and 100"), {
        status: 400,
      });
    }

    // Stock check for tracked variants
    if (variant.trackInventory !== false && !variant.continueSellingWhenOutOfStock) {
      const inv = inventoryByVariant.get(String(variant._id));
      const available = inv?.available ?? inv?.onHand ?? 0;
      if (available < qty) {
        throw Object.assign(
          new Error(
            `Insufficient stock for "${product.name}". Available: ${available}, requested: ${qty}.`,
          ),
          { status: 400 },
        );
      }
    }

    const unitPrice = Number(variant.price) || 0;
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;

    pricedItems.push({
      type: "flexi",
      productId: product._id,
      variantId: variant._id,
      variantTitle: Array.isArray(variant.selectedOptions)
        ? variant.selectedOptions.map((o) => ({ name: o.name, value: o.value }))
        : [],
      productName: product.name,
      sku: variant.sku || product.sku || "",
      quantity: qty,
      unitPrice,
      lineTotal,
      discount: 0,
      taxAmount: 0,
      parentItemIndex: null,
      originalPrice: unitPrice,
      assignedUser: null,
      commissionAmount: 0,
      commissionType: null,
      commissionValue: 0,
      laborCost: 0,
      productCost: 0,
    });
  }

  return { pricedItems, subtotal };
}

// ---------------------------------------------------------------------------
// POST /storefront/checkout
// ---------------------------------------------------------------------------

router.post("/checkout", async (req, res) => {
  try {
    const org = req.storefrontOrg;
    const organizationId = org._id;

    // 1. Load fresh org (need daraja fields, which aren't in the orgFromHost select)
    const fullOrg = await Organization.findById(organizationId)
      .select("+daraja.consumerKey +daraja.consumerSecret +daraja.passkey daraja name slug settings")
      .lean();

    if (!fullOrg) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const darajaCreds = getDecryptedDaraja(fullOrg);
    if (!darajaCreds.enabled) {
      return res.status(400).json({
        error: "Storefront payments are not enabled for this organization",
        code: "DARAJA_DISABLED",
      });
    }

    const { items, customer, shipping, notes } = req.body || {};

    if (!customer?.phone) {
      return res.status(400).json({ error: "customer.phone is required" });
    }
    const msisdn = daraja.normalizePhone(customer.phone);
    if (!msisdn) {
      return res.status(400).json({
        error: "Invalid phone number. Use format 07XXXXXXXX or +2547XXXXXXXX",
        code: "INVALID_PHONE",
      });
    }

    const locationId = await resolveLocationId(org, req.query.locationId);
    if (!locationId) {
      return res.status(400).json({
        error: "No active location available for this storefront",
        code: "NO_LOCATION",
      });
    }

    // 2. Price the cart against the DB
    const { pricedItems, subtotal } = await priceCart(
      organizationId,
      locationId,
      items,
    );

    if (subtotal <= 0) {
      return res.status(400).json({ error: "Cart total must be positive" });
    }

    // 3. Resolve tax from location settings
    const location = await Location.findById(locationId)
      .select("taxRate taxMode")
      .lean();
    const taxRate = Number(location?.taxRate) || 0;
    const taxMode = location?.taxMode === "exclusive" ? "exclusive" : "inclusive";

    let taxAmount = 0;
    let totalAmount = subtotal;
    if (taxRate > 0) {
      if (taxMode === "exclusive") {
        taxAmount = subtotal * taxRate;
        totalAmount = subtotal + taxAmount;
      } else {
        taxAmount = subtotal - subtotal / (1 + taxRate);
        totalAmount = subtotal;
      }
    }

    totalAmount = Math.round(totalAmount * 100) / 100;
    taxAmount = Math.round(taxAmount * 100) / 100;

    // 4. Create the Sale (pending payment)
    const receiptNumber = `WEB-${organizationId}-${Date.now()}`;
    const transactionId = `TXN-WEB-${organizationId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const sale = new Sale({
      organizationId,
      locationId,
      salesChannel: "storefront",
      receiptNumber,
      transactionId,
      items: pricedItems,
      customerName: customer.name || null,
      customerPhone: msisdn,
      customerEmail: customer.email || null,
      subtotal,
      discountAmount: 0,
      taxAmount,
      taxMode,
      taxRateUsed: taxRate,
      totalAmount,
      paymentMethod: "mpesa",
      payments: [],
      paymentStatus: "pending",
      // cashierId left null — storefront orders have no POS cashier
      status: "pending",
      notes: notes || null,
      tags: ["storefront", "online-order"],
    });

    await sale.save();

    // 5. Initiate STK push
    const callbackUrl = buildCallbackUrl(org, darajaCreds.callbackSecret);

    let stkResult;
    try {
      stkResult = await daraja.initiateStkPush({
        organizationId,
        environment: darajaCreds.environment,
        consumerKey: darajaCreds.consumerKey,
        consumerSecret: darajaCreds.consumerSecret,
        shortcode: darajaCreds.shortcode,
        passkey: darajaCreds.passkey,
        phone: msisdn,
        amount: Math.round(totalAmount),
        accountReference: receiptNumber.slice(-12),
        transactionDesc: "Order Payment",
        callbackUrl,
      });
    } catch (stkErr) {
      // Mark the sale failed and return the Daraja error to the client
      sale.paymentStatus = "failed";
      sale.status = "voided";
      sale.voidReason = `STK push failed: ${stkErr.message}`;
      await sale.save();

      console.error("[StorefrontCheckout] STK push failed:", stkErr.message);
      return res.status(502).json({
        error: "Failed to initiate M-Pesa payment",
        code: "STK_PUSH_FAILED",
        detail: stkErr.message,
      });
    }

    if (stkResult.responseCode !== "0") {
      sale.paymentStatus = "failed";
      sale.status = "voided";
      sale.voidReason = `STK push declined: ${stkResult.responseDescription}`;
      await sale.save();

      return res.status(502).json({
        error: "M-Pesa rejected the payment request",
        code: "STK_REJECTED",
        detail: stkResult.responseDescription,
      });
    }

    // 6. Store the CheckoutRequestID for callback lookup
    sale.checkoutRequestId = stkResult.checkoutRequestId;
    await sale.save();

    return res.status(201).json({
      success: true,
      order: {
        saleId: sale._id,
        receiptNumber: sale.receiptNumber,
        totalAmount: sale.totalAmount,
        paymentStatus: sale.paymentStatus,
      },
      mpesa: {
        checkoutRequestId: stkResult.checkoutRequestId,
        customerMessage: stkResult.customerMessage,
      },
    });
  } catch (err) {
    console.error("[StorefrontCheckout] error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      error: err.message || "Failed to process checkout",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /storefront/orders/:saleId/status
// Polling endpoint for the storefront UI
// ---------------------------------------------------------------------------

router.get("/orders/:saleId/status", async (req, res) => {
  try {
    const org = req.storefrontOrg;
    const { saleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(saleId)) {
      return res.status(400).json({ error: "Invalid sale id" });
    }

    const sale = await Sale.findOne({
      _id: saleId,
      organizationId: org._id,
      salesChannel: "storefront",
    })
      .select(
        "receiptNumber totalAmount paymentStatus status payments checkoutRequestId createdAt",
      )
      .lean();

    if (!sale) {
      return res.status(404).json({ error: "Order not found" });
    }

    const lastPayment = (sale.payments || [])
      .filter((p) => p.status === "completed")
      .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0];

    return res.status(200).json({
      order: {
        saleId: sale._id,
        receiptNumber: sale.receiptNumber,
        totalAmount: sale.totalAmount,
        paymentStatus: sale.paymentStatus,
        status: sale.status,
        createdAt: sale.createdAt,
        mpesaReceiptNumber: lastPayment?.reference || null,
      },
    });
  } catch (err) {
    console.error("[StorefrontCheckout] status error:", err);
    return res.status(500).json({ error: "Failed to fetch order status" });
  }
});

module.exports = router;