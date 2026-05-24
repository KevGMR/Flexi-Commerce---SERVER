const express = require("express");
const router = express.Router();
const ReconciliationSession = require("../models/ReconciliationSession");
const ShiftSession = require("../models/ShiftSession");
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

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDateRange = ({ startDate, endDate }) => {
  const start = startDate ? new Date(startDate) : new Date();
  const end = endDate ? new Date(endDate) : new Date(start);

  // If startDate is date-only (YYYY-MM-DD) treat it as start-of-day
  if (startDate && DATE_ONLY_RE.test(startDate)) {
    start.setHours(0, 0, 0, 0);
  } else if (!startDate) {
    start.setHours(0, 0, 0, 0);
  }

  // If endDate is date-only (YYYY-MM-DD) treat it as end-of-day
  if (endDate && DATE_ONLY_RE.test(endDate)) {
    end.setHours(23, 59, 59, 999);
  } else if (!endDate) {
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

const computeExpectedByMethod = async ({ organizationId, locationId, start, end }) => {
  const query = {
    organizationId,
    locationId,
    createdAt: { $gte: start, $lte: end },
    status: { $ne: "voided" },
  };

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

const collectShiftBreakdown = (shiftSessions) =>
  shiftSessions.map((session) => ({
    shiftSessionId: session._id,
    shiftCode: session.shiftCode,
    cashierId: session.cashierId,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    openingCash: roundMoney(session.openingCash),
    expectedCashSales: roundMoney(session.expectedCashSales),
    cashExpenseTotal: roundMoney(session.cashExpenseTotal),
    expectedClosingCash: roundMoney(session.expectedClosingCash),
    closingCash: roundMoney(session.closingCash),
    cashVariance: roundMoney(session.cashVariance),
  }));

const collectShiftSessionsForWindow = async ({ organizationId, locationId, start, end }) => {
  return ShiftSession.find({
    organizationId,
    locationId,
    openedAt: { $lte: end },
    $or: [{ status: "open" }, { closedAt: { $gte: start } }],
  })
    .sort({ openedAt: 1 })
    .lean();
};

const buildShiftBreakdownEntry = (shiftSession) => ({
  shiftSessionId: shiftSession._id,
  shiftCode: shiftSession.shiftCode,
  cashierId: shiftSession.cashierId,
  status: shiftSession.status,
  openedAt: shiftSession.openedAt,
  closedAt: shiftSession.closedAt,
  openingCash: roundMoney(shiftSession.openingCash),
  expectedCashSales: roundMoney(shiftSession.expectedCashSales),
  cashExpenseTotal: roundMoney(shiftSession.cashExpenseTotal),
  expectedClosingCash: roundMoney(shiftSession.expectedClosingCash),
  closingCash: roundMoney(shiftSession.closingCash),
  cashVariance: roundMoney(shiftSession.cashVariance),
});

const mergeCountedByMethod = ({ expectedByMethod, existingCountedByMethod }) => {
  const expectedMap = new Map((expectedByMethod || []).map((row) => [row.method, Number(row.expectedAmount) || 0]));
  const countedMap = new Map((existingCountedByMethod || []).map((row) => [row.method, row]));

  const orderedMethods = PAYMENT_METHODS.filter((method) => expectedMap.has(method) || countedMap.has(method));

  return orderedMethods
    .map((method) => {
      const existingRow = countedMap.get(method) || {};
      const expectedAmount = roundMoney(expectedMap.get(method) || 0);
      const countedAmount = roundMoney(Number(existingRow.countedAmount) || 0);
      const settledAmount = roundMoney(
        existingRow.settledAmount === undefined ? countedAmount : Number(existingRow.settledAmount) || 0
      );
      const varianceAmount = roundMoney(countedAmount - expectedAmount);

      return {
        method,
        expectedAmount,
        countedAmount,
        settledAmount,
        varianceAmount,
        reference: existingRow.reference || undefined,
        notes: existingRow.notes || undefined,
      };
    })
    .filter(
      (row) =>
        row.expectedAmount > 0 ||
        row.countedAmount > 0 ||
        row.settledAmount > 0 ||
        row.reference ||
        row.notes
    );
};

const attachShiftToEligibleReconciliationSession = async ({
  organizationId,
  locationId,
  openedAt,
  shiftSession,
  userId,
}) => {
  if (!organizationId || !locationId || !openedAt || !shiftSession?._id) {
    return { attached: false, reason: "invalid-input" };
  }

  const eligibleSessions = await ReconciliationSession.find({
    organizationId,
    locationId,
    windowStart: { $lte: openedAt },
    windowEnd: { $gte: openedAt },
    status: { $in: ["open", "needs_review"] },
  }).sort({ windowStart: -1, createdAt: -1 });

  if (!eligibleSessions.length) {
    return { attached: false, reason: "no-eligible-session" };
  }

  if (eligibleSessions.length > 1) {
    console.warn("Multiple eligible reconciliation sessions found for shift attach", {
      organizationId: String(organizationId),
      locationId: String(locationId),
      openedAt: new Date(openedAt).toISOString(),
      reconciliationSessionIds: eligibleSessions.map((session) => String(session._id)),
    });
  }

  const reconciliationSession = eligibleSessions[0];
  const shiftId = String(shiftSession._id);

  const hasShiftId = (reconciliationSession.shiftSessionIds || []).some((id) => String(id) === shiftId);
  if (!hasShiftId) {
    reconciliationSession.shiftSessionIds.push(shiftSession._id);
  }

  const hasBreakdown = (reconciliationSession.shiftBreakdown || []).some(
    (row) => String(row.shiftSessionId) === shiftId
  );
  if (!hasBreakdown) {
    reconciliationSession.shiftBreakdown.push(buildShiftBreakdownEntry(shiftSession));
  }

  const { expectedByMethod, totalExpected } = await computeExpectedByMethod({
    organizationId,
    locationId,
    start: reconciliationSession.windowStart,
    end: reconciliationSession.windowEnd,
  });

  reconciliationSession.expectedByMethod = expectedByMethod;
  reconciliationSession.countedByMethod = mergeCountedByMethod({
    expectedByMethod,
    existingCountedByMethod: reconciliationSession.countedByMethod,
  });
  reconciliationSession.totalExpected = totalExpected;
  reconciliationSession.totalCounted = roundMoney(
    (reconciliationSession.countedByMethod || []).reduce((sum, row) => sum + (Number(row.countedAmount) || 0), 0)
  );
  reconciliationSession.totalVariance = roundMoney(
    Number(reconciliationSession.totalCounted) - Number(reconciliationSession.totalExpected)
  );
  reconciliationSession.updatedBy = userId || reconciliationSession.updatedBy;
  await reconciliationSession.save();

  await ShiftSession.updateOne(
    {
      _id: shiftSession._id,
      organizationId,
    },
    {
      $addToSet: {
        reconciliationSessionIds: reconciliationSession._id,
      },
      $set: {
        updatedBy: userId || shiftSession.updatedBy,
      },
    }
  );

  return {
    attached: !hasShiftId || !hasBreakdown,
    reconciliationSessionId: reconciliationSession._id,
    status: reconciliationSession.status,
  };
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
      const { locationId, startDate, endDate, varianceThreshold, notes } = req.body;

      if (!locationId) {
        return res.status(400).json({ success: false, message: "locationId is required" });
      }

      const location = await Location.findOne({ _id: locationId, organizationId }).lean();
      if (!location) {
        return res.status(404).json({ success: false, message: "Location not found" });
      }

      const { start, end } = toDateRange({ startDate, endDate });

      // Prevent creating multiple reconciliation sessions that overlap the same window
      const existing = await ReconciliationSession.findOne({
        organizationId,
        locationId,
        windowStart: { $lte: end },
        windowEnd: { $gte: start },
      }).lean();

      if (existing) {
        return res.status(400).json({
          success: false,
          code: "RECONCILIATION_EXISTS",
          message: "A reconciliation session already exists for the selected window",
          data: { existingSessionId: existing._id, sessionCode: existing.sessionCode },
        });
      }

      const shiftSessions = await collectShiftSessionsForWindow({ organizationId, locationId, start, end });
      const { expectedByMethod, totalExpected } = await computeExpectedByMethod({
        organizationId,
        locationId,
        start,
        end,
      });

      const sessionCode = `REC-${organizationId}-${Date.now()}`;

      const session = await ReconciliationSession.create({
        organizationId,
        locationId,
        sessionCode,
        windowStart: start,
        windowEnd: end,
        shiftSessionIds: shiftSessions.map((shift) => shift._id),
        shiftBreakdown: collectShiftBreakdown(shiftSessions),
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
      })
        .populate("shiftBreakdown.cashierId", "fullname email")
        .lean();

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

      if (Array.isArray(session.shiftSessionIds) && session.shiftSessionIds.length > 0) {
        await ShiftSession.updateMany(
          { _id: { $in: session.shiftSessionIds }, organizationId },
          {
            $set: {
              reconciliationStatus: "completed",
              updatedBy: userId,
            },
            $addToSet: {
              reconciliationSessionIds: session._id,
            },
          }
        );
      }

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
// Export helper for unit testing
module.exports.toDateRange = toDateRange;
module.exports.attachShiftToEligibleReconciliationSession = attachShiftToEligibleReconciliationSession;
