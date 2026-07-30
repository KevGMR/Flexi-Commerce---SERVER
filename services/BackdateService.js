const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const ShiftSession = require("../models/ShiftSession");
const Receivable = require("../models/Receivable");
const Expense = require("../models/Expense");
const DeliveryFee = require("../models/DeliveryFee");
const ZReport = require("../models/ZReport");
const BackdateHistory = require("../models/BackdateHistory");
const TokenAuditLog = require("../models/TokenAuditLog");
const { roundMoney } = require("../utils/shiftSessionCalculations");

/**
 * Helper: Build a snapshot of all entities related to a shift
 * Lightweight: only fetch necessary fields
 */
async function snapshotShiftEntities(shiftId, organizationId) {
  const shift = await ShiftSession.findOne({ _id: shiftId, organizationId }).lean();
  if (!shift) throw new Error("Shift not found");

  const [sales, expenses, deliveryFees] = await Promise.all([
    Sale.find({ shiftSessionId: shiftId, organizationId })
      .select("_id createdAt completedAt shiftSessionId payments paymentMethod totalAmount status")
      .lean(),
    Expense.find({ shiftSessionId: shiftId, organizationId })
      .select("_id expenseDate createdAt")
      .lean(),
    DeliveryFee.find({ shiftSessionId: shiftId, organizationId })
      .select("_id createdAt totalAmount")
      .lean(),
  ]);

  const saleIds = sales.map(s => s._id);
  const [receivables, zReports] = await Promise.all([
    Receivable.find({ saleId: { $in: saleIds } })
      .select("_id saleId createdAt payments lastPaymentAt")
      .lean(),
    ZReport.find({ shiftSessionId: shiftId, organizationId })
      .select("_id reportDate reportCode")
      .lean(),
  ]);

  return {
    shift,
    sales,
    receivables,
    expenses,
    deliveryFees,
    zReports,
  };
}

/**
 * Helper: Preserve time-of-day when shifting a date
 */
function shiftDatePreserveTime(originalDate, targetDate) {
  return new Date(
    Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate(),
      originalDate.getUTCHours(),
      originalDate.getUTCMinutes(),
      originalDate.getUTCSeconds(),
      originalDate.getUTCMilliseconds()
    )
  );
}

/**
 * Helper: Recalculate shift totals
 */
async function recalculateShiftTotals(shiftId, organizationId, modifiedBy) {
  const sales = await Sale.find({ shiftSessionId: shiftId, organizationId, status: { $ne: "voided" } }).lean();
  
  let expectedCashSales = 0;
  for (const sale of sales) {
    if (sale.payments && sale.payments.length > 0) {
      const cashPayments = sale.payments
        .filter(p => p.method === "cash" && p.status === "completed")
        .reduce((sum, p) => sum + p.amount, 0);
      expectedCashSales += cashPayments;
    } else if (sale.paymentMethod === "cash") {
      expectedCashSales += sale.totalAmount;
    }
  }
  expectedCashSales = roundMoney(expectedCashSales);

  const shift = await ShiftSession.findById(shiftId);
  if (!shift) return;

  const openingCash = roundMoney(shift.openingCash || 0);
  const cashExpenseTotal = shift.cashExpenseTotal || 0;
  const expectedClosingCash = roundMoney(openingCash + expectedCashSales - cashExpenseTotal);

  await ShiftSession.updateOne(
    { _id: shiftId },
    {
      $set: {
        expectedCashSales,
        expectedClosingCash,
        updatedAt: new Date(),
        updatedBy: modifiedBy,
      }
    }
  );

  // Also update Z-Report if exists
  await ZReport.updateOne(
    { shiftSessionId: shiftId },
    {
      $set: {
        "summary.expectedCashSales": expectedCashSales,
        "summary.expectedClosingCash": expectedClosingCash,
        updatedAt: new Date(),
      }
    }
  );
}

/**
 * Main service: Preview backdate for a shift
 */
async function previewShiftBackdate(shiftId, targetDate, modifiedBy, organizationId) {
  const snapshot = await snapshotShiftEntities(shiftId, organizationId);
  const { shift, sales, receivables, expenses, deliveryFees, zReports } = snapshot;

  const targetDateObj = new Date(targetDate);
  if (isNaN(targetDateObj.getTime())) throw new Error("Invalid target date");

  const preview = {
    shiftId,
    shiftCode: shift.shiftCode,
    originalShiftOpenedAt: shift.openedAt,
    newShiftOpenedAt: shiftDatePreserveTime(shift.openedAt, targetDateObj),
    sales: [],
    receivables: [],
    expenses: [],
    deliveryFees: [],
    zReports: [],
  };

  // Preview sales changes
  for (const sale of sales) {
    const originalCreatedAt = new Date(sale.createdAt);
    const shiftedCreatedAt = shiftDatePreserveTime(originalCreatedAt, targetDateObj);
    preview.sales.push({
      saleId: sale._id,
      receiptNumber: sale.receiptNumber,
      originalCreatedAt,
      shiftedCreatedAt,
    });
  }

  // Preview receivable changes
  for (const rec of receivables) {
    const originalCreatedAt = new Date(rec.createdAt);
    const shiftedCreatedAt = shiftDatePreserveTime(originalCreatedAt, targetDateObj);
    preview.receivables.push({
      receivableId: rec._id,
      saleId: rec.saleId,
      originalCreatedAt,
      shiftedCreatedAt,
    });
  }

  // Preview expense changes
  for (const exp of expenses) {
    const originalExpenseDate = new Date(exp.expenseDate);
    const shiftedExpenseDate = shiftDatePreserveTime(originalExpenseDate, targetDateObj);
    preview.expenses.push({
      expenseId: exp._id,
      category: exp.category,
      originalExpenseDate,
      shiftedExpenseDate,
    });
  }

  // Preview delivery fee changes
  for (const df of deliveryFees) {
    const originalCreatedAt = new Date(df.createdAt);
    const shiftedCreatedAt = shiftDatePreserveTime(originalCreatedAt, targetDateObj);
    preview.deliveryFees.push({
      deliveryFeeId: df._id,
      originalCreatedAt,
      shiftedCreatedAt,
    });
  }

  // Preview Z-Report changes
  for (const zr of zReports) {
    const originalReportDate = new Date(zr.reportDate);
    const shiftedReportDate = shiftDatePreserveTime(originalReportDate, targetDateObj);
    preview.zReports.push({
      zReportId: zr._id,
      reportCode: zr.reportCode,
      originalReportDate,
      shiftedReportDate,
    });
  }

  return preview;
}

/**
 * Main service: Apply backdate for a shift (in transaction)
 * Optimized with a single bulkWrite and higher timeout
 */
async function applyShiftBackdate(shiftId, targetDate, modifiedBy, organizationId, notes = "", ipAddress = "0.0.0.0", userAgent = "unknown") {
  const session = await mongoose.startSession();
  session.startTransaction({
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    maxCommitTimeMS: 120000, // 2 minutes timeout
  });

  try {
    // 1. Snapshot original state (lightweight: only fetch what's needed)
    const snapshot = await snapshotShiftEntities(shiftId, organizationId);
    const { shift, sales, receivables, expenses, deliveryFees, zReports } = snapshot;

    const targetDateObj = new Date(targetDate);
    if (isNaN(targetDateObj.getTime())) throw new Error("Invalid target date");

    // 2. Update shift session
    const newShiftOpenedAt = shiftDatePreserveTime(shift.openedAt, targetDateObj);
    await ShiftSession.updateOne(
      { _id: shiftId },
      {
        $set: {
          openedAt: newShiftOpenedAt,
          updatedAt: new Date(),
          updatedBy: modifiedBy,
        }
      },
      { session }
    );

    // 3. Build a single bulkWrite array with all operations
    const bulkOps = [];

    // Sales
    for (const sale of sales) {
      const originalCreatedAt = new Date(sale.createdAt);
      const shiftedCreatedAt = shiftDatePreserveTime(originalCreatedAt, targetDateObj);
      
      const update = {
        $set: {
          createdAt: shiftedCreatedAt,
          completedAt: shiftedCreatedAt,
          updatedAt: new Date(),
          lastModified: new Date(),
          modifiedBy: modifiedBy,
        }
      };
      
      // Update payment timestamps if any
      if (sale.payments && sale.payments.length > 0) {
        update.$set["payments.$[].paidAt"] = shiftedCreatedAt;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: sale._id },
          update: update,
        },
      });
    }

    // Receivables
    for (const rec of receivables) {
      const originalCreatedAt = new Date(rec.createdAt);
      const shiftedCreatedAt = shiftDatePreserveTime(originalCreatedAt, targetDateObj);
      
      const update = {
        $set: {
          createdAt: shiftedCreatedAt,
          updatedAt: new Date(),
          updatedBy: modifiedBy,
        }
      };
      
      if (rec.payments && rec.payments.length > 0) {
        update.$set["payments.$[].collectedAt"] = shiftedCreatedAt;
        update.$set.lastPaymentAt = shiftedCreatedAt;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: rec._id },
          update: update,
        },
      });
    }

    // Expenses
    for (const exp of expenses) {
      const originalExpenseDate = new Date(exp.expenseDate);
      const shiftedExpenseDate = shiftDatePreserveTime(originalExpenseDate, targetDateObj);
      
      bulkOps.push({
        updateOne: {
          filter: { _id: exp._id },
          update: {
            $set: {
              expenseDate: shiftedExpenseDate,
              createdAt: shiftedExpenseDate,
              updatedAt: new Date(),
            }
          },
        },
      });
    }

    // Delivery Fees
    for (const df of deliveryFees) {
      const originalCreatedAt = new Date(df.createdAt);
      const shiftedCreatedAt = shiftDatePreserveTime(originalCreatedAt, targetDateObj);
      
      bulkOps.push({
        updateOne: {
          filter: { _id: df._id },
          update: {
            $set: {
              createdAt: shiftedCreatedAt,
              updatedAt: new Date(),
            }
          },
        },
      });
    }

    // Z-Reports
    for (const zr of zReports) {
      const originalReportDate = new Date(zr.reportDate);
      const shiftedReportDate = shiftDatePreserveTime(originalReportDate, targetDateObj);
      
      bulkOps.push({
        updateOne: {
          filter: { _id: zr._id },
          update: {
            $set: {
              reportDate: shiftedReportDate,
              updatedAt: new Date(),
            }
          },
        },
      });
    }

    // 4. Execute all updates in a single bulkWrite (ordered: false for speed)
    let results = {};
    if (bulkOps.length > 0) {
      results = await Sale.bulkWrite(bulkOps, { 
        session, 
        ordered: false,
        // Increase write timeout per operation
        wtimeout: 60000,
      });
    }

    // 5. Recalculate shift totals (using the already-fetched sales)
    const shiftTotals = sales.reduce((acc, sale) => {
      if (sale.status === "voided") return acc;
      if (sale.payments && sale.payments.length > 0) {
        const cashPayments = sale.payments
          .filter(p => p.method === "cash" && p.status === "completed")
          .reduce((sum, p) => sum + p.amount, 0);
        acc.expectedCashSales += cashPayments;
      } else if (sale.paymentMethod === "cash") {
        acc.expectedCashSales += sale.totalAmount;
      }
      return acc;
    }, { expectedCashSales: 0 });

    const openingCash = roundMoney(shift.openingCash || 0);
    const cashExpenseTotal = shift.cashExpenseTotal || 0;
    const expectedClosingCash = roundMoney(openingCash + shiftTotals.expectedCashSales - cashExpenseTotal);

    await ShiftSession.updateOne(
      { _id: shiftId },
      {
        $set: {
          expectedCashSales: roundMoney(shiftTotals.expectedCashSales),
          expectedClosingCash: expectedClosingCash,
        }
      },
      { session }
    );

    // Update Z-Report if exists
    if (zReports.length > 0) {
      await ZReport.updateOne(
        { shiftSessionId: shiftId },
        {
          $set: {
            "summary.expectedCashSales": roundMoney(shiftTotals.expectedCashSales),
            "summary.expectedClosingCash": expectedClosingCash,
            updatedAt: new Date(),
          }
        },
        { session }
      );
    }

    // 6. Save backdate history
    const history = new BackdateHistory({
      organizationId,
      locationId: shift.locationId,
      shiftId: shift._id,
      targetDate: targetDateObj,
      originalState: {
        shift: {
          openedAt: shift.openedAt,
          expectedCashSales: shift.expectedCashSales || 0,
          expectedClosingCash: shift.expectedClosingCash || 0,
        },
        sales: sales.map(s => ({
          _id: s._id,
          createdAt: s.createdAt,
          completedAt: s.completedAt,
          shiftSessionId: s.shiftSessionId,
          payments: s.payments,
        })),
        receivables: receivables.map(r => ({
          _id: r._id,
          createdAt: r.createdAt,
          payments: r.payments,
          lastPaymentAt: r.lastPaymentAt,
        })),
        expenses: expenses.map(e => ({
          _id: e._id,
          expenseDate: e.expenseDate,
          createdAt: e.createdAt,
        })),
        deliveryFees: deliveryFees.map(df => ({
          _id: df._id,
          createdAt: df.createdAt,
        })),
        zReports: zReports.map(zr => ({
          _id: zr._id,
          reportDate: zr.reportDate,
        })),
      },
      changes: {
        salesCount: sales.length,
        salesIds: sales.map(s => s._id),
        expensesCount: expenses.length,
        expenseIds: expenses.map(e => e._id),
        deliveryFeesCount: deliveryFees.length,
        deliveryFeeIds: deliveryFees.map(df => df._id),
        receivablesCount: receivables.length,
        receivableIds: receivables.map(r => r._id),
        zReportsCount: zReports.length,
        zReportIds: zReports.map(zr => zr._id),
      },
      appliedBy: modifiedBy,
      notes,
    });

    await history.save({ session });

    // 7. Log to TokenAuditLog
    const auditLog = new TokenAuditLog({
        userId: modifiedBy,
        organizationId,
        ipAddress: ipAddress,
        userAgent: userAgent,
        eventType: "backdate_applied",
        details: `Backdated shift ${shift.shiftCode} to ${targetDateObj.toISOString()}. ${sales.length} sales, ${expenses.length} expenses, ${deliveryFees.length} deliveries, ${receivables.length} receivables, ${zReports.length} Z-reports updated.`,
        success: true,
        endpoint: "/admin/backdate-shift",
        adminId: modifiedBy,
    });
    await auditLog.save({ session });

    await session.commitTransaction();

    return {
      success: true,
      historyId: history._id,
      salesUpdated: sales.length,
      expensesUpdated: expenses.length,
      deliveryFeesUpdated: deliveryFees.length,
      receivablesUpdated: receivables.length,
      zReportsUpdated: zReports.length,
      shiftCode: shift.shiftCode,
      newShiftOpenedAt,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

/**
 * Rollback a backdate operation
 */
async function rollbackBackdate(backdateId, rolledBackBy, reason = "", ipAddress = "0.0.0.0", userAgent = "unknown") {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const history = await BackdateHistory.findOne({ _id: backdateId, status: "applied" });
    if (!history) throw new Error("Backdate history not found or already rolled back");

    const { originalState, shiftId, organizationId, locationId } = history;

    // 1. Restore shift
    await ShiftSession.updateOne(
      { _id: shiftId },
      {
        $set: {
          openedAt: originalState.shift.openedAt,
          expectedCashSales: originalState.shift.expectedCashSales,
          expectedClosingCash: originalState.shift.expectedClosingCash,
          updatedAt: new Date(),
          updatedBy: rolledBackBy,
        }
      },
      { session }
    );

    // 2. Restore sales
    for (const saleData of originalState.sales) {
      const update = {
        $set: {
          createdAt: saleData.createdAt,
          completedAt: saleData.completedAt || saleData.createdAt,
          shiftSessionId: saleData.shiftSessionId,
          updatedAt: new Date(),
          modifiedBy: rolledBackBy,
        }
      };
      if (saleData.payments) {
        update.$set["payments"] = saleData.payments;
      }
      await Sale.updateOne(
        { _id: saleData._id },
        update,
        { session }
      );
    }

    // 3. Restore receivables
    for (const recData of originalState.receivables) {
      const update = {
        $set: {
          createdAt: recData.createdAt,
          updatedAt: new Date(),
          updatedBy: rolledBackBy,
        }
      };
      if (recData.payments) {
        update.$set["payments"] = recData.payments;
      }
      if (recData.lastPaymentAt) {
        update.$set.lastPaymentAt = recData.lastPaymentAt;
      }
      await Receivable.updateOne(
        { _id: recData._id },
        update,
        { session }
      );
    }

    // 4. Restore expenses
    for (const expData of originalState.expenses) {
      await Expense.updateOne(
        { _id: expData._id },
        {
          $set: {
            expenseDate: expData.expenseDate,
            createdAt: expData.createdAt,
            updatedAt: new Date(),
          }
        },
        { session }
      );
    }

    // 5. Restore delivery fees
    for (const dfData of originalState.deliveryFees) {
      await DeliveryFee.updateOne(
        { _id: dfData._id },
        {
          $set: {
            createdAt: dfData.createdAt,
            updatedAt: new Date(),
          }
        },
        { session }
      );
    }

    // 6. Restore Z-Reports
    for (const zrData of originalState.zReports) {
      await ZReport.updateOne(
        { _id: zrData._id },
        {
          $set: {
            reportDate: zrData.reportDate,
            updatedAt: new Date(),
          }
        },
        { session }
      );
    }

    // 7. Update history status
    history.status = "rolled-back";
    history.rolledBackBy = rolledBackBy;
    history.rolledBackAt = new Date();
    history.rollbackReason = reason;
    await history.save({ session });

    // 8. Log to TokenAuditLog
    const auditLog = new TokenAuditLog({
      userId: rolledBackBy,
      organizationId,
      ipAddress: ipAddress,
      userAgent: userAgent,
      eventType: "backdate_rolled_back",
      details: `Rolled back backdate for shift ${history.shiftId} (history ${backdateId}). Reason: ${reason || "No reason provided"}`,
      success: true,
      endpoint: "/admin/rollback-backdate",
      adminId: rolledBackBy,
    });
    await auditLog.save({ session });


    await session.commitTransaction();

    return {
      success: true,
      historyId: history._id,
      shiftId,
      rolledBackAt: history.rolledBackAt,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * List shifts with totals for the backdate UI
 */
async function listShiftsForBackdate(organizationId, locationId, startDate, endDate, page, limit) {
  const query = { organizationId };
  if (locationId) query.locationId = locationId;

  // ✅ Fix: Ensure end date includes the full day
  if (startDate || endDate) {
    query.openedAt = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setUTCHours(0, 0, 0, 0);
      query.openedAt.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      query.openedAt.$lte = end;
    }
    if (!query.openedAt.$gte) delete query.openedAt.$gte;
    if (!query.openedAt.$lte) delete query.openedAt.$lte;
    if (Object.keys(query.openedAt).length === 0) delete query.openedAt;
  }

  const skip = (page - 1) * limit;
  const [shifts, total] = await Promise.all([
    ShiftSession.find(query)
      .sort({ openedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ShiftSession.countDocuments(query),
  ]);

  // Enrich each shift with totals
  const enrichedShifts = await Promise.all(shifts.map(async (shift) => {
    const sales = await Sale.find({ shiftSessionId: shift._id, organizationId, status: { $ne: "voided" } }).lean();
    const expenses = await Expense.find({ shiftSessionId: shift._id, organizationId }).lean();
    const deliveryFees = await DeliveryFee.find({ shiftSessionId: shift._id, organizationId }).lean();
    const receivables = await Receivable.find({ saleId: { $in: sales.map(s => s._id) } }).lean();

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

    return {
      ...shift,
      summary: {
        salesCount: sales.length,
        totalSales: roundMoney(totalSales),
        totalTax: roundMoney(totalTax),
        totalDiscount: roundMoney(totalDiscount),
        totalDeliveryFees: roundMoney(totalDeliveries),
        totalExpenses: roundMoney(totalExpenses),
        totalReceivables: roundMoney(totalReceivables),
        expectedCashSales: shift.expectedCashSales || 0,
        expectedClosingCash: shift.expectedClosingCash || 0,
        cashVariance: shift.cashVariance || 0,
      }
    };
  }));

  return {
    shifts: enrichedShifts,
    pagination: { page, limit, total },
  };
}

module.exports = {
  previewShiftBackdate,
  applyShiftBackdate,
  rollbackBackdate,
  listShiftsForBackdate,
};