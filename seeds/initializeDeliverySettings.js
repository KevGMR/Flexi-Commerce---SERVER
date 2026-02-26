/**
 * Seed Script: Initialize Delivery Settings on Existing Locations
 * 
 * This script adds default delivery fee settings to all locations that don't have them yet.
 * Run with: node server/seeds/initializeDeliverySettings.js
 * 
 * Default Values:
 * - enableDeliveryFees: true
 * - taxDeliveryFees: true (uses location's taxRate)
 * - standardFee: 5.00
 * - expressFee: 10.00
 * - overnightFee: 15.00
 * - defaultFeeType: "standard"
 * - allowCustomFees: true
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Location = require("../models/Location");

const MONGO_URI = process.env.MONGO_URI;

const DEFAULT_DELIVERY_SETTINGS = {
  enableDeliveryFees: true,
  taxDeliveryFees: true,
  standardFee: 5.0,
  expressFee: 10.0,
  overnightFee: 15.0,
  defaultFeeType: "standard",
  allowCustomFees: true,
};

async function initializeDeliverySettings() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    console.log("\n📍 Fetching all locations...");
    const locations = await Location.find({});
    console.log(`📊 Found ${locations.length} total locations`);

    if (locations.length === 0) {
      console.log("⚠️  No locations found in database");
      await mongoose.connection.close();
      return;
    }

    // Filter locations that need delivery settings
    const locationsNeedingUpdate = locations.filter(
      (loc) =>
        !loc.deliveryFeeSettings ||
        Object.keys(loc.deliveryFeeSettings).length === 0
    );

    console.log(
      `\n📝 Locations to update: ${locationsNeedingUpdate.length}`
    );

    if (locationsNeedingUpdate.length === 0) {
      console.log("✅ All locations already have delivery settings configured");
      await mongoose.connection.close();
      return;
    }

    // Display locations to be updated
    console.log("\n📋 Locations to be updated:");
    locationsNeedingUpdate.forEach((loc, idx) => {
      console.log(
        `  ${idx + 1}. ${loc.name} (${loc.locationType}) - Org: ${loc.organizationId}`
      );
    });

    // Update locations with default delivery settings
    console.log("\n⏳ Updating locations with default delivery settings...");
    const updateOperations = locationsNeedingUpdate.map((location) =>
      Location.updateOne(
        { _id: location._id },
        { deliveryFeeSettings: DEFAULT_DELIVERY_SETTINGS }
      )
    );

    const results = await Promise.all(updateOperations);

    // Count successful updates
    const successCount = results.filter((r) => r.modifiedCount > 0).length;
    console.log(`\n✅ Successfully updated ${successCount} locations`);

    // Display summary
    console.log("\n📊 Delivery Settings Applied:");
    console.log(
      `   enableDeliveryFees: ${DEFAULT_DELIVERY_SETTINGS.enableDeliveryFees}`
    );
    console.log(
      `   taxDeliveryFees: ${DEFAULT_DELIVERY_SETTINGS.taxDeliveryFees}`
    );
    console.log(
      `   standardFee: $${DEFAULT_DELIVERY_SETTINGS.standardFee.toFixed(2)}`
    );
    console.log(
      `   expressFee: $${DEFAULT_DELIVERY_SETTINGS.expressFee.toFixed(2)}`
    );
    console.log(
      `   overnightFee: $${DEFAULT_DELIVERY_SETTINGS.overnightFee.toFixed(2)}`
    );
    console.log(
      `   defaultFeeType: ${DEFAULT_DELIVERY_SETTINGS.defaultFeeType}`
    );
    console.log(
      `   allowCustomFees: ${DEFAULT_DELIVERY_SETTINGS.allowCustomFees}`
    );

    console.log("\n✅ Delivery settings initialization completed successfully!");
    console.log(
      "\n💡 Tip: You can customize delivery fees per location using:"
    );
    console.log("   PATCH /locations/:locationId/delivery-settings");

    await mongoose.connection.close();
    console.log("\n🔌 Database connection closed");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error initializing delivery settings:", error.message);
    console.error("Stack:", error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
initializeDeliverySettings();
