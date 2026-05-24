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
};