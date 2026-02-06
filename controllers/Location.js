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

module.exports = router;
