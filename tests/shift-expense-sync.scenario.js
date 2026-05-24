const assert = require("assert");
const mongoose = require("mongoose");
const express = require("express");

require("dotenv").config();

const ShiftSession = require("../models/ShiftSession");
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Organization = require("../models/Organization");
const User = require("../models/User");
const Location = require("../models/Location");
const shiftSessionRouter = require("../controllers/ShiftSession");
const expenseRouter = require("../controllers/Expense");

const scenario = {
  organizationId: "6a0ea9ec202ee117d64d28ed",
  cashierId: "6a0ea9eb202ee117d64d28e6",
  locationId: "6a0eac1a202ee117d64d293a",
};

const nowSuffix = Date.now();
const runTag = `SHIFT-EXP-SYNC-${nowSuffix}`;

const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let body;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }

  return { response, body };
};

const ensureRequiredReferences = async () => {
  const [orgExists, userExists, locationExists] = await Promise.all([
    Organization.exists({ _id: toObjectId(scenario.organizationId) }),
    User.exists({ _id: toObjectId(scenario.cashierId) }),
    Location.exists({ _id: toObjectId(scenario.locationId), organizationId: toObjectId(scenario.organizationId) }),
  ]);

  assert.ok(orgExists, `Organization not found: ${scenario.organizationId}`);
  assert.ok(userExists, `Cashier not found: ${scenario.cashierId}`);
  assert.ok(locationExists, `Location not found in organization: ${scenario.locationId}`);
};

const closeExistingOpenShifts = async () => {
  const result = await ShiftSession.updateMany(
    {
      organizationId: toObjectId(scenario.organizationId),
      locationId: toObjectId(scenario.locationId),
      cashierId: toObjectId(scenario.cashierId),
      status: "open",
    },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        updatedBy: toObjectId(scenario.cashierId),
      },
    }
  );

  console.log(`[scenario] Closed existing open shifts: ${result.modifiedCount}`);
};

const buildHarnessApp = () => {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = {
      userId: scenario.cashierId,
      organizationId: scenario.organizationId,
      role: "Cashier",
      permissions: ["create_sale", "create_expenses", "view_financial_reports"],
    };
    next();
  });

  app.use("/shift-sessions", shiftSessionRouter);
  app.use("/expenses", expenseRouter);

  return app;
};

const createSaleForShift = async (shiftSessionId) => {
  const sale = await Sale.create({
    organizationId: toObjectId(scenario.organizationId),
    locationId: toObjectId(scenario.locationId),
    receiptNumber: `${runTag}-RCP-200`,
    transactionId: `${runTag}-TXN-200`,
    items: [
      {
        type: "flexi",
        quantity: 1,
        unitPrice: 200,
        lineTotal: 200,
      },
    ],
    subtotal: 200,
    totalAmount: 200,
    paymentMethod: "cash",
    payments: [
      {
        method: "cash",
        amount: 200,
        status: "completed",
      },
    ],
    paymentStatus: "completed",
    cashierId: toObjectId(scenario.cashierId),
    shiftSessionId,
    status: "completed",
    completedAt: new Date(),
    notes: runTag,
  });

  console.log(`[scenario] Sale created: ${sale._id} amount=200`);
  return sale;
};

const run = async () => {
  const mongoUri = process.env.MONGO_URI;
  assert.ok(mongoUri, "MONGO_URI is required in environment");

  let server;
  let createdShiftId = null;
  let createdSaleId = null;
  let createdExpenseId = null;

  try {
    await mongoose.connect(mongoUri);
    console.log("[scenario] Connected to MongoDB");

    await ensureRequiredReferences();
    await closeExistingOpenShifts();

    const app = buildHarnessApp();
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const openShiftResult = await requestJson(`${baseUrl}/shift-sessions/open`, {
      method: "POST",
      body: JSON.stringify({
        locationId: scenario.locationId,
        openingCash: 0,
        notes: runTag,
      }),
    });

    assert.strictEqual(openShiftResult.response.status, 201, `Open shift failed: ${JSON.stringify(openShiftResult.body)}`);
    createdShiftId = openShiftResult.body?.data?._id;
    assert.ok(createdShiftId, "Shift ID missing from open-shift response");
    console.log(`[scenario] Shift opened: ${createdShiftId}`);

    const sale = await createSaleForShift(toObjectId(createdShiftId));
    createdSaleId = sale._id;

    const expenseResult = await requestJson(`${baseUrl}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        locationId: scenario.locationId,
        expenseDate: new Date().toISOString(),
        category: "Testing",
        description: `${runTag} Expense 100`,
        amount: 100,
        paymentMethod: "cash",
        paymentStatus: "paid",
        status: "draft",
        notes: runTag,
      }),
    });

    assert.strictEqual(expenseResult.response.status, 201, `Create expense failed: ${JSON.stringify(expenseResult.body)}`);
    createdExpenseId = expenseResult.body?.data?.expense?._id;
    assert.ok(createdExpenseId, "Expense ID missing from expense create response");
    console.log(`[scenario] Expense created: ${createdExpenseId} amount=100`);

    const previewResult = await requestJson(`${baseUrl}/shift-sessions/${createdShiftId}/preview`);
    assert.strictEqual(previewResult.response.status, 200, `Preview failed: ${JSON.stringify(previewResult.body)}`);

    const preview = previewResult.body?.data || {};
    assert.strictEqual(Number(preview.expectedCashSales), 200, `expectedCashSales mismatch: ${preview.expectedCashSales}`);
    assert.strictEqual(Number(preview.cashExpenseTotal), 100, `preview cashExpenseTotal mismatch: ${preview.cashExpenseTotal}`);

    const shiftAfter = await ShiftSession.findById(createdShiftId).lean();
    assert.ok(shiftAfter, "Shift not found after scenario run");
    assert.strictEqual(Number(shiftAfter.cashExpenseTotal), 100, `shift cashExpenseTotal mismatch: ${shiftAfter.cashExpenseTotal}`);

    console.log("[scenario] PASS");
    console.log(
      JSON.stringify(
        {
          organizationId: scenario.organizationId,
          shiftSessionId: createdShiftId,
          cashierId: scenario.cashierId,
          locationId: scenario.locationId,
          saleAmount: 200,
          expenseAmount: 100,
          preview,
          storedShiftCashExpenseTotal: Number(shiftAfter.cashExpenseTotal),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("[scenario] FAIL", error.message);
    process.exitCode = 1;
  } finally {
    const keepData = process.env.KEEP_SHIFT_EXPENSE_TEST_DATA === "1";

    if (!keepData) {
      const cleanupOps = [];
      if (createdExpenseId) cleanupOps.push(Expense.deleteOne({ _id: createdExpenseId }));
      if (createdSaleId) cleanupOps.push(Sale.deleteOne({ _id: createdSaleId }));
      if (createdShiftId) cleanupOps.push(ShiftSession.deleteOne({ _id: createdShiftId }));

      if (cleanupOps.length > 0) {
        await Promise.all(cleanupOps);
        console.log("[scenario] Cleanup completed");
      }
    } else {
      console.log("[scenario] KEEP_SHIFT_EXPENSE_TEST_DATA=1, skipping cleanup");
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
};

run();