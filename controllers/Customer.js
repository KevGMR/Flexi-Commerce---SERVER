const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const { verifyToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");

/**
 * GET /customers
 * Search customers by name, email, or phone
 */
router.get("/", verifyToken, requirePermission(PERMISSIONS.VIEW_CUSTOMERS), async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { search, limit = 20 } = req.query;

    const query = { organizationId, status: "active" };
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { fullname: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    const customers = await Customer.find(query)
      .limit(parseInt(limit))
      .sort({ fullname: 1 });

    res.json({ success: true, customers });
  } catch (error) {
    console.error("Get customers error:", error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

/**
 * POST /customers
 * Create a new customer
 */
router.post("/", verifyToken, requirePermission(PERMISSIONS.CREATE_CUSTOMERS), async (req, res) => {
  try {
    const { organizationId, userId } = req.user;
    const { fullname, email, phone, address, notes, tags } = req.body;

    if (!fullname) {
      return res.status(400).json({ error: "fullname is required" });
    }

    if (email) {
      const existing = await Customer.findOne({ organizationId, email: email.toLowerCase() });
      if (existing) {
        return res.status(409).json({ error: "Customer with this email already exists" });
      }
    }

    const customer = new Customer({
      organizationId,
      fullname,
      email: email ? email.toLowerCase() : undefined,
      phone,
      address,
      notes,
      tags,
      createdBy: userId,
    });

    await customer.save();

    res.status(201).json({ success: true, customer });
  } catch (error) {
    console.error("Create customer error:", error);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

/**
 * PATCH /customers/:id/loyalty
 * Add or subtract loyalty points for a customer
 */
router.patch("/:id/loyalty", verifyToken, requirePermission(PERMISSIONS.VIEW_CUSTOMERS), async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { points, reason } = req.body;

    if (typeof points !== "number" || points === 0) {
      return res.status(400).json({ error: "points must be a non-zero number" });
    }

    const customer = await Customer.findOne({ _id: id, organizationId });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    customer.loyaltyPoints = Math.max(0, customer.loyaltyPoints + points);
    await customer.save();

    // Optionally log the change (we could create a LoyaltyTransaction model later)

    res.json({
      success: true,
      customer: {
        _id: customer._id,
        fullname: customer.fullname,
        loyaltyPoints: customer.loyaltyPoints,
      },
    });
  } catch (error) {
    console.error("Update loyalty error:", error);
    res.status(500).json({ error: "Failed to update loyalty points" });
  }
});

module.exports = router;