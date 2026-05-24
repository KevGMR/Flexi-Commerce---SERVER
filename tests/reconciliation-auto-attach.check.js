const assert = require("assert");
const mongoose = require("mongoose");

const reconController = require("../controllers/Reconciliation");
const ReconciliationSession = require("../models/ReconciliationSession");
const ShiftSession = require("../models/ShiftSession");
const Sale = require("../models/Sale");

const createObjectId = () => new mongoose.Types.ObjectId();

const createShift = ({ organizationId, locationId }) => ({
  _id: createObjectId(),
  organizationId,
  locationId,
  cashierId: createObjectId(),
  shiftCode: `SHIFT-${Date.now()}`,
  status: "open",
  openedAt: new Date("2026-05-24T10:00:00.000Z"),
  closedAt: null,
  openingCash: 120,
  expectedCashSales: 0,
  cashExpenseTotal: 0,
  expectedClosingCash: 120,
  closingCash: 0,
  cashVariance: 0,
  updatedBy: createObjectId(),
});

const createReconciliationSession = ({ organizationId, locationId }) => ({
  _id: createObjectId(),
  organizationId,
  locationId,
  status: "open",
  windowStart: new Date("2026-05-24T00:00:00.000Z"),
  windowEnd: new Date("2026-05-24T23:59:59.999Z"),
  shiftSessionIds: [],
  shiftBreakdown: [],
  expectedByMethod: [],
  countedByMethod: [
    {
      method: "cash",
      expectedAmount: 0,
      countedAmount: 20,
      settledAmount: 20,
      varianceAmount: 20,
    },
  ],
  totalExpected: 0,
  totalCounted: 20,
  totalVariance: 20,
  updatedBy: createObjectId(),
  async save() {
    this.saved = true;
    return this;
  },
});

(async function run() {
  const originalFind = ReconciliationSession.find;
  const originalSaleFind = Sale.find;
  const originalShiftUpdateOne = ShiftSession.updateOne;

  try {
    const organizationId = createObjectId();
    const locationId = createObjectId();
    const userId = createObjectId();
    const shift = createShift({ organizationId, locationId });
    const reconciliationSession = createReconciliationSession({ organizationId, locationId });

    let updateCalls = 0;

    ReconciliationSession.find = (query) => {
      assert.strictEqual(String(query.organizationId), String(organizationId));
      assert.strictEqual(String(query.locationId), String(locationId));
      assert.deepStrictEqual(query.status.$in, ["open", "needs_review"]);
      assert.strictEqual(query.windowStart.$lte.toISOString(), shift.openedAt.toISOString());
      assert.strictEqual(query.windowEnd.$gte.toISOString(), shift.openedAt.toISOString());

      return {
        sort: async () => [reconciliationSession],
      };
    };

    Sale.find = () => ({
      select: () => ({
        lean: async () => [
          {
            paymentMethod: "cash",
            totalAmount: 50,
          },
        ],
      }),
    });

    ShiftSession.updateOne = async (filter, update) => {
      updateCalls += 1;
      assert.strictEqual(String(filter._id), String(shift._id));
      assert.strictEqual(String(filter.organizationId), String(organizationId));
      assert.strictEqual(String(update.$addToSet.reconciliationSessionIds), String(reconciliationSession._id));
      return { acknowledged: true };
    };

    const firstAttach = await reconController.attachShiftToEligibleReconciliationSession({
      organizationId,
      locationId,
      openedAt: shift.openedAt,
      shiftSession: shift,
      userId,
    });

    assert.strictEqual(firstAttach.attached, true);
    assert.strictEqual(String(firstAttach.reconciliationSessionId), String(reconciliationSession._id));
    assert.strictEqual(reconciliationSession.shiftSessionIds.length, 1);
    assert.strictEqual(String(reconciliationSession.shiftSessionIds[0]), String(shift._id));
    assert.strictEqual(reconciliationSession.shiftBreakdown.length, 1);
    assert.strictEqual(String(reconciliationSession.shiftBreakdown[0].shiftSessionId), String(shift._id));

    assert.strictEqual(reconciliationSession.expectedByMethod.length, 1);
    assert.strictEqual(reconciliationSession.expectedByMethod[0].method, "cash");
    assert.strictEqual(reconciliationSession.expectedByMethod[0].expectedAmount, 50);

    assert.strictEqual(reconciliationSession.countedByMethod.length, 1);
    assert.strictEqual(reconciliationSession.countedByMethod[0].countedAmount, 20);
    assert.strictEqual(reconciliationSession.countedByMethod[0].expectedAmount, 50);

    assert.strictEqual(reconciliationSession.totalExpected, 50);
    assert.strictEqual(reconciliationSession.totalCounted, 20);
    assert.strictEqual(reconciliationSession.totalVariance, -30);

    const secondAttach = await reconController.attachShiftToEligibleReconciliationSession({
      organizationId,
      locationId,
      openedAt: shift.openedAt,
      shiftSession: shift,
      userId,
    });

    assert.strictEqual(secondAttach.attached, false);
    assert.strictEqual(reconciliationSession.shiftSessionIds.length, 1);
    assert.strictEqual(reconciliationSession.shiftBreakdown.length, 1);
    assert.strictEqual(updateCalls, 2);

    let statusQueryObserved = false;
    ReconciliationSession.find = (query) => {
      statusQueryObserved = true;
      assert.deepStrictEqual(query.status.$in, ["open", "needs_review"]);
      return {
        sort: async () => [],
      };
    };

    const noEligible = await reconController.attachShiftToEligibleReconciliationSession({
      organizationId,
      locationId,
      openedAt: shift.openedAt,
      shiftSession: shift,
      userId,
    });

    assert.strictEqual(statusQueryObserved, true);
    assert.strictEqual(noEligible.attached, false);
    assert.strictEqual(noEligible.reason, "no-eligible-session");

    console.log("reconciliation-auto-attach: OK");
  } catch (error) {
    console.error("reconciliation-auto-attach: FAIL");
    console.error(error);
    process.exitCode = 1;
  } finally {
    ReconciliationSession.find = originalFind;
    Sale.find = originalSaleFind;
    ShiftSession.updateOne = originalShiftUpdateOne;
  }
})();
