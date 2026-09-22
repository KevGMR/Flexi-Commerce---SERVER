/**
 * Migration Script: Backfill shiftSessionId for existing transactions
 * 
 * This script handles three scenarios:
 * 1. Sales without shiftSessionId - links to active shift for cashier at time of sale
 * 2. Expenses without shiftSessionId - links to active shift for cashier at time of creation
 * 3. DeliveryFees without shiftSessionId - links to active shift at location at time of creation
 * 
 * For transactions with no matching shift, marks them with null shiftSessionId but doesn't fail
 * 
 * Usage: node server/scripts/migrate-sales-to-shifts.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const DeliveryFee = require("../models/DeliveryFee");
const ShiftSession = require("../models/ShiftSession");

const BATCH_SIZE = 100;

/**
 * Find closest matching shift for a transaction
 * Strategy: Look for shift that was open during transaction creation time
 */
const findShiftForTransaction = async ({ organizationId, locationId, cashierId, createdAt }) => {
  // Look for shift that contains this timestamp
  const shift = await ShiftSession.findOne({
    organizationId,
    locationId,
    cashierId,
    openedAt: { $lte: createdAt },
    $or: [
      { closedAt: null }, // Still open
      { closedAt: { $gte: createdAt } }, // Was open at this time
    ],
  }).lean();

  return shift;
};

/**
 * Backfill Sales with shiftSessionId
 */
const migrateSales = async () => {
  console.log("\n🔄 Starting Sales migration...");

  const salesWithoutShift = await Sale.find({ shiftSessionId: { $exists: false } }).select("_id organizationId locationId cashierId createdAt").lean();

  console.log(`Found ${salesWithoutShift.length} sales without shiftSessionId`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < salesWithoutShift.length; i += BATCH_SIZE) {
    const batch = salesWithoutShift.slice(i, i + BATCH_SIZE);

    for (const sale of batch) {
      try {
        const shift = await findShiftForTransaction({
          organizationId: sale.organizationId,
          locationId: sale.locationId,
          cashierId: sale.cashierId,
          createdAt: sale.createdAt,
        });

        if (shift) {
          await Sale.findByIdAndUpdate(sale._id, {
            shiftSessionId: shift._id,
          });
          updated++;
        } else {
          console.warn(`⚠️  Sale ${sale._id} - No matching shift found (created at ${sale.createdAt})`);
          failed++;
        }
      } catch (error) {
        console.error(`❌ Error migrating sale ${sale._id}:`, error.message);
        failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, salesWithoutShift.length)}/${salesWithoutShift.length}`);
  }

  console.log(`✅ Sales migration complete: ${updated} updated, ${failed} failed/missing shift`);
  return { updated, failed };
};

/**
 * Backfill Expenses with shiftSessionId
 */
const migrateExpenses = async () => {
  console.log("\n🔄 Starting Expenses migration...");

  const expensesWithoutShift = await Expense.find({ shiftSessionId: { $exists: false } }).select("_id organizationId locationId createdBy createdAt").lean();

  console.log(`Found ${expensesWithoutShift.length} expenses without shiftSessionId`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < expensesWithoutShift.length; i += BATCH_SIZE) {
    const batch = expensesWithoutShift.slice(i, i + BATCH_SIZE);

    for (const expense of batch) {
      try {
        const shift = await findShiftForTransaction({
          organizationId: expense.organizationId,
          locationId: expense.locationId,
          cashierId: expense.createdBy,
          createdAt: expense.createdAt,
        });

        if (shift) {
          await Expense.findByIdAndUpdate(expense._id, {
            shiftSessionId: shift._id,
          });
          updated++;
        } else {
          console.warn(`⚠️  Expense ${expense._id} - No matching shift found (created at ${expense.createdAt})`);
          failed++;
        }
      } catch (error) {
        console.error(`❌ Error migrating expense ${expense._id}:`, error.message);
        failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, expensesWithoutShift.length)}/${expensesWithoutShift.length}`);
  }

  console.log(`✅ Expenses migration complete: ${updated} updated, ${failed} failed/missing shift`);
  return { updated, failed };
};

/**
 * Backfill DeliveryFees with shiftSessionId
 */
const migrateDeliveryFees = async () => {
  console.log("\n🔄 Starting DeliveryFees migration...");

  const deliveriesWithoutShift = await DeliveryFee.find({ shiftSessionId: { $exists: false } }).select("_id organizationId locationId createdBy createdAt").lean();

  console.log(`Found ${deliveriesWithoutShift.length} delivery fees without shiftSessionId`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < deliveriesWithoutShift.length; i += BATCH_SIZE) {
    const batch = deliveriesWithoutShift.slice(i, i + BATCH_SIZE);

    for (const delivery of batch) {
      try {
        const shift = await findShiftForTransaction({
          organizationId: delivery.organizationId,
          locationId: delivery.locationId,
          cashierId: delivery.createdBy,
          createdAt: delivery.createdAt,
        });

        if (shift) {
          await DeliveryFee.findByIdAndUpdate(delivery._id, {
            shiftSessionId: shift._id,
          });
          updated++;
        } else {
          console.warn(`⚠️  DeliveryFee ${delivery._id} - No matching shift found (created at ${delivery.createdAt})`);
          failed++;
        }
      } catch (error) {
        console.error(`❌ Error migrating delivery fee ${delivery._id}:`, error.message);
        failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, deliveriesWithoutShift.length)}/${deliveriesWithoutShift.length}`);
  }

  console.log(`✅ DeliveryFees migration complete: ${updated} updated, ${failed} failed/missing shift`);
  return { updated, failed };
};

/**
 * Main execution
 */
const runMigration = async () => {
  try {
    console.log("🚀 Starting transaction shift linkage migration...");
    console.log(`📦 Database: ${process.env.MONGO_URI}`);

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    // Run migrations
    const salesResult = await migrateSales();
    const expensesResult = await migrateExpenses();
    const deliveriesResult = await migrateDeliveryFees();

    // Summary
    console.log("\n📊 Migration Summary:");
    console.log(`  Sales:     ${salesResult.updated} updated, ${salesResult.failed} failed`);
    console.log(`  Expenses:  ${expensesResult.updated} updated, ${expensesResult.failed} failed`);
    console.log(`  Deliveries: ${deliveriesResult.updated} updated, ${deliveriesResult.failed} failed`);
    console.log(`  Total:     ${salesResult.updated + expensesResult.updated + deliveriesResult.updated} updated`);

    console.log("\n✅ Migration complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

runMigration();
