/**
 * Migration: Populate deliveryCategory, deliveryOption, categoryStatus from linked DeliveryFees
 * Run once after model changes deployed
 * 
 * Usage: node server/seeds/migrate-delivery-categories.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const Sale = require("../models/Sale");
const DeliveryFee = require("../models/DeliveryFee");

async function migrateDeliveryCategories() {
  try {
    console.log("🔄 Starting delivery categories migration...");

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Find all sales with deliveryFeeId but no deliveryCategory
    const salesWithFees = await Sale.find({
      deliveryFeeId: { $exists: true, $ne: null },
      deliveryCategory: { $exists: false },
    }).lean();

    console.log(`📊 Found ${salesWithFees.length} sales to migrate`);

    if (salesWithFees.length === 0) {
      console.log("✅ No sales to migrate. Migration complete!");
      await mongoose.connection.close();
      return;
    }

    let migrated = 0;
    let errors = 0;
    const errorLog = [];

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 100;
    for (let i = 0; i < salesWithFees.length; i += BATCH_SIZE) {
      const batch = salesWithFees.slice(i, i + BATCH_SIZE);

      for (const sale of batch) {
        try {
          const fee = await DeliveryFee.findById(sale.deliveryFeeId).lean();

          if (fee) {
            const updateData = {
              deliveryStatusSyncedAt: new Date(),
            };

            // Only set if the fee has these values
            if (fee.deliveryCategory) {
              updateData.deliveryCategory = fee.deliveryCategory;
            }
            if (fee.deliveryOption) {
              updateData.deliveryOption = fee.deliveryOption;
            }
            if (fee.categoryStatus) {
              updateData.categoryStatus = fee.categoryStatus;
            } else if (fee.status) {
              // Fallback to legacy status field
              updateData.categoryStatus = fee.status;
            }

            await Sale.updateOne({ _id: sale._id }, { $set: updateData });
            migrated++;

            // Progress indicator
            if (migrated % 10 === 0) {
              console.log(`⏳ Migrated ${migrated}/${salesWithFees.length} sales...`);
            }
          } else {
            console.warn(`⚠️  DeliveryFee not found for sale ${sale._id}`);
            errors++;
          }
        } catch (error) {
          console.error(`❌ Error migrating sale ${sale._id}:`, error.message);
          errorLog.push({
            saleId: sale._id.toString(),
            error: error.message,
          });
          errors++;
        }
      }

      // Give database a breather between batches
      if (i + BATCH_SIZE < salesWithFees.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📋 Migration Summary:");
    console.log("=".repeat(60));
    console.log(`✅ Successfully migrated: ${migrated} sales`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Success rate: ${((migrated / salesWithFees.length) * 100).toFixed(2)}%`);

    if (errorLog.length > 0) {
      console.log("\n⚠️  Error Details:");
      errorLog.forEach((err) => {
        console.log(`  - Sale ${err.saleId}: ${err.error}`);
      });
    }

    console.log("=".repeat(60) + "\n");

    if (errors === 0) {
      console.log("✨ Migration completed successfully!");
    } else {
      console.log(
        `⚠️  Migration completed with ${errors} errors. Please review the errors above.`
      );
    }

    await mongoose.connection.close();
    process.exit(errors > 0 ? 1 : 0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateDeliveryCategories();
