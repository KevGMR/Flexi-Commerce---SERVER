const mongoose = require("mongoose");
require("dotenv").config();

const DeliveryFee = require("./models/DeliveryFee");
const User = require("./models/User");
const Organization = require("./models/Organization");
const Location = require("./models/Location");

let organizationId = null;
let locationId = null;
let userId = null;

async function setupTestData() {
  try {
    console.log("\n📊 Setting up test data...");
    
    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("✅ Connected to MongoDB");
    }

    // Get an active user
    const user = await User.findOne({ status: "active" }).select(
      "_id email fullname organizationId"
    );
    if (!user) {
      console.error("❌ No active user found");
      return false;
    }
    userId = user._id;
    console.log(`✅ Found user: ${user.fullname}`);

    // Get organization
    organizationId = user.organizationId;
    if (!organizationId) {
      const org = await Organization.findOne({}).select("_id");
      if (!org) {
        console.error("❌ No organization found");
        return false;
      }
      organizationId = org._id;
    }
    console.log(`✅ Found organization: ${organizationId}`);

    // Get a location and enable delivery fees if needed
    let location = await Location.findOne({
      organizationId,
    }).select("_id deliveryFeeSettings");
    
    if (!location) {
      console.error("❌ No location found");
      return false;
    }

    // Enable delivery fees if not already enabled
    if (!location.deliveryFeeSettings?.enableDeliveryFees) {
      console.log("⚠️ Enabling delivery fees for testing...");
      await Location.updateOne(
        { _id: location._id },
        {
          $set: {
            "deliveryFeeSettings.enableDeliveryFees": true,
            "deliveryFeeSettings.standardFee": 5.0,
            "deliveryFeeSettings.expressFee": 10.0,
            "deliveryFeeSettings.overnightFee": 15.0,
          },
        }
      );
      console.log("✅ Delivery fees enabled");
    }

    locationId = location._id;
    console.log(`✅ Found location: ${locationId}`);
    console.log("✅ Setup complete");
    return true;
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    return false;
  }
}

async function testDeliveryCreationWithoutCountry() {
  try {
    console.log("\n📦 TEST 1: Creating delivery with street & city only (no country)...");
    
    const deliveryData = {
      organizationId,
      locationId,
      recipientName: "John Doe",
      recipientPhone: "+254712345678",
      recipientEmail: "john@example.com",
      feeType: "standard",
      amount: 5.0,
      totalAmount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        street: "123 Main Street",
        city: "Nairobi",
        // NOTE: country is NOT provided - should use default "Kenya"
      },
      status: "pending",
      createdBy: userId,
    };

    console.log("Creating delivery with data:", JSON.stringify(deliveryData, null, 2));

    const delivery = new DeliveryFee(deliveryData);
    await delivery.save();

    console.log("✅ Delivery created successfully!");
    console.log("   ID:", delivery._id);
    console.log("   Tracking Number:", delivery.trackingNumber);
    console.log("   Delivery Address:", JSON.stringify(delivery.deliveryAddress, null, 2));
    
    // Verify the country field was set to default
    if (delivery.deliveryAddress.country === "Kenya") {
      console.log("✅ Country correctly defaulted to 'Kenya'");
      return true;
    } else {
      console.log("❌ Country not set correctly:", delivery.deliveryAddress.country);
      return false;
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

async function testDeliveryCreationValidationMissingStreet() {
  try {
    console.log("\n📦 TEST 2: Attempting to create delivery with missing street (should fail)...");
    
    const deliveryData = {
      organizationId,
      locationId,
      recipientName: "Jane Doe",
      recipientPhone: "+254712345679",
      feeType: "standard",
      amount: 5.0,
      totalAmount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        // street is missing
        city: "Mombasa",
        country: "Kenya",
      },
      status: "pending",
      createdBy: userId,
    };

    const delivery = new DeliveryFee(deliveryData);
    await delivery.save();

    console.log("❌ Should have failed validation but didn't!");
    return false;
  } catch (error) {
    // Check if it failed due to required field validation
    if (error.message.includes("required")) {
      console.log("✅ Correctly rejected invalid delivery");
      console.log("   Error:", error.message.substring(0, 100));
      return true;
    } else {
      console.error("❌ Failed with unexpected error:", error.message);
      return false;
    }
  }
}

async function testDeliveryCreationValidationMissingCity() {
  try {
    console.log("\n📦 TEST 3: Attempting to create delivery with missing city (should fail)...");
    
    const deliveryData = {
      organizationId,
      locationId,
      recipientName: "Bob Smith",
      recipientPhone: "+254712345680",
      feeType: "standard",
      amount: 5.0,
      totalAmount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        street: "456 Oak Avenue",
        // city is missing
        country: "Kenya",
      },
      status: "pending",
      createdBy: userId,
    };

    const delivery = new DeliveryFee(deliveryData);
    await delivery.save();

    console.log("❌ Should have failed validation but didn't!");
    return false;
  } catch (error) {
    // Check if it failed due to required field validation
    if (error.message.includes("required")) {
      console.log("✅ Correctly rejected invalid delivery");
      console.log("   Error:", error.message.substring(0, 100));
      return true;
    } else {
      console.error("❌ Failed with unexpected error:", error.message);
      return false;
    }
  }
}

async function runTests() {
  console.log("🚀 Starting Delivery Model Validation Tests");
  console.log("===========================================");

  // Step 1: Setup test data
  if (!(await setupTestData())) {
    console.error("\n❌ Cannot proceed without setup");
    process.exit(1);
  }

  // Step 2: Run tests
  const test1 = await testDeliveryCreationWithoutCountry();
  const test2 = await testDeliveryCreationValidationMissingStreet();
  const test3 = await testDeliveryCreationValidationMissingCity();

  // Summary
  console.log("\n📊 Test Summary");
  console.log("================");
  console.log(`Test 1 - Create without country: ${test1 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Test 2 - Reject missing street:  ${test2 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Test 3 - Reject missing city:   ${test3 ? "✅ PASS" : "❌ FAIL"}`);

  // Close MongoDB connection
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  if (test1 && test2 && test3) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("\n⚠️ Some tests failed");
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Test error:", error.message);
  process.exit(1);
});
