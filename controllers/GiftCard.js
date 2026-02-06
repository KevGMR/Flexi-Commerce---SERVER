const express = require("express");
const router = express.Router();

const GiftCard = require("../models/GiftCard");
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");

// Generate unique gift card code
async function generateGiftCardCode(organizationId) {
  let code;
  let exists = true;

  while (exists) {
    code = "GC-" + Math.random().toString(36).substr(2, 12).toUpperCase();
    const existing = await GiftCard.findOne({ organizationId, code });
    exists = !!existing;
  }

  return code;
}

/**
 * Create gift card
 * POST /gift-cards
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { initialBalance, currency, expiryDate, customerId, notes } = req.body;

    if (!initialBalance || !currency) {
      return res.status(400).json({ error: "initialBalance and currency are required" });
    }

    const code = await generateGiftCardCode(organizationId);

    const giftCard = new GiftCard({
      organizationId,
      code,
      initialBalance,
      currentBalance: initialBalance,
      currency,
      expiryDate,
      customerId,
      notes,
      issuedBy: req.user.userId,
    });

    await giftCard.save();

    await logTokenEvent(req.user.userId, organizationId, "gift_card_created", req.ip, req.get("user-agent"), {
      details: `Gift card created: ${code}`,
    });

    return res.status(201).json({ message: "Gift card created", giftCard });
  } catch (error) {
    console.error("Create gift card error:", error);
    return res.status(500).json({ error: "Failed to create gift card" });
  }
});

/**
 * Get all gift cards
 * GET /gift-cards
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { status, customerId, skip = 0, limit = 50 } = req.query;

    let query = { organizationId };
    if (status) query.status = status;
    if (customerId) query.customerId = customerId;

    const giftCards = await GiftCard.find(query)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await GiftCard.countDocuments(query);

    return res.status(200).json({ giftCards, total });
  } catch (error) {
    console.error("Get gift cards error:", error);
    return res.status(500).json({ error: "Failed to fetch gift cards" });
  }
});

/**
 * Get gift card by code
 * GET /gift-cards/lookup/:code
 */
router.get("/lookup/:code", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const giftCard = await GiftCard.findOne({ organizationId, code: req.params.code });

    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    return res.status(200).json({ giftCard });
  } catch (error) {
    console.error("Lookup gift card error:", error);
    return res.status(500).json({ error: "Failed to lookup gift card" });
  }
});

/**
 * Get gift card by ID
 * GET /gift-cards/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const giftCard = await GiftCard.findOne({ _id: req.params.id, organizationId });

    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    return res.status(200).json({ giftCard });
  } catch (error) {
    console.error("Get gift card error:", error);
    return res.status(500).json({ error: "Failed to fetch gift card" });
  }
});

/**
 * Redeem gift card
 * PUT /gift-cards/:id/redeem
 */
router.put("/:id/redeem", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { amountRedeemed, orderId } = req.body;

    if (!amountRedeemed || amountRedeemed <= 0) {
      return res.status(400).json({ error: "amountRedeemed is required and must be positive" });
    }

    const giftCard = await GiftCard.findOne({ _id: req.params.id, organizationId });
    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    // Check expiry
    if (giftCard.expiryDate && new Date(giftCard.expiryDate) < new Date()) {
      giftCard.isExpired = true;
      await giftCard.save();
      return res.status(400).json({ error: "Gift card has expired" });
    }

    // Check status
    if (giftCard.status !== "active") {
      return res.status(400).json({ error: "Gift card is not active" });
    }

    // Check balance
    if (giftCard.currentBalance < amountRedeemed) {
      return res.status(400).json({ error: "Insufficient balance on gift card" });
    }

    giftCard.currentBalance -= amountRedeemed;
    giftCard.totalRedeemed += amountRedeemed;

    giftCard.redemptions.push({
      orderId,
      amountRedeemed,
      redeemedAt: new Date(),
      redeemedBy: req.user.userId,
    });

    // Deactivate if fully redeemed
    if (giftCard.currentBalance === 0) {
      giftCard.status = "inactive";
    }

    await giftCard.save();

    await logTokenEvent(req.user.userId, organizationId, "gift_card_redeemed", req.ip, req.get("user-agent"), {
      details: `Gift card redeemed: ${giftCard.code}`,
    });

    return res.status(200).json({ message: "Gift card redeemed", giftCard });
  } catch (error) {
    console.error("Redeem gift card error:", error);
    return res.status(500).json({ error: "Failed to redeem gift card" });
  }
});

/**
 * Update gift card
 * PUT /gift-cards/:id
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { customerId, status, notes } = req.body;

    const giftCard = await GiftCard.findOne({ _id: req.params.id, organizationId });
    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    if (customerId !== undefined) giftCard.customerId = customerId;
    if (status) giftCard.status = status;
    if (notes !== undefined) giftCard.notes = notes;

    await giftCard.save();

    return res.status(200).json({ message: "Gift card updated", giftCard });
  } catch (error) {
    console.error("Update gift card error:", error);
    return res.status(500).json({ error: "Failed to update gift card" });
  }
});

/**
 * Deactivate gift card
 * PUT /gift-cards/:id/deactivate
 */
router.put("/:id/deactivate", verifyToken, async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const giftCard = await GiftCard.findOne({ _id: req.params.id, organizationId });
    if (!giftCard) {
      return res.status(404).json({ error: "Gift card not found" });
    }

    giftCard.status = "inactive";
    await giftCard.save();

    await logTokenEvent(req.user.userId, organizationId, "gift_card_deactivated", req.ip, req.get("user-agent"), {
      details: `Gift card deactivated: ${giftCard.code}`,
    });

    return res.status(200).json({ message: "Gift card deactivated", giftCard });
  } catch (error) {
    console.error("Deactivate gift card error:", error);
    return res.status(500).json({ error: "Failed to deactivate gift card" });
  }
});

module.exports = router;
