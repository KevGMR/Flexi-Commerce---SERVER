const Location = require("../models/Location");
const User = require("../models/User");
const DeliveryFee = require("../models/DeliveryFee");

/**
 * Validate that location has delivery fees enabled
 */
const validateDeliveryEnabled = async (req, res, next) => {
  try {
    const { organizationId } = req.user;
    const locationId = req.body.locationId || req.params.locationId;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        message: "locationId is required",
      });
    }

    const location = await Location.findOne({
      _id: locationId,
      organizationId,
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    if (!location.deliveryFeeSettings?.enableDeliveryFees) {
      return res.status(400).json({
        success: false,
        message: "Delivery fees are not enabled for this location",
      });
    }

    // Attach location to request for reuse
    req.location = location;
    next();
  } catch (error) {
    console.error("Delivery validation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate delivery settings",
      error: error.message,
    });
  }
};

/**
 * Validate delivery fee type
 */
const validateFeeType = (req, res, next) => {
  const { feeType, customAmount } = req.body;
  const validTypes = ["standard", "express", "overnight", "custom"];

  if (!feeType) {
    return res.status(400).json({
      success: false,
      message: "feeType is required",
    });
  }

  if (!validTypes.includes(feeType)) {
    return res.status(400).json({
      success: false,
      message: `Invalid feeType. Must be one of: ${validTypes.join(", ")}`,
    });
  }

  if (feeType === "custom" && (!customAmount || customAmount < 0)) {
    return res.status(400).json({
      success: false,
      message: "customAmount is required and must be >= 0 for custom fee type",
    });
  }

  next();
};

/**
 * Validate delivery address is complete
 */
const validateDeliveryAddress = (req, res, next) => {
  const { deliveryAddress } = req.body;

  if (!deliveryAddress) {
    return res.status(400).json({
      success: false,
      message: "deliveryAddress is required",
    });
  }

  const requiredFields = ["street", "city"];
  const missingFields = requiredFields.filter(
    (field) => !deliveryAddress[field]
  );

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Delivery address missing required fields: ${missingFields.join(", ")}`,
    });
  }

  next();
};

/**
 * Validate driver exists and belongs to organization
 */
const validateDriver = async (req, res, next) => {
  try {
    const { driverId } = req.body;
    const { organizationId } = req.user;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: "driverId is required",
      });
    }

    const driver = await User.findById(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    // Optional: Add additional checks like verifying driver belongs to org
    // This would require checking UserOrganization model

    next();
  } catch (error) {
    console.error("Driver validation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate driver",
      error: error.message,
    });
  }
};

/**
 * Validate status transition is valid
 */
const validateStatusTransition = async (req, res, next) => {
  try {
    const { status } = req.body;
    const { id, organizationId } = req.params;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "status is required",
      });
    }

    const validStatuses = [
      "pending",
      "assigned",
      "in_transit",
      "delivered",
      "cancelled",
      "failed",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Get current delivery fee
    const deliveryFee = await DeliveryFee.findOne({
      _id: id,
      organizationId: req.user.organizationId,
    });

    if (!deliveryFee) {
      return res.status(404).json({
        success: false,
        message: "Delivery fee not found",
      });
    }

    // Define invalid transitions
    const currentStatus = deliveryFee.status;
    const invalidTransitions = {
      delivered: ["pending", "assigned", "in_transit", "failed"],
      cancelled: ["delivered", "in_transit"],
    };

    if (
      invalidTransitions[currentStatus] &&
      invalidTransitions[currentStatus].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${currentStatus} to ${status}`,
      });
    }

    // Attach delivery fee to request for reuse
    req.deliveryFee = deliveryFee;
    next();
  } catch (error) {
    console.error("Status validation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate status transition",
      error: error.message,
    });
  }
};

/**
 * Validate recipient information is provided
 */
const validateRecipientInfo = (req, res, next) => {
  const { recipientName, recipientPhone } = req.body;

  if (!recipientName || !recipientPhone) {
    return res.status(400).json({
      success: false,
      message: "recipientName and recipientPhone are required",
    });
  }

  // Optional: Add phone number format validation
  // const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  // if (!phoneRegex.test(recipientPhone)) {
  //   return res.status(400).json({
  //     success: false,
  //     message: "Invalid phone number format"
  //   });
  // }

  next();
};

module.exports = {
  validateDeliveryEnabled,
  validateFeeType,
  validateDeliveryAddress,
  validateDriver,
  validateStatusTransition,
  validateRecipientInfo,
};
