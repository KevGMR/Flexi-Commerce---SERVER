const express = require("express");
const router = express.Router();
const ShiftSession = require("../models/ShiftSession");
const Sale = require("../models/Sale");
const Location = require("../models/Location");
const ReconciliationSession = require("../models/ReconciliationSession");
const { generateZReportForShiftSession } = require("../services/zReportService");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizePagination = (req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getSaleCashPaymentsTotal = (sale) => {
  if (Array.isArray(sale?.payments) && sale.payments.length > 0) {
    return roundMoney(
      sale.payments
        .filter((payment) => payment?.method === "cash" && (payment?.status || "completed") === "completed")
        .reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0)
    );
  }

  if (sale?.paymentMethod === "cash" && Number(sale?.totalAmount) > 0) {
    return roundMoney(Number(sale.totalAmount));
  }

  return 0;
};

const computeExpectedCashSales = async ({ organizationId, locationId, cashierId, openedAt, closedAt }) => {
  const query = {
    organizationId,
    locationId,
    status: { $ne: "voided" },
    createdAt: {
      $gte: openedAt,
      $lte: closedAt,
    },
  };

  if (cashierId) {
    query.cashierId = cashierId;
  }

  const sales = await Sale.find(query)
    .select("payments paymentMethod totalAmount")
    .lean();

  return roundMoney(sales.reduce((sum, sale) => sum + getSaleCashPaymentsTotal(sale), 0));
};

router.get(
  "/current",
  requirePermission(PERMISSIONS.CREATE_SALE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const locationId = req.query.locationId;

      if (!locationId) {
        return res.status(400).json({ success: false, message: "locationId is required" });
      }

      const session = await ShiftSession.findOne({
        organizationId,
        locationId,
        cashierId: userId,
        status: "open",
      }).lean();

      res.json({
        success: true,
        data: session || null,
      });
    } catch (error) {
      console.error("Get current shift session error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch current shift" });
    }
  }
);

router.get(
  "/",
  requirePermission(PERMISSIONS.VIEW_FINANCIAL_REPORTS),
  async (req, res) => {
    try {
      const { organizationId, userId, role } = req.user;
      const { page, limit, skip } = normalizePagination(req);
      const { locationId, status } = req.query;

      const query = { organizationId };
      if (locationId) query.locationId = locationId;
      if (status) query.status = status;

      if (!["Owner", "Manager"].includes(role)) {
        query.cashierId = userId;
      }

      const [sessions, total] = await Promise.all([
        ShiftSession.find(query)
          .sort({ openedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ShiftSession.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: {
          page,
          limit,
          total,
          sessions,
        },
      });
    } catch (error) {
      console.error("List shift sessions error:", error);
      res.status(500).json({ success: false, message: "Failed to list shift sessions" });
    }
  }
);

router.post(
  "/open",
  requirePermission(PERMISSIONS.CREATE_SALE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { locationId, openingCash, notes } = req.body;

      if (!locationId) {
        return res.status(400).json({ success: false, message: "locationId is required" });
      }

      const location = await Location.findOne({ _id: locationId, organizationId }).lean();
      if (!location) {
        return res.status(404).json({ success: false, message: "Location not found" });
      }

      const existingOpen = await ShiftSession.findOne({
        organizationId,
        locationId,
        cashierId: userId,
        status: "open",
      }).lean();

      if (existingOpen) {
        return res.status(400).json({
          success: false,
          message: "An open shift already exists for this cashier at this location",
          data: existingOpen,
        });
      }

      const shiftCode = `SHIFT-${organizationId}-${Date.now()}`;
      const session = await ShiftSession.create({
        organizationId,
        locationId,
        cashierId: userId,
        shiftCode,
        status: "open",
        openedAt: new Date(),
        openingCash: roundMoney(openingCash),
        openNotes: notes,
        openedBy: userId,
        updatedBy: userId,
      });

      res.status(201).json({
        success: true,
        message: "Shift opened successfully",
        data: session,
      });
    } catch (error) {
      console.error("Open shift session error:", error);
      res.status(500).json({ success: false, message: "Failed to open shift" });
    }
  }
);

router.post(
  "/:id/close",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId, role } = req.user;
      const { closingCash, notes } = req.body;

      const session = await ShiftSession.findOne({
        _id: req.params.id,
        organizationId,
        status: "open",
      });

      if (!session) {
        return res.status(404).json({ success: false, message: "Open shift session not found" });
      }

      if (!["Owner", "Manager"].includes(role) && String(session.cashierId) !== String(userId)) {
        return res.status(403).json({ success: false, message: "You can only close your own shift" });
      }

      const closeTime = new Date();

      const reconciliationSessions = await ReconciliationSession.find({
        organizationId,
        locationId: session.locationId,
        windowStart: { $gte: session.openedAt },
        windowEnd: { $lte: closeTime },
        $or: [{ cashierId: session.cashierId }, { cashierId: { $exists: false } }, { cashierId: null }],
      })
        .select("_id sessionCode status totalVariance")
        .lean();

      if (reconciliationSessions.length === 0) {
        return res.status(400).json({
          success: false,
          code: "RECONCILIATION_REQUIRED",
          message: "At least one reconciliation session is required before closing shift",
        });
      }

      const unresolved = reconciliationSessions.filter((entry) => entry.status !== "reconciled");
      if (unresolved.length > 0) {
        return res.status(400).json({
          success: false,
          code: "RECONCILIATION_UNRESOLVED",
          message: "Resolve all reconciliation sessions before closing shift",
          data: {
            unresolved,
          },
        });
      }

      const expectedCashSales = await computeExpectedCashSales({
        organizationId,
        locationId: session.locationId,
        cashierId: session.cashierId,
        openedAt: session.openedAt,
        closedAt: closeTime,
      });

      const openingCash = roundMoney(session.openingCash || 0);
      const expectedClosingCash = roundMoney(openingCash + expectedCashSales);
      const closing = roundMoney(closingCash);
      const cashVariance = roundMoney(closing - expectedClosingCash);

      session.status = "closed";
      session.closedAt = closeTime;
      session.expectedCashSales = expectedCashSales;
      session.expectedClosingCash = expectedClosingCash;
      session.closingCash = closing;
      session.cashVariance = cashVariance;
      session.reconciliationStatus = "completed";
      session.reconciliationSessionIds = reconciliationSessions.map((entry) => entry._id);
      session.closeNotes = notes || session.closeNotes;
      session.closedBy = userId;
      session.updatedBy = userId;

      await session.save();

      let zReportGeneration = {
        attempted: true,
        generated: false,
      };

      try {
        const zReportResult = await generateZReportForShiftSession({
          organizationId,
          userId,
          shiftSessionId: session._id,
          notes: `Auto-generated at shift close (${session.shiftCode})`,
        });

        zReportGeneration = {
          attempted: true,
          generated: true,
          reused: Boolean(zReportResult?.reused),
          reportId: zReportResult?.report?._id,
          reportCode: zReportResult?.report?.reportCode,
        };
      } catch (zReportError) {
        console.error("Auto Z-report generation error:", zReportError);
        zReportGeneration = {
          attempted: true,
          generated: false,
          error: zReportError.message,
        };
      }

      res.json({
        success: true,
        message: "Shift closed successfully",
        data: {
          session,
          zReportGeneration,
        },
      });
    } catch (error) {
      console.error("Close shift session error:", error);
      res.status(500).json({ success: false, message: "Failed to close shift" });
    }
  }
);

module.exports = router;
