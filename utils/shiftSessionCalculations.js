const mongoose = require("mongoose");

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const toObjectIdIfValid = (value) => {
  if (!value) {
    return value;
  }

  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return value;
};

const getLocalDayStart = (referenceDate = new Date()) => {
  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0,
  );
};

const determineShiftCloseTiming = ({ openedAt, transactionTimestamps = [], now = new Date() }) => {
  const nowDate = now instanceof Date ? now : new Date(now);
  const openedAtDate = openedAt instanceof Date ? openedAt : new Date(openedAt);
  const validTransactionTimes = transactionTimestamps
    .map((timestamp) => (timestamp instanceof Date ? timestamp : new Date(timestamp)))
    .filter((timestamp) => !Number.isNaN(timestamp.getTime()))
    .map((timestamp) => timestamp.getTime());

  const latestTransactionMs = validTransactionTimes.length > 0 ? Math.max(...validTransactionTimes) : null;
  const closeTimeMs = latestTransactionMs === null
    ? nowDate.getTime()
    : Math.max(openedAtDate.getTime(), Math.min(latestTransactionMs, nowDate.getTime()));
  const closeTime = new Date(closeTimeMs);

  return {
    closeTime,
    closeBackdated: closeTime.getTime() < nowDate.getTime(),
    closedAtRecordedAt: nowDate,
  };
};

const findPreviousDayOpenShiftSession = async ({ ShiftSession, organizationId, locationId, cashierId, referenceDate = new Date() }) => {
  if (!ShiftSession || !organizationId || !locationId || !cashierId) {
    return null;
  }

  const dayStart = getLocalDayStart(referenceDate);

  return ShiftSession.findOne({
    organizationId,
    locationId,
    cashierId,
    status: "open",
    openedAt: { $lt: dayStart },
  })
    .sort({ openedAt: -1 })
    .lean();
};

const getSaleCashPaymentsTotal = (sale) => {
  let cashTotal = 0;

  if (Array.isArray(sale?.payments) && sale.payments.length > 0) {
    cashTotal = sale.payments
      .filter((payment) => payment?.method === "cash" && (payment?.status || "completed") === "completed")
      .reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0);
  } else if (sale?.paymentMethod === "cash" && Number(sale?.totalAmount) > 0) {
    cashTotal = Number(sale.totalAmount) || 0;
  }

  const refundTotal = Number(sale?.refundAmount) || 0;
  return roundMoney(Math.max(0, cashTotal - refundTotal));
};

const buildShiftExpenseMatch = ({ organizationId, locationId, shiftSessionId, cashierId, openedAt, closedAt }) => {
  const normalizedOrganizationId = toObjectIdIfValid(organizationId);
  const normalizedLocationId = toObjectIdIfValid(locationId);
  const normalizedShiftSessionId = toObjectIdIfValid(shiftSessionId);
  const normalizedCashierId = toObjectIdIfValid(cashierId);

  const match = {
    organizationId: normalizedOrganizationId,
    locationId: normalizedLocationId,
    paymentMethod: "cash",
    status: { $ne: "rejected" },
    $or: [{ shiftSessionId: normalizedShiftSessionId }],
  };

  if (normalizedCashierId && openedAt && closedAt) {
    match.$or.push({
      shiftSessionId: { $exists: false },
      createdBy: normalizedCashierId,
      createdAt: {
        $gte: openedAt,
        $lte: closedAt,
      },
    });
  }

  return match;
};

const calculateExpectedClosingCash = ({ openingCash, expectedCashSales, cashExpenseTotal }) => {
  return roundMoney(Number(openingCash || 0) + Number(expectedCashSales || 0) - Number(cashExpenseTotal || 0));
};

module.exports = {
  roundMoney,
  getSaleCashPaymentsTotal,
  buildShiftExpenseMatch,
  calculateExpectedClosingCash,
  determineShiftCloseTiming,
  findPreviousDayOpenShiftSession,
};