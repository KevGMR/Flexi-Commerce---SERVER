/**
 * Test Suite: Transaction Validation System
 * 
 * Tests for:
 * - Transaction validation endpoint (POST /transactions/:id/validate)
 * - Transaction dispute endpoint (POST /transactions/:id/dispute)
 * - Shift transactions listing (GET /shifts/:id/transactions)
 * - Unified transaction querying (GET /transactions/:id)
 */

const request = require("supertest");
const mongoose = require("mongoose");
require("dotenv").config();

// Models
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const DeliveryFee = require("../models/DeliveryFee");
const ShiftSession = require("../models/ShiftSession");
const User = require("../models/User");
const Organization = require("../models/Organization");
const Location = require("../models/Location");

// Start with your app instance
const app = require("../index");

// Test Data
let organizationId, locationId, cashierId, financeUserId, testToken, financeToken, shiftId;
let testSale, testExpense, testDelivery;

/**
 * Setup: Create test organization, locations, users, and shift
 */
const setupTestData = async () => {
  console.log("🔧 Setting up test data...");

  // Create organization
  const org = await Organization.create({
    name: "Test Org - Validation Suite",
    subscriptionTier: "premium",
  });
  organizationId = org._id;

  // Create location
  const location = await Location.create({
    organizationId,
    name: "Test Location",
    city: "Nairobi",
    country: "Kenya",
  });
  locationId = location._id;

  // Create cashier user
  const cashierUser = await User.create({
    email: "cashier@test.com",
    password: "hashed_password",
    firstName: "Test",
    lastName: "Cashier",
    role: "Cashier",
    organizationId,
    permissions: ["CREATE_SALE", "CREATE_EXPENSES"],
    isActive: true,
  });
  cashierId = cashierUser._id;

  // Create finance user
  const financeUser = await User.create({
    email: "finance@test.com",
    password: "hashed_password",
    firstName: "Test",
    lastName: "Finance",
    role: "Manager",
    organizationId,
    permissions: ["MANAGE_FINANCE", "VIEW_FINANCIAL_REPORTS"],
    isActive: true,
  });
  financeUserId = financeUser._id;

  // Create open shift
  const shift = await ShiftSession.create({
    organizationId,
    locationId,
    cashierId,
    openingCash: 5000,
    openedAt: new Date(),
    status: "open",
  });
  shiftId = shift._id;

  console.log("✅ Test data created");
  return { organizationId, locationId, cashierId, financeUserId, shiftId };
};

/**
 * Helper: Generate auth token for user
 */
const generateToken = (userId, permissions) => {
  // Mock JWT token generation
  // In real tests, use your actual auth mechanism
  return `mock_token_${userId}`;
};

/**
 * Test Suite 1: Sales Transaction Validation
 */
describe("Sales Validation", () => {
  let saleId;

  beforeAll(async () => {
    await setupTestData();

    // Create a sale
    testSale = await Sale.create({
      organizationId,
      locationId,
      receiptNumber: "RCP-001",
      transactionId: `TXN-${Date.now()}`,
      items: [{ name: "Item 1", quantity: 1, price: 100 }],
      subtotal: 100,
      totalAmount: 100,
      paymentMethod: "cash",
      paymentStatus: "completed",
      cashierId,
      shiftSessionId: shiftId,
      validationStatus: "pending",
      status: "completed",
      completedAt: new Date(),
    });
    saleId = testSale._id;
  });

  test("Sale should be created with validationStatus: pending", () => {
    expect(testSale.validationStatus).toBe("pending");
    expect(testSale.shiftSessionId).toEqual(shiftId);
    expect(testSale.validatedBy).toBeUndefined();
  });

  test("Accountant can validate a sale", async () => {
    const response = await request(app)
      .post(`/transactions/${saleId}/validate`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ notes: "Validated - all items accounted for" });

    expect(response.status).toBe(200);
    expect(response.body.data.validationStatus).toBe("validated");
    expect(response.body.data.validatedBy).toEqual(financeUserId.toString());

    // Verify in DB
    const updated = await Sale.findById(saleId);
    expect(updated.validationStatus).toBe("validated");
    expect(updated.validatedAt).toBeDefined();
    expect(updated.validationNotes).toBe("Validated - all items accounted for");
  });

  test("Should not allow double validation", async () => {
    const response = await request(app)
      .post(`/transactions/${saleId}/validate`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ notes: "Attempt double validation" });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("already has status");
  });

  test("Accountant can dispute a sale", async () => {
    // Create new sale for dispute test
    const newSale = await Sale.create({
      organizationId,
      locationId,
      receiptNumber: "RCP-002",
      transactionId: `TXN-${Date.now()}`,
      items: [{ name: "Item 1", quantity: 2, price: 50 }],
      subtotal: 100,
      totalAmount: 100,
      paymentMethod: "cash",
      paymentStatus: "completed",
      cashierId,
      shiftSessionId: shiftId,
      validationStatus: "pending",
      status: "completed",
      completedAt: new Date(),
    });

    const response = await request(app)
      .post(`/transactions/${newSale._id}/dispute`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({
        reason: "Item count mismatch",
        notes: "Physical count shows 1 item, not 2",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.validationStatus).toBe("disputed");
    expect(response.body.data.reason).toBe("Item count mismatch");

    const updated = await Sale.findById(newSale._id);
    expect(updated.validationStatus).toBe("disputed");
    expect(updated.validationNotes).toContain("DISPUTED");
  });
});

/**
 * Test Suite 2: Expense Validation
 */
describe("Expense Validation", () => {
  let expenseId;

  beforeAll(async () => {
    await setupTestData();

    testExpense = await Expense.create({
      organizationId,
      locationId,
      expenseDate: new Date(),
      category: "Supplies",
      description: "Office supplies",
      amount: 500,
      paymentMethod: "cash",
      paymentStatus: "paid",
      status: "draft",
      shiftSessionId: shiftId,
      validationStatus: "pending",
      createdBy: cashierId,
    });
    expenseId = testExpense._id;
  });

  test("Expense should be created with validationStatus: pending", () => {
    expect(testExpense.validationStatus).toBe("pending");
    expect(testExpense.shiftSessionId).toEqual(shiftId);
  });

  test("Accountant can validate an expense", async () => {
    const response = await request(app)
      .post(`/transactions/${expenseId}/validate`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ notes: "Receipt verified and amount confirmed" });

    expect(response.status).toBe(200);
    expect(response.body.data.validationStatus).toBe("validated");

    const updated = await Expense.findById(expenseId);
    expect(updated.validationStatus).toBe("validated");
  });
});

/**
 * Test Suite 3: Delivery Fee Validation
 */
describe("Delivery Fee Validation", () => {
  let deliveryId;

  beforeAll(async () => {
    await setupTestData();

    testDelivery = await DeliveryFee.create({
      organizationId,
      locationId,
      shiftSessionId: shiftId,
      deliveryCategory: "Standard",
      deliveryOption: "Same Day",
      amount: 200,
      totalAmount: 200,
      deliveryAddress: {
        street: "123 Main St",
        city: "Nairobi",
      },
      recipientName: "John Doe",
      recipientPhone: "254712345678",
      validationStatus: "pending",
      createdBy: cashierId,
    });
    deliveryId = testDelivery._id;
  });

  test("Delivery fee should be created with validationStatus: pending", () => {
    expect(testDelivery.validationStatus).toBe("pending");
    expect(testDelivery.shiftSessionId).toEqual(shiftId);
  });

  test("Accountant can validate a delivery", async () => {
    const response = await request(app)
      .post(`/transactions/${deliveryId}/validate`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ notes: "Delivery executed on time" });

    expect(response.status).toBe(200);
    expect(response.body.data.validationStatus).toBe("validated");
  });
});

/**
 * Test Suite 4: Shift Transaction Listing
 */
describe("Shift Transaction Listing", () => {
  test("Finance user can fetch all transactions for a shift", async () => {
    const response = await request(app)
      .get(`/shifts/${shiftId}/transactions`)
      .set("Authorization", `Bearer ${financeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.shiftId).toEqual(shiftId.toString());
    expect(response.body.data.breakdown).toBeDefined();
    expect(response.body.data.transactions).toBeInstanceOf(Array);
  });

  test("Can filter transactions by validationStatus", async () => {
    const response = await request(app)
      .get(`/shifts/${shiftId}/transactions?validationStatus=pending`)
      .set("Authorization", `Bearer ${financeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.transactions).toBeDefined();
    // All transactions should have validationStatus pending
    response.body.data.transactions.forEach((txn) => {
      expect(txn.validationStatus).toBe("pending");
    });
  });

  test("Can filter by transaction type", async () => {
    const response = await request(app)
      .get(`/shifts/${shiftId}/transactions?type=sale`)
      .set("Authorization", `Bearer ${financeToken}`);

    expect(response.status).toBe(200);
    // Only sales should be returned
    response.body.data.transactions.forEach((txn) => {
      expect(txn.type).toBe("sale");
    });
  });

  test("Cashier cannot access shift transactions (permission check)", async () => {
    const response = await request(app)
      .get(`/shifts/${shiftId}/transactions`)
      .set("Authorization", `Bearer ${testToken}`);

    expect(response.status).toBe(403); // Forbidden
  });
});

/**
 * Test Suite 5: Unified Transaction Fetch
 */
describe("Unified Transaction Fetch", () => {
  test("Can fetch any transaction by ID", async () => {
    const response = await request(app)
      .get(`/transactions/${testSale._id}`)
      .set("Authorization", `Bearer ${financeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.transactionType).toBe("sale");
    expect(response.body.data.validationStatus).toBe("validated");
  });

  test("Returns 404 for invalid transaction ID", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const response = await request(app)
      .get(`/transactions/${fakeId}`)
      .set("Authorization", `Bearer ${financeToken}`);

    expect(response.status).toBe(404);
  });
});

/**
 * Cleanup
 */
afterAll(async () => {
  console.log("🧹 Cleaning up test data...");
  await Sale.deleteMany({ organizationId });
  await Expense.deleteMany({ organizationId });
  await DeliveryFee.deleteMany({ organizationId });
  await ShiftSession.deleteMany({ organizationId });
  await User.deleteMany({ organizationId });
  await Organization.deleteOne({ _id: organizationId });
  await mongoose.disconnect();
  console.log("✅ Cleanup complete");
});
