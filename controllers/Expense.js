const express = require("express");
const router = express.Router();
const Expense = require("../models/Expense");
const ExpenseApproval = require("../models/ExpenseApproval");
const AccountingPeriod = require("../models/AccountingPeriod");
const JournalEntry = require("../models/JournalEntry");
const Location = require("../models/Location");
const ShiftSession = require("../models/ShiftSession");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");
const { buildShiftExpenseMatch, calculateExpectedClosingCash, findPreviousDayOpenShiftSession } = require("../utils/shiftSessionCalculations");

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const isPrivilegedRole = (role) => ["Owner", "Manager"].includes(role);

const normalizePagination = (req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const createApprovalRecord = async ({ organizationId, expenseId, action, actedBy, notes }) => {
  await ExpenseApproval.create({
    organizationId,
    expenseId,
    action,
    actedBy,
    notes,
    actedAt: new Date(),
  });
};

const findPostingPeriod = async ({ organizationId, locationId, expenseDate }) => {
  return AccountingPeriod.findOne({
    organizationId,
    $or: [{ locationId }, { locationId: { $exists: false } }, { locationId: null }],
    startDate: { $lte: expenseDate },
    endDate: { $gte: expenseDate },
  }).sort({ locationId: -1, startDate: -1 });
};

const findOpenShiftSession = async ({ organizationId, locationId, cashierId }) => {
  return ShiftSession.findOne({
    organizationId,
    locationId,
    cashierId,
    status: "open",
  }).lean();
};

const getBlockedShiftMessage = () => "Close the previous day's shift before creating new transactions at this location";

const logShiftExpenseSync = (event, payload = {}) => {
  console.info(`[SHIFT_EXPENSE_SYNC] ${event}`, payload);
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

const refreshOpenShiftTotalsById = async ({ organizationId, shiftSessionId }) => {
  if (!shiftSessionId) {
    logShiftExpenseSync("refresh.skip.no-shift-id", {
      organizationId: String(organizationId),
    });
    return;
  }

  const session = await ShiftSession.findOne({
    _id: shiftSessionId,
    organizationId,
    status: "open",
  });

  if (!session) {
    logShiftExpenseSync("refresh.skip.shift-not-open-or-missing", {
      organizationId: String(organizationId),
      shiftSessionId: String(shiftSessionId),
    });
    return;
  }

  const now = new Date();
  const cashExpenseTotal = await computeCashExpenseTotal({
    organizationId,
    locationId: session.locationId,
    shiftSessionId: session._id,
    cashierId: session.cashierId,
    openedAt: session.openedAt,
    closedAt: now,
  });

  const expectedClosingCash = calculateExpectedClosingCash({
    openingCash: roundMoney(session.openingCash || 0),
    expectedCashSales: roundMoney(session.expectedCashSales || 0),
    cashExpenseTotal,
  });

  session.cashExpenseTotal = cashExpenseTotal;
  session.expectedClosingCash = expectedClosingCash;
  await session.save();

  logShiftExpenseSync("refresh.applied", {
    organizationId: String(organizationId),
    shiftSessionId: String(session._id),
    cashierId: String(session.cashierId),
    locationId: String(session.locationId),
    cashExpenseTotal,
    expectedClosingCash,
  });
};

const refreshShiftTotalsAfterExpenseMutation = async ({
  organizationId,
  shiftSessionIds = [],
  expenseId,
  action,
}) => {
  const uniqueIds = [...new Set(shiftSessionIds.filter(Boolean).map((id) => String(id)))];

  logShiftExpenseSync("refresh.start", {
    organizationId: String(organizationId),
    expenseId: expenseId ? String(expenseId) : undefined,
    action,
    shiftSessionIds: uniqueIds,
  });

  await Promise.all(
    uniqueIds.map(async (shiftSessionId) => {
      try {
        await refreshOpenShiftTotalsById({ organizationId, shiftSessionId });
      } catch (error) {
        console.error("Shift total refresh error:", {
          organizationId: String(organizationId),
          shiftSessionId,
          error: error.message,
        });
      }
    })
  );

  logShiftExpenseSync("refresh.complete", {
    organizationId: String(organizationId),
    expenseId: expenseId ? String(expenseId) : undefined,
    action,
    refreshedShiftSessionIds: uniqueIds,
  });
};

const buildPostingWarning = (warningType, message) => ({
  posted: false,
  warningType,
  message,
});

const postExpenseToAccounting = async ({ expense, userId }) => {
  const period = await findPostingPeriod({
    organizationId: expense.organizationId,
    locationId: expense.locationId,
    expenseDate: expense.expenseDate,
  });

  if (!period) {
    return buildPostingWarning("period_missing", "No accounting period found for expense date");
  }

  if (period.status === "locked") {
    return buildPostingWarning("period_locked", "Accounting period is locked");
  }

  if (period.status === "closed") {
    return buildPostingWarning("period_closed", "Accounting period is closed");
  }

  const existing = await JournalEntry.findOne({
    organizationId: expense.organizationId,
    expenseId: expense._id,
    sourceType: "expense",
  });

  if (existing) {
    return {
      posted: true,
      reused: true,
      journalEntryId: existing._id,
      entryCode: existing.entryCode,
    };
  }

  const amount = roundMoney(expense.amount);

  const entry = await JournalEntry.create({
    organizationId: expense.organizationId,
    locationId: expense.locationId,
    periodId: period._id,
    expenseId: expense._id,
    entryCode: `JRN-${String(expense.organizationId).slice(-6).toUpperCase()}-${Date.now()}`,
    sourceType: "expense",
    entryDate: expense.expenseDate,
    description: `Expense ${expense.expenseCode}: ${expense.category}`,
    reference: expense.reference,
    debitLines: [
      {
        accountCode: "6000",
        accountName: "Operating Expenses",
        amount,
      },
    ],
    creditLines: [
      {
        accountCode: expense.paymentStatus === "paid" ? "1000" : "2000",
        accountName: expense.paymentStatus === "paid" ? "Cash & Cash Equivalents" : "Accounts Payable",
        amount,
      },
    ],
    status: "posted",
    createdBy: userId,
    updatedBy: userId,
  });

  expense.journalEntryId = entry._id;
  expense.updatedBy = userId;
  await expense.save();

  return {
    posted: true,
    reused: false,
    journalEntryId: entry._id,
    entryCode: entry.entryCode,
  };
};

router.get(
  "/",
  requirePermission(PERMISSIONS.VIEW_EXPENSES),
  async (req, res) => {
    try {
      const { organizationId, userId, role } = req.user;
      const { locationId, status, paymentStatus, category } = req.query;
      const { page, limit, skip } = normalizePagination(req);

      const query = { organizationId };
      if (locationId) query.locationId = locationId;
      if (status) query.status = status;
      if (paymentStatus) query.paymentStatus = paymentStatus;
      if (category) query.category = new RegExp(category, "i");
      if (!isPrivilegedRole(role)) query.createdBy = userId;

      const [items, total] = await Promise.all([
        Expense.find(query).sort({ expenseDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        Expense.countDocuments(query),
      ]);

      return res.json({
        success: true,
        data: {
          page,
          limit,
          total,
          items,
        },
      });
    } catch (error) {
      console.error("List expenses error:", error);
      return res.status(500).json({ success: false, message: "Failed to list expenses" });
    }
  }
);

router.post(
  "/",
  requirePermission(PERMISSIONS.CREATE_EXPENSES),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const {
        locationId,
        expenseDate,
        category,
        description,
        amount,
        paymentMethod,
        paymentStatus,
        status,
        vendorName,
        reference,
        notes,
      } = req.body;

      if (!locationId || !expenseDate || !category || !description) {
        return res.status(400).json({
          success: false,
          message: "locationId, expenseDate, category, and description are required",
        });
      }

      if (Number(amount) <= 0) {
        return res.status(400).json({ success: false, message: "amount must be greater than 0" });
      }

      const location = await Location.findOne({ _id: locationId, organizationId }).lean();
      if (!location) {
        return res.status(404).json({ success: false, message: "Location not found" });
      }

      // All expenses require an open shift session
      const previousDayOpenShift = await findPreviousDayOpenShiftSession({
        ShiftSession,
        organizationId,
        locationId,
        cashierId: userId,
      });
      if (previousDayOpenShift) {
        return res.status(403).json({
          success: false,
          code: "PREVIOUS_SHIFT_OPEN",
          message: getBlockedShiftMessage(),
          data: previousDayOpenShift,
        });
      }

      const openShift = await findOpenShiftSession({ organizationId, locationId, cashierId: userId });
      if (!openShift) {
        return res.status(400).json({
          success: false,
          message: "All expenses require an open shift at this location",
        });
      }
      const shiftSessionId = openShift._id;
      logShiftExpenseSync("expense.create.linked-to-shift", {
        organizationId: String(organizationId),
        userId: String(userId),
        locationId: String(locationId),
        shiftSessionId: String(shiftSessionId),
      });

      if (["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Use submit/approve/reject workflow endpoints for finalization",
        });
      }

      const resolvedStatus = status === "submitted" ? "submitted" : "draft";

      const expense = await Expense.create({
        organizationId,
        locationId,
        expenseDate: new Date(expenseDate),
        category,
        description,
        amount: roundMoney(amount),
        paymentMethod: paymentMethod || "cash",
        paymentStatus: paymentStatus || "unpaid",
        status: resolvedStatus,
        vendorName,
        reference,
        notes,
        shiftSessionId,
        validationStatus: "pending",
        submittedAt: resolvedStatus === "submitted" ? new Date() : undefined,
        submittedBy: resolvedStatus === "submitted" ? userId : undefined,
        createdBy: userId,
        updatedBy: userId,
      });

      await refreshShiftTotalsAfterExpenseMutation({
        organizationId,
        shiftSessionIds: [shiftSessionId],
        expenseId: expense._id,
        action: "expense.create",
      });

      if (resolvedStatus === "submitted") {
        await createApprovalRecord({
          organizationId,
          expenseId: expense._id,
          action: "submitted",
          actedBy: userId,
          notes,
        });
      }

      return res.status(201).json({
        success: true,
        message: "Expense created",
        data: {
          expense,
          accountingPosting: {
            posted: false,
            message: "Posting will happen on approval",
          },
        },
      });
    } catch (error) {
      console.error("Create expense error:", error);
      return res.status(500).json({ success: false, message: "Failed to create expense" });
    }
  }
);

router.get(
  "/:id",
  requirePermission(PERMISSIONS.VIEW_EXPENSES),
  async (req, res) => {
    try {
      const { organizationId, userId, role } = req.user;
      const query = {
        _id: req.params.id,
        organizationId,
      };
      if (!isPrivilegedRole(role)) {
        query.createdBy = userId;
      }

      const expense = await Expense.findOne(query).lean();
      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      const approvals = await ExpenseApproval.find({
        organizationId,
        expenseId: expense._id,
      })
        .sort({ actedAt: -1 })
        .lean();

      return res.json({ success: true, data: { expense, approvals } });
    } catch (error) {
      console.error("Get expense error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch expense" });
    }
  }
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.CREATE_EXPENSES),
  async (req, res) => {
    try {
      const { organizationId, userId, role } = req.user;
      const expense = await Expense.findOne({
        _id: req.params.id,
        organizationId,
      });

      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      if (!isPrivilegedRole(role) && String(expense.createdBy) !== String(userId)) {
        return res.status(403).json({ success: false, message: "You can only edit your own expenses" });
      }

      if (["approved", "rejected"].includes(expense.status)) {
        return res.status(400).json({ success: false, message: "Finalized expenses cannot be edited" });
      }

      const fields = [
        "expenseDate",
        "category",
        "description",
        "amount",
        "paymentMethod",
        "paymentStatus",
        "vendorName",
        "reference",
        "notes",
      ];

      const previousShiftSessionId = expense.shiftSessionId;

      const paymentMethodChanged = req.body.paymentMethod !== undefined;
      if (paymentMethodChanged) {
        if (req.body.paymentMethod === "cash") {
          const openShift = await findOpenShiftSession({
            organizationId,
            locationId: expense.locationId,
            cashierId: userId,
          });

          if (!openShift) {
            return res.status(400).json({
              success: false,
              message: "Cash expenses require an open shift at this location",
            });
          }

          expense.shiftSessionId = openShift._id;
          logShiftExpenseSync("expense.update.linked-to-shift", {
            organizationId: String(organizationId),
            expenseId: String(expense._id),
            shiftSessionId: String(openShift._id),
            paymentMethod: "cash",
          });
        } else {
          expense.shiftSessionId = undefined;
          logShiftExpenseSync("expense.update.unlinked-from-shift", {
            organizationId: String(organizationId),
            expenseId: String(expense._id),
            previousShiftSessionId: previousShiftSessionId ? String(previousShiftSessionId) : undefined,
            paymentMethod: req.body.paymentMethod,
          });
        }
      }

      fields.forEach((field) => {
        if (req.body[field] !== undefined) {
          expense[field] = field === "amount" ? roundMoney(req.body[field]) : req.body[field];
        }
      });

      if (req.body.expenseDate) {
        expense.expenseDate = new Date(req.body.expenseDate);
      }

      if (req.body.status && ["draft", "submitted"].includes(req.body.status)) {
        expense.status = req.body.status;
        if (req.body.status === "submitted") {
          expense.submittedAt = new Date();
          expense.submittedBy = userId;
          await createApprovalRecord({
            organizationId,
            expenseId: expense._id,
            action: "submitted",
            actedBy: userId,
            notes: req.body.notes,
          });
        }
      }

      expense.updatedBy = userId;
      await expense.save();

      await refreshShiftTotalsAfterExpenseMutation({
        organizationId,
        shiftSessionIds: [previousShiftSessionId, expense.shiftSessionId],
        expenseId: expense._id,
        action: "expense.update",
      });

      return res.json({ success: true, message: "Expense updated", data: expense });
    } catch (error) {
      console.error("Update expense error:", error);
      return res.status(500).json({ success: false, message: "Failed to update expense" });
    }
  }
);

router.post(
  "/:id/submit",
  requirePermission(PERMISSIONS.CREATE_EXPENSES),
  async (req, res) => {
    try {
      const { organizationId, userId, role } = req.user;
      const expense = await Expense.findOne({ _id: req.params.id, organizationId });

      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      if (!isPrivilegedRole(role) && String(expense.createdBy) !== String(userId)) {
        return res.status(403).json({ success: false, message: "You can only submit your own expenses" });
      }

      if (expense.status !== "draft") {
        return res.status(400).json({ success: false, message: "Only draft expenses can be submitted" });
      }

      expense.status = "submitted";
      expense.submittedAt = new Date();
      expense.submittedBy = userId;
      expense.updatedBy = userId;
      await expense.save();

      await refreshShiftTotalsAfterExpenseMutation({
        organizationId,
        shiftSessionIds: [expense.shiftSessionId],
        expenseId: expense._id,
        action: "expense.submit",
      });

      await createApprovalRecord({
        organizationId,
        expenseId: expense._id,
        action: "submitted",
        actedBy: userId,
        notes: req.body?.notes,
      });

      return res.json({ success: true, message: "Expense submitted", data: expense });
    } catch (error) {
      console.error("Submit expense error:", error);
      return res.status(500).json({ success: false, message: "Failed to submit expense" });
    }
  }
);

router.post(
  "/:id/approve",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;

      const expense = await Expense.findOne({ _id: req.params.id, organizationId });
      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      if (expense.status !== "submitted") {
        return res.status(400).json({ success: false, message: "Only submitted expenses can be approved" });
      }

      expense.status = "approved";
      expense.approvedAt = new Date();
      expense.approvedBy = userId;
      expense.updatedBy = userId;
      await expense.save();

      await refreshShiftTotalsAfterExpenseMutation({
        organizationId,
        shiftSessionIds: [expense.shiftSessionId],
        expenseId: expense._id,
        action: "expense.approve",
      });

      await createApprovalRecord({
        organizationId,
        expenseId: expense._id,
        action: "approved",
        actedBy: userId,
        notes: req.body?.notes,
      });

      const accountingPosting = await postExpenseToAccounting({ expense, userId });

      return res.json({
        success: true,
        message: "Expense approved",
        data: {
          expense,
          accountingPosting,
        },
      });
    } catch (error) {
      console.error("Approve expense error:", error);
      return res.status(500).json({ success: false, message: "Failed to approve expense" });
    }
  }
);

router.post(
  "/:id/reject",
  requirePermission(PERMISSIONS.MANAGE_FINANCE),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;

      const { reason, notes } = req.body || {};
      if (!reason) {
        return res.status(400).json({ success: false, message: "reason is required" });
      }

      const expense = await Expense.findOne({ _id: req.params.id, organizationId });
      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      if (expense.status !== "submitted") {
        return res.status(400).json({ success: false, message: "Only submitted expenses can be rejected" });
      }

      expense.status = "rejected";
      expense.rejectedAt = new Date();
      expense.rejectedBy = userId;
      expense.rejectionReason = reason;
      expense.updatedBy = userId;
      await expense.save();

      await refreshShiftTotalsAfterExpenseMutation({
        organizationId,
        shiftSessionIds: [expense.shiftSessionId],
        expenseId: expense._id,
        action: "expense.reject",
      });

      await createApprovalRecord({
        organizationId,
        expenseId: expense._id,
        action: "rejected",
        actedBy: userId,
        notes: notes || reason,
      });

      return res.json({ success: true, message: "Expense rejected", data: expense });
    } catch (error) {
      console.error("Reject expense error:", error);
      return res.status(500).json({ success: false, message: "Failed to reject expense" });
    }
  }
);

module.exports = router;
