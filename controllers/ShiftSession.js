const express = require("express");
const router = express.Router();
const ShiftSession = require("../models/ShiftSession");
const Expense = require("../models/Expense");
const Sale = require("../models/Sale");
const Location = require("../models/Location");
const { generateZReportForShiftSession } = require("../services/zReportService");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");
const {
  roundMoney,
  getSaleCashPaymentsTotal,
  buildShiftExpenseMatch,
  calculateExpectedClosingCash,
} = require("../utils/shiftSessionCalculations");
const { attachShiftToEligibleReconciliationSession } = require("./Reconciliation");

const normalizePagination = (req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
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

const computeCashExpenseTotal = async ({ organizationId, locationId, shiftSessionId, cashierId, openedAt, closedAt }) => {
  const aggregateResult = await Expense.aggregate([
    {
      $match: buildShiftExpenseMatch({ organizationId, locationId, shiftSessionId, cashierId, openedAt, closedAt }),
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
      },
    },
  ]);

  return roundMoney(aggregateResult[0]?.total || 0);
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

      try {
        await attachShiftToEligibleReconciliationSession({
          organizationId,
          locationId: session.locationId,
          openedAt: session.openedAt,
          shiftSession: session,
          userId,
        });
      } catch (attachError) {
        console.error("Auto-attach shift to reconciliation session error:", attachError);
      }

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

      const expectedCashSales = await computeExpectedCashSales({
        organizationId,
        locationId: session.locationId,
        cashierId: session.cashierId,
        openedAt: session.openedAt,
        closedAt: closeTime,
      });
      const cashExpenseTotal = await computeCashExpenseTotal({
        organizationId,
        locationId: session.locationId,
        shiftSessionId: session._id,
        cashierId: session.cashierId,
        openedAt: session.openedAt,
        closedAt: closeTime,
      });

      const openingCash = roundMoney(session.openingCash || 0);
      const expectedClosingCash = calculateExpectedClosingCash({ openingCash, expectedCashSales, cashExpenseTotal });
      const closing = roundMoney(closingCash);
      const cashVariance = roundMoney(closing - expectedClosingCash);

      session.status = "closed";
      session.closedAt = closeTime;
      session.expectedCashSales = expectedCashSales;
      session.cashExpenseTotal = cashExpenseTotal;
      session.expectedClosingCash = expectedClosingCash;
      session.closingCash = closing;
      session.cashVariance = cashVariance;
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

router.get(
  "/:id/preview",
  requirePermission(PERMISSIONS.CREATE_SALE),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const session = await ShiftSession.findOne({ _id: req.params.id, organizationId }).lean();
      if (!session) {
        return res.status(404).json({ success: false, message: "Shift session not found" });
      }

      const now = new Date();
      const expectedCashSales = await computeExpectedCashSales({
        organizationId,
        locationId: session.locationId,
        cashierId: session.cashierId,
        openedAt: session.openedAt,
        closedAt: now,
      });

      const cashExpenseTotal = await computeCashExpenseTotal({
        organizationId,
        locationId: session.locationId,
        shiftSessionId: session._id,
        cashierId: session.cashierId,
        openedAt: session.openedAt,
        closedAt: now,
      });

      const openingCash = roundMoney(session.openingCash || 0);
      const expectedClosingCash = calculateExpectedClosingCash({ openingCash, expectedCashSales, cashExpenseTotal });

      res.json({
        success: true,
        data: {
          expectedCashSales,
          cashExpenseTotal,
          expectedClosingCash,
        },
      });
    } catch (error) {
      console.error("Preview shift close error:", error);
      res.status(500).json({ success: false, message: "Failed to preview shift close" });
    }
  }
);

/**
 * GET /shifts/:id/transactions
 * Fetch all transactions (sales, expenses, deliveries) for a shift with optional filtering
 * Query params: validationStatus (pending|validated|disputed)
 */
router.get(
  "/:id/transactions",
  requirePermission(PERMISSIONS.VIEW_FINANCIAL_REPORTS),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const { id: shiftId } = req.params;
      const { validationStatus, type } = req.query;
      const { page, limit, skip } = normalizePagination(req);

      // Verify shift exists
      const shift = await ShiftSession.findOne({ _id: shiftId, organizationId }).lean();
      if (!shift) {
        return res.status(404).json({
          success: false,
          message: "Shift session not found",
        });
      }

      // Build base query for all transaction types
      const baseQuery = {
        organizationId,
        shiftSessionId: shiftId,
      };

      // Apply validation status filter if provided
      if (validationStatus) {
        if (!["pending", "validated", "disputed"].includes(validationStatus)) {
          return res.status(400).json({
            success: false,
            message: "Invalid validationStatus. Must be one of: pending, validated, disputed",
          });
        }
        baseQuery.validationStatus = validationStatus;
      }

      // Fetch transactions from all types (unless specific type is requested)
      const fetchAllTypes = !type || type === "all";
      const transactions = [];

      // Fetch sales
      if (fetchAllTypes || type === "sale") {
        const sales = await Sale.find(baseQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
        
        transactions.push(
          ...sales.map((sale) => ({
            _id: sale._id,
            type: "sale",
            receiptNumber: sale.receiptNumber,
            totalAmount: sale.totalAmount,
            validationStatus: sale.validationStatus,
            validatedBy: sale.validatedBy,
            validatedAt: sale.validatedAt,
            validationNotes: sale.validationNotes,
            createdAt: sale.createdAt,
            cashierId: sale.cashierId,
          }))
        );
      }

      // Fetch expenses
      if (fetchAllTypes || type === "expense") {
        const expenses = await Expense.find(baseQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
        
        transactions.push(
          ...expenses.map((expense) => ({
            _id: expense._id,
            type: "expense",
            category: expense.category,
            description: expense.description,
            amount: expense.amount,
            validationStatus: expense.validationStatus,
            validatedBy: expense.validatedBy,
            validatedAt: expense.validatedAt,
            validationNotes: expense.validationNotes,
            createdAt: expense.createdAt,
            createdBy: expense.createdBy,
          }))
        );
      }

      // Fetch deliveries
      if (fetchAllTypes || type === "delivery") {
        const DeliveryFee = require("../models/DeliveryFee");
        const deliveries = await DeliveryFee.find(baseQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
        
        transactions.push(
          ...deliveries.map((delivery) => ({
            _id: delivery._id,
            type: "delivery",
            recipientName: delivery.recipientName,
            amount: delivery.amount,
            deliveryCategory: delivery.deliveryCategory,
            validationStatus: delivery.validationStatus,
            validatedBy: delivery.validatedBy,
            validatedAt: delivery.validatedAt,
            validationNotes: delivery.validationNotes,
            createdAt: delivery.createdAt,
            createdBy: delivery.createdBy,
          }))
        );
      }

      // Sort by createdAt descending
      transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Get total counts
      const [salesCount, expenseCount, deliveryCount] = await Promise.all([
        Sale.countDocuments(baseQuery),
        Expense.countDocuments(baseQuery),
        require("../models/DeliveryFee").countDocuments(baseQuery),
      ]);

      const totalCount = salesCount + expenseCount + deliveryCount;

      return res.json({
        success: true,
        data: {
          shiftId,
          page,
          limit,
          total: totalCount,
          breakdown: {
            sales: salesCount,
            expenses: expenseCount,
            deliveries: deliveryCount,
          },
          transactions,
        },
      });
    } catch (error) {
      console.error("Get shift transactions error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch transactions",
        error: error.message,
      });
    }
  }
);

module.exports = router;
