const mongoose = require("mongoose");
require("dotenv").config();

const DeliveryFee = require("./models/DeliveryFee");
const User = require("./models/User");
const Location = require("./models/Location");
const Organization = require("./models/Organization");

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
    const user = await User.findOne({ status: "active" });
    if (!user) {
      console.error("❌ No active user found");
      return false;
    }
    userId = user._id;
    console.log(`✅ Found user: ${user.fullname}`);

    // Get organization
    organizationId = user.organizationId || (await Organization.findOne({}))?._id;
    if (!organizationId) {
      console.error("❌ No organization found");
      return false;
    }
    console.log(`✅ Found organization: ${organizationId}`);

    // Get a location and enable delivery fees
    let location = await Location.findOne({ organizationId });
    if (!location) {
      console.error("❌ No location found");
      return false;
    }

    if (!location.deliveryFeeSettings?.enableDeliveryFees) {
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
    }

    locationId = location._id;
    console.log(`✅ Found location: ${locationId}`);
    console.log("✅ Setup complete\n");
    return true;
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    return false;
  }
}

async function testDeliveryCreation() {
  const results = [];

  // Test 1: Create delivery with all required fields
  try {
    console.log("TEST 1️⃣: Creating delivery with complete data...");
    const delivery1 = new DeliveryFee({
      organizationId,
      locationId,
      feeType: "standard",
      amount: 5.0,
      totalAmount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        street: "123 Main Street",
        city: "Nairobi",
        country: "Kenya",
      },
      recipientName: "John Doe",
      recipientPhone: "+254712345678",
      status: "pending",
      createdBy: userId,
    });

    const saved1 = await delivery1.save();
    console.log("✅ PASS - Delivery created");
    console.log(`   ID: ${saved1._id}`);
    console.log(`   Tracking: ${saved1.trackingNumber}`);
    results.push(true);
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}`);
    results.push(false);
  }

  // Test 2: Create delivery without country (should use default)
  try {
    console.log("\nTEST 2️⃣: Creating delivery without country (should default to Kenya)...");
    const delivery2 = new DeliveryFee({
      organizationId,
      locationId,
      feeType: "express",
      amount: 10.0,
      totalAmount: 10.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        street: "456 Oak Avenue",
        city: "Mombasa",
        // country NOT provided
      },
      recipientName: "Jane Smith",
      recipientPhone: "+254712345679",
      status: "pending",
      createdBy: userId,
    });

    const saved2 = await delivery2.save();
    console.log("✅ PASS - Delivery created without country");
    console.log(`   City: ${saved2.deliveryAddress.city}`);
    console.log(`   Country: ${saved2.deliveryAddress.country}`);
    if (saved2.deliveryAddress.country !== "Kenya") {
      console.log("❌ FAIL - Country not defaulted to Kenya");
      results.push(false);
    } else {
      results.push(true);
    }
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}`);
    results.push(false);
  }

  // Test 3: Create delivery with category-based system
  try {
    console.log("\nTEST 3️⃣: Creating delivery with category-based system...");
    const delivery3 = new DeliveryFee({
      organizationId,
      locationId,
      deliveryCategory: "Standard",
      deliveryOption: "Same Day",
      amount: 8.0,
      totalAmount: 8.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        street: "789 Pine Road",
        city: "Kisumu",
        country: "Kenya",
      },
      recipientName: "Bob Johnson",
      recipientPhone: "+254712345680",
      status: "pending",
      createdBy: userId,
    });

    const saved3 = await delivery3.save();
    console.log("✅ PASS - Category-based delivery created");
    console.log(`   Category: ${saved3.deliveryCategory}`);
    console.log(`   Option: ${saved3.deliveryOption}`);
    results.push(true);
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}`);
    results.push(false);
  }

  // Test 4: Attempt to create delivery without street (should fail)
  try {
    console.log("\nTEST 4️⃣: Attempting to create delivery without street (should fail)...");
    const delivery4 = new DeliveryFee({
      organizationId,
      locationId,
      feeType: "standard",
      amount: 5.0,
      totalAmount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        // street NOT provided
        city: "Nakuru",
        country: "Kenya",
      },
      recipientName: "Alice Brown",
      recipientPhone: "+254712345681",
      status: "pending",
      createdBy: userId,
    });

    await delivery4.save();
    console.log("❌ FAIL - Should have rejected missing street");
    results.push(false);
  } catch (error) {
    if (error.message.includes("street") && error.message.includes("required")) {
      console.log("✅ PASS - Correctly rejected missing street");
      results.push(true);
    } else {
      console.log(`❌ FAIL - Wrong error: ${error.message}`);
      results.push(false);
    }
  }

  // Test 5: Attempt to create delivery without city (should fail)
  try {
    console.log("\nTEST 5️⃣: Attempting to create delivery without city (should fail)...");
    const delivery5 = new DeliveryFee({
      organizationId,
      locationId,
      feeType: "standard",
      amount: 5.0,
      totalAmount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      deliveryAddress: {
        street: "999 Elm Street",
        // city NOT provided
        country: "Kenya",
      },
      recipientName: "Charlie Davis",
      recipientPhone: "+254712345682",
      status: "pending",
      createdBy: userId,
    });

    await delivery5.save();
    console.log("❌ FAIL - Should have rejected missing city");
    results.push(false);
  } catch (error) {
    if (error.message.includes("city") && error.message.includes("required")) {
      console.log("✅ PASS - Correctly rejected missing city");
      results.push(true);
    } else {
      console.log(`❌ FAIL - Wrong error: ${error.message}`);
      results.push(false);
    }
  }

  return results;
}

async function verifyCounts() {
  try {
    console.log("\n📊 Verifying counts...");
    const count = await DeliveryFee.countDocuments({ organizationId });
    console.log(`Total deliveries created: ${count}`);
    return count >= 3; // At least 3 should succeed
  } catch (error) {
    console.error("❌ Count verification failed:", error.message);
    return false;
  }
}

async function runTests() {
  console.log("🚀 Starting Delivery Creation Tests (Direct Model)");
  console.log("=================================================");

  if (!(await setupTestData())) {
    console.error("\n❌ Cannot proceed without setup");
    process.exit(1);
  }

  const results = await testDeliveryCreation();
  const verify = await verifyCounts();

  // Summary
  console.log("\n📊 Test Summary");
  console.log("================");
  const testNames = [
    "Complete data",
    "Without country (default)",
    "Category-based system",
    "Reject missing street",
    "Reject missing city",
  ];

  testNames.forEach((name, idx) => {
    console.log(`${idx + 1}. ${name}: ${results[idx] ? "✅ PASS" : "❌ FAIL"}`);
  });
  console.log(`Data verification: ${verify ? "✅ PASS" : "❌ FAIL"}`);

  const passCount = results.filter((r) => r).length;
  const totalCount = results.length;

  console.log(`\nResults: ${passCount}/${totalCount} tests passed`);

  // Close MongoDB connection
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  if (passCount === totalCount && verify) {
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
