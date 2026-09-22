const assert = require("assert");
const {
  getSaleCashPaymentsTotal,
  buildShiftExpenseMatch,
  calculateExpectedClosingCash,
  determineShiftCloseTiming,
} = require("../utils/shiftSessionCalculations");

const refundSale = {
  payments: [{ method: "cash", amount: 100, status: "completed" }],
  refundAmount: 30,
  status: "partial_refund",
};

assert.strictEqual(getSaleCashPaymentsTotal(refundSale), 70, "refunds should reduce cash sales");

const legacyCashSale = {
  paymentMethod: "cash",
  totalAmount: 55,
  refundAmount: 5,
};

assert.strictEqual(getSaleCashPaymentsTotal(legacyCashSale), 50, "legacy cash sales should still support refunds");

const expenseMatch = buildShiftExpenseMatch({
  organizationId: "org1",
  locationId: "loc1",
  shiftSessionId: "shift1",
  cashierId: "user1",
  openedAt: new Date("2026-05-23T08:00:00.000Z"),
  closedAt: new Date("2026-05-23T16:00:00.000Z"),
});

assert.deepStrictEqual(
  expenseMatch,
  {
    organizationId: "org1",
    locationId: "loc1",
    paymentMethod: "cash",
    status: { $ne: "rejected" },
    $or: [
      { shiftSessionId: "shift1" },
      {
        shiftSessionId: { $exists: false },
        createdBy: "user1",
        createdAt: {
          $gte: new Date("2026-05-23T08:00:00.000Z"),
          $lte: new Date("2026-05-23T16:00:00.000Z"),
        },
      },
    ],
  },
  "shift expenses should include linked expenses and legacy orphaned expenses within the shift window"
);

assert.strictEqual(
  calculateExpectedClosingCash({ openingCash: 100, expectedCashSales: 70, cashExpenseTotal: 25 }),
  145,
  "expected closing cash should subtract expenses from opening cash plus sales"
);

const backdatedTiming = determineShiftCloseTiming({
  openedAt: new Date("2026-05-23T08:00:00.000Z"),
  transactionTimestamps: [
    new Date("2026-05-23T10:15:00.000Z"),
    new Date("2026-05-23T14:45:00.000Z"),
  ],
  now: new Date("2026-05-24T09:00:00.000Z"),
});

assert.strictEqual(
  backdatedTiming.closeTime.toISOString(),
  "2026-05-23T14:45:00.000Z",
  "shift close time should backdate to the latest transaction time"
);
assert.strictEqual(
  backdatedTiming.closeBackdated,
  true,
  "shift close timing should flag backdated closes"
);

const sameDayTiming = determineShiftCloseTiming({
  openedAt: new Date("2026-05-23T08:00:00.000Z"),
  transactionTimestamps: [],
  now: new Date("2026-05-23T16:00:00.000Z"),
});

assert.strictEqual(
  sameDayTiming.closeTime.toISOString(),
  "2026-05-23T16:00:00.000Z",
  "shift close time should use server time when there are no transactions"
);
assert.strictEqual(
  sameDayTiming.closeBackdated,
  false,
  "shift close timing should not flag same-day closes as backdated"
);

console.log("shift-session-calculations: OK");