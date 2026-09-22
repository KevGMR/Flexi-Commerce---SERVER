const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const DeliveryFee = require("../models/DeliveryFee");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");

/**
 * Helper: Identify transaction type and fetch the appropriate model
 * Returns { model, document, type } or throws 404
 */
const getTransactionByAnyId = async ({ organizationId, transactionId }) => {
  // Try each model type
  let doc = await Sale.findOne({ _id: transactionId, organizationId }).lean();
  if (doc) return { model: Sale, document: doc, type: "sale" };

  doc = await Expense.findOne({ _id: transactionId, organizationId }).lean();
  if (doc) return { model: Expense, document: doc, type: "expense" };

  doc = await DeliveryFee.findOne({ _id: transactionId, organizationId }).lean();
  if (doc) return { model: DeliveryFee, document: doc, type: "delivery" };

  // Not found in any model
  throw new Error("TRANSACTION_NOT_FOUND");
};

/**
 * POST /transactions/:id/validate
 * Mark a transaction as validated (requires MANAGE_FINANCE permission)
 */
router.post(
  "/:id/validate",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { id: transactionId } = req.params;
      const { notes } = req.body;

      // Validate transactionId is a valid MongoDB ObjectId
      if (!mongoose.Types.ObjectId.isValid(transactionId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid transaction ID format",
        });
      }

      // Find transaction across all types
      let transaction;
      try {
        transaction = await getTransactionByAnyId({ organizationId, transactionId });
      } catch (error) {
        if (error.message === "TRANSACTION_NOT_FOUND") {
          return res.status(404).json({
            success: false,
            message: "Transaction not found or does not belong to this organization",
          });
        }
        throw error;
      }

      // Check if already validated/disputed
      if (transaction.document.validationStatus !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Transaction already has status: ${transaction.document.validationStatus}`,
        });
      }

      // Update transaction with validation
      const updateResult = await transaction.model.findByIdAndUpdate(
        transactionId,
        {
          validationStatus: "validated",
          validatedBy: new mongoose.Types.ObjectId(userId),
          validatedAt: new Date(),
          validationNotes: notes || undefined,
        },
        { new: true }
      );

      return res.json({
        success: true,
        message: "Transaction validated successfully",
        data: {
          transactionId: updateResult._id,
          transactionType: transaction.type,
          validationStatus: updateResult.validationStatus,
          validatedAt: updateResult.validatedAt,
          validatedBy: updateResult.validatedBy,
        },
      });
    } catch (error) {
      console.error("Transaction validation error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to validate transaction",
        error: error.message,
      });
    }
  }
);

/**
 * POST /transactions/:id/dispute
 * Mark a transaction as disputed (requires MANAGE_FINANCE permission)
 */
router.post(
  "/:id/dispute",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { id: transactionId } = req.params;
      const { reason, notes } = req.body;

      // Validate transactionId is a valid MongoDB ObjectId
      if (!mongoose.Types.ObjectId.isValid(transactionId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid transaction ID format",
        });
      }

      // Reason is required for dispute
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: "Reason for dispute is required",
        });
      }

      // Find transaction across all types
      let transaction;
      try {
        transaction = await getTransactionByAnyId({ organizationId, transactionId });
      } catch (error) {
        if (error.message === "TRANSACTION_NOT_FOUND") {
          return res.status(404).json({
            success: false,
            message: "Transaction not found or does not belong to this organization",
          });
        }
        throw error;
      }

      // Check if already validated/disputed
      if (transaction.document.validationStatus !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Transaction already has status: ${transaction.document.validationStatus}`,
        });
      }

      // Build validation notes with reason and optional notes
      const validationNotes = `DISPUTED: ${reason}${notes ? ` - ${notes}` : ""}`;

      // Update transaction with dispute
      const updateResult = await transaction.model.findByIdAndUpdate(
        transactionId,
        {
          validationStatus: "disputed",
          validatedBy: new mongoose.Types.ObjectId(userId),
          validatedAt: new Date(),
          validationNotes: validationNotes,
        },
        { new: true }
      );

      return res.json({
        success: true,
        message: "Transaction disputed successfully",
        data: {
          transactionId: updateResult._id,
          transactionType: transaction.type,
          validationStatus: updateResult.validationStatus,
          reason,
          validatedAt: updateResult.validatedAt,
          validatedBy: updateResult.validatedBy,
        },
      });
    } catch (error) {
      console.error("Transaction dispute error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to dispute transaction",
        error: error.message,
      });
    }
  }
);

/**
 * GET /transactions/:id
 * Fetch a single transaction (unified endpoint for any transaction type)
 */
router.get("/:id", async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { id: transactionId } = req.params;

    // Validate transactionId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction ID format",
      });
    }

    // Find transaction across all types
    let transaction;
    try {
      transaction = await getTransactionByAnyId({ organizationId, transactionId });
    } catch (error) {
      if (error.message === "TRANSACTION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Transaction not found or does not belong to this organization",
        });
      }
      throw error;
    }

    return res.json({
      success: true,
      data: {
        transactionId: transaction.document._id,
        transactionType: transaction.type,
        validationStatus: transaction.document.validationStatus,
        validatedBy: transaction.document.validatedBy,
        validatedAt: transaction.document.validatedAt,
        validationNotes: transaction.document.validationNotes,
        transaction: transaction.document,
      },
    });
  } catch (error) {
    console.error("Get transaction error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transaction",
      error: error.message,
    });
  }
});

module.exports = router;
