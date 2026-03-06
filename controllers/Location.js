const express = require("express");
const router = express.Router();

const Location = require("../models/Location");
const ShopifyConnection = require("../models/ShopifyConnection");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");
const axios = require("axios");
const { getAccessToken } = require("../data/shopifyAuth");

/**
 * Create location
 * POST /locations
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, locationType, address, phone, email, taxRate, taxId, currency, isDefault, metafieldDefinitions } = req.body;

    if (!name || !locationType) {
      return res.status(400).json({ error: "name and locationType are required" });
    }

    // If isDefault, unset other defaults
    if (isDefault) {
      await Location.updateMany({ organizationId }, { isDefault: false });
    }

    const location = new Location({
      organizationId,
      name,
      locationType,
      address,
      phone,
      email,
      taxRate,
      taxId,
      currency,
      isDefault: isDefault || false,
      metafieldDefinitions,
    });

    await location.save();

    await logTokenEvent(req.user.userId, organizationId, "location_created", req.ip, req.get("user-agent"), {
      details: `Location created: ${name}`,
    });

    return res.status(201).json({ message: "Location created", location });
  } catch (error) {
    console.error("Create location error:", error);
    return res.status(500).json({ error: "Failed to create location" });
  }
});

/**
 * Get all locations
 * GET /locations
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { locationType, status, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (locationType) query.locationType = locationType;
    if (status) query.status = status;

    const locations = await Location.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ isDefault: -1, createdAt: -1 });

    const total = await Location.countDocuments(query);

    return res.status(200).json({ locations, total });
  } catch (error) {
    console.error("Get locations error:", error);
    return res.status(500).json({ error: "Failed to fetch locations" });
  }
});

/**
 * Get location by ID
 * GET /locations/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const location = await Location.findOne({ _id: req.params.id, organizationId });

    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    return res.status(200).json({ location });
  } catch (error) {
    console.error("Get location error:", error);
    return res.status(500).json({ error: "Failed to fetch location" });
  }
});

/**
 * Update location
 * PUT /locations/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, locationType, address, phone, email, taxRate, taxId, currency, isDefault, status, metafieldDefinitions } = req.body;

    const location = await Location.findOne({ _id: req.params.id, organizationId });
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    if (isDefault && !location.isDefault) {
      await Location.updateMany({ organizationId }, { isDefault: false });
      location.isDefault = true;
    } else if (!isDefault && location.isDefault) {
      location.isDefault = false;
    }

    if (name) location.name = name;
    if (locationType) location.locationType = locationType;
    if (address) location.address = address;
    if (phone !== undefined) location.phone = phone;
    if (email !== undefined) location.email = email;
    if (taxRate !== undefined) location.taxRate = taxRate;
    if (taxId !== undefined) location.taxId = taxId;
    if (currency) location.currency = currency;
    if (status) location.status = status;
    if (metafieldDefinitions) location.metafieldDefinitions = metafieldDefinitions;

    await location.save();

    await logTokenEvent(req.user.userId, organizationId, "location_updated", req.ip, req.get("user-agent"), {
      details: `Location updated: ${location.name}`,
    });

    return res.status(200).json({ message: "Location updated", location });
  } catch (error) {
    console.error("Update location error:", error);
    return res.status(500).json({ error: "Failed to update location" });
  }
});

/**
 * Delete location
 * DELETE /locations/:id
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    // Check if other locations exist
    const otherLocations = await Location.countDocuments({ organizationId, _id: { $ne: req.params.id } });
    if (otherLocations === 0) {
      return res.status(400).json({ error: "Cannot delete the only location. Organization must have at least one location." });
    }

    const location = await Location.findOneAndDelete({ _id: req.params.id, organizationId });
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    await logTokenEvent(req.user.userId, organizationId, "location_deleted", req.ip, req.get("user-agent"), {
      details: `Location deleted: ${location.name}`,
    });

    return res.status(200).json({ message: "Location deleted" });
  } catch (error) {
    console.error("Delete location error:", error);
    return res.status(500).json({ error: "Failed to delete location" });
  }
});

/**
 * GET /locations/shopify/available-locations
 * List available Shopify locations for mapping
 */
router.get("/shopify/available-locations", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    // Get Shopify connection
    const connection = await ShopifyConnection.findOne({ organizationId })
      .select('+clientId +clientSecret +accessToken +tokenExpiresAt');

    if (!connection) {
      return res.status(400).json({
        error: "No Shopify connection found. Connect to Shopify first.",
      });
    }

    // Get access token
    const { accessToken } = await getAccessToken(
      connection.storeUrl,
      connection.clientId,
      connection.clientSecret,
      organizationId
    );

    // Query Shopify locations
    const url = `https://${connection.storeUrl}/admin/api/${connection.apiVersion}/graphql.json`;
    const query = `
      query locations {
        locations(first: 100) {
          edges {
            node {
              id
              name
              isActive
              address {
                address1
                city
              }
            }
          }
        }
      }
    `;

    const { data } = await axios.post(
      url,
      { query },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (data.errors) {
      throw new Error(`Shopify errors: ${JSON.stringify(data.errors)}`);
    }

    const locations = data.data.locations.edges.map(({ node }) => ({
      id: node.id,
      name: node.name,
      isActive: node.isActive,
      address: node.address?.address1 || '',
      city: node.address?.city || '',
    }));

    return res.status(200).json({
      success: true,
      shopifyLocations: locations,
    });
  } catch (error) {
    console.error("Fetch Shopify locations error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch Shopify locations" });
  }
});

/**
 * POST /locations/:id/set-shopify-location
 * Map FLEXI location to Shopify location
 */
router.post("/:id/set-shopify-location", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { shopifyLocationId, shopifyLocationName } = req.body;

    if (!shopifyLocationId || !shopifyLocationName) {
      return res.status(400).json({
        error: "shopifyLocationId and shopifyLocationName are required",
      });
    }

    // Verify location belongs to org
    const location = await Location.findOne({ _id: req.params.id, organizationId });
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    // Verify Shopify connection exists
    const connection = await ShopifyConnection.findOne({ organizationId });
    if (!connection) {
      return res.status(400).json({ error: "No Shopify connection found" });
    }

    // Update location with Shopify mapping
    location.shopifyLocationId = shopifyLocationId;
    location.shopifyLocationName = shopifyLocationName;
    location.shopifyLocationActive = true;
    await location.save();

    await logTokenEvent(req.user.userId, organizationId, "location_updated", req.ip, req.get("user-agent"), {
      details: `Location ${location.name} mapped to Shopify location ${shopifyLocationName}`,
    });

    return res.status(200).json({
      success: true,
      message: "Location mapped to Shopify successfully",
      location,
    });
  } catch (error) {
    console.error("Set Shopify location error:", error);
    return res.status(500).json({ error: "Failed to set Shopify location" });
  }
});

/**
 * Update delivery fee settings for a location
 * PATCH /locations/:id/delivery-settings
 */
router.patch("/:id/delivery-settings", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id } = req.params;
    const {
      enableDeliveryFees,
      taxDeliveryFees,
      standardFee,
      expressFee,
      overnightFee,
      defaultFeeType,
      allowCustomFees,
    } = req.body;

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    // Update delivery settings
    if (enableDeliveryFees !== undefined)
      location.deliveryFeeSettings.enableDeliveryFees = enableDeliveryFees;
    if (taxDeliveryFees !== undefined)
      location.deliveryFeeSettings.taxDeliveryFees = taxDeliveryFees;
    if (standardFee !== undefined)
      location.deliveryFeeSettings.standardFee = standardFee;
    if (expressFee !== undefined)
      location.deliveryFeeSettings.expressFee = expressFee;
    if (overnightFee !== undefined)
      location.deliveryFeeSettings.overnightFee = overnightFee;
    if (defaultFeeType !== undefined)
      location.deliveryFeeSettings.defaultFeeType = defaultFeeType;
    if (allowCustomFees !== undefined)
      location.deliveryFeeSettings.allowCustomFees = allowCustomFees;

    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "location_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery settings updated for location: ${location.name}`,
      }
    );

    return res.json({
      success: true,
      message: "Delivery settings updated successfully",
      deliveryFeeSettings: location.deliveryFeeSettings,
    });
  } catch (error) {
    console.error("Update delivery settings error:", error);
    return res.status(500).json({ error: "Failed to update delivery settings" });
  }
});

/**
 * Create delivery category for a location
 * POST /locations/:id/delivery-categories
 */
router.post("/:id/delivery-categories", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id } = req.params;
    const {
      categoryName,
      description,
      statusWorkflow,
      childOptions,
    } = req.body;

    // Validate required fields
    if (!categoryName) {
      return res.status(400).json({
        success: false,
        message: "categoryName is required",
      });
    }

    if (!statusWorkflow || !Array.isArray(statusWorkflow) || statusWorkflow.length === 0) {
      return res.status(400).json({
        success: false,
        message: "statusWorkflow is required and must be a non-empty array",
      });
    }

    if (!childOptions || !Array.isArray(childOptions) || childOptions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "childOptions is required and must be a non-empty array",
      });
    }

    // Validate status workflow
    for (let i = 0; i < statusWorkflow.length; i++) {
      const wf = statusWorkflow[i];
      if (!wf.status || !wf.displayName) {
        return res.status(400).json({
          success: false,
          message: `Status workflow item at index ${i} must have 'status' and 'displayName'`,
        });
      }
    }

    // Validate child options
    for (let i = 0; i < childOptions.length; i++) {
      const opt = childOptions[i];
      if (!opt.optionName || typeof opt.price !== "number" || opt.price < 0) {
        return res.status(400).json({
          success: false,
          message: `Child option at index ${i} must have 'optionName' and 'price' (non-negative number)`,
        });
      }
    }

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    // Check if category already exists
    const categoryExists = location.deliveryCategories?.some(
      (cat) => cat.categoryName === categoryName
    );

    if (categoryExists) {
      return res.status(400).json({
        success: false,
        message: `Delivery category "${categoryName}" already exists in this location`,
      });
    }

    // Initialize deliveryCategories array if it doesn't exist
    if (!location.deliveryCategories) {
      location.deliveryCategories = [];
    }

    // Create new category with child options
    const newCategory = {
      _id: new (require("mongoose")).Types.ObjectId(),
      categoryName,
      description: description || "",
      isActive: true,
      statusWorkflow: statusWorkflow.map((wf, idx) => ({
        status: wf.status,
        displayName: wf.displayName,
        order: wf.order || idx,
      })),
      childOptions: childOptions.map((opt) => ({
        _id: new (require("mongoose")).Types.ObjectId(),
        optionName: opt.optionName,
        price: opt.price,
        estimatedDays: opt.estimatedDays || 1,
        isActive: opt.isActive !== undefined ? opt.isActive : true,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    location.deliveryCategories.push(newCategory);
    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "delivery_category_created",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery category "${categoryName}" created for location: ${location.name}`,
      }
    );

    return res.status(201).json({
      success: true,
      message: "Delivery category created successfully",
      category: newCategory,
    });
  } catch (error) {
    console.error("Create delivery category error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create delivery category",
      error: error.message,
    });
  }
});

/**
 * Get all delivery categories for a location
 * GET /locations/:id/delivery-categories
 */
router.get("/:id/delivery-categories", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id } = req.params;
    const { includeInactive = false } = req.query;

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    let categories = location.deliveryCategories || [];

    // Filter out inactive categories if requested
    if (includeInactive !== "true") {
      categories = categories.filter((cat) => cat.isActive);
    }

    return res.status(200).json({
      success: true,
      categories: categories,
      total: categories.length,
    });
  } catch (error) {
    console.error("Get delivery categories error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch delivery categories",
      error: error.message,
    });
  }
});

/**
 * Update delivery category (name, description, status)
 * PATCH /locations/:id/delivery-categories/:categoryId
 */
router.patch("/:id/delivery-categories/:categoryId", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id, categoryId } = req.params;
    const { categoryName, description, isActive, statusWorkflow } = req.body;
    const hasUpdatableField =
      categoryName !== undefined ||
      description !== undefined ||
      isActive !== undefined ||
      statusWorkflow !== undefined;

    if (!hasUpdatableField) {
      return res.status(400).json({
        success: false,
        message:
          "No updatable category fields provided. Allowed fields: categoryName, description, isActive, statusWorkflow",
      });
    }

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    const category = location.deliveryCategories?.find(
      (cat) => cat._id.toString() === categoryId
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Delivery category not found",
      });
    }

    // Update fields
    if (categoryName !== undefined) category.categoryName = categoryName;
    if (description !== undefined) category.description = description;
    if (isActive !== undefined) category.isActive = isActive;
    if (statusWorkflow !== undefined && Array.isArray(statusWorkflow)) {
      // Validate workflow
      for (let i = 0; i < statusWorkflow.length; i++) {
        const wf = statusWorkflow[i];
        if (!wf.status || !wf.displayName) {
          return res.status(400).json({
            success: false,
            message: `Status workflow item at index ${i} must have 'status' and 'displayName'`,
          });
        }
      }
      category.statusWorkflow = statusWorkflow.map((wf, idx) => ({
        status: wf.status,
        displayName: wf.displayName,
        order: wf.order || idx,
      }));
    }
    category.updatedAt = new Date();

    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "delivery_category_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery category "${category.categoryName}" updated for location: ${location.name}`,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Delivery category updated successfully",
      category: category,
    });
  } catch (error) {
    console.error("Update delivery category error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update delivery category",
      error: error.message,
    });
  }
});

/**
 * Delete delivery category
 * DELETE /locations/:id/delivery-categories/:categoryId
 */
router.delete("/:id/delivery-categories/:categoryId", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id, categoryId } = req.params;

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    const categoryIndex = location.deliveryCategories?.findIndex(
      (cat) => cat._id.toString() === categoryId
    );

    if (categoryIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Delivery category not found",
      });
    }

    const deletedCategory = location.deliveryCategories[categoryIndex];
    location.deliveryCategories.splice(categoryIndex, 1);
    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "delivery_category_deleted",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery category "${deletedCategory.categoryName}" deleted from location: ${location.name}`,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Delivery category deleted successfully",
    });
  } catch (error) {
    console.error("Delete delivery category error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete delivery category",
      error: error.message,
    });
  }
});

/**
 * Add or update delivery option in a category
 * POST /locations/:id/delivery-categories/:categoryId/options
 */
router.post("/:id/delivery-categories/:categoryId/options", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id, categoryId } = req.params;
    const { optionName, price, estimatedDays, isActive, description } = req.body;

    // Validate required fields
    if (!optionName || typeof price !== "number" || price < 0) {
      return res.status(400).json({
        success: false,
        message: "optionName and price (non-negative number) are required",
      });
    }

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    const category = location.deliveryCategories?.find(
      (cat) => cat._id.toString() === categoryId
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Delivery category not found",
      });
    }

    // Check if option already exists
    const optionExists = category.childOptions?.some(
      (opt) => opt.optionName === optionName
    );

    if (optionExists) {
      return res.status(400).json({
        success: false,
        message: `Option "${optionName}" already exists in this category`,
      });
    }

    // Initialize childOptions array if it doesn't exist
    if (!category.childOptions) {
      category.childOptions = [];
    }

    // Create new option
    const newOption = {
      _id: new (require("mongoose")).Types.ObjectId(),
      optionName,
      price,
      estimatedDays: estimatedDays || 1,
      isActive: isActive !== undefined ? isActive : true,
      description: description || "",
    };

    category.childOptions.push(newOption);
    category.updatedAt = new Date();
    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "delivery_option_created",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery option "${optionName}" added to category "${category.categoryName}" in location: ${location.name}`,
      }
    );

    return res.status(201).json({
      success: true,
      message: "Delivery option added successfully",
      option: newOption,
    });
  } catch (error) {
    console.error("Add delivery option error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add delivery option",
      error: error.message,
    });
  }
});

/**
 * Update delivery option price and details
 * PATCH /locations/:id/delivery-categories/:categoryId/options/:optionId
 */
router.patch("/:id/delivery-categories/:categoryId/options/:optionId", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id, categoryId, optionId } = req.params;
    const { optionName, price, estimatedDays, isActive, description } = req.body;
    const hasUpdatableField =
      optionName !== undefined ||
      price !== undefined ||
      estimatedDays !== undefined ||
      isActive !== undefined ||
      description !== undefined;

    if (!hasUpdatableField) {
      return res.status(400).json({
        success: false,
        message:
          "No updatable option fields provided. Allowed fields: optionName, price, estimatedDays, isActive, description",
      });
    }

    if (optionName !== undefined && (!optionName || optionName.trim() === "")) {
      return res.status(400).json({
        success: false,
        message: "optionName cannot be empty",
      });
    }

    if (
      price !== undefined &&
      (typeof price !== "number" || Number.isNaN(price) || price < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "price must be a non-negative number",
      });
    }

    if (
      estimatedDays !== undefined &&
      (typeof estimatedDays !== "number" ||
        Number.isNaN(estimatedDays) ||
        estimatedDays < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "estimatedDays must be a non-negative number",
      });
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
      });
    }

    if (description !== undefined && typeof description !== "string") {
      return res.status(400).json({
        success: false,
        message: "description must be a string",
      });
    }

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    const category = location.deliveryCategories?.find(
      (cat) => cat._id.toString() === categoryId
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Delivery category not found",
      });
    }

    const option = category.childOptions?.find(
      (opt) => opt._id.toString() === optionId
    );

    if (!option) {
      return res.status(404).json({
        success: false,
        message: "Delivery option not found",
      });
    }

    let changed = false;

    if (optionName !== undefined) {
      const nextOptionName = optionName.trim();
      if (option.optionName !== nextOptionName) {
        option.optionName = nextOptionName;
        changed = true;
      }
    }

    if (price !== undefined && option.price !== price) {
      option.price = price;
      changed = true;
    }

    if (estimatedDays !== undefined && option.estimatedDays !== estimatedDays) {
      option.estimatedDays = estimatedDays;
      changed = true;
    }

    if (isActive !== undefined && option.isActive !== isActive) {
      option.isActive = isActive;
      changed = true;
    }

    if (description !== undefined && (option.description || "") !== description) {
      option.description = description;
      changed = true;
    }

    if (!changed) {
      return res.status(200).json({
        success: true,
        message: "No changes detected for delivery option",
        option,
      });
    }

    category.updatedAt = new Date();

    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "delivery_option_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery option "${option.optionName}" updated in category "${category.categoryName}" in location: ${location.name}`,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Delivery option updated successfully",
      option: option,
    });
  } catch (error) {
    console.error("Update delivery option error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update delivery option",
      error: error.message,
    });
  }
});

/**
 * Delete delivery option from category
 * DELETE /locations/:id/delivery-categories/:categoryId/options/:optionId
 */
router.delete("/:id/delivery-categories/:categoryId/options/:optionId", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { id, categoryId, optionId } = req.params;

    const location = await Location.findOne({ _id: id, organizationId });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or does not belong to this organization",
      });
    }

    const category = location.deliveryCategories?.find(
      (cat) => cat._id.toString() === categoryId
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Delivery category not found",
      });
    }

    const optionIndex = category.childOptions?.findIndex(
      (opt) => opt._id.toString() === optionId
    );

    if (optionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Delivery option not found",
      });
    }

    const deletedOption = category.childOptions[optionIndex];
    category.childOptions.splice(optionIndex, 1);
    category.updatedAt = new Date();
    await location.save();

    await logTokenEvent(
      req.user.userId,
      organizationId,
      "delivery_option_deleted",
      req.ip,
      req.get("user-agent"),
      {
        details: `Delivery option "${deletedOption.optionName}" deleted from category "${category.categoryName}" in location: ${location.name}`,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Delivery option deleted successfully",
    });
  } catch (error) {
    console.error("Delete delivery option error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete delivery option",
      error: error.message,
    });
  }
});

module.exports = router;
