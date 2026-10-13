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
const DeliveryFee = require("../models/DeliveryFee");
const secretBox = require("../services/secretBox");
const daraja = require("../services/daraja");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveLocationId(org, requestedLocationId) {
  if (
    requestedLocationId &&
    mongoose.Types.ObjectId.isValid(requestedLocationId)
  ) {
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
  return callbackSecret
    ? `${url}?key=${encodeURIComponent(callbackSecret)}`
    : url;
}

function buildStorefrontUrl(org) {
  const rootDomain = process.env.STOREFRONT_ROOT_DOMAIN;
  const protocol = process.env.STOREFRONT_PROTOCOL || "https";
  if (!rootDomain) return null;

  if (org?.website?.domain && org?.website?.domainVerified) {
    return `${protocol}://${org.website.domain}`;
  }
  if (org?.website?.subdomain) {
    return `${protocol}://${org.website.subdomain}.${rootDomain}`;
  }
  return null;
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

// ---------------------------------------------------------------------------
// Cart pricing
// ---------------------------------------------------------------------------

async function priceCart(organizationId, locationId, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw Object.assign(new Error("items is required"), { status: 400 });
  }
  if (rawItems.length > 50) {
    throw Object.assign(new Error("too many items"), { status: 400 });
  }

  const invalid = rawItems.find(
    (i) => !i.variantId || !mongoose.Types.ObjectId.isValid(i.variantId),
  );
  if (invalid) {
    throw Object.assign(new Error("invalid variantId in items"), {
      status: 400,
    });
  }

  const variantIds = rawItems.map((i) => i.variantId);

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
      throw Object.assign(
        new Error(`Product not available: ${variant.productId}`),
        { status: 400 },
      );
    }

    const qty = Math.floor(Number(raw.quantity) || 0);
    if (qty <= 0 || qty > 100) {
      throw Object.assign(new Error("Quantity must be between 1 and 100"), {
        status: 400,
      });
    }

    if (
      variant.trackInventory !== false &&
      !variant.continueSellingWhenOutOfStock
    ) {
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
        ? variant.selectedOptions.map((o) => ({
            name: o.name,
            value: o.value,
          }))
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
// Delivery validation + pricing
// ---------------------------------------------------------------------------

/**
 * Validate the customer's chosen delivery option against the org's location.
 * Returns a normalized object the checkout flow and DeliveryFee creation
 * can use. Server-derived fee — never trusts a client-sent price.
 */
async function priceDelivery(organizationId, locationId, raw) {
  if (!raw) {
    throw Object.assign(new Error("delivery selection is required"), {
      status: 400,
    });
  }

  if (!raw.categoryName || !raw.optionName) {
    throw Object.assign(
      new Error("delivery requires categoryName and optionName"),
      { status: 400 },
    );
  }

  const location = await Location.findOne({
    _id: locationId,
    organizationId,
    status: "active",
  })
    .select("deliveryCategories")
    .lean();

  if (!location) {
    throw Object.assign(new Error("Delivery location not found"), {
      status: 400,
    });
  }

  const category = (location.deliveryCategories || []).find(
    (c) => c.categoryName === raw.categoryName && c.isActive !== false,
  );
  if (!category) {
    throw Object.assign(new Error("Delivery category not found"), {
      status: 400,
    });
  }

  const option = (category.childOptions || []).find(
    (o) => o.optionName === raw.optionName && o.isActive !== false,
  );
  if (!option) {
    throw Object.assign(new Error("Delivery option not found"), {
      status: 400,
    });
  }

  const fee = Number(option.price) || 0;
  const requiresAddress = option.requiresAddress !== false;
  const requiresLandmark = option.requiresLandmark === true;

  const address = raw.address || {};

  if (requiresAddress) {
    if (!address.street || !address.city) {
      throw Object.assign(
        new Error("Delivery address requires street and city"),
        { status: 400 },
      );
    }
    if (requiresLandmark && !address.landmark) {
      throw Object.assign(
        new Error("This delivery option requires a landmark"),
        { status: 400 },
      );
    }
  }

  // Normalize the address. For pickups (requiresAddress === false), store a
  // descriptive marker so the DeliveryFee doc has valid street/city fields.
  const normalizedAddress = requiresAddress
    ? {
        street: String(address.street).trim(),
        city: String(address.city).trim(),
        state: address.state ? String(address.state).trim() : undefined,
        postalCode: address.postalCode
          ? String(address.postalCode).trim()
          : undefined,
        country: address.country ? String(address.country).trim() : "Kenya",
        landmark: address.landmark ? String(address.landmark).trim() : undefined,
      }
    : {
        street: `Pickup: ${category.categoryName}`,
        city: "N/A",
        country: "Kenya",
      };

  return {
    categoryName: category.categoryName,
    optionName: option.optionName,
    fee,
    estimatedDays: option.estimatedDays ?? null,
    requiresAddress,
    requiresLandmark,
    address: normalizedAddress,
    notes: raw.notes ? String(raw.notes).trim() : null,
    categoryStatus:
      (Array.isArray(category.statusWorkflow) &&
        category.statusWorkflow[0]?.status) ||
      "pending",
  };
}

// ---------------------------------------------------------------------------
// POST /storefront/checkout
// ---------------------------------------------------------------------------

router.post("/checkout", async (req, res) => {
  let sale = null;

  try {
    const org = req.storefrontOrg;
    const organizationId = org._id;

    // Load full org including decrypted daraja fields
    const fullOrg = await Organization.findById(organizationId)
      .select(
        "+daraja.consumerKey +daraja.consumerSecret +daraja.passkey daraja name slug settings website",
      )
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

    const { items, customer, delivery, notes } = req.body || {};

    if (!customer?.phone) {
      return res.status(400).json({ error: "customer.phone is required" });
    }
    if (!customer?.name || !customer.name.trim()) {
      return res
        .status(400)
        .json({ error: "customer.name is required" });
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

    // ---- Price cart ----
    const { pricedItems, subtotal } = await priceCart(
      organizationId,
      locationId,
      items,
    );

    if (subtotal <= 0) {
      return res.status(400).json({ error: "Cart total must be positive" });
    }

    // ---- Price delivery ----
    const deliveryPriced = await priceDelivery(
      organizationId,
      locationId,
      delivery,
    );

    // ---- Tax from location ----
    const location = await Location.findById(locationId)
      .select("taxRate taxMode")
      .lean();
    const taxRate = Number(location?.taxRate) || 0;
    const taxMode =
      location?.taxMode === "exclusive" ? "exclusive" : "inclusive";

    let taxAmount = 0;
    let itemsTotal = subtotal;
    if (taxRate > 0) {
      if (taxMode === "exclusive") {
        taxAmount = subtotal * taxRate;
        itemsTotal = subtotal + taxAmount;
      } else {
        taxAmount = subtotal - subtotal / (1 + taxRate);
        itemsTotal = subtotal;
      }
    }

    const deliveryFeeAmount = deliveryPriced.fee;
    const totalAmount = itemsTotal + deliveryFeeAmount;

    const roundedTotal = Math.round(totalAmount * 100) / 100;
    const roundedTax = Math.round(taxAmount * 100) / 100;

    // ---- Create Sale ----
    const receiptNumber = `WEB-${organizationId}-${Date.now()}`;
    const transactionId = `TXN-WEB-${organizationId}-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")}`;

    sale = new Sale({
      organizationId,
      locationId,
      salesChannel: "storefront",
      storefrontUrl: buildStorefrontUrl(fullOrg),
      receiptNumber,
      transactionId,
      items: pricedItems,
      customerName: customer.name.trim(),
      customerPhone: msisdn,
      customerEmail: customer.email ? String(customer.email).trim() : null,
      subtotal,
      discountAmount: 0,
      taxAmount: roundedTax,
      taxMode,
      taxRateUsed: taxRate,
      totalAmount: roundedTotal,
      deliveryFeeAmount,
      requiresDelivery: true,
      deliveryStatus: "pending",
      deliveryCategory: deliveryPriced.categoryName,
      deliveryOption: deliveryPriced.optionName,
      categoryStatus: deliveryPriced.categoryStatus,
      deliveryStatusSyncedAt: new Date(),
      paymentMethod: "mpesa",
      payments: [],
      paymentStatus: "pending",
      status: "pending",
      notes: notes ? String(notes).trim() : null,
      tags: ["storefront", "online-order"],
    });

    await sale.save();

    // ---- Create DeliveryFee doc ----
    try {
      const deliveryFeeDoc = new DeliveryFee({
        organizationId,
        locationId,
        saleId: sale._id,
        deliveryCategory: deliveryPriced.categoryName,
        deliveryOption: deliveryPriced.optionName,
        amount: deliveryPriced.fee,
        isTaxable: false,
        taxAmount: 0,
        totalAmount: deliveryPriced.fee,
        deliveryAddress: deliveryPriced.address,
        recipientName: customer.name.trim(),
        recipientPhone: msisdn,
        recipientEmail: customer.email
          ? String(customer.email).trim()
          : undefined,
        categoryStatus: deliveryPriced.categoryStatus,
        notes: deliveryPriced.notes || undefined,
        validationStatus: "pending",
        // createdBy intentionally omitted — storefront order
      });
      await deliveryFeeDoc.save();
      sale.deliveryFeeId = deliveryFeeDoc._id;
      await sale.save();
    } catch (dfErr) {
      console.error(
        "[StorefrontCheckout] DeliveryFee creation failed:",
        dfErr.message,
      );
      // Non-fatal — sale exists, delivery tracking can be reconciled later
      sale.notes = `${sale.notes || ""}\n[delivery-fee-creation-failed]`.trim();
      await sale.save();
    }

    // ---- Initiate STK push ----
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
        amount: Math.round(roundedTotal),
        accountReference: receiptNumber.slice(-12),
        transactionDesc: "Order Payment",
        callbackUrl,
      });
    } catch (stkErr) {
      sale.paymentStatus = "failed";
      sale.status = "voided";
      sale.voidReason = `STK push failed: ${stkErr.message}`;
      sale.voidedAt = new Date();
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
      sale.voidedAt = new Date();
      await sale.save();

      return res.status(502).json({
        error: "M-Pesa rejected the payment request",
        code: "STK_REJECTED",
        detail: stkResult.responseDescription,
      });
    }

    // ---- Store CheckoutRequestID ----
    sale.checkoutRequestId = stkResult.checkoutRequestId;
    await sale.save();

    return res.status(201).json({
      success: true,
      order: {
        saleId: sale._id,
        receiptNumber: sale.receiptNumber,
        totalAmount: sale.totalAmount,
        deliveryFeeAmount: sale.deliveryFeeAmount,
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
        "receiptNumber subtotal totalAmount deliveryFeeAmount paymentStatus status payments checkoutRequestId createdAt completedAt",
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
        subtotal: sale.subtotal,
        deliveryFeeAmount: sale.deliveryFeeAmount,
        totalAmount: sale.totalAmount,
        paymentStatus: sale.paymentStatus,
        status: sale.status,
        createdAt: sale.createdAt,
        completedAt: sale.completedAt,
        mpesaReceiptNumber: lastPayment?.reference || null,
      },
    });
  } catch (err) {
    console.error("[StorefrontCheckout] status error:", err);
    return res.status(500).json({ error: "Failed to fetch order status" });
  }
});

module.exports = router;