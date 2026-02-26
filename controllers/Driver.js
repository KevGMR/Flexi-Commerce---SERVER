const express = require("express");
const router = express.Router();
const Driver = require("../models/Driver");
const Organization = require("../models/Organization");
const { requirePermission } = require("../middleware/permissionCheck");

/**
 * POST /drivers
 * Create a new driver
 */
const createDriver = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { name, phone, status } = req.body;

    // Validate required fields
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, phone",
      });
    }

    // Verify organization exists
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // Create new driver
    const driver = new Driver({
      name,
      phone,
      organizationId,
      status: status || "active",
    });

    await driver.save();

    return res.status(201).json({
      success: true,
      message: "Driver created successfully",
      data: driver,
    });
  } catch (error) {
    console.error("Error creating driver:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating driver",
      error: error.message,
    });
  }
};

/**
 * GET /drivers
 * Get all drivers for an organization
 */
const getDrivers = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { status } = req.query;

    const filter = { organizationId };
    if (status) {
      filter.status = status;
    }

    const drivers = await Driver.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Drivers retrieved successfully",
      data: drivers,
    });
  } catch (error) {
    console.error("Error fetching drivers:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching drivers",
      error: error.message,
    });
  }
};

/**
 * GET /drivers/:driverId
 * Get a specific driver by ID
 */
const getDriverById = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { driverId } = req.params;

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

    return res.status(200).json({
      success: true,
      message: "Driver retrieved successfully",
      data: driver,
    });
  } catch (error) {
    console.error("Error fetching driver:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching driver",
      error: error.message,
    });
  }
};

/**
 * PATCH /drivers/:driverId
 * Update a driver
 */
const updateDriver = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { driverId } = req.params;
    const { name, phone, status } = req.body;

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

    // Update fields
    if (name !== undefined) driver.name = name;
    if (phone !== undefined) driver.phone = phone;
    if (status !== undefined) driver.status = status;

    await driver.save();

    return res.status(200).json({
      success: true,
      message: "Driver updated successfully",
      data: driver,
    });
  } catch (error) {
    console.error("Error updating driver:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating driver",
      error: error.message,
    });
  }
};

/**
 * DELETE /drivers/:driverId
 * Delete a driver
 */
const deleteDriver = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { driverId } = req.params;

    const driver = await Driver.findOneAndDelete({
      _id: driverId,
      organizationId,
    });

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Driver deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting driver:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting driver",
      error: error.message,
    });
  }
};

// Routes
router.post("/", createDriver);
router.get("/", getDrivers);
router.get("/:driverId", getDriverById);
router.patch("/:driverId", updateDriver);
router.delete("/:driverId", deleteDriver);

module.exports = router;
