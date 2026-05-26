const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const Location = require("../models/Location");
const Product = require("../models/Product");
const DeliveryFee = require("../models/DeliveryFee");
const Receivable = require("../models/Receivable");
const ShopifyConnection = require("../models/ShopifyConnection");
const UserOrganization = require("../models/UserOrganization");
const Organization = require("../models/Organization");
const {
  updateShopifyInventory,
  queueInventoryUpdate,
} = require("../services/shopifySync");
const Inventory = require("../models/Inventory");
const Expense = require("../models/Expense");
const { requirePermission } = require("../middleware/permissionCheck");
const { validateLocationAccess } = require("../middleware/locationAccess");

const VALID_TAX_MODES = ["inclusive", "exclusive"];
const PAYMENT_METHODS = ["cash", "card", "mobile", "check", "credit", "mpesa"];
const INTERNAL_CREDIT_PAYMENT_METHODS = new Set(["credit"]);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const toObjectIdIfValid = (value) => {
  if (!value) {
    return value;
  }

  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};

const deriveSalePaymentStatus = (payments = [], totalAmount = 0) => {
  const total = roundMoney(totalAmount);
  const completedTotal = roundMoney(
    payments
      .filter((p) => (p.status || "completed") === "completed")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
  );

  if (total <= 0 || completedTotal >= total - 0.01) {
    return "completed";
  }

  if (completedTotal > 0) {
    return "partial";
  }

  if (payments.some((p) => (p.status || "completed") === "pending")) {
    return "pending";
  }

  if (payments.some((p) => (p.status || "completed") === "failed")) {
    return "failed";
  }

  return "pending";
};

const getCompletedPaymentsTotal = (payments = []) =>
  roundMoney(
    payments
      .filter((p) => (p.status || "completed") === "completed")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
  );

const summarizePaymentAmounts = (payments = []) => {
  let grossAmount = 0;
  let exchangeCreditAmount = 0;

  for (const payment of Array.isArray(payments) ? payments : []) {
    const amount = roundMoney(Number(payment?.amount) || 0);
    if (amount <= 0) {
      continue;
    }

    grossAmount += amount;

    if (INTERNAL_CREDIT_PAYMENT_METHODS.has(payment?.method)) {
      exchangeCreditAmount += amount;
    }
  }

  grossAmount = roundMoney(grossAmount);
  exchangeCreditAmount = roundMoney(exchangeCreditAmount);

  return {
    grossAmount,
    exchangeCreditAmount,
    netCollectedAmount: roundMoney(Math.max(0, grossAmount - exchangeCreditAmount)),
  };
};

const getEffectivePayments = ({
  payments = [],
  paymentCorrections = [],
  fallbackMethod,
  fallbackAmount,
  fallbackDate,
}) => {
  const hasSplitPayments = Array.isArray(payments) && payments.length > 0;

  if (!hasSplitPayments) {
    if (!fallbackMethod || !PAYMENT_METHODS.includes(fallbackMethod)) {
      return [];
    }

    const amount = roundMoney(Number(fallbackAmount) || 0);
    if (amount <= 0) {
      return [];
    }

    return [
      {
        method: fallbackMethod,
        amount,
        status: "completed",
        paidAt: normalizePaymentTimestamp(fallbackDate, new Date()),
      },
    ];
  }

  const baseEntries = payments
    .map((payment, index) => ({
      paymentIndex: index,
      method: payment.method,
      amount: roundMoney(Number(payment.amount) || 0),
      remaining: roundMoney(Number(payment.amount) || 0),
      status: payment.status || "completed",
      paidAt: normalizePaymentTimestamp(payment.paidAt, fallbackDate || new Date()),
      reference: payment.reference || undefined,
      cardLast4: payment.cardLast4 || undefined,
      cardBrand: payment.cardBrand || undefined,
    }))
    .filter(
      (payment) =>
        payment.status === "completed" &&
        payment.amount > 0 &&
        PAYMENT_METHODS.includes(payment.method),
    );

  const correctionEntries = [];
  const sortedCorrections = (Array.isArray(paymentCorrections) ? paymentCorrections : [])
    .slice()
    .sort((a, b) => {
      const aTime = normalizePaymentTimestamp(a?.correctedAt, fallbackDate || new Date());
      const bTime = normalizePaymentTimestamp(b?.correctedAt, fallbackDate || new Date());
      return aTime.getTime() - bTime.getTime();
    });

  for (const correction of sortedCorrections) {
    for (const fromAllocation of correction?.fromAllocations || []) {
      const paymentIndex = Number(fromAllocation?.paymentIndex);
      const amount = roundMoney(Number(fromAllocation?.amount) || 0);
      if (!Number.isInteger(paymentIndex) || paymentIndex < 0 || amount <= 0) {
        continue;
      }

      const targetEntry = baseEntries.find((entry) => entry.paymentIndex === paymentIndex);
      if (!targetEntry) {
        continue;
      }

      targetEntry.remaining = Math.max(0, roundMoney(targetEntry.remaining - amount));
    }

    for (const toAllocation of correction?.toAllocations || []) {
      const method = toAllocation?.method;
      const amount = roundMoney(Number(toAllocation?.amount) || 0);
      if (!PAYMENT_METHODS.includes(method) || amount <= 0) {
        continue;
      }

      correctionEntries.push({
        method,
        amount,
        status: "completed",
        paidAt: normalizePaymentTimestamp(correction?.correctedAt, fallbackDate || new Date()),
        reference: toAllocation?.reference || undefined,
        cardLast4: toAllocation?.cardLast4 || undefined,
        cardBrand: toAllocation?.cardBrand || undefined,
      });
    }
  }

  const remainingEntries = baseEntries
    .filter((entry) => entry.remaining > 0)
    .map((entry) => ({
      method: entry.method,
      amount: roundMoney(entry.remaining),
      status: "completed",
      paidAt: entry.paidAt,
      reference: entry.reference,
      cardLast4: entry.cardLast4,
      cardBrand: entry.cardBrand,
    }));

  return [...remainingEntries, ...correctionEntries]
    .filter((payment) => payment.amount > 0)
    .map((payment) => ({
      ...payment,
      amount: roundMoney(payment.amount),
    }));
};

const getEffectivePaymentsForSale = (sale = {}) =>
  getEffectivePayments({
    payments: sale.payments,
    paymentCorrections: sale.paymentCorrections,
    fallbackMethod: sale.paymentMethod,
    fallbackAmount: sale.totalAmount,
    fallbackDate: sale.createdAt,
  });

const getCorrectionAvailabilityByIndex = ({ payments = [], paymentCorrections = [] }) => {
  const availability = new Map();

  for (const [index, payment] of (Array.isArray(payments) ? payments : []).entries()) {
    if ((payment?.status || "completed") !== "completed") {
      continue;
    }

    const amount = roundMoney(Number(payment?.amount) || 0);
    if (amount <= 0) {
      continue;
    }

    availability.set(index, amount);
  }

  for (const correction of Array.isArray(paymentCorrections) ? paymentCorrections : []) {
    for (const fromAllocation of correction?.fromAllocations || []) {
      const paymentIndex = Number(fromAllocation?.paymentIndex);
      const amount = roundMoney(Number(fromAllocation?.amount) || 0);
      if (!Number.isInteger(paymentIndex) || paymentIndex < 0 || amount <= 0) {
        continue;
      }

      const current = availability.get(paymentIndex);
      if (typeof current !== "number") {
        continue;
      }

      availability.set(paymentIndex, Math.max(0, roundMoney(current - amount)));
    }
  }

  return availability;
};

const isDateWithinRange = ({ value, startDate, endDate }) => {
  const dateValue = normalizePaymentTimestamp(value, null);
  if (!dateValue) {
    return false;
  }

  if (startDate && dateValue < startDate) {
    return false;
  }

  if (endDate && dateValue > endDate) {
    return false;
  }

  return true;
};

const normalizePaymentTimestamp = (value, fallback = new Date()) => {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const userHasLocationAccess = async ({ organizationId, userId, role, locationId }) => {
  if (["Owner", "Manager"].includes(role)) {
    return true;
  }

  const membership = await UserOrganization.findOne({
    userId,
    organizationId,
    status: "active",
  })
    .select("locations")
    .lean();

  if (!membership || !membership.locations || membership.locations.length === 0) {
    return true;
  }

  return membership.locations.some((loc) => String(loc) === String(locationId));
};

const resolveEffectiveTaxConfig = async ({ organizationId, location }) => {
  let orgTaxMode = "inclusive";

  const org = await Organization.findById(organizationId)
    .select("settings.taxMode")
    .lean();

  if (VALID_TAX_MODES.includes(org?.settings?.taxMode)) {
    orgTaxMode = org.settings.taxMode;
  }

  const locationTaxMode = VALID_TAX_MODES.includes(location?.taxMode)
    ? location.taxMode
    : null;

  return {
    taxRate: Number(location?.taxRate) || 0,
    taxMode: locationTaxMode || orgTaxMode,
  };
};

const calculateLineTax = ({ taxableAmount, taxRate, taxMode }) => {
  if (taxRate <= 0 || taxableAmount <= 0) {
    return 0;
  }

  if (taxMode === "exclusive") {
    return taxableAmount * taxRate;
  }

  return taxableAmount - taxableAmount / (1 + taxRate);
};

const buildShopifySyncSummary = (sale = {}) => {
  const syncStatus = sale.shopifySyncStatus || "pending";
  const hasDetailedLog = Array.isArray(sale.shopifySyncLog);
  const syncLog = hasDetailedLog ? sale.shopifySyncLog : [];

  const retryAttempts = syncLog.filter((entry) =>
    ["retrying", "failed"].includes(entry?.status),
  ).length;

  return {
    orderStatus: sale.status || "pending",
    syncStatus,
    retryAttempts,
    successCount: syncLog.filter((entry) => entry?.status === "success").length,
    pendingCount: syncLog.filter((entry) => entry?.status === "pending").length,
    retryingCount: syncLog.filter((entry) => entry?.status === "retrying").length,
    failedCount: syncLog.filter((entry) => entry?.status === "failed").length,
    hasDetailedLog,
    isTerminal: ["synced", "failed"].includes(syncStatus),
  };
};

/**
 * POST /sales
 * Create a new sale with items from FLEXI and/or Shopify
 */
const createSale = async (req, res) => {
  

  try {
    const { organizationId } = req.user;
    const {
      idempotencyKey,
      locationId,
      items,
      customerId,
      customerName,
      paymentMethod,
      payments,
      paymentStatus,
      notes,
      tags,
      deliveryInfo,
    } = req.body;

    

    // Check for duplicate sale (idempotency)
    if (idempotencyKey) {
      const existingSale = await Sale.findOne({
        organizationId,
        idempotencyKey,
      });

      if (existingSale) {
        return res.status(200).json({
          success: true,
          message: "Sale already exists (idempotent)",
          data: {
            saleId: existingSale._id,
            receiptNumber: existingSale.receiptNumber,
            transactionId: existingSale.transactionId,
            totalAmount: existingSale.totalAmount,
            status: existingSale.status,
            itemCount: existingSale.items.length,
            createdAt: existingSale.createdAt,
          },
        });
      }
    }

    // Validate required fields
    if (
      !locationId ||
      !items ||
      items.length === 0 ||
      (!paymentMethod && (!payments || payments.length === 0))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: locationId, items (non-empty array), payment info (paymentMethod or payments[])",
      });
    }

    // Validate location belongs to org
    const location = await Location.findOne({
      _id: locationId,
      organizationId,
    });
    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    const { taxRate, taxMode } = await resolveEffectiveTaxConfig({
      organizationId,
      location,
    });

    // Calculate totals
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    // Enrich items and calculate
    const enrichedItems = [];
    for (const item of items) {
      if (item.type === "flexi") {
        // Validate FLEXI product
        const product = await Product.findOne({
          _id: item.productId,
          organizationId,
        });
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `FLEXI product ${item.productId} not found`,
          });
        }

        const lineTotal = item.quantity * item.unitPrice;
        const lineDiscount = item.discount || 0;
        const taxableAmount = Math.max(0, lineTotal - lineDiscount);
        const lineTax = calculateLineTax({
          taxableAmount,
          taxRate,
          taxMode,
        });

        enrichedItems.push({
          type: "flexi",
          productId: item.productId,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal,
          discount: lineDiscount,
          taxAmount: lineTax,
        });

        subtotal += lineTotal;
        totalTax += lineTax;
        totalDiscount += lineDiscount;
      } else if (item.type === "service") {
        const product = await Product.findOne({
          _id: item.productId,
          organizationId,
        });
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Service product ${item.productId} not found`,
          });
        }

        if (product.type !== "service") {
          return res.status(400).json({
            success: false,
            message: `Product ${item.productId} is not a service`,
          });
        }

        const serviceBundleComponents = Array.isArray(product.serviceBundleComponents)
          ? product.serviceBundleComponents.map((component) => {
              const componentQuantity = Number(component.quantity) || 1;
              const componentUnitPrice = Number(component.priceSnapshot) || 0;
              return {
                serviceProductId: component.serviceProductId,
                productName: component.nameSnapshot || "",
                sku: component.skuSnapshot || "",
                quantity: componentQuantity,
                unitPrice: componentUnitPrice,
                lineTotal: roundMoney(componentQuantity * componentUnitPrice),
              };
            })
          : [];

        const lineTotal = item.quantity * item.unitPrice;
        const lineDiscount = item.discount || 0;
        const taxableAmount = Math.max(0, lineTotal - lineDiscount);
        const lineTax = calculateLineTax({
          taxableAmount,
          taxRate,
          taxMode,
        });

        enrichedItems.push({
          type: "service",
          productId: item.productId,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal,
          discount: lineDiscount,
          taxAmount: lineTax,
          serviceBundle: {
            isBundle:
              product.serviceKind === "bundle" || serviceBundleComponents.length > 0,
            bundleName: product.name,
            components: serviceBundleComponents,
          },
        });

        subtotal += lineTotal;
        totalTax += lineTax;
        totalDiscount += lineDiscount;
      } else if (item.type === "shopify") {
        // Shopify items - just snapshot what was provided
        if (!item.shopifyVariantId || !item.productName) {
          return res.status(400).json({
            success: false,
            message:
              "Shopify items require: shopifyVariantId, productName, unitPrice, quantity",
          });
        }

        const lineTotal = item.quantity * item.unitPrice;
        const lineDiscount = item.discount || 0;
        const taxableAmount = Math.max(0, lineTotal - lineDiscount);
        const lineTax = calculateLineTax({
          taxableAmount,
          taxRate,
          taxMode,
        });

        enrichedItems.push({
          type: "shopify",
          shopifyVariantId: item.shopifyVariantId,
          productName: item.productName,
          sku: item.sku || "",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal,
          discount: lineDiscount,
          taxAmount: lineTax,
        });

        subtotal += lineTotal;
        totalTax += lineTax;
        totalDiscount += lineDiscount;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Item type must be "flexi", "service", or "shopify"',
        });
      }
    }

    subtotal = roundMoney(subtotal);
    totalTax = roundMoney(totalTax);
    totalDiscount = roundMoney(totalDiscount);

    let totalAmount = subtotal - totalDiscount;
    if (taxMode === "exclusive") {
      totalAmount += totalTax;
    }

    // Handle delivery fee if provided
    let deliveryFee = null;
    let deliveryFeeAmount = 0;
    
    if (deliveryInfo) {
      console.log("📦 Processing delivery info:", {
        requiresDelivery: deliveryInfo.requiresDelivery,
        hasRecipientName: !!deliveryInfo.recipientName,
        hasRecipientPhone: !!deliveryInfo.recipientPhone,
        hasDeliveryAddress: !!deliveryInfo.deliveryAddress,
        hasFeeType: !!deliveryInfo.feeType,
        hasCategory: !!deliveryInfo.deliveryCategory,
        hasOption: !!deliveryInfo.deliveryOption,
      });
    } else {
      console.log("ℹ️ No deliveryInfo provided in request");
    }
    
    if (deliveryInfo && deliveryInfo.requiresDelivery) {
      // Validate required delivery info
      const missingFields = [];
      if (!deliveryInfo.recipientName) missingFields.push("recipientName");
      if (!deliveryInfo.recipientPhone) missingFields.push("recipientPhone");
      if (!deliveryInfo.deliveryAddress) missingFields.push("deliveryAddress");

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Delivery requires: ${missingFields.join(", ")}`,
        });
      }

      // Validate delivery address contains minimum required fields (street and city)
      // Country will default to "Kenya" if not provided
      const addressMissingFields = [];
      if (!deliveryInfo.deliveryAddress.street) addressMissingFields.push("street");
      if (!deliveryInfo.deliveryAddress.city) addressMissingFields.push("city");

      if (addressMissingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Delivery address must include: ${addressMissingFields.join(", ")}`,
        });
      }

      // Check if using new category-based system or legacy feeType
      const usingCategory = !!(deliveryInfo.deliveryCategory && deliveryInfo.deliveryOption);
      const usingLegacyFeeType = !!deliveryInfo.feeType;

      // Validate that at least one fee type is provided
      if (!usingCategory && !usingLegacyFeeType) {
        return res.status(400).json({
          success: false,
          message:
            "Either feeType (legacy) or both deliveryCategory and deliveryOption are required",
        });
      }

      let amount = 0;
      let categoryStatus = undefined;
      let deliveryCategory = undefined;
      let deliveryOption = undefined;
      let feeType = undefined;

      if (usingCategory) {
        // New category-based delivery fee
        deliveryCategory = deliveryInfo.deliveryCategory;
        deliveryOption = deliveryInfo.deliveryOption;

        // Find category in location
        const category = location.deliveryCategories?.find(
          (cat) => cat.categoryName === deliveryCategory
        );

        if (!category) {
          return res.status(404).json({
            success: false,
            message: `Delivery category "${deliveryCategory}" not found in this location`,
          });
        }

        if (!category.isActive) {
          return res.status(400).json({
            success: false,
            message: `Delivery category "${deliveryCategory}" is not active`,
          });
        }

        // Find option in category
        const option = category.childOptions?.find(
          (opt) => opt.optionName === deliveryOption
        );

        if (!option) {
          return res.status(404).json({
            success: false,
            message: `Delivery option "${deliveryOption}" not found in category "${deliveryCategory}"`,
          });
        }

        if (!option.isActive) {
          return res.status(400).json({
            success: false,
            message: `Delivery option "${deliveryOption}" is not active`,
          });
        }

        amount = option.price;
        // Set initial category status to first status in workflow
        categoryStatus = category.statusWorkflow?.[0]?.status || "pending";
      } else {
        // Legacy feeType-based delivery fee
        feeType = deliveryInfo.feeType || location.deliveryFeeSettings?.defaultFeeType || "standard";

        if (feeType === "custom") {
          if (!deliveryInfo.customAmount || deliveryInfo.customAmount < 0) {
            return res.status(400).json({
              success: false,
              message: "Custom fee amount is required for custom fee type",
            });
          }
          amount = deliveryInfo.customAmount;
        } else {
          const feeMap = {
            standard: location.deliveryFeeSettings?.standardFee || 5.0,
            express: location.deliveryFeeSettings?.expressFee || 10.0,
            overnight: location.deliveryFeeSettings?.overnightFee || 15.0,
          };
          amount = feeMap[feeType] || 5.0;
        }
      }

      // Delivery fees are not taxed
      const deliveryTax = 0;
      deliveryFeeAmount = amount;

      // Add delivery fee to total
      totalAmount += deliveryFeeAmount;

      // Prepare delivery fee object (will be created after sale)
      deliveryFee = {
        feeType: feeType || undefined,
        deliveryCategory: deliveryCategory || undefined,
        deliveryOption: deliveryOption || undefined,
        categoryStatus: categoryStatus || undefined,
        amount,
        isTaxable: false,
        taxAmount: deliveryTax,
        totalAmount: deliveryFeeAmount,
        deliveryAddress: typeof deliveryInfo.deliveryAddress === 'string' 
          ? {
              street: deliveryInfo.deliveryAddress,
              city: deliveryInfo.city || "N/A",
              state: deliveryInfo.state,
              postalCode: deliveryInfo.postalCode,
              country: deliveryInfo.country || "Kenya",
              landmark: deliveryInfo.landmark,
            }
          : deliveryInfo.deliveryAddress,
        recipientName: deliveryInfo.recipientName,
        recipientPhone: deliveryInfo.recipientPhone,
        recipientEmail: deliveryInfo.recipientEmail,
        estimatedDelivery: deliveryInfo.estimatedDelivery,
        notes: deliveryInfo.notes,
        deliveryInstructions: deliveryInfo.deliveryInstructions,
      };
      
      console.log("✅ Delivery fee object prepared:", {
        amount: deliveryFee.amount,
        totalAmount: deliveryFee.totalAmount,
        feeType: deliveryFee.feeType,
        deliveryCategory: deliveryFee.deliveryCategory,
        deliveryAddress: deliveryFee.deliveryAddress,
        recipientName: deliveryFee.recipientName,
      });
    } else {
      console.log("⚠️ deliveryInfo or requiresDelivery is falsy:", {
        hasDeliveryInfo: !!deliveryInfo,
        requiresDelivery: deliveryInfo?.requiresDelivery,
      });
    }

    // Prepare payments (support split payments)
    let normalizedPayments = [];
    if (payments && Array.isArray(payments) && payments.length > 0) {
      // Basic validation
      const sum = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      if (sum <= 0) {
        return res.status(400).json({
          success: false,
          message: "Payments total must be greater than 0",
        });
      }

      if (sum - totalAmount > 0.01) {
        return res.status(400).json({
          success: false,
          message: `Payments total (${sum.toFixed(2)}) cannot exceed sale total (${totalAmount.toFixed(2)})`,
        });
      }

      normalizedPayments = payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount) || 0,
        reference: p.reference || undefined,
        status: p.status || "completed",
        paidAt: normalizePaymentTimestamp(p.paidAt),
        cardLast4: p.cardLast4 || undefined,
        cardBrand: p.cardBrand || undefined,
      }));
    } else if (paymentMethod) {
      normalizedPayments = [
        {
          method: paymentMethod,
          amount: totalAmount,
          status: paymentStatus || "completed",
          paidAt: new Date(),
        },
      ];
    }

    const completedPaymentsTotal = getCompletedPaymentsTotal(normalizedPayments);
    const initialBalanceDue = Math.max(
      0,
      roundMoney(totalAmount - completedPaymentsTotal),
    );
    const overallPaymentStatus = deriveSalePaymentStatus(
      normalizedPayments,
      totalAmount,
    );

    const normalizedTags = Array.isArray(tags) ? [...tags] : [];
    if (initialBalanceDue > 0.01) {
      if (!normalizedTags.includes("reservation")) {
        normalizedTags.push("reservation");
      }
      if (!normalizedTags.includes("partial-payment")) {
        normalizedTags.push("partial-payment");
      }
    }

    // Verify an open shift session exists for this cashier at this location
    const ShiftSession = require("../models/ShiftSession");
    const { findPreviousDayOpenShiftSession } = require("../utils/shiftSessionCalculations");
    const previousDayOpenShift = await findPreviousDayOpenShiftSession({
      ShiftSession,
      organizationId,
      locationId,
      cashierId: req.user.userId,
    });

    if (previousDayOpenShift) {
      return res.status(403).json({
        success: false,
        code: "PREVIOUS_SHIFT_OPEN",
        message: "Close the previous day's shift before completing a new sale",
        data: previousDayOpenShift,
      });
    }

    const openShift = await ShiftSession.findOne({
      organizationId,
      locationId,
      cashierId: req.user.userId,
      status: "open",
    }).lean();

    if (!openShift) {
      return res.status(400).json({
        success: false,
        message: "All sales require an open shift at this location",
      });
    }

    // Generate receipt and transaction numbers
    const receiptNumber = `REC-${organizationId}-${Date.now()}`;
    const transactionId = `TXN-${organizationId}-${Date.now()}`;

    // Start MongoDB transaction for atomic sale + inventory updates
    const session = await Sale.startSession();
    session.startTransaction();

    try {
      // Create sale within transaction
      const sale = new Sale({
        organizationId,
        locationId,
        receiptNumber,
        transactionId,
        idempotencyKey,
        items: enrichedItems,
        customerId: customerId || null,
        customerName: customerName || null,
        subtotal,
        discountAmount: totalDiscount,
        taxAmount: totalTax,
        taxMode,
        taxRateUsed: taxRate,
        totalAmount,
        deliveryFeeAmount: deliveryFeeAmount || 0,
        requiresDelivery: deliveryInfo?.requiresDelivery || false,
        deliveryStatus: deliveryInfo?.requiresDelivery ? "pending" : "not_required",
        // NEW: Delivery category snapshot at time of sale
        deliveryCategory: deliveryFee?.deliveryCategory || undefined,
        deliveryOption: deliveryFee?.deliveryOption || undefined,
        categoryStatus: deliveryFee?.categoryStatus || undefined,
        deliveryStatusSyncedAt: deliveryInfo?.requiresDelivery ? new Date() : undefined,
        paymentMethod:
          normalizedPayments.length === 1
            ? normalizedPayments[0].method
            : undefined,
        payments: normalizedPayments,
        paymentStatus: overallPaymentStatus,
        cashierId: req.user.userId,
        // Shift Management & Audit
        shiftSessionId: openShift._id,
        validationStatus: "pending",
        status: "completed",
        completedAt: new Date(),
        inventoryStatus: "pending",
        notes,
        tags: normalizedTags,
      });

      await sale.save({ session });

      let createdReceivable = null;
      if (initialBalanceDue > 0.01) {
        createdReceivable = new Receivable({
          organizationId,
          locationId,
          saleId: sale._id,
          customerId: customerId || undefined,
          customerName: customerName || undefined,
          totalDue: roundMoney(totalAmount),
          totalPaid: completedPaymentsTotal,
          balanceDue: initialBalanceDue,
          status: completedPaymentsTotal > 0 ? "partial" : "open",
          payments: normalizedPayments.map((p) => ({
            method: p.method,
            amount: Number(p.amount) || 0,
            reference: p.reference || undefined,
            status: p.status || "completed",
            cardLast4: p.cardLast4 || undefined,
            cardBrand: p.cardBrand || undefined,
            collectedBy: req.user.userId,
            collectedAt: normalizePaymentTimestamp(p.paidAt),
          })),
          lastPaymentAt:
            completedPaymentsTotal > 0
              ? normalizePaymentTimestamp(
                  normalizedPayments
                    .filter((p) => (p.status || "completed") === "completed")
                    .sort(
                      (a, b) =>
                        normalizePaymentTimestamp(b.paidAt).getTime() -
                        normalizePaymentTimestamp(a.paidAt).getTime(),
                    )[0]?.paidAt,
                )
              : undefined,
          createdBy: req.user.userId,
          updatedBy: req.user.userId,
        });

        await createdReceivable.save({ session });
      }

      // Create delivery fee if required
      let createdDeliveryFee = null;
      if (deliveryFee) {
        try {
          console.log("Creating delivery fee with data:", {
            organizationId,
            locationId,
            saleId: sale._id,
            recipientName: deliveryFee.recipientName,
            deliveryAddress: deliveryFee.deliveryAddress,
            amount: deliveryFee.amount,
            feeType: deliveryFee.feeType,
            deliveryCategory: deliveryFee.deliveryCategory,
          });
          
          createdDeliveryFee = new DeliveryFee({
            organizationId,
            locationId,
            saleId: sale._id,
            ...deliveryFee,
            status: "pending",
            createdBy: req.user.userId,
          });
          await createdDeliveryFee.save({ session });

          // Link delivery fee to sale
          sale.deliveryFeeId = createdDeliveryFee._id;
          await sale.save({ session });
          
          console.log("✅ Delivery fee created successfully:", createdDeliveryFee._id);
        } catch (deliveryError) {
          console.error("❌ Error creating delivery fee:", deliveryError);
          throw new Error(`Delivery creation failed: ${deliveryError.message}`);
        }
      } else {
        console.log("⚠️ No delivery fee data to create (deliveryInfo.requiresDelivery might be false)");
      }

      // Process inventory updates within transaction
      await processInventoryUpdates(sale, organizationId, session);

      // Commit transaction
      await session.commitTransaction();

      res.status(201).json({
        success: true,
        message: "Sale created successfully",
        data: {
          saleId: sale._id,
          receiptNumber: sale.receiptNumber,
          transactionId: sale.transactionId,
          totalAmount: sale.totalAmount,
          deliveryFeeAmount: sale.deliveryFeeAmount,
          requiresDelivery: sale.requiresDelivery,
          deliveryStatus: sale.deliveryStatus,
          deliveryFeeId: createdDeliveryFee?._id,
          trackingNumber: createdDeliveryFee?.trackingNumber,
          status: sale.status,
          orderStatus: sale.status,
          shopifySyncStatus: sale.shopifySyncStatus || "pending",
          shopifySyncSummary: buildShopifySyncSummary(sale),
          taxMode: sale.taxMode,
          taxRateUsed: sale.taxRateUsed,
          paymentStatus: sale.paymentStatus,
          amountPaid: completedPaymentsTotal,
          balanceDue: initialBalanceDue,
          receivableId: createdReceivable?._id,
          itemCount: sale.items.length,
          createdAt: sale.createdAt,
        },
      });
    } catch (txError) {
      await session.abortTransaction();
      throw txError;
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.error("Create sale error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create sale",
      error: error.message,
    });
  }
};

/**
 * GET /sales/receivables
 * List receivables (open, partial, paid)
 */
const listReceivables = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const {
      locationId,
      status,
      saleId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    const query = { organizationId };

    if (!["Owner", "Manager"].includes(role)) {
      const membership = await UserOrganization.findOne({
        userId,
        organizationId,
        status: "active",
      })
        .select("locations")
        .lean();

      if (membership?.locations?.length > 0) {
        query.locationId = { $in: membership.locations };
      }
    }

    if (locationId) query.locationId = locationId;
    if (status) query.status = status;
    if (saleId) query.saleId = saleId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [receivables, total] = await Promise.all([
      Receivable.find(query)
        .populate("saleId", "receiptNumber transactionId totalAmount paymentStatus status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Receivable.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        receivables,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("List receivables error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list receivables",
      error: error.message,
    });
  }
};

/**
 * GET /sales/:id/receivable
 * Get receivable details for a sale
 */
const getSaleReceivable = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;

    const sale = await Sale.findOne({ _id: id, organizationId })
      .select("_id locationId totalAmount paymentStatus paymentMethod payments paymentCorrections createdAt")
      .lean();

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    const hasAccess = await userHasLocationAccess({
      organizationId,
      userId,
      role,
      locationId: sale.locationId,
    });

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have access to this location.",
        code: "LOCATION_ACCESS_DENIED",
      });
    }

    const receivable = await Receivable.findOne({ organizationId, saleId: id }).lean();
    if (!receivable) {
      const effectivePayments = getEffectivePaymentsForSale(sale);
      const amountPaid = getCompletedPaymentsTotal(effectivePayments);
      const balanceDue = Math.max(0, roundMoney((sale.totalAmount || 0) - amountPaid));
      return res.json({
        success: true,
        data: {
          saleId: sale._id,
          totalDue: sale.totalAmount,
          totalPaid: amountPaid,
          balanceDue,
          status: balanceDue > 0.01 ? "open" : "paid",
          payments: sale.payments || [],
          effectivePayments,
          paymentCorrections: sale.paymentCorrections || [],
        },
      });
    }

    const effectivePayments = getEffectivePayments({
      payments: receivable.payments,
      paymentCorrections: receivable.paymentCorrections,
      fallbackDate: sale.createdAt,
    });

    res.json({
      success: true,
      data: {
        ...receivable,
        effectivePayments,
      },
    });
  } catch (error) {
    console.error("Get sale receivable error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sale receivable",
      error: error.message,
    });
  }
};

/**
 * POST /sales/:id/payments
 * Add additional payment to settle outstanding receivable
 */
const recordSalePayment = async (req, res) => {
  const session = await Sale.startSession();

  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;
    const {
      method,
      amount,
      reference,
      status = "completed",
      cardLast4,
      cardBrand,
      notes,
    } = req.body;

    if (!method || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "method and amount (> 0) are required",
      });
    }

    const sale = await Sale.findOne({ _id: id, organizationId }).session(session);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    const hasAccess = await userHasLocationAccess({
      organizationId,
      userId,
      role,
      locationId: sale.locationId,
    });

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have access to this location.",
        code: "LOCATION_ACCESS_DENIED",
      });
    }

    if (sale.status === "voided") {
      return res.status(400).json({
        success: false,
        message: "Cannot add payment to a voided sale",
      });
    }

    session.startTransaction();

    let receivable = await Receivable.findOne({ organizationId, saleId: sale._id }).session(
      session,
    );

    if (!receivable) {
      const paid = getCompletedPaymentsTotal(sale.payments || []);
      const outstanding = Math.max(0, roundMoney((sale.totalAmount || 0) - paid));

      if (outstanding <= 0.01) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Sale is already fully paid",
        });
      }

      receivable = new Receivable({
        organizationId,
        locationId: sale.locationId,
        saleId: sale._id,
        customerId: sale.customerId || undefined,
        customerName: sale.customerName || undefined,
        totalDue: roundMoney(sale.totalAmount),
        totalPaid: paid,
        balanceDue: outstanding,
        status: paid > 0 ? "partial" : "open",
        payments: (sale.payments || []).map((p) => ({
          method: p.method,
          amount: Number(p.amount) || 0,
          reference: p.reference || undefined,
          status: p.status || "completed",
          cardLast4: p.cardLast4 || undefined,
          cardBrand: p.cardBrand || undefined,
          collectedBy: sale.cashierId,
          collectedAt: normalizePaymentTimestamp(p.paidAt, sale.createdAt || new Date()),
        })),
        createdBy: sale.cashierId,
        updatedBy: userId,
      });
    }

    if (["paid", "cancelled"].includes(receivable.status) || receivable.balanceDue <= 0.01) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "No outstanding receivable balance for this sale",
      });
    }

    const paymentAmount = roundMoney(amount);
    if (paymentAmount - receivable.balanceDue > 0.01) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Payment amount (${paymentAmount.toFixed(2)}) cannot exceed balance due (${receivable.balanceDue.toFixed(2)})`,
      });
    }

    const paymentTimestamp = new Date();

    const paymentEntry = {
      method,
      amount: paymentAmount,
      reference: reference || undefined,
      status,
      cardLast4: cardLast4 || undefined,
      cardBrand: cardBrand || undefined,
      collectedBy: userId,
      collectedAt: paymentTimestamp,
    };

    receivable.payments.push(paymentEntry);
    if (status === "completed") {
      receivable.totalPaid = roundMoney((receivable.totalPaid || 0) + paymentAmount);
      receivable.balanceDue = Math.max(
        0,
        roundMoney((receivable.totalDue || 0) - (receivable.totalPaid || 0)),
      );
      receivable.lastPaymentAt = new Date();
    }

    if (notes) {
      receivable.notes = notes;
    }

    if (receivable.balanceDue <= 0.01) {
      receivable.balanceDue = 0;
      receivable.status = "paid";
    } else if (receivable.totalPaid > 0) {
      receivable.status = "partial";
    } else {
      receivable.status = "open";
    }

    receivable.updatedBy = userId;
    await receivable.save({ session });

    sale.payments.push({
      method,
      amount: paymentAmount,
      reference: reference || undefined,
      status,
      paidAt: paymentTimestamp,
      cardLast4: cardLast4 || undefined,
      cardBrand: cardBrand || undefined,
    });

    sale.paymentStatus = deriveSalePaymentStatus(sale.payments, sale.totalAmount);
    sale.lastModified = new Date();
    sale.modifiedBy = userId;
    await sale.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        saleId: sale._id,
        paymentStatus: sale.paymentStatus,
        amountPaid: receivable.totalPaid,
        balanceDue: receivable.balanceDue,
        receivableStatus: receivable.status,
        receivableId: receivable._id,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Record sale payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to record sale payment",
      error: error.message,
    });
  } finally {
    await session.endSession();
  }
};

/**
 * PATCH /sales/:id/payments/reallocate
 * Reallocate completed payment allocations with immutable correction trail
 */
const reallocateSalePayment = async (req, res) => {
  const session = await Sale.startSession();

  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;
    const {
      fromAllocations,
      toAllocations,
      reason,
      notes,
    } = req.body || {};

    if (!Array.isArray(fromAllocations) || fromAllocations.length === 0) {
      return res.status(400).json({
        success: false,
        message: "fromAllocations is required",
      });
    }

    if (!Array.isArray(toAllocations) || toAllocations.length === 0) {
      return res.status(400).json({
        success: false,
        message: "toAllocations is required",
      });
    }

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        success: false,
        message: "reason is required",
      });
    }

    const sale = await Sale.findOne({ _id: id, organizationId }).session(session);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    const hasAccess = await userHasLocationAccess({
      organizationId,
      userId,
      role,
      locationId: sale.locationId,
    });

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have access to this location.",
        code: "LOCATION_ACCESS_DENIED",
      });
    }

    if (sale.status === "voided") {
      return res.status(400).json({
        success: false,
        message: "Cannot reallocate payments for a voided sale",
      });
    }

    if (!Array.isArray(sale.payments) || sale.payments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Sale has no split payments to reallocate",
      });
    }

    const normalizedFrom = fromAllocations.map((allocation) => ({
      paymentIndex: Number(allocation?.paymentIndex),
      amount: roundMoney(Number(allocation?.amount) || 0),
    }));

    if (
      normalizedFrom.some(
        (allocation) =>
          !Number.isInteger(allocation.paymentIndex) ||
          allocation.paymentIndex < 0 ||
          allocation.amount <= 0,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Each from allocation must include valid paymentIndex and amount > 0",
      });
    }

    const normalizedTo = toAllocations.map((allocation) => ({
      method: String(allocation?.method || "").trim().toLowerCase(),
      amount: roundMoney(Number(allocation?.amount) || 0),
      reference: allocation?.reference || undefined,
      cardLast4: allocation?.cardLast4 || undefined,
      cardBrand: allocation?.cardBrand || undefined,
    }));

    if (
      normalizedTo.some(
        (allocation) =>
          !PAYMENT_METHODS.includes(allocation.method) ||
          allocation.amount <= 0,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Each to allocation must include valid payment method and amount > 0",
      });
    }

    const groupedFromByIndex = normalizedFrom.reduce((acc, allocation) => {
      acc.set(
        allocation.paymentIndex,
        roundMoney((acc.get(allocation.paymentIndex) || 0) + allocation.amount),
      );
      return acc;
    }, new Map());

    const availableSaleByIndex = getCorrectionAvailabilityByIndex({
      payments: sale.payments,
      paymentCorrections: sale.paymentCorrections,
    });

    const resolvedFromAllocations = [];
    for (const [paymentIndex, amount] of groupedFromByIndex.entries()) {
      const payment = sale.payments[paymentIndex];
      if (!payment) {
        return res.status(400).json({
          success: false,
          message: `Invalid paymentIndex ${paymentIndex}`,
        });
      }

      if ((payment.status || "completed") !== "completed") {
        return res.status(400).json({
          success: false,
          message: `Payment at index ${paymentIndex} is not completed`,
        });
      }

      const available = roundMoney(availableSaleByIndex.get(paymentIndex) || 0);
      if (amount - available > 0.01) {
        return res.status(400).json({
          success: false,
          message: `Allocation amount exceeds remaining correctable amount for payment index ${paymentIndex}`,
        });
      }

      resolvedFromAllocations.push({
        paymentIndex,
        method: payment.method,
        amount,
      });
    }

    const fromTotal = roundMoney(
      resolvedFromAllocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    );
    const toTotal = roundMoney(
      normalizedTo.reduce((sum, allocation) => sum + allocation.amount, 0),
    );

    if (Math.abs(fromTotal - toTotal) > 0.01) {
      return res.status(400).json({
        success: false,
        message: "Total amount in fromAllocations must match total amount in toAllocations",
      });
    }

    session.startTransaction();

    let receivable = await Receivable.findOne({ organizationId, saleId: sale._id }).session(
      session,
    );

    if (!receivable) {
      const paid = getCompletedPaymentsTotal(sale.payments || []);
      const outstanding = Math.max(0, roundMoney((sale.totalAmount || 0) - paid));

      receivable = new Receivable({
        organizationId,
        locationId: sale.locationId,
        saleId: sale._id,
        customerId: sale.customerId || undefined,
        customerName: sale.customerName || undefined,
        totalDue: roundMoney(sale.totalAmount),
        totalPaid: paid,
        balanceDue: outstanding,
        status: paid > 0 ? "partial" : "open",
        payments: (sale.payments || []).map((p) => ({
          method: p.method,
          amount: Number(p.amount) || 0,
          reference: p.reference || undefined,
          status: p.status || "completed",
          cardLast4: p.cardLast4 || undefined,
          cardBrand: p.cardBrand || undefined,
          collectedBy: sale.cashierId,
          collectedAt: normalizePaymentTimestamp(p.paidAt, sale.createdAt || new Date()),
        })),
        createdBy: sale.cashierId,
        updatedBy: userId,
      });
    }

    const availableReceivableByIndex = getCorrectionAvailabilityByIndex({
      payments: receivable.payments,
      paymentCorrections: receivable.paymentCorrections,
    });

    for (const fromAllocation of resolvedFromAllocations) {
      const receivablePayment = receivable.payments[fromAllocation.paymentIndex];
      if (!receivablePayment) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Receivable payment index ${fromAllocation.paymentIndex} is invalid`,
        });
      }

      const available = roundMoney(
        availableReceivableByIndex.get(fromAllocation.paymentIndex) || 0,
      );
      if (fromAllocation.amount - available > 0.01) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Receivable correction amount exceeds available amount for payment index ${fromAllocation.paymentIndex}`,
        });
      }
    }

    const correctionId = new mongoose.Types.ObjectId();
    const correctedAt = new Date();
    const correctionPayload = {
      correctionId,
      fromAllocations: resolvedFromAllocations,
      toAllocations: normalizedTo,
      reason: String(reason).trim(),
      notes: notes ? String(notes).trim() : undefined,
      correctedBy: userId,
      correctedAt,
    };

    sale.paymentCorrections = [...(sale.paymentCorrections || []), correctionPayload];
    sale.paymentStatus = deriveSalePaymentStatus(
      getEffectivePaymentsForSale(sale),
      sale.totalAmount,
    );
    sale.lastModified = correctedAt;
    sale.modifiedBy = userId;
    sale.supervisorId = userId;
    await sale.save({ session });

    receivable.paymentCorrections = [
      ...(receivable.paymentCorrections || []),
      correctionPayload,
    ];
    receivable.updatedBy = userId;
    await receivable.save({ session });

    await session.commitTransaction();

    const effectivePayments = getEffectivePaymentsForSale(sale);

    res.json({
      success: true,
      message: "Payment allocation corrected successfully",
      data: {
        saleId: sale._id,
        correctionId,
        effectivePayments,
        paymentStatus: sale.paymentStatus,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Reallocate sale payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reallocate payment",
      error: error.message,
    });
  } finally {
    await session.endSession();
  }
};

/**
 * Helper: Process inventory updates for FLEXI and Shopify items
 * Executes within a MongoDB transaction session
 */
async function processInventoryUpdates(sale, organizationId, session) {
  const connection = await ShopifyConnection.findOne({ organizationId })
    .select("+clientId +clientSecret +accessToken +tokenExpiresAt")
    .session(session);

  // Get the FLEXI location for Shopify mapping
  const flexiLocation = await Location.findOne({
    _id: sale.locationId,
    organizationId,
  }).session(session);

  let totalShopifyItems = 0;
  let syncedCount = 0;
  let queuedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < sale.items.length; i++) {
    const item = sale.items[i];

    if (item.type === "flexi") {
      // Update FLEXI inventory
      try {
        const inventory = await Inventory.findOne({
          productId: item.productId,
          locationId: sale.locationId,
        }).session(session);

        if (inventory) {
          const previousStock = inventory.quantity;
          const newStock = Math.max(0, previousStock - item.quantity);

          await Inventory.updateOne(
            { _id: inventory._id },
            {
              $set: {
                quantity: newStock,
                lastModified: new Date(),
              },
            },
            { session },
          );

          // Log update
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "flexi",
            productId: item.productId,
            quantityDeducted: item.quantity,
            previousStock,
            newStock,
            status: "success",
          });
        }
      } catch (error) {
        console.error(
          `[Sales] FLEXI inventory update failed for item ${i}:`,
          error.message,
        );
        sale.inventoryUpdates.push({
          itemId: i.toString(),
          type: "flexi",
          productId: item.productId,
          quantityDeducted: item.quantity,
          status: "failed",
          error: error.message,
        });
      }
    } else if (item.type === "shopify" && connection) {
      totalShopifyItems += 1;
      // Update Shopify inventory
      try {
        await updateShopifyInventory(
          organizationId,
          item.shopifyVariantId,
          -item.quantity, // negative = sold
          sale._id,
          flexiLocation?.shopifyLocationId, // Pass mapped Shopify location
        );

        sale.inventoryUpdates.push({
          itemId: i.toString(),
          type: "shopify",
          shopifyVariantId: item.shopifyVariantId,
          quantityDeducted: item.quantity,
          status: "success",
        });
        syncedCount += 1;
      } catch (error) {
        console.error(
          `[Sales] Shopify inventory update failed for item ${i}:`,
          error.message,
        );

        // Permanent failures (e.g. deleted Shopify variant) must not be queued —
        // they will never succeed regardless of retries. Log and skip immediately.
        if (error.permanent === true) {
          console.error(
            `[Sales] Permanent Shopify sync failure for variant ${item.shopifyVariantId} — not queuing:`,
            error.message,
          );
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: item.quantity,
            status: "failed",
            error: error.message,
          });
          failedCount += 1;
          sale.shopifySyncLog.push({
            shopifyVariantId: item.shopifyVariantId,
            itemIndex: i,
            status: "failed",
            error: error.message,
          });
          continue; // eslint-disable-line no-continue
        }

        // Transient failure — attempt to queue for retry so sync can complete later
        try {
          await queueInventoryUpdate(
            organizationId,
            null,
            item.shopifyVariantId,
            -item.quantity,
            null,
            sale._id,
            flexiLocation?.shopifyLocationId,
          );

          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: item.quantity,
            status: "pending",
            error: error.message,
          });
          queuedCount += 1;
          sale.shopifySyncLog.push({
            shopifyVariantId: item.shopifyVariantId,
            itemIndex: i,
            status: "retrying",
            error: error.message,
          });
        } catch (queueError) {
          console.error(
            `[Sales] Queueing Shopify inventory update failed for item ${i}:`,
            queueError.message,
          );
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: item.quantity,
            status: "failed",
            error: queueError.message,
          });
          failedCount += 1;
          sale.shopifySyncLog.push({
            shopifyVariantId: item.shopifyVariantId,
            itemIndex: i,
            status: "failed",
            error: queueError.message,
          });
        }
      }
    }
  }

  if (totalShopifyItems > 0) {
    if (syncedCount === totalShopifyItems) {
      sale.shopifySyncStatus = "synced";
    } else if (syncedCount > 0 || (queuedCount > 0 && failedCount > 0)) {
      sale.shopifySyncStatus = "partial";
    } else if (queuedCount > 0) {
      sale.shopifySyncStatus = "pending";
    } else if (failedCount > 0) {
      sale.shopifySyncStatus = "failed";
    }
  }

  // Save inventory updates inside the same transaction
  await sale.save({ session });
}

/**
 * GET /sales/:id
 * Get a specific sale
 */
const getSale = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { id } = req.params;

    const sale = await Sale.findOne({ _id: id, organizationId })
      .populate("cashierId", "fullname email")
      .populate("customerId", "name email phone");

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    const saleData = sale.toObject();
    saleData.effectivePayments = getEffectivePaymentsForSale(saleData);
    saleData.orderStatus = saleData.status;
    saleData.shopifySyncSummary = buildShopifySyncSummary(saleData);

    res.json({
      success: true,
      data: saleData,
    });
  } catch (error) {
    console.error("Get sale error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve sale",
      error: error.message,
    });
  }
};

/**
 * GET /sales
 * List sales with filters
 */
const listSales = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const {
      locationId,
      status,
      paymentMethod,
      startDate,
      endDate,
      timeBasis,
      receiptNumber,
      idempotencyKey,
      search,
      limit = 50,
      page = 1,
    } = req.query;

    const filter = { organizationId };

    // Apply location restrictions for non-Owner/Manager users
    if (!["Owner", "Manager"].includes(role)) {
      const membership = await UserOrganization.findOne({
        userId,
        organizationId,
        status: "active",
      })
        .select("locations")
        .lean();

      if (
        membership &&
        membership.locations &&
        membership.locations.length > 0
      ) {
        // User has location restrictions - filter by accessible locations
        filter.locationId = { $in: membership.locations };
      }
    }

    if (receiptNumber || idempotencyKey) {
      const receiptFilters = [];
      if (receiptNumber) receiptFilters.push({ receiptNumber });
      if (idempotencyKey) receiptFilters.push({ idempotencyKey });

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: receiptFilters }];
        delete filter.$or;
      } else {
        filter.$or = receiptFilters;
      }
    }

    if (search) {
      const searchFilters = [
        { receiptNumber: search },
        { transactionId: search },
        { idempotencyKey: search },
      ];

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchFilters }];
        delete filter.$or;
      } else if (filter.$and) {
        filter.$and.push({ $or: searchFilters });
      } else {
        filter.$or = searchFilters;
      }
    }
    if (locationId) filter.locationId = locationId;
    if (status) filter.status = status;
    if (req.query.paymentStatus) {
      filter.paymentStatus = req.query.paymentStatus;
    }

    const requestedTimeBasis = timeBasis === "payment" ? "payment" : "sale";
    const startDateObj = startDate ? new Date(startDate) : null;
    const endDateObj = endDate ? new Date(endDate) : null;

    if (requestedTimeBasis === "sale" && (startDateObj || endDateObj)) {
      filter.createdAt = {};
      if (startDateObj) filter.createdAt.$gte = startDateObj;
      if (endDateObj) filter.createdAt.$lte = endDateObj;
    }

    // Delivery category and status filtering
    if (req.query.deliveryCategory) {
      filter.deliveryCategory = req.query.deliveryCategory;
    }
    if (req.query.categoryStatus) {
      filter.categoryStatus = req.query.categoryStatus;
    }
    if (req.query.requiresDelivery) {
      filter.requiresDelivery = req.query.requiresDelivery === "true";
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let sales = [];
    let total = 0;

    if (requestedTimeBasis === "payment") {
      const allSales = await Sale.find(filter)
        .sort({ createdAt: -1 })
        .select("-inventoryUpdates -shopifySyncLog")
        .lean();

      const paymentTimeRows = allSales
        .map((sale) => {
          const salePayments = getEffectivePaymentsForSale(sale);

          const matchedPayments = salePayments.filter((payment) => {
            if ((payment.status || "completed") !== "completed") {
              return false;
            }

            if (paymentMethod && payment.method !== paymentMethod) {
              return false;
            }

            return isDateWithinRange({
              value: payment.paidAt || sale.createdAt,
              startDate: startDateObj,
              endDate: endDateObj,
            });
          });

          if (matchedPayments.length === 0) {
            return null;
          }

          let amountPaidInRange = 0;
          let lastPaymentAtInRange = null;
          let paymentMethodsInRange = [];

          amountPaidInRange = roundMoney(
            matchedPayments.reduce(
              (sum, payment) => sum + (Number(payment.amount) || 0),
              0,
            ),
          );

          const paymentDates = matchedPayments
            .map((payment) => normalizePaymentTimestamp(payment.paidAt, sale.createdAt))
            .filter(Boolean);

          if (paymentDates.length > 0) {
            lastPaymentAtInRange = paymentDates
              .sort((a, b) => b.getTime() - a.getTime())[0]
              .toISOString();
          }

          paymentMethodsInRange = [
            ...new Set(matchedPayments.map((payment) => payment.method).filter(Boolean)),
          ];

          return {
            ...sale,
            amountPaidInRange,
            lastPaymentAtInRange,
            paymentMethodsInRange,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = normalizePaymentTimestamp(
            a.lastPaymentAtInRange,
            a.createdAt,
          ).getTime();
          const bTime = normalizePaymentTimestamp(
            b.lastPaymentAtInRange,
            b.createdAt,
          ).getTime();

          return bTime - aTime;
        });

      total = paymentTimeRows.length;
      sales = paymentTimeRows.slice(skip, skip + parseInt(limit));
    } else {
      if (paymentMethod) {
        const allSales = await Sale.find(filter)
          .sort({ createdAt: -1 })
          .select("-inventoryUpdates -shopifySyncLog")
          .lean();

        const filteredSales = allSales.filter((sale) =>
          getEffectivePaymentsForSale(sale).some(
            (payment) =>
              (payment.status || "completed") === "completed" &&
              payment.method === paymentMethod,
          ),
        );

        total = filteredSales.length;
        sales = filteredSales.slice(skip, skip + parseInt(limit));
      } else {
        sales = await Sale.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .select("-inventoryUpdates -shopifySyncLog")
          .lean();

        total = await Sale.countDocuments(filter);
      }
    }

    sales = (sales || []).map((saleItem) => ({
      ...saleItem,
      orderStatus: saleItem.status,
      shopifySyncSummary: buildShopifySyncSummary(saleItem),
    }));

    res.json({
      success: true,
      data: {
        sales,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("List sales error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list sales",
      error: error.message,
    });
  }
};

/**
 * POST /sales/:id/void
 * Void a sale
 */
const voidSale = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Void reason is required",
      });
    }

    const sale = await Sale.findOne({ _id: id, organizationId });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    if (sale.status === "voided") {
      return res.status(400).json({
        success: false,
        message: "Sale is already voided",
      });
    }

    // Update sale
    sale.status = "voided";
    sale.voidReason = reason;
    sale.voidedBy = req.user.userId;
    sale.voidedAt = new Date();

    await sale.save();

    // Reverse inventory updates (restock items)
    await reverseInventoryUpdates(sale, organizationId);

    res.json({
      success: true,
      message: "Sale voided successfully",
      data: {
        saleId: sale._id,
        status: sale.status,
        voidedAt: sale.voidedAt,
      },
    });
  } catch (error) {
    console.error("Void sale error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to void sale",
      error: error.message,
    });
  }
};

/**
 * POST /sales/:id/refund
 * Process refund for a sale
 */
const refundSale = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { items, reason } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items array is required with at least one item",
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Refund reason is required",
      });
    }

    const sale = await Sale.findOne({ _id: id, organizationId });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    if (sale.status === "voided") {
      return res.status(400).json({
        success: false,
        message: "Cannot refund a voided sale",
      });
    }

    // Validate returned items
    let refundAmount = 0;
    const refundedItems = [];

    for (const refundItem of items) {
      const { itemIndex, quantity } = refundItem;

      if (itemIndex === undefined || !quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Each item must have itemIndex and quantity > 0",
        });
      }

      const saleItem = sale.items[itemIndex];
      if (!saleItem) {
        return res.status(400).json({
          success: false,
          message: `Item index ${itemIndex} not found in sale`,
        });
      }

      const alreadyRefunded = saleItem.quantityRefunded || 0;
      const availableToRefund = saleItem.quantity - alreadyRefunded;

      if (quantity > availableToRefund) {
        return res.status(400).json({
          success: false,
          message: `Refund quantity (${quantity}) cannot exceed available quantity (${availableToRefund}) for item ${itemIndex}. Already refunded: ${alreadyRefunded}`,
        });
      }

      // Calculate proportional refund
      const itemRefund =
        (saleItem.lineTotal + saleItem.taxAmount - saleItem.discount) *
        (quantity / saleItem.quantity);
      refundAmount += itemRefund;

      refundedItems.push({
        itemIndex,
        quantity,
        saleItem,
        refundAmount: itemRefund,
      });
    }

    // Update item-level refund tracking
    for (const refundItem of refundedItems) {
      sale.items[refundItem.itemIndex].quantityRefunded =
        (sale.items[refundItem.itemIndex].quantityRefunded || 0) +
        refundItem.quantity;
    }

    // Log refund in history
    if (!sale.refundHistory) sale.refundHistory = [];
    sale.refundHistory.push({
      refundedBy: req.user.userId,
      refundedAt: new Date(),
      reason,
      amount: refundAmount,
      items: refundedItems.map((r) => ({
        itemIndex: r.itemIndex,
        quantity: r.quantity,
        refundAmount: r.refundAmount,
      })),
    });

    // Update sale
    const isPartial = refundAmount < sale.totalAmount;
    sale.status = isPartial ? "partial_refund" : "voided";
    sale.refundAmount = (sale.refundAmount || 0) + refundAmount;
    sale.refundReason = reason;
    sale.refundedAt = new Date();

    await sale.save();

    // Restore inventory for refunded items
    await reverseInventoryForItems(sale, organizationId, refundedItems);

    res.json({
      success: true,
      message: "Refund processed successfully",
      data: {
        saleId: sale._id,
        refundAmount,
        totalRefunded: sale.refundAmount,
        status: sale.status,
        refundedAt: sale.refundedAt,
        itemsRefunded: refundedItems.length,
      },
    });
  } catch (error) {
    console.error("Refund sale error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process refund",
      error: error.message,
    });
  }
};

/**
 * GET /sales/reports/summary
 * Sales summary for reporting
 */
const getSalesSummary = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const {
      locationId,
      startDate,
      endDate,
      status,
      paymentMethod,
      paymentStatus,
      shopifySyncStatus,
      timeBasis,
    } = req.query;

    const requestedTimeBasis =
      timeBasis === "payment" ? "payment" : "sale";

    const startDateObj = startDate ? new Date(startDate) : null;
    const endDateObj = endDate ? new Date(endDate) : null;

    const filter = { organizationId };
    filter.status = status || "completed";

    if (locationId) filter.locationId = locationId;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (shopifySyncStatus) filter.shopifySyncStatus = shopifySyncStatus;

    if (requestedTimeBasis === "sale" && (startDateObj || endDateObj)) {
      filter.createdAt = {};
      if (startDateObj) filter.createdAt.$gte = startDateObj;
      if (endDateObj) filter.createdAt.$lte = endDateObj;
    }

    const sales = await Sale.find(filter)
      .select(
        "totalAmount deliveryFeeAmount taxAmount discountAmount taxMode items payments paymentCorrections paymentMethod createdAt",
      )
      .lean();

    let totalRevenue = 0;
    let grossRevenue = 0;
    let exchangeCreditApplied = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    let deliveryAmountCollected = 0;
    let salesAmountExcludingDelivery = 0;
    let netSalesExcludingTax = 0;
    let preDiscountSales = 0;
    let deliverySalesCount = 0;
    let fleximCount = 0;
    let shopifyCount = 0;
    let transactionCount = 0;

    const taxModeBreakdown = {
      inclusive: {
        transactions: 0,
        totalRevenue: 0,
        totalTax: 0,
      },
      exclusive: {
        transactions: 0,
        totalRevenue: 0,
        totalTax: 0,
      },
    };

    const accumulateSummaryTotals = ({
      sale,
      grossRevenueAmount,
      revenueAmount,
      exchangeCreditAmount,
      taxAmount,
      discountAmount,
      deliveryAmount,
      transactionIncrement,
    }) => {
      grossRevenue += grossRevenueAmount;
      totalRevenue += revenueAmount;
      exchangeCreditApplied += exchangeCreditAmount;
      totalTax += taxAmount;
      totalDiscount += discountAmount;
      deliveryAmountCollected += deliveryAmount;

      const baseSalesAmount = Math.max(0, grossRevenueAmount - deliveryAmount);
      salesAmountExcludingDelivery += baseSalesAmount;

      const netAmount = Math.max(0, baseSalesAmount - taxAmount);
      netSalesExcludingTax += netAmount;
      preDiscountSales += netAmount + discountAmount;

      const mode = sale.taxMode === "exclusive" ? "exclusive" : "inclusive";
      taxModeBreakdown[mode].transactions += transactionIncrement;
      taxModeBreakdown[mode].totalRevenue += grossRevenueAmount;
      taxModeBreakdown[mode].totalTax += taxAmount;
    };

    if (requestedTimeBasis === "payment") {
      for (const sale of sales) {
        const salePayments = getEffectivePaymentsForSale(sale);

        const matchedPayments = salePayments.filter((payment) => {
          if ((payment.status || "completed") !== "completed") {
            return false;
          }

          if (paymentMethod && payment.method !== paymentMethod) {
            return false;
          }

          return isDateWithinRange({
            value: payment.paidAt || sale.createdAt,
            startDate: startDateObj,
            endDate: endDateObj,
          });
        });

        const {
          grossAmount: matchedGrossAmount,
          exchangeCreditAmount: matchedExchangeCredit,
          netCollectedAmount: matchedNetCollected,
        } = summarizePaymentAmounts(matchedPayments);

        if (matchedPayments.length === 0) {
          continue;
        }

        if (matchedGrossAmount <= 0) {
          continue;
        }

        const completedTotal = getCompletedPaymentsTotal(salePayments);
        const allocationRatio =
          completedTotal > 0
            ? Math.min(1, roundMoney(matchedGrossAmount / completedTotal))
            : 0;
        const saleDeliveryAmount = Number(sale.deliveryFeeAmount) || 0;
        const allocatedDeliveryAmount = saleDeliveryAmount * allocationRatio;

        accumulateSummaryTotals({
          sale,
          grossRevenueAmount: matchedGrossAmount,
          revenueAmount: matchedNetCollected,
          exchangeCreditAmount: matchedExchangeCredit,
          taxAmount: (Number(sale.taxAmount) || 0) * allocationRatio,
          discountAmount: (Number(sale.discountAmount) || 0) * allocationRatio,
          deliveryAmount: allocatedDeliveryAmount,
          transactionIncrement: matchedPayments.length,
        });

        if (saleDeliveryAmount > 0) {
          deliverySalesCount += 1;
        }
        transactionCount += matchedPayments.length;

        for (const item of sale.items || []) {
          const allocatedQty = (Number(item.quantity) || 0) * allocationRatio;
          if (item.type === "flexi") fleximCount += allocatedQty;
          else if (item.type === "shopify") shopifyCount += allocatedQty;
        }
      }
    } else {
      for (const sale of sales) {
        const salePayments = getEffectivePaymentsForSale(sale);

        if (paymentMethod) {
          const hasMatchingMethod = salePayments.some(
            (payment) =>
              (payment.status || "completed") === "completed" &&
              payment.method === paymentMethod,
          );

          if (!hasMatchingMethod) {
            continue;
          }
        }

        const saleDeliveryAmount = Number(sale.deliveryFeeAmount) || 0;
        const saleGrossAmount = roundMoney(Number(sale.totalAmount) || 0);
        const {
          exchangeCreditAmount: saleExchangeCredit,
          netCollectedAmount: saleNetCollected,
        } = summarizePaymentAmounts(salePayments);

        accumulateSummaryTotals({
          sale,
          grossRevenueAmount: saleGrossAmount,
          revenueAmount: saleNetCollected,
          exchangeCreditAmount: saleExchangeCredit,
          taxAmount: Number(sale.taxAmount) || 0,
          discountAmount: Number(sale.discountAmount) || 0,
          deliveryAmount: saleDeliveryAmount,
          transactionIncrement: 1,
        });

        if (saleDeliveryAmount > 0) {
          deliverySalesCount += 1;
        }
        transactionCount += 1;

        for (const item of sale.items || []) {
          if (item.type === "flexi") fleximCount += Number(item.quantity) || 0;
          else if (item.type === "shopify") shopifyCount += Number(item.quantity) || 0;
        }
      }
    }

    totalRevenue = roundMoney(totalRevenue);
    grossRevenue = roundMoney(grossRevenue);
    exchangeCreditApplied = roundMoney(exchangeCreditApplied);
    totalTax = roundMoney(totalTax);
    totalDiscount = roundMoney(totalDiscount);
    deliveryAmountCollected = roundMoney(deliveryAmountCollected);
    salesAmountExcludingDelivery = roundMoney(salesAmountExcludingDelivery);
    netSalesExcludingTax = roundMoney(netSalesExcludingTax);
    preDiscountSales = roundMoney(preDiscountSales);
    // New: Subtotal excluding both exchange credit and discounts
    let subtotalExclCreditAndDiscount = Math.max(
      0,
      preDiscountSales - exchangeCreditApplied - totalDiscount,
    );
    subtotalExclCreditAndDiscount = roundMoney(subtotalExclCreditAndDiscount);
    const roundedFlexiCount = Math.round(fleximCount);
    const roundedShopifyCount = Math.round(shopifyCount);

    // Aggregate approved expenses for the requested period/location
    let totalExpenses = 0;
    try {
      const normalizedOrganizationId = toObjectIdIfValid(organizationId);
      const normalizedLocationId = toObjectIdIfValid(locationId);

      const expenseFilter = {
        organizationId: normalizedOrganizationId,
        status: "approved",
      };

      if (normalizedLocationId) {
        expenseFilter.locationId = normalizedLocationId;
      }

      if (startDateObj || endDateObj) {
        const dateRange = {};
        if (startDateObj) dateRange.$gte = startDateObj;
        if (endDateObj) dateRange.$lte = endDateObj;

        expenseFilter.$or = [
          { expenseDate: dateRange },
          { expenseDate: { $exists: false }, createdAt: dateRange },
        ];
      }

      const expenseAgg = await Expense.aggregate([
        { $match: expenseFilter },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      totalExpenses = roundMoney(expenseAgg[0]?.total || 0);
    } catch (expErr) {
      console.error("Failed to aggregate expenses for sales summary:", expErr);
      totalExpenses = 0;
    }

    const modeEntries = Object.entries(taxModeBreakdown)
      .map(([mode, totals]) => ({
        mode,
        transactions: totals.transactions,
        totalRevenue: roundMoney(totals.totalRevenue),
        totalTax: roundMoney(totals.totalTax),
      }))
      .filter((entry) => entry.transactions > 0 || entry.totalRevenue > 0);

    const taxDisplayMode =
      modeEntries.length > 1
        ? "mixed"
        : modeEntries.length === 1
          ? modeEntries[0].mode
          : "inclusive";

    res.json({
      success: true,
        data: {
        totalSales: transactionCount,
        totalRevenue,
        grossRevenue,
        netCollected: totalRevenue,
        exchangeCreditApplied,
        salesAmountExcludingDelivery,
        netSalesExcludingTax,
        preDiscountSales,
          subtotalExclCreditAndDiscount,
        totalTax,
        totalDiscount,
        deliveryAmountCollected,
        // Expenses (approved) for the requested range/location
        totalExpenses,
        netProfitAfterExpenses:
          typeof totalExpenses !== "undefined"
            ? roundMoney(netSalesExcludingTax - totalExpenses)
            : null,
        expenseToRevenueRatio:
          grossRevenue > 0 ? roundMoney((totalExpenses / grossRevenue) * 100) : 0,
        taxDisplayMode,
        taxModeBreakdown: {
          inclusive: modeEntries.find((entry) => entry.mode === "inclusive") || {
            mode: "inclusive",
            transactions: 0,
            totalRevenue: 0,
            totalTax: 0,
          },
          exclusive: modeEntries.find((entry) => entry.mode === "exclusive") || {
            mode: "exclusive",
            transactions: 0,
            totalRevenue: 0,
            totalTax: 0,
          },
        },
        deliverySalesCount,
        deliveryAmountShareOfRevenue:
          grossRevenue > 0
            ? roundMoney((deliveryAmountCollected / grossRevenue) * 100)
            : 0,
        deliveryAmountShareOfNetRevenue:
          totalRevenue > 0
            ? roundMoney((deliveryAmountCollected / totalRevenue) * 100)
            : 0,
        averageTransactionValue:
          transactionCount > 0 ? roundMoney(totalRevenue / transactionCount) : 0,
        averageGrossTransactionValue:
          transactionCount > 0 ? roundMoney(grossRevenue / transactionCount) : 0,
        itemsSold: {
          flexi: roundedFlexiCount,
          shopify: roundedShopifyCount,
          total: roundedFlexiCount + roundedShopifyCount,
        },
        timeBasis: requestedTimeBasis,
        paymentMethodBreakdown: await getPaymentMethodBreakdown({
          filter,
          timeBasis: requestedTimeBasis,
          startDate: startDateObj,
          endDate: endDateObj,
          paymentMethod,
        }),
      },
    });
  } catch (error) {
    console.error("Sales summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get sales summary",
      error: error.message,
    });
  }
};

/**
 * Helper: Get payment method breakdown
 */
async function getPaymentMethodBreakdown({
  filter,
  timeBasis = "sale",
  startDate,
  endDate,
  paymentMethod,
}) {
  const sales = await Sale.find(filter)
    .select("paymentMethod payments paymentCorrections totalAmount createdAt")
    .lean();

  const map = {};

  const add = (method, amount) => {
    if (!method) return;
    if (!map[method]) {
      map[method] = {
        count: 0,
        total: 0,
        netCollected: 0,
        exchangeCreditApplied: 0,
      };
    }

    const isExchangeCredit = INTERNAL_CREDIT_PAYMENT_METHODS.has(method);

    map[method].count += 1;
    map[method].total += amount;
    if (isExchangeCredit) {
      map[method].exchangeCreditApplied += amount;
    } else {
      map[method].netCollected += amount;
    }
  };

  for (const sale of sales) {
    const salePayments = getEffectivePaymentsForSale(sale);

    for (const payment of salePayments) {
      if ((payment.status || "completed") !== "completed") {
        continue;
      }

      if (paymentMethod && payment.method !== paymentMethod) {
        continue;
      }

      if (
        timeBasis === "payment" &&
        !isDateWithinRange({
          value: payment.paidAt || sale.createdAt,
          startDate,
          endDate,
        })
      ) {
        continue;
      }

      add(payment.method, Number(payment.amount) || 0);
    }
  }

  for (const methodData of Object.values(map)) {
    methodData.total = roundMoney(methodData.total);
    methodData.netCollected = roundMoney(methodData.netCollected);
    methodData.exchangeCreditApplied = roundMoney(methodData.exchangeCreditApplied);
  }

  return map;
}

/**
 * Helper: Reverse inventory updates (used for voids and full refunds)
 */
async function reverseInventoryUpdates(sale, organizationId) {
  const connection = await ShopifyConnection.findOne({ organizationId }).select(
    "+clientId +clientSecret +accessToken +tokenExpiresAt",
  );
  const flexiLocation = await Location.findOne({
    _id: sale.locationId,
    organizationId,
  });

  for (let i = 0; i < sale.items.length; i++) {
    const item = sale.items[i];

    if (item.type === "flexi") {
      try {
        const inventory = await Inventory.findOne({
          productId: item.productId,
          locationId: sale.locationId,
        });

        if (inventory) {
          const previousStock = inventory.quantity || 0;
          const newStock = previousStock + item.quantity;

          await Inventory.updateOne(
            { _id: inventory._id },
            {
              $set: {
                quantity: newStock,
                lastModified: new Date(),
              },
            },
          );

          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "flexi",
            productId: item.productId,
            quantityDeducted: -item.quantity,
            previousStock,
            newStock,
            status: "success",
          });
        }
      } catch (error) {
        console.error(
          `[Sales] FLEXI inventory reversal failed for item ${i}:`,
          error.message,
        );
        sale.inventoryUpdates.push({
          itemId: i.toString(),
          type: "flexi",
          productId: item.productId,
          quantityDeducted: -item.quantity,
          status: "failed",
          error: error.message,
        });
      }
    } else if (item.type === "shopify" && connection) {
      try {
        await updateShopifyInventory(
          organizationId,
          item.shopifyVariantId,
          item.quantity,
          sale._id,
          flexiLocation?.shopifyLocationId,
        );

        sale.inventoryUpdates.push({
          itemId: i.toString(),
          type: "shopify",
          shopifyVariantId: item.shopifyVariantId,
          quantityDeducted: -item.quantity,
          status: "success",
        });
      } catch (error) {
        console.error(
          `[Sales] Shopify inventory reversal failed for item ${i}:`,
          error.message,
        );

        // Permanent failure — variant deleted; no point queuing a restock
        if (error.permanent === true) {
          console.error(
            `[Sales] Permanent Shopify sync failure for variant ${item.shopifyVariantId} (reversal) — not queuing:`,
            error.message,
          );
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: -item.quantity,
            status: "failed",
            error: error.message,
          });
          continue; // eslint-disable-line no-continue
        }

        // Transient failure — attempt to queue for retry
        try {
          await queueInventoryUpdate(
            organizationId,
            null,
            item.shopifyVariantId,
            item.quantity, // positive = restock
            null,
            sale._id,
            flexiLocation?.shopifyLocationId,
          );

          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: -item.quantity,
            status: "pending",
            error: error.message,
          });
        } catch (queueError) {
          console.error(
            `[Sales] Queueing Shopify reversal failed for item ${i}:`,
            queueError.message,
          );
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: -item.quantity,
            status: "failed",
            error: queueError.message,
          });
        }
      }
    }
  }

  await Sale.updateOne(
    { _id: sale._id },
    {
      $set: {
        inventoryUpdates: sale.inventoryUpdates,
        shopifySyncStatus: sale.shopifySyncStatus,
        shopifySyncLog: sale.shopifySyncLog,
      },
    },
  );
}

/**
 * Helper: Reverse inventory for specific refunded items
 */
async function reverseInventoryForItems(sale, organizationId, refundedItems) {
  const connection = await ShopifyConnection.findOne({ organizationId }).select(
    "+clientId +clientSecret +accessToken +tokenExpiresAt",
  );
  const flexiLocation = await Location.findOne({
    _id: sale.locationId,
    organizationId,
  });

  for (const refundItem of refundedItems) {
    const { itemIndex, quantity, saleItem } = refundItem;

    if (saleItem.type === "flexi") {
      try {
        const inventory = await Inventory.findOne({
          productId: saleItem.productId,
          locationId: sale.locationId,
        });

        if (inventory) {
          const previousStock = inventory.quantity || 0;
          const newStock = previousStock + quantity;

          await Inventory.updateOne(
            { _id: inventory._id },
            {
              $set: {
                quantity: newStock,
                lastModified: new Date(),
              },
            },
          );

          sale.inventoryUpdates.push({
            itemId: `refund-${itemIndex}`,
            type: "flexi",
            productId: saleItem.productId,
            quantityDeducted: -quantity,
            previousStock,
            newStock,
            status: "success",
          });
        }
      } catch (error) {
        console.error(
          `[Sales] FLEXI inventory refund reversal failed for item ${itemIndex}:`,
          error.message,
        );
        sale.inventoryUpdates.push({
          itemId: `refund-${itemIndex}`,
          type: "flexi",
          productId: saleItem.productId,
          quantityDeducted: -quantity,
          status: "failed",
          error: error.message,
        });
      }
    } else if (saleItem.type === "shopify" && connection) {
      try {
        await updateShopifyInventory(
          organizationId,
          saleItem.shopifyVariantId,
          quantity,
          sale._id,
          flexiLocation?.shopifyLocationId,
        );

        sale.inventoryUpdates.push({
          itemId: `refund-${itemIndex}`,
          type: "shopify",
          shopifyVariantId: saleItem.shopifyVariantId,
          quantityDeducted: -quantity,
          status: "success",
        });
      } catch (error) {
        console.error(
          `[Sales] Shopify inventory refund reversal failed for item ${itemIndex}:`,
          error.message,
        );

        // Permanent failure — variant deleted; no point queuing a restock
        if (error.permanent === true) {
          console.error(
            `[Sales] Permanent Shopify sync failure for variant ${saleItem.shopifyVariantId} (refund reversal) — not queuing:`,
            error.message,
          );
          sale.inventoryUpdates.push({
            itemId: `refund-${itemIndex}`,
            type: "shopify",
            shopifyVariantId: saleItem.shopifyVariantId,
            quantityDeducted: -quantity,
            status: "failed",
            error: error.message,
          });
        } else {
        // Transient failure — attempt to queue for retry
        try {
          await queueInventoryUpdate(
            organizationId,
            null,
            saleItem.shopifyVariantId,
            quantity, // positive = restock
            null,
            sale._id,
            flexiLocation?.shopifyLocationId,
          );

          sale.inventoryUpdates.push({
            itemId: `refund-${itemIndex}`,
            type: "shopify",
            shopifyVariantId: saleItem.shopifyVariantId,
            quantityDeducted: -quantity,
            status: "pending",
            error: error.message,
          });
        } catch (queueError) {
          console.error(
            `[Sales] Queueing Shopify refund reversal failed for item ${itemIndex}:`,
            queueError.message,
          );
          sale.inventoryUpdates.push({
            itemId: `refund-${itemIndex}`,
            type: "shopify",
            shopifyVariantId: saleItem.shopifyVariantId,
            quantityDeducted: -quantity,
            status: "failed",
            error: queueError.message,
          });
        }
        } // end else (transient)
      }
    }
  }

  await Sale.updateOne(
    { _id: sale._id },
    {
      $set: {
        inventoryUpdates: sale.inventoryUpdates,
        shopifySyncStatus: sale.shopifySyncStatus,
        shopifySyncLog: sale.shopifySyncLog,
      },
    },
  );
}

/**
 * GET /reports/by-delivery-category
 * Get sales breakdown by delivery category with metrics
 */
const getDeliveryCategoryReport = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { locationId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    const filter = {
      organizationId,
      status: "completed",
      requiresDelivery: true,
      deliveryCategory: { $exists: true, $ne: null },
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    if (locationId) filter.locationId = locationId;

    const sales = await Sale.find(filter).lean();

    // Group by delivery category
    const categoryMap = {};
    let totalRevenue = 0;
    let totalDeliveryFees = 0;

    for (const sale of sales) {
      const category = sale.deliveryCategory || "Uncategorized";
      const option = sale.deliveryOption || "Standard";
      const catStatus = sale.categoryStatus || sale.deliveryStatus || "pending";

      if (!categoryMap[category]) {
        categoryMap[category] = {
          category,
          count: 0,
          revenue: 0,
          deliveryFees: 0,
          byOption: {},
          byStatus: {},
        };
      }

      const categoryRecord = categoryMap[category];
      categoryRecord.count += 1;
      categoryRecord.revenue += Number(sale.totalAmount) || 0;
      categoryRecord.deliveryFees +=
        (sale.deliveryInfo?.deliveryFee || 0);

      // Track by option
      if (!categoryRecord.byOption[option]) {
        categoryRecord.byOption[option] = { count: 0, revenue: 0 };
      }
      categoryRecord.byOption[option].count += 1;
      categoryRecord.byOption[option].revenue +=
        Number(sale.totalAmount) || 0;

      // Track by status
      if (!categoryRecord.byStatus[catStatus]) {
        categoryRecord.byStatus[catStatus] = { count: 0, revenue: 0 };
      }
      categoryRecord.byStatus[catStatus].count += 1;
      categoryRecord.byStatus[catStatus].revenue +=
        Number(sale.totalAmount) || 0;

      totalRevenue += Number(sale.totalAmount) || 0;
      totalDeliveryFees += sale.deliveryInfo?.deliveryFee || 0;
    }

    // Calculate percentages
    const byCategory = {};
    for (const [category, data] of Object.entries(categoryMap)) {
      byCategory[category] = {
        ...data,
        percentage: totalRevenue > 0 ? 
          ((data.revenue / totalRevenue) * 100).toFixed(2) + "%" : 
          "0%",
        avgFee: data.count > 0 ? 
          (data.deliveryFees / data.count).toFixed(2) : 
          "0",
      };
    }

    res.json({
      success: true,
      data: {
        period: {
          startDate,
          endDate,
        },
        summary: {
          totalCategories: Object.keys(byCategory).length,
          totalDeliveries: sales.length,
          totalRevenue: totalRevenue.toFixed(2),
          totalDeliveryFees: totalDeliveryFees.toFixed(2),
        },
        byCategory,
      },
    });
  } catch (error) {
    console.error("Delivery category report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate delivery category report",
      error: error.message,
    });
  }
};

/**
 * GET /reports/delivery-metrics
 * Get high-level delivery KPIs and performance metrics
 */
const getDeliveryMetrics = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { locationId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    const filter = {
      organizationId,
      status: "completed",
      requiresDelivery: true,
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    if (locationId) filter.locationId = locationId;

    const allDeliveries = await Sale.find(filter).lean();

    // Calculate metrics
    const successStatuses = ["delivered", "completed", "completed-successfully"];
    const failedStatuses = ["failed", "undeliverable", "cancelled"];

    let successfulCount = 0;
    let failedCount = 0;
    let totalDeliveryFees = 0;
    let totalRevenue = 0;

    for (const sale of allDeliveries) {
      const saleStatus = sale.categoryStatus || 
                        sale.deliveryStatus || 
                        "pending";
      
      if (successStatuses.includes(saleStatus.toLowerCase())) {
        successfulCount += 1;
      } else if (failedStatuses.includes(saleStatus.toLowerCase())) {
        failedCount += 1;
      }

      totalDeliveryFees += sale.deliveryInfo?.deliveryFee || 0;
      totalRevenue += Number(sale.totalAmount) || 0;
    }

    const totalDeliveries = allDeliveries.length;
    const successRate = totalDeliveries > 0 ? 
      ((successfulCount / totalDeliveries) * 100).toFixed(2) : 
      "0";
    const failureRate = totalDeliveries > 0 ? 
      ((failedCount / totalDeliveries) * 100).toFixed(2) : 
      "0";
    const avgDeliveryFee = totalDeliveries > 0 ? 
      (totalDeliveryFees / totalDeliveries).toFixed(2) : 
      "0";
    const feePercentage = totalRevenue > 0 ? 
      ((totalDeliveryFees / totalRevenue) * 100).toFixed(2) : 
      "0";

    res.json({
      success: true,
      data: {
        period: {
          startDate,
          endDate,
        },
        metrics: {
          totalDeliveries,
          successfulDeliveries: successfulCount,
          failedDeliveries: failedCount,
          pendingDeliveries: totalDeliveries - successfulCount - failedCount,
          successRate: successRate + "%",
          failureRate: failureRate + "%",
          totalDeliveryFees: totalDeliveryFees.toFixed(2),
          avgDeliveryFee,
          deliveryFeesAsPercentOfRevenue: feePercentage + "%",
        },
      },
    });
  } catch (error) {
    console.error("Delivery metrics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to calculate delivery metrics",
      error: error.message,
    });
  }
};

/**
 * GET /reports/delivery-status-flow
 * Get distribution of deliveries across different statuses (bottleneck analysis)
 */
const getDeliveryStatusFlow = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { locationId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    const filter = {
      organizationId,
      status: "completed",
      requiresDelivery: true,
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    if (locationId) filter.locationId = locationId;

    const deliveries = await Sale.find(filter)
      .select("categoryStatus deliveryStatus")
      .lean();

    // Count by status
    const statusCounts = {};
    let totalDeliveries = 0;

    for (const delivery of deliveries) {
      totalDeliveries += 1;
      const status = 
        delivery.categoryStatus || 
        delivery.deliveryStatus || 
        "pending";

      if (!statusCounts[status]) {
        statusCounts[status] = 0;
      }
      statusCounts[status] += 1;
    }

    // Calculate percentages
    const statusFlow = {};
    const percentages = {};

    for (const [status, count] of Object.entries(statusCounts)) {
      statusFlow[status] = count;
      percentages[status] = totalDeliveries > 0 ? 
        ((count / totalDeliveries) * 100).toFixed(2) + "%" : 
        "0%";
    }

    // Sort by count (highest first) for bottleneck visibility
    const sortedFlow = Object.entries(statusFlow)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [key, val]) => {
        obj[key] = val;
        return obj;
      }, {});

    const sortedPercentages = Object.entries(percentages)
      .sort((a, b) => parseInt(b[1]) - parseInt(a[1]))
      .reduce((obj, [key, val]) => {
        obj[key] = val;
        return obj;
      }, {});

    res.json({
      success: true,
      data: {
        period: {
          startDate,
          endDate,
        },
        totalDeliveries,
        statusFlow: sortedFlow,
        percentages: sortedPercentages,
        topBottleneck: Object.keys(sortedFlow)[0] || "none",
      },
    });
  } catch (error) {
    console.error("Delivery status flow error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate delivery status flow report",
      error: error.message,
    });
  }
};

// Routes
router.post(
  "/",
  requirePermission("create_sale"),
  validateLocationAccess,
  createSale,
);
router.get(
  "/reports/summary",
  requirePermission("view_reports"),
  getSalesSummary,
);
router.get(
  "/reports/by-delivery-category",
  requirePermission("view_reports"),
  getDeliveryCategoryReport,
);
router.get(
  "/reports/delivery-metrics",
  requirePermission("view_reports"),
  getDeliveryMetrics,
);
router.get(
  "/reports/delivery-status-flow",
  requirePermission("view_reports"),
  getDeliveryStatusFlow,
);
router.get(
  "/receivables",
  requirePermission("view_sale_history"),
  listReceivables,
);
router.get(
  "/:id/receivable",
  requirePermission("view_sale_history"),
  getSaleReceivable,
);
router.post(
  "/:id/payments",
  requirePermission("create_sale"),
  recordSalePayment,
);
router.patch(
  "/:id/payments/reallocate",
  requirePermission("edit_sale"),
  reallocateSalePayment,
);
router.get("/:id", requirePermission("view_sale_history"), getSale);
router.get("/", requirePermission("view_sale_history"), listSales);
router.post("/:id/void", requirePermission("refund_sale"), voidSale);
router.post("/:id/refund", requirePermission("refund_sale"), refundSale);

module.exports = router;
