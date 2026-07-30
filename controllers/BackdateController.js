const express = require("express");
const router = express.Router();
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");
const BackdateService = require("../services/BackdateService");
const ShiftSession = require("../models/ShiftSession");
const Sale = require("../models/Sale");
const Receivable = require("../models/Receivable");
const Expense = require("../models/Expense");
const DeliveryFee = require("../models/DeliveryFee");
const ZReport = require("../models/ZReport");
const BackdateHistory = require("../models/BackdateHistory");
const TokenAuditLog = require("../models/TokenAuditLog");
const { roundMoney } = require("../utils/shiftSessionCalculations");

/**
 * GET /admin/shifts-for-backdate
 * List shifts with totals, for the backdate UI
 */
router.get(
  "/shifts-for-backdate",
  requirePermission(PERMISSIONS.BACKDATE_SALES),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const { locationId, startDate, endDate, page = 1, limit = 20 } = req.query;

      const result = await BackdateService.listShiftsForBackdate(
        organizationId,
        locationId,
        startDate,
        endDate,
        parseInt(page, 10),
        parseInt(limit, 10)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("List shifts for backdate error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to list shifts",
        error: error.message,
      });
    }
  }
);

/**
 * GET /admin/shifts-for-backdate/:shiftId
 * Get detailed shift data for backdate preview
 */
router.get(
  "/shifts-for-backdate/:shiftId",
  requirePermission(PERMISSIONS.BACKDATE_SALES),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const { shiftId } = req.params;

      const shift = await ShiftSession.findOne({ _id: shiftId, organizationId }).lean();
      if (!shift) {
        return res.status(404).json({
          success: false,
          message: "Shift not found",
        });
      }

      // Fetch related data
      const sales = await Sale.find({ shiftSessionId: shiftId, organizationId }).lean();
      const saleIds = sales.map(s => s._id);
      const [receivables, expenses, deliveryFees, zReports] = await Promise.all([
        Receivable.find({ saleId: { $in: saleIds } }).lean(),
        Expense.find({ shiftSessionId: shiftId, organizationId }).lean(),
        DeliveryFee.find({ shiftSessionId: shiftId, organizationId }).lean(),
        ZReport.find({ shiftSessionId: shiftId, organizationId }).lean(),
      ]);

      // Calculate totals
      let totalSales = 0;
      let totalTax = 0;
      let totalDiscount = 0;
      let totalDeliveries = 0;
      let totalExpenses = 0;
      let totalReceivables = 0;

      for (const sale of sales) {
        totalSales += sale.totalAmount || 0;
        totalTax += sale.taxAmount || 0;
        totalDiscount += sale.discountAmount || 0;
      }
      for (const df of deliveryFees) {
        totalDeliveries += df.totalAmount || 0;
      }
      for (const exp of expenses) {
        totalExpenses += exp.amount || 0;
      }
      for (const rec of receivables) {
        totalReceivables += rec.totalDue || 0;
      }

      res.json({
        success: true,
        data: {
          shift,
          sales,
          receivables,
          expenses,
          deliveryFees,
          zReports,
          summary: {
            salesCount: sales.length,
            totalSales: roundMoney(totalSales),
            totalTax: roundMoney(totalTax),
            totalDiscount: roundMoney(totalDiscount),
            totalDeliveryFees: roundMoney(totalDeliveries),
            totalExpenses: roundMoney(totalExpenses),
            totalReceivables: roundMoney(totalReceivables),
          }
        },
      });
    } catch (error) {
      console.error("Get shift detail error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get shift detail",
        error: error.message,
      });
    }
  }
);

/**
 * POST /admin/backdate-shift
 * Apply or preview backdate for a shift
 * Body: { shiftId, targetDate, modifiedBy, dryRun?: boolean, notes?: string }
 */
router.post(
  "/backdate-shift",
  requirePermission(PERMISSIONS.BACKDATE_SALES),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { shiftId, targetDate, dryRun = true, notes = "" } = req.body;

      if (!shiftId || !targetDate) {
        return res.status(400).json({
          success: false,
          message: "shiftId and targetDate are required",
        });
      }

      const shift = await ShiftSession.findOne({ _id: shiftId, organizationId });
      if (!shift) {
        return res.status(404).json({
          success: false,
          message: "Shift not found",
        });
      }

      // Capture IP and user agent
      const ipAddress = req.ip || req.connection.remoteAddress || "0.0.0.0";
      const userAgent = req.get("user-agent") || "unknown";

      if (dryRun) {
        const preview = await BackdateService.previewShiftBackdate(
          shiftId,
          targetDate,
          userId,
          organizationId
        );
        return res.json({
          success: true,
          dryRun: true,
          data: preview,
        });
      } else {
        const result = await BackdateService.applyShiftBackdate(
          shiftId,
          targetDate,
          userId,
          organizationId,
          notes,
          ipAddress,
          userAgent
        );
        return res.json({
          success: true,
          dryRun: false,
          data: result,
        });
      }
    } catch (error) {
      console.error("Backdate shift error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to backdate shift",
        error: error.message,
      });
    }
  }
);

/**
 * POST /admin/rollback-backdate/:backdateId
 * Rollback a previous backdate operation
 * Body: { reason?: string }
 */
router.post(
  "/rollback-backdate/:backdateId",
  requirePermission(PERMISSIONS.BACKDATE_SALES),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { backdateId } = req.params;
      const { reason = "" } = req.body;

      const history = await BackdateHistory.findOne({ _id: backdateId, organizationId });
      if (!history) {
        return res.status(404).json({
          success: false,
          message: "Backdate history not found",
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress || "0.0.0.0";
      const userAgent = req.get("user-agent") || "unknown";

      const result = await BackdateService.rollbackBackdate(
        backdateId,
        userId,
        reason,
        ipAddress,
        userAgent
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Rollback backdate error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to rollback backdate",
        error: error.message,
      });
    }
  }
);

/**
 * GET /admin/backdate-history
 * List backdate history
 */
router.get(
  "/backdate-history",
  requirePermission(PERMISSIONS.BACKDATE_SALES),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const { limit = 20, page = 1, status } = req.query;

      const query = { organizationId };
      if (status) query.status = status;

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
      const [histories, total] = await Promise.all([
        BackdateHistory.find(query)
          .sort({ appliedAt: -1 })
          .skip(skip)
          .limit(parseInt(limit, 10))
          .populate("appliedBy", "fullname email")
          .populate("rolledBackBy", "fullname email")
          .lean(),
        BackdateHistory.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: {
          histories,
          pagination: {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            total,
          },
        },
      });
    } catch (error) {
      console.error("List backdate history error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to list backdate history",
        error: error.message,
      });
    }
  }
);

module.exports = router;