const express = require("express");
const router = express.Router();

const Supplier = require("../models/Supplier");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Create supplier
 * POST /suppliers
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, email, phone, address, contactPerson, paymentTerms, paymentMethod, taxId, currency, rating, notes, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const supplier = new Supplier({
      organizationId,
      name,
      email,
      phone,
      address,
      contactPerson,
      paymentTerms,
      paymentMethod,
      taxId,
      currency,
      rating,
      notes,
      status: status || "active",
    });

    await supplier.save();

    await logTokenEvent(req.user.userId, organizationId, "supplier_created", req.ip, req.get("user-agent"), {
      details: `Supplier created: ${name}`,
    });

    return res.status(201).json({ message: "Supplier created", supplier });
  } catch (error) {
    console.error("Create supplier error:", error);
    return res.status(500).json({ error: "Failed to create supplier" });
  }
});

/**
 * Get all suppliers
 * GET /suppliers
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { status, search, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (status) query.status = status;
    if (search) query.name = new RegExp(search, "i");

    const suppliers = await Supplier.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Supplier.countDocuments(query);

    return res.status(200).json({ suppliers, total });
  } catch (error) {
    console.error("Get suppliers error:", error);
    return res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

/**
 * Get supplier by ID
 * GET /suppliers/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const supplier = await Supplier.findOne({ _id: req.params.id, organizationId });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    return res.status(200).json({ supplier });
  } catch (error) {
    console.error("Get supplier error:", error);
    return res.status(500).json({ error: "Failed to fetch supplier" });
  }
});

/**
 * Update supplier
 * PUT /suppliers/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, email, phone, address, contactPerson, paymentTerms, paymentMethod, taxId, currency, rating, notes, status } = req.body;

    const supplier = await Supplier.findOne({ _id: req.params.id, organizationId });
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    if (name) supplier.name = name;
    if (email !== undefined) supplier.email = email;
    if (phone !== undefined) supplier.phone = phone;
    if (address) supplier.address = address;
    if (contactPerson !== undefined) supplier.contactPerson = contactPerson;
    if (paymentTerms) supplier.paymentTerms = paymentTerms;
    if (paymentMethod) supplier.paymentMethod = paymentMethod;
    if (taxId !== undefined) supplier.taxId = taxId;
    if (currency) supplier.currency = currency;
    if (rating !== undefined) supplier.rating = rating;
    if (notes !== undefined) supplier.notes = notes;
    if (status) supplier.status = status;

    await supplier.save();

    await logTokenEvent(req.user.userId, organizationId, "supplier_updated", req.ip, req.get("user-agent"), {
      details: `Supplier updated: ${supplier.name}`,
    });

    return res.status(200).json({ message: "Supplier updated", supplier });
  } catch (error) {
    console.error("Update supplier error:", error);
    return res.status(500).json({ error: "Failed to update supplier" });
  }
});

/**
 * Delete supplier
 * DELETE /suppliers/:id
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const supplier = await Supplier.findOneAndDelete({ _id: req.params.id, organizationId });
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    await logTokenEvent(req.user.userId, organizationId, "supplier_deleted", req.ip, req.get("user-agent"), {
      details: `Supplier deleted: ${supplier.name}`,
    });

    return res.status(200).json({ message: "Supplier deleted" });
  } catch (error) {
    console.error("Delete supplier error:", error);
    return res.status(500).json({ error: "Failed to delete supplier" });
  }
});

module.exports = router;
