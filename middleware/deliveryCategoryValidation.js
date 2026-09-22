const mongoose = require("mongoose");
const Location = require("../models/Location");

/**
 * Validate that a delivery category exists in the location
 */
const validateCategoryExists = async (req, res, next) => {
  try {
    const { organizationId } = req.user;
    const { locationId, deliveryCategory } = req.body;

    if (!locationId || !deliveryCategory) {
      return res.status(400).json({
        success: false,
        message: "locationId and deliveryCategory are required",
      });
    }

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

    // Find the category
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

    // Attach category to request for use in controller
    req.category = category;
    req.location = location;

    next();
  } catch (error) {
    console.error("Error validating category existence:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate delivery category",
      error: error.message,
    });
  }
};

/**
 * Validate that a delivery option exists in the category
 */
const validateOptionExists = async (req, res, next) => {
  try {
    const { locationId, deliveryCategory, deliveryOption } = req.body;

    if (!deliveryOption) {
      return res.status(400).json({
        success: false,
        message: "deliveryOption is required",
      });
    }

    // Ensure category was already validated
    if (!req.category) {
      return res.status(400).json({
        success: false,
        message: "Category must be validated first",
      });
    }

    const option = req.category.childOptions?.find(
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

    // Attach option to request for use in controller
    req.deliveryOption = option;

    next();
  } catch (error) {
    console.error("Error validating option existence:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate delivery option",
      error: error.message,
    });
  }
};

/**
 * Validate status transition for a category's custom workflow
 */
const validateCategoryStatusTransition = async (req, res, next) => {
  try {
    const { newStatus } = req.body;
    const { categoryStatus, deliveryCategory } = req.body;

    if (!newStatus) {
      return res.status(400).json({
        success: false,
        message: "newStatus is required",
      });
    }

    if (!deliveryCategory || !req.category) {
      // If no category, skip custom workflow validation
      return next();
    }

    const workflow = req.category.statusWorkflow || [];

    // Check if status is valid in the workflow
    const validStatus = workflow.find((wf) => wf.status === newStatus);
    if (!validStatus) {
      const validStatuses = workflow.map((wf) => wf.status).join(", ");
      return res.status(400).json({
        success: false,
        message: `Invalid status "${newStatus}" for category "${deliveryCategory}". Valid statuses: ${validStatuses}`,
      });
    }

    next();
  } catch (error) {
    console.error("Error validating category status transition:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate status transition",
      error: error.message,
    });
  }
};

/**
 * Validate delivery category structure when creating/updating
 */
const validateCategoryStructure = (req, res, next) => {
  try {
    const { categoryName, statusWorkflow, childOptions } = req.body;

    if (!categoryName) {
      return res.status(400).json({
        success: false,
        message: "categoryName is required",
      });
    }

    // Validate status workflow
    if (statusWorkflow && Array.isArray(statusWorkflow)) {
      for (let i = 0; i < statusWorkflow.length; i++) {
        const wf = statusWorkflow[i];
        if (!wf.status || !wf.displayName) {
          return res.status(400).json({
            success: false,
            message: `Status workflow item at index ${i} must have 'status' and 'displayName'`,
          });
        }
        if (!Number.isInteger(wf.order) || wf.order < 0) {
          return res.status(400).json({
            success: false,
            message: `Status workflow item at index ${i} must have a valid 'order' (non-negative integer)`,
          });
        }
      }
    }

    // Validate child options
    if (childOptions && Array.isArray(childOptions)) {
      for (let i = 0; i < childOptions.length; i++) {
        const opt = childOptions[i];
        if (!opt.optionName || typeof opt.price !== "number" || opt.price < 0) {
          return res.status(400).json({
            success: false,
            message: `Child option at index ${i} must have 'optionName' and 'price' (non-negative number)`,
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error("Error validating category structure:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate category structure",
      error: error.message,
    });
  }
};

module.exports = {
  validateCategoryExists,
  validateOptionExists,
  validateCategoryStatusTransition,
  validateCategoryStructure,
};
