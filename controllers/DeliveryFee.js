const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const DeliveryFee = require("../models/DeliveryFee");
const Sale = require("../models/Sale");
const Receivable = require("../models/Receivable");
const Location = require("../models/Location");
const Driver = require("../models/Driver");
const ShiftSession = require("../models/ShiftSession");
const { requirePermission } = require("../middleware/permissionCheck");
const { validateLocationAccess, getUserAccessibleLocations } = require("../middleware/locationAccess");

const deliveryStatusesRequiringFullPayment = new Set([
  "assigned",
  "ready_for_pickup",
  "in_transit",
  "out_for_delivery",
  "picked_up",
  "delivered",
  "completed",
  "collected",
]);

const validateSalePaymentGate = async ({ organizationId, saleId }) => {
  if (!saleId) {
    return { allowed: true };
  }

  const receivable = await Receivable.findOne({
    organizationId,
    saleId,
    status: { $ne: "cancelled" },
  })
    .select("balanceDue status")
    .lean();

  if (receivable && Number(receivable.balanceDue) > 0.01) {
    return {
      allowed: false,
      balanceDue: Number(receivable.balanceDue),
      status: receivable.status,
    };
  }

  const sale = await Sale.findOne({ _id: saleId, organizationId })
    .select("paymentStatus")
    .lean();

  if (sale && sale.paymentStatus !== "completed") {
    return {
      allowed: false,
      balanceDue: null,
      status: sale.paymentStatus,
    };
  }

  return { allowed: true };
};

/**
 * POST /delivery-fees
 * Create a new delivery fee (standalone or linked to sale)
 */
const createDeliveryFee = async (req, res) => {
  try {
    const { organizationId, userId } = req.user;
    const {
      locationId,
      saleId,
      deliveryCategory,
      deliveryOption,
      deliveryAddress,
      recipientName,
      recipientPhone,
      recipientEmail,
      estimatedDelivery,
      notes,
      deliveryInstructions,
    } = req.body;

    // Validate required fields
    if (
      !locationId ||
      !deliveryAddress ||
      !recipientName ||
      !recipientPhone ||
      !deliveryCategory ||
      !deliveryOption
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: locationId, deliveryCategory, deliveryOption, deliveryAddress, recipientName, recipientPhone",
      });
    }

    // Verify an open shift session exists for this cashier at this location
    const openShift = await ShiftSession.findOne({
      organizationId,
      locationId,
      cashierId: userId,
      status: "open",
    }).lean();

    if (!openShift) {
      return res.status(400).json({
        success: false,
        message: "All deliveries require an open shift at this location",
      });
    }

    // Validate delivery address - only street and city are required
    // Country defaults to "Kenya" if not provided
    if (!deliveryAddress.street || !deliveryAddress.city) {
      const missingFields = [];
      if (!deliveryAddress.street) missingFields.push("street");
      if (!deliveryAddress.city) missingFields.push("city");
      return res.status(400).json({
        success: false,
        message: `Delivery address must include: ${missingFields.join(", ")}`,
      });
    }

    // Validate location belongs to org and get delivery settings
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

    // Determine fee amount and get category/option info
    let amount = 0;
    let categoryStatus = undefined;
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

    // Delivery fees are not taxed
    const taxAmount = 0;
    const totalAmount = amount;

    // If linked to sale, validate it exists and belongs to org
    if (saleId) {
      const sale = await Sale.findOne({ _id: saleId, organizationId });
      if (!sale) {
        return res.status(404).json({
          success: false,
          message: "Sale not found or does not belong to this organization",
        });
      }

      // Check if sale already has a delivery fee
      if (sale.deliveryFeeId) {
        return res.status(400).json({
          success: false,
          message: "Sale already has a delivery fee attached",
        });
      }
    }

    // Create delivery fee
    const deliveryFee = new DeliveryFee({
      organizationId,
      locationId,
      shiftSessionId: openShift._id,
      saleId: saleId || undefined,
      deliveryCategory: deliveryCategory || undefined,
      deliveryOption: deliveryOption || undefined,
      amount,
      isTaxable: false,
      taxAmount,
      totalAmount,
      deliveryAddress,
      recipientName,
      recipientPhone,
      recipientEmail: recipientEmail || undefined,
      estimatedDelivery: estimatedDelivery || undefined,
      notes: notes || undefined,
      deliveryInstructions: deliveryInstructions || undefined,
      categoryStatus: categoryStatus || undefined,
      validationStatus: "pending",
      createdBy: userId,
    });

    await deliveryFee.save();

    // If linked to sale, update the sale
    if (saleId) {
      await Sale.findByIdAndUpdate(saleId, {
        deliveryFeeId: deliveryFee._id,
        deliveryFeeAmount: totalAmount,
        requiresDelivery: true,
        deliveryStatus: "pending",
        deliveryCategory,
        deliveryOption,
        categoryStatus: categoryStatus || "pending",
        $inc: { totalAmount: totalAmount },
      });
    }

    res.status(201).json({
      success: true,
      message: "Delivery fee created successfully",
      data: deliveryFee,
    });
  } catch (error) {
    console.error("Error creating delivery fee:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create delivery fee",
      error: error.message,
    });
  }
};

/**
 * GET /delivery-fees
 * List delivery fees with filters
 */
const listDeliveryFees = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const {
      locationId,
      categoryStatus,
      assigned,
      deliveryCategory,
      deliveryOption,
      driverId,
      saleId,
      startDate,
      endDate,
      searchTerm,
      page = 1,
      limit = 50,
    } = req.query;

    // Get user's accessible locations
    const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);

    // Build query
    const query = { organizationId };

    // Apply location filtering
    if (accessibleLocations !== null) {
      // User has specific location restrictions
      if (locationId && accessibleLocations.includes(String(locationId))) {
        query.locationId = locationId;
      } else if (locationId) {
        // User requested a location they don't have access to
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      } else {
        // Filter to only accessible locations
        query.locationId = { $in: accessibleLocations };
      }
    } else if (locationId) {
      // User has no restrictions (Owner/Manager), can view any location
      query.locationId = locationId;
    }

    if (deliveryCategory) query.deliveryCategory = deliveryCategory;
    if (deliveryOption) query.deliveryOption = deliveryOption;
    if (driverId) query.driverId = driverId;
    if (saleId) query.saleId = saleId;

    const andConditions = [];

    if (req.query.status) {
      return res.status(400).json({
        success: false,
        message: "status query param is deprecated. Use categoryStatus instead.",
      });
    }

    if (categoryStatus) {
      andConditions.push({ categoryStatus });
    }

    if (assigned === "true") {
      andConditions.push({ driverId: { $exists: true, $ne: null } });
    } else if (assigned === "false") {
      andConditions.push({
        $or: [{ driverId: { $exists: false } }, { driverId: null }],
      });
    }

    if (searchTerm) {
      const searchRegex = new RegExp(searchTerm, "i");
      andConditions.push({
        $or: [
          { trackingNumber: searchRegex },
          { recipientName: searchRegex },
          { recipientPhone: searchRegex },
          { recipientEmail: searchRegex },
        ],
      });
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await DeliveryFee.countDocuments(query);

    const deliveryFees = await DeliveryFee.find(query)
      .populate("locationId", "name address")
      .populate("saleId", "receiptNumber transactionId totalAmount")
      .populate("driverId", "name phone")
      .populate("createdBy", "fullname email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: deliveryFees,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error listing delivery fees:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list delivery fees",
      error: error.message,
    });
  }
};

/**
 * GET /delivery-fees/:id
 * Get single delivery fee
 */
const getDeliveryFee = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;

    const deliveryFee = await DeliveryFee.findOne({
      _id: id,
      organizationId,
    })
      .populate("saleId")
      .populate("driverId", "name phone")
      .populate("createdBy", "fullname email")
      .populate("lastModifiedBy", "fullname email");

    if (!deliveryFee) {
      return res.status(404).json({
        success: false,
        message: "Delivery fee not found",
      });
    }

    // Validate location access
    if (!["Owner", "Manager"].includes(role)) {
      const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);
      if (accessibleLocations !== null && !accessibleLocations.some(loc => String(loc) === String(deliveryFee.locationId))) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      }
    }

    res.json({
      success: true,
      data: deliveryFee,
    });
  } catch (error) {
    console.error("Error fetching delivery fee:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch delivery fee",
      error: error.message,
    });
  }
};

/**
 * PATCH /delivery-fees/:id
 * Update delivery fee details
 */
const updateDeliveryFee = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;
    const {
      deliveryAddress,
      recipientName,
      recipientPhone,
      recipientEmail,
      estimatedDelivery,
      notes,
      deliveryInstructions,
    } = req.body;

    const deliveryFee = await DeliveryFee.findOne({
      _id: id,
      organizationId,
    });

    if (!deliveryFee) {
      return res.status(404).json({
        success: false,
        message: "Delivery fee not found",
      });
    }

    // Validate location access
    if (!["Owner", "Manager"].includes(role)) {
      const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);
      if (accessibleLocations !== null && !accessibleLocations.some(loc => String(loc) === String(deliveryFee.locationId))) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      }
    }

    const currentStatus = deliveryFee.categoryStatus;
    const terminalStatuses = [
      "delivered",
      "completed",
      "cancelled",
      "failed",
      "picked_up",
      "collected",
    ];
    if (terminalStatuses.includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update delivery fee with status: ${currentStatus}`,
      });
    }

    if (deliveryAddress) {
      const missingFields = [];
      if (!deliveryAddress.street) missingFields.push("street");
      if (!deliveryAddress.city) missingFields.push("city");
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Delivery address must include: ${missingFields.join(", ")}`,
        });
      }
    }

    // Update fields
    if (deliveryAddress) deliveryFee.deliveryAddress = deliveryAddress;
    if (recipientName) deliveryFee.recipientName = recipientName;
    if (recipientPhone) deliveryFee.recipientPhone = recipientPhone;
    if (recipientEmail !== undefined)
      deliveryFee.recipientEmail = recipientEmail;
    if (estimatedDelivery) deliveryFee.estimatedDelivery = estimatedDelivery;
    if (notes !== undefined) deliveryFee.notes = notes;
    if (deliveryInstructions !== undefined)
      deliveryFee.deliveryInstructions = deliveryInstructions;

    deliveryFee.lastModifiedBy = userId;

    await deliveryFee.save();

    res.json({
      success: true,
      message: "Delivery fee updated successfully",
      data: deliveryFee,
    });
  } catch (error) {
    console.error("Error updating delivery fee:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update delivery fee",
      error: error.message,
    });
  }
};

/**
 * PATCH /delivery-fees/:id/assign
 * Assign delivery to driver
 */
const assignDriver = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: "driverId is required",
      });
    }

    // Verify driver exists and belongs to organization
    const driver = await Driver.findOne({
      _id: driverId,
      organizationId,
    });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    const deliveryFee = await DeliveryFee.findOne({
      _id: id,
      organizationId,
    });

    if (!deliveryFee) {
      return res.status(404).json({
        success: false,
        message: "Delivery fee not found",
      });
    }

    // Validate location access
    if (!["Owner", "Manager"].includes(role)) {
      const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);
      if (accessibleLocations !== null && !accessibleLocations.some(loc => String(loc) === String(deliveryFee.locationId))) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      }
    }

    const currentStatus = deliveryFee.categoryStatus;
    const terminalStatuses = [
      "delivered",
      "completed",
      "cancelled",
      "failed",
      "picked_up",
      "collected",
    ];

    if (terminalStatuses.includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver for delivery with status: ${currentStatus}`,
      });
    }

    const paymentGate = await validateSalePaymentGate({
      organizationId,
      saleId: deliveryFee.saleId,
    });

    if (!paymentGate.allowed) {
      const balanceMessage =
        paymentGate.balanceDue !== null && paymentGate.balanceDue !== undefined
          ? ` Outstanding balance: ${paymentGate.balanceDue.toFixed(2)}.`
          : "";

      return res.status(400).json({
        success: false,
        message: `Delivery cannot be assigned until sale is fully paid.${balanceMessage}`,
        code: "SALE_PAYMENT_REQUIRED",
      });
    }

    deliveryFee.driverId = driverId;
    deliveryFee.assignedAt = new Date();
    let assignedCategoryStatusApplied = false;

    const location = await Location.findOne({
      _id: deliveryFee.locationId,
      organizationId,
    });

    if (location) {
      const category = location.deliveryCategories?.find(
        (cat) => cat.categoryName === deliveryFee.deliveryCategory
      );
      const hasAssignedInWorkflow = Boolean(
        category?.statusWorkflow?.some((wf) => wf.status === "assigned")
      );

      if (hasAssignedInWorkflow) {
        deliveryFee.categoryStatus = "assigned";
        assignedCategoryStatusApplied = true;
      }
    }

    deliveryFee.lastModifiedBy = userId;

    await deliveryFee.save();

    // Update linked sale if exists
    if (deliveryFee.saleId) {
      const saleUpdate = {
        deliveryStatusSyncedAt: new Date(),
      };

      if (assignedCategoryStatusApplied) {
        saleUpdate.deliveryStatus = "assigned";
        saleUpdate.categoryStatus = "assigned";
      }

      await Sale.findByIdAndUpdate(deliveryFee.saleId, saleUpdate);
    }

    res.json({
      success: true,
      message: "Driver assigned successfully",
      data: deliveryFee,
    });
  } catch (error) {
    console.error("Error assigning driver:", error);
    res.status(500).json({
      success: false,
      message: "Failed to assign driver",
      error: error.message,
    });
  }
};

/**
 * PATCH /delivery-fees/:id/status
 * Update delivery status
 */
const updateStatus = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;
    const {
      categoryStatus,
      cancelReason,
      failReason,
      signatureUrl,
      photoUrl,
      receivedByName,
    } = req.body;

    if (req.body.status) {
      return res.status(400).json({
        success: false,
        message: "status field is deprecated. Use categoryStatus.",
      });
    }

    if (!categoryStatus) {
      return res.status(400).json({
        success: false,
        message: "categoryStatus is required",
      });
    }

    const deliveryFee = await DeliveryFee.findOne({
      _id: id,
      organizationId,
    });

    if (!deliveryFee) {
      return res.status(404).json({
        success: false,
        message: "Delivery fee not found",
      });
    }

    // Validate location access
    if (!["Owner", "Manager"].includes(role)) {
      const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);
      if (accessibleLocations !== null && !accessibleLocations.some(loc => String(loc) === String(deliveryFee.locationId))) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      }
    }

    const location = await Location.findOne({
      _id: deliveryFee.locationId,
      organizationId,
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    const category = location.deliveryCategories?.find(
      (cat) => cat.categoryName === deliveryFee.deliveryCategory
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: `Category "${deliveryFee.deliveryCategory}" not found in location`,
      });
    }

    const workflow = Array.isArray(category.statusWorkflow)
      ? [...category.statusWorkflow]
      : [];
    const sortedWorkflow = workflow.sort((a, b) => (a.order || 0) - (b.order || 0));
    const isCancelStatus = categoryStatus === "cancelled";
    const validStatus = sortedWorkflow.find((wf) => wf.status === categoryStatus);

    if (!validStatus && !isCancelStatus) {
      const validStatuses = sortedWorkflow.map((wf) => wf.status).join(", ");
      return res.status(400).json({
        success: false,
        message: `Invalid status "${categoryStatus}" for category "${deliveryFee.deliveryCategory}". Valid statuses: ${validStatuses}`,
      });
    }

    const currentStatus = deliveryFee.categoryStatus || sortedWorkflow[0]?.status;
    if (currentStatus && currentStatus !== categoryStatus && sortedWorkflow.length > 0) {
      const currentIndex = sortedWorkflow.findIndex(
        (wf) => wf.status === currentStatus
      );
      const nextIndex = sortedWorkflow.findIndex(
        (wf) => wf.status === categoryStatus
      );
      const isCancel = categoryStatus === "cancelled";

      if (currentIndex !== -1 && nextIndex !== -1 && !isCancel) {
        if (nextIndex !== currentIndex + 1) {
          return res.status(400).json({
            success: false,
            message: `Cannot change status from ${currentStatus} to ${categoryStatus}`,
          });
        }
      }
    }

    if (deliveryStatusesRequiringFullPayment.has(categoryStatus)) {
      const paymentGate = await validateSalePaymentGate({
        organizationId,
        saleId: deliveryFee.saleId,
      });

      if (!paymentGate.allowed) {
        const balanceMessage =
          paymentGate.balanceDue !== null && paymentGate.balanceDue !== undefined
            ? ` Outstanding balance: ${paymentGate.balanceDue.toFixed(2)}.`
            : "";

        return res.status(400).json({
          success: false,
          message: `Delivery cannot move to ${categoryStatus} until sale is fully paid.${balanceMessage}`,
          code: "SALE_PAYMENT_REQUIRED",
        });
      }
    }

    deliveryFee.categoryStatus = categoryStatus;

    if (categoryStatus === "cancelled") {
      deliveryFee.cancelledAt = new Date();
      if (cancelReason) deliveryFee.cancelReason = cancelReason;
    }

    if (categoryStatus === "failed") {
      if (failReason) deliveryFee.failReason = failReason;
    }

    if (categoryStatus === "picked_up" && !deliveryFee.pickedUpAt) {
      deliveryFee.pickedUpAt = new Date();
    }

    if (["delivered", "completed", "collected"].includes(categoryStatus)) {
      deliveryFee.deliveredAt = new Date();
      deliveryFee.actualDelivery = new Date();
      if (signatureUrl) deliveryFee.signatureUrl = signatureUrl;
      if (photoUrl) deliveryFee.photoUrl = photoUrl;
      if (receivedByName) deliveryFee.receivedByName = receivedByName;
    }

    deliveryFee.lastModifiedBy = userId;
    await deliveryFee.save();

    // Update linked sale if exists
    if (deliveryFee.saleId) {
      await Sale.findByIdAndUpdate(deliveryFee.saleId, {
        deliveryStatus: categoryStatus,
        categoryStatus,
        deliveryStatusSyncedAt: new Date(),
      });
    }

    res.json({
      success: true,
      message: "Delivery status updated successfully",
      data: deliveryFee,
    });
  } catch (error) {
    console.error("Error updating delivery status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update delivery status",
      error: error.message,
    });
  }
};

/**
 * DELETE /delivery-fees/:id
 * Cancel/delete delivery fee
 */
const deleteDeliveryFee = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { id } = req.params;

    const deliveryFee = await DeliveryFee.findOne({
      _id: id,
      organizationId,
    });

    if (!deliveryFee) {
      return res.status(404).json({
        success: false,
        message: "Delivery fee not found",
      });
    }

    // Validate location access
    if (!["Owner", "Manager"].includes(role)) {
      const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);
      if (accessibleLocations !== null && !accessibleLocations.some(loc => String(loc) === String(deliveryFee.locationId))) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      }
    }

    const currentStatus = deliveryFee.categoryStatus;
    const terminalStatuses = [
      "delivered",
      "completed",
      "cancelled",
      "failed",
      "picked_up",
      "collected",
    ];

    if (terminalStatuses.includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete delivery fee with status: ${currentStatus}`,
      });
    }

    // Mark as cancelled instead of deleting
    deliveryFee.categoryStatus = "cancelled";
    deliveryFee.cancelledAt = new Date();
    deliveryFee.cancelReason = "Cancelled by user";
    deliveryFee.lastModifiedBy = userId;

    await deliveryFee.save();

    // Update linked sale if exists
    if (deliveryFee.saleId) {
      await Sale.findByIdAndUpdate(deliveryFee.saleId, {
        deliveryStatus: "cancelled",
        categoryStatus: "cancelled",
        deliveryStatusSyncedAt: new Date(),
        requiresDelivery: false,
      });
    }

    res.json({
      success: true,
      message: "Delivery fee cancelled successfully",
      data: deliveryFee,
    });
  } catch (error) {
    console.error("Error deleting delivery fee:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete delivery fee",
      error: error.message,
    });
  }
};

/**
 * GET /delivery-fees/stats
 * Get delivery statistics
 */
const getStats = async (req, res) => {
  try {
    const { organizationId, userId, role } = req.user;
    const { locationId, startDate, endDate } = req.query;

    // Get user's accessible locations
    const accessibleLocations = await getUserAccessibleLocations(userId, organizationId, role);

    // Build aggregation match stage with proper ObjectId conversion
    const matchStage = {
      organizationId: new mongoose.Types.ObjectId(organizationId),
    };

    if (accessibleLocations !== null) {
      // User has specific location restrictions
      if (locationId && accessibleLocations.includes(String(locationId))) {
        matchStage.locationId = new mongoose.Types.ObjectId(locationId);
      } else if (locationId) {
        // User requested a location they don't have access to
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have access to this location.",
          code: "LOCATION_ACCESS_DENIED",
        });
      } else {
        // Filter to only accessible locations
        matchStage.locationId = {
          $in: accessibleLocations.map(id => new mongoose.Types.ObjectId(id))
        };
      }
    } else if (locationId) {
      // User has no restrictions (Owner/Manager), can view any location
      matchStage.locationId = new mongoose.Types.ObjectId(locationId);
    }

    // Date range filter
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    // Get counts by category status
    const categoryStatusCounts = await DeliveryFee.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$categoryStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get revenue by category/option
    const revenueByCategory = await DeliveryFee.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            category: { $ifNull: ["$deliveryCategory", "Uncategorized"] },
            option: { $ifNull: ["$deliveryOption", ""] },
          },
          totalRevenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
          avgFee: { $avg: "$totalAmount" },
        },
      },
    ]);

    // Total revenue
    const totalRevenue = await DeliveryFee.aggregate([
      { $match: matchStage },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    // Average delivery time (for completed deliveries)
    const deliveredMatchStage = {
      ...matchStage,
      categoryStatus: { $in: ["delivered", "completed", "collected"] },
    };
    const avgDeliveryTime = await DeliveryFee.aggregate([
      { $match: deliveredMatchStage },
      {
        $project: {
          deliveryTime: {
            $subtract: ["$deliveredAt", "$createdAt"],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: "$deliveryTime" },
        },
      },
    ]);

    const driverStatsAgg = await DeliveryFee.aggregate([
      {
        $match: {
          ...matchStage,
          driverId: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: { driverId: "$driverId", status: "$categoryStatus" },
          count: { $sum: 1 },
        },
      },
    ]);

    const driverStats = driverStatsAgg.reduce((acc, item) => {
      const driverKey = item._id.driverId.toString();
      if (!acc[driverKey]) acc[driverKey] = {};
      acc[driverKey][item._id.status] = item.count;
      return acc;
    }, {});

    const assignedCount = await DeliveryFee.countDocuments({
      ...matchStage,
      driverId: { $exists: true, $ne: null },
    });

    const unassignedCount = await DeliveryFee.countDocuments({
      ...matchStage,
      $or: [{ driverId: { $exists: false } }, { driverId: null }],
    });

    res.json({
      success: true,
      data: {
        categoryStatusCounts: categoryStatusCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        revenueByCategory,
        totalRevenue: totalRevenue[0]?.total || 0,
        avgDeliveryTimeMs: avgDeliveryTime[0]?.avgTime || null,
        avgDeliveryTimeHours: avgDeliveryTime[0]?.avgTime
          ? (avgDeliveryTime[0].avgTime / (1000 * 60 * 60)).toFixed(2)
          : null,
        assignedCount,
        unassignedCount,
        driverStats,
      },
    });
  } catch (error) {
    console.error("Error fetching delivery stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch delivery statistics",
      error: error.message,
    });
  }
};

// Routes
router.post("/", requirePermission("delivery_fees.create"), validateLocationAccess, createDeliveryFee);
router.get("/", requirePermission("delivery_fees.read"), listDeliveryFees);
router.get("/stats", requirePermission("delivery_fees.read"), getStats);
router.get("/:id", requirePermission("delivery_fees.read"), getDeliveryFee);
router.patch(
  "/:id",
  requirePermission("delivery_fees.update"),
  updateDeliveryFee
);
router.patch(
  "/:id/assign",
  requirePermission("delivery_fees.assign_driver"),
  assignDriver
);
router.patch(
  "/:id/status",
  requirePermission("delivery_fees.update_status"),
  updateStatus
);
router.delete(
  "/:id",
  requirePermission("delivery_fees.delete"),
  deleteDeliveryFee
);

module.exports = router;
