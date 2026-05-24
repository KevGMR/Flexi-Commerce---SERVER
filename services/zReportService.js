const ShiftSession = require("../models/ShiftSession");
const ZReport = require("../models/ZReport");

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const generateZReportForShiftSession = async ({ organizationId, userId, shiftSessionId, notes }) => {
  const existingReport = await ZReport.findOne({
    organizationId,
    shiftSessionId,
  });

  if (existingReport) {
    return { reused: true, report: existingReport };
  }

  const session = await ShiftSession.findOne({
    _id: shiftSessionId,
    organizationId,
  }).lean();

  if (!session) {
    throw new Error("Shift session not found");
  }

  const report = await ZReport.create({
    organizationId,
    locationId: session.locationId,
    shiftSessionId: session._id,
    reportCode: `ZR-${String(organizationId).slice(-6).toUpperCase()}-${Date.now()}`,
    reportDate: session.closedAt || new Date(),
    summary: {
      openingCash: roundMoney(session.openingCash),
      expectedCashSales: roundMoney(session.expectedCashSales),
      expectedClosingCash: roundMoney(session.expectedClosingCash),
      countedClosingCash: roundMoney(session.closingCash),
      variance: roundMoney(session.cashVariance),
    },
    notes,
    generatedBy: userId,
  });

  return { reused: false, report };
};

module.exports = {
  generateZReportForShiftSession,
};
