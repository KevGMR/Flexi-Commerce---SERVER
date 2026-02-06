const express = require("express");
const router = express.Router();
const Sale = require("../models/Sale");
const Location = require("../models/Location");
const Product = require("../models/Product");
const ShopifyConnection = require("../models/ShopifyConnection");
const UserOrganization = require("../models/UserOrganization");
const {
  updateShopifyInventory,
  queueInventoryUpdate,
} = require("../services/shopifySync");
const Inventory = require("../models/Inventory");
const { requirePermission } = require("../middleware/permissionCheck");
const { validateLocationAccess } = require("../middleware/locationAccess");

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
        const lineTax = item.taxAmount || 0;

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
        const lineTax = item.taxAmount || 0;

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
          message: 'Item type must be "flexi" or "shopify"',
        });
      }
    }

    const totalAmount = subtotal + totalTax - totalDiscount;

    // Prepare payments (support split payments)
    let normalizedPayments = [];
    if (payments && Array.isArray(payments) && payments.length > 0) {
      // Basic validation
      const sum = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      if (Math.abs(sum - totalAmount) > 0.01) {
        return res.status(400).json({
          success: false,
          message: `Payments total (${sum.toFixed(2)}) must equal sale total (${totalAmount.toFixed(2)})`,
        });
      }

      normalizedPayments = payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount) || 0,
        reference: p.reference || undefined,
        status: p.status || "completed",
        cardLast4: p.cardLast4 || undefined,
        cardBrand: p.cardBrand || undefined,
      }));
    } else if (paymentMethod) {
      normalizedPayments = [
        {
          method: paymentMethod,
          amount: totalAmount,
          status: paymentStatus || "completed",
        },
      ];
    }

    // Derive overall payment status
    const overallPaymentStatus = (() => {
      if (!normalizedPayments || normalizedPayments.length === 0)
        return "pending";
      const statuses = normalizedPayments.map((p) => p.status || "completed");
      if (statuses.every((s) => s === "completed")) return "completed";
      if (statuses.some((s) => s === "pending")) return "pending";
      if (statuses.some((s) => s === "failed")) return "failed";
      return "pending";
    })();

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
        totalAmount,
        paymentMethod:
          normalizedPayments.length === 1
            ? normalizedPayments[0].method
            : undefined,
        payments: normalizedPayments,
        paymentStatus: overallPaymentStatus,
        cashierId: req.user.userId,
        status: "completed",
        completedAt: new Date(),
        inventoryStatus: "pending",
        notes,
        tags: tags || [],
      });

      await sale.save({ session });

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
          status: sale.status,
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

        // Attempt to queue for retry so offline sync can complete later
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
            status: "pending",
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

    res.json({
      success: true,
      data: sale,
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
      receiptNumber,
      idempotencyKey,
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
    if (locationId) filter.locationId = locationId;
    if (status) filter.status = status;
    if (paymentMethod) {
      const paymentFilters = [
        { paymentMethod },
        { "payments.method": paymentMethod },
      ];

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: paymentFilters }];
        delete filter.$or;
      } else if (filter.$and) {
        filter.$and.push({ $or: paymentFilters });
      } else {
        filter.$or = paymentFilters;
      }
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-inventoryUpdates -shopifySyncLog") // Exclude large arrays in list
      .lean();

    const total = await Sale.countDocuments(filter);

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
    const { locationId, startDate, endDate } = req.query;

    const filter = { organizationId, status: "completed" };

    if (locationId) filter.locationId = locationId;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const sales = await Sale.find(filter).lean();

    let totalRevenue = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    let fleximCount = 0;
    let shopifyCount = 0;

    for (const sale of sales) {
      totalRevenue += sale.totalAmount;
      totalTax += sale.taxAmount;
      totalDiscount += sale.discountAmount;

      for (const item of sale.items) {
        if (item.type === "flexi") fleximCount += item.quantity;
        else if (item.type === "shopify") shopifyCount += item.quantity;
      }
    }

    res.json({
      success: true,
      data: {
        totalSales: sales.length,
        totalRevenue,
        totalTax,
        totalDiscount,
        averageTransactionValue:
          sales.length > 0 ? totalRevenue / sales.length : 0,
        itemsSold: {
          flexi: fleximCount,
          shopify: shopifyCount,
          total: fleximCount + shopifyCount,
        },
        paymentMethodBreakdown: await getPaymentMethodBreakdown(filter),
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
async function getPaymentMethodBreakdown(filter) {
  // Fetch minimal fields for computation
  const sales = await Sale.find(filter)
    .select("paymentMethod payments totalAmount")
    .lean();

  const map = {};

  const add = (method, amount) => {
    if (!method) return;
    if (!map[method]) map[method] = { count: 0, total: 0 };
    map[method].count += 1;
    map[method].total += amount;
  };

  for (const s of sales) {
    if (s.payments && Array.isArray(s.payments) && s.payments.length > 0) {
      for (const p of s.payments) {
        add(p.method, Number(p.amount) || 0);
      }
    } else {
      add(s.paymentMethod, Number(s.totalAmount) || 0);
    }
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

        // Attempt to queue for retry
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

        // Attempt to queue for retry
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
router.get("/:id", requirePermission("view_sale_history"), getSale);
router.get("/", requirePermission("view_sale_history"), listSales);
router.post("/:id/void", requirePermission("refund_sale"), voidSale);
router.post("/:id/refund", requirePermission("refund_sale"), refundSale);

module.exports = router;
