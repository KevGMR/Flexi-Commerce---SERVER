const express = require("express");
const router = express.Router();
const ReconciliationSession = require("../models/ReconciliationSession");
const Sale = require("../models/Sale");
const Location = require("../models/Location");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");

const PAYMENT_METHODS = ["cash", "card", "mobile", "check", "credit", "mpesa"];

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizePagination = (req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const toDateRange = ({ startDate, endDate }) => {
  const start = startDate ? new Date(startDate) : new Date();
  const end = endDate ? new Date(endDate) : new Date(start);

  if (!startDate) {
    start.setHours(0, 0, 0, 0);
  }

  if (!endDate) {
    end.setHours(23, 59, 59, 999);
  }

  if (start > end) {
    throw new Error("startDate cannot be after endDate");
  }

  return { start, end };
};

const extractSalePayments = (sale) => {
  const hasSplit = Array.isArray(sale.payments) && sale.payments.length > 0;

  if (hasSplit) {
    return sale.payments
      .filter((payment) => (payment?.status || "completed") === "completed")
      .map((payment) => ({
        method: payment.method,
        amount: roundMoney(payment.amount),
      }));
  }

  if (sale.paymentMethod && Number(sale.totalAmount) > 0) {
    return [
      {
        method: sale.paymentMethod,
        amount: roundMoney(sale.totalAmount),
      },
    ];
  }

  return [];
};

const computeExpectedByMethod = async ({ organizationId, locationId, cashierId, start, end }) => {
  const query = {
    organizationId,
    locationId,
    createdAt: { $gte: start, $lte: end },
    status: { $ne: "voided" },
  };

  if (cashierId) {
    query.cashierId = cashierId;
  }

  const sales = await Sale.find(query)
    .select("payments paymentMethod totalAmount status")
    .lean();

  const summaryMap = new Map(PAYMENT_METHODS.map((method) => [method, 0]));

  for (const sale of sales) {
    const payments = extractSalePayments(sale);
    for (const payment of payments) {
      if (!summaryMap.has(payment.method)) {
        continue;
      }
      summaryMap.set(payment.method, roundMoney(summaryMap.get(payment.method) + payment.amount));
    }
  }

  const expectedByMethod = PAYMENT_METHODS.map((method) => ({
    method,
    expectedAmount: summaryMap.get(method) || 0,
    countedAmount: 0,
    settledAmount: 0,
    varianceAmount: 0,
  })).filter((row) => row.expectedAmount > 0);

  const totalExpected = roundMoney(
    expectedByMethod.reduce((sum, row) => sum + (Number(row.expectedAmount) || 0), 0)
  );

  return { expectedByMethod, totalExpected };
};

router.get(
  "/sessions",
  requirePermission(PERMISSIONS.VIEW_FINANCIAL_REPORTS),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const { page, limit, skip } = normalizePagination(req);
      const { locationId, status } = req.query;

      const query = { organizationId };
      if (locationId) query.locationId = locationId;
      if (status) query.status = status;

      const [sessions, total] = await Promise.all([
        ReconciliationSession.find(query)
          .sort({ windowStart: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ReconciliationSession.countDocuments(query),
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
      console.error("List reconciliation sessions error:", error);
      res.status(500).json({ success: false, message: "Failed to list sessions" });
    }
  }
);

router.post(
  "/sessions",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { locationId, cashierId, startDate, endDate, varianceThreshold, notes } = req.body;

      if (!locationId) {
        return res.status(400).json({ success: false, message: "locationId is required" });
      }

      const location = await Location.findOne({ _id: locationId, organizationId }).lean();
      if (!location) {
        return res.status(404).json({ success: false, message: "Location not found" });
      }

      const { start, end } = toDateRange({ startDate, endDate });
      const { expectedByMethod, totalExpected } = await computeExpectedByMethod({
        organizationId,
        locationId,
        cashierId,
        start,
        end,
      });

      const sessionCode = `REC-${organizationId}-${Date.now()}`;

      const session = await ReconciliationSession.create({
        organizationId,
        locationId,
        cashierId: cashierId || undefined,
        sessionCode,
        windowStart: start,
        windowEnd: end,
        expectedByMethod,
        countedByMethod: expectedByMethod.map((row) => ({
          method: row.method,
          expectedAmount: row.expectedAmount,
          countedAmount: 0,
          settledAmount: 0,
          varianceAmount: roundMoney(-row.expectedAmount),
        })),
        totalExpected,
        totalCounted: 0,
        totalVariance: roundMoney(-totalExpected),
        status: "open",
        varianceThreshold: Number(varianceThreshold) || 0,
        notes,
        createdBy: userId,
        updatedBy: userId,
      });

      res.status(201).json({
        success: true,
        message: "Reconciliation session created",
        data: session,
      });
    } catch (error) {
      console.error("Create reconciliation session error:", error);
      res.status(400).json({ success: false, message: error.message || "Failed to create session" });
    }
  }
);

router.get(
  "/sessions/:id",
  requirePermission(PERMISSIONS.VIEW_FINANCIAL_REPORTS),
  async (req, res) => {
    try {
      const { organizationId } = req.user;
      const session = await ReconciliationSession.findOne({
        _id: req.params.id,
        organizationId,
      }).lean();

      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }

      res.json({ success: true, data: session });
    } catch (error) {
      console.error("Get reconciliation session error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch session" });
    }
  }
);

router.post(
  "/sessions/:id/submit",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const { counts = [], notes } = req.body;

      const session = await ReconciliationSession.findOne({
        _id: req.params.id,
        organizationId,
      });

      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }

      const expectedMap = new Map(
        (session.expectedByMethod || []).map((row) => [row.method, Number(row.expectedAmount) || 0])
      );

      const countedByMethod = PAYMENT_METHODS.map((method) => {
        const payload = counts.find((item) => item?.method === method) || {};
        const expectedAmount = roundMoney(expectedMap.get(method) || 0);
        const countedAmount = roundMoney(Number(payload.countedAmount) || 0);
        const settledAmount = roundMoney(Number(payload.settledAmount) || countedAmount);
        const varianceAmount = roundMoney(countedAmount - expectedAmount);

        return {
          method,
          expectedAmount,
          countedAmount,
          settledAmount,
          varianceAmount,
          reference: payload.reference || undefined,
          notes: payload.notes || undefined,
        };
      }).filter((row) => row.expectedAmount > 0 || row.countedAmount > 0 || row.settledAmount > 0);

      const totalExpected = roundMoney(
        countedByMethod.reduce((sum, row) => sum + (Number(row.expectedAmount) || 0), 0)
      );
      const totalCounted = roundMoney(
        countedByMethod.reduce((sum, row) => sum + (Number(row.countedAmount) || 0), 0)
      );
      const totalVariance = roundMoney(totalCounted - totalExpected);

      const threshold = Number(session.varianceThreshold) || 0;
      const status = Math.abs(totalVariance) <= threshold ? "reconciled" : "needs_review";

      session.countedByMethod = countedByMethod;
      session.totalExpected = totalExpected;
      session.totalCounted = totalCounted;
      session.totalVariance = totalVariance;
      session.status = status;
      session.submittedAt = new Date();
      session.submittedBy = userId;
      session.updatedBy = userId;
      session.notes = notes || session.notes;

      await session.save();

      res.json({
        success: true,
        message: "Reconciliation submitted",
        data: session,
      });
    } catch (error) {
      console.error("Submit reconciliation error:", error);
      res.status(500).json({ success: false, message: "Failed to submit reconciliation" });
    }
  }
);

module.exports = router;
