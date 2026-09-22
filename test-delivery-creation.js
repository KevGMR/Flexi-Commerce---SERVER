const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const User = require("./models/User");
const Organization = require("./models/Organization");
const Location = require("./models/Location");

const API_URL = "http://localhost:9200";

let authToken = null;
let organizationId = null;
let locationId = null;

async function setupTestData() {
  try {
    console.log("\n📊 Setting up test data from database...");
    
    // Connect to MongoDB
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

    // Get a location (and enable delivery fees if needed)
    let location = await Location.findOne({
      organizationId,
    }).select("_id deliveryFeeSettings");
    
    if (!location) {
      console.error("❌ No location found");
      return false;
    }

    // Enable delivery fees if not already enabled
    if (!location.deliveryFeeSettings?.enableDeliveryFees) {
      console.log("⚠️ Delivery fees not enabled, enabling for testing...");
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

    // Try to get token by updating user's password temporarily
    console.log("\n🔐 Attempting to login with test credentials...");
    const testPassword = "TestPassword123!";
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    
    await User.updateOne(
      { _id: user._id },
      { password: hashedPassword }
    );
    console.log("✅ Updated user password for testing");

    // Login
    const loginRes = await axios.post(`${API_URL}/users/login`, {
      email: user.email,
      password: testPassword,
    });

    authToken = loginRes.data.data?.accessToken || loginRes.data.token;
    if (!authToken) {
      console.error("❌ Failed to get token");
      return false;
    }
    console.log("✅ Login successful");
    return true;
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    return false;
  }
}


async function testDeliveryCreation() {
  try {
    console.log("\n📦 Testing delivery creation with street & city only (no country)...");
    
    const deliveryPayload = {
      locationId,
      recipientName: "John Doe",
      recipientPhone: "+254712345678",
      recipientEmail: "john@example.com",
      deliveryAddress: {
        street: "123 Main Street",
        city: "Nairobi",
        // Note: country is NOT provided - should use default "Kenya"
      },
      feeType: "standard",
    };

    console.log("Request payload:", JSON.stringify(deliveryPayload, null, 2));

    const response = await axios.post(`${API_URL}/delivery-fees`, deliveryPayload, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (response.data.success) {
      console.log("✅ Delivery created successfully!");
      console.log("Delivery ID:", response.data.data._id);
      console.log("Tracking Number:", response.data.data.trackingNumber);
      console.log("Delivery Address:", response.data.data.deliveryAddress);
      return true;
    }
  } catch (error) {
    console.error("❌ Delivery creation failed:");
    console.error("Status:", error.response?.status);
    console.error("Message:", error.response?.data?.message);
    console.error("Full error:", error.response?.data);
    return false;
  }
}

async function testDeliveryCreationWithMissingStreet() {
  try {
    console.log("\n📦 Testing delivery creation with missing street (should fail)...");
    
    const deliveryPayload = {
      locationId,
      recipientName: "Jane Doe",
      recipientPhone: "+254712345679",
      deliveryAddress: {
        city: "Mombasa",
        country: "Kenya",
        // street is missing
      },
      feeType: "standard",
    };

    const response = await axios.post(`${API_URL}/delivery-fees`, deliveryPayload, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    console.error("❌ Should have failed but didn't!");
    return false;
  } catch (error) {
    if (error.response?.status === 400) {
      console.log("✅ Correctly rejected missing street field");
      console.log("Error message:", error.response?.data?.message);
      return true;
    }
    console.error("❌ Unexpected error:", error.response?.data?.message);
    return false;
  }
}

async function runTests() {
  console.log("🚀 Starting Delivery Creation Tests");
  console.log("==================================");

  // Step 1: Setup test data
  if (!(await setupTestData())) {
    console.error("\n❌ Cannot proceed without setup");
    process.exit(1);
  }

  // Step 2: Test successful delivery creation
  const test1 = await testDeliveryCreation();

  // Step 3: Test validation with missing field
  const test2 = await testDeliveryCreationWithMissingStreet();

  // Summary
  console.log("\n📊 Test Summary");
  console.log("================");
  console.log(`Delivery creation (street & city only): ${test1 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Validation (missing street): ${test2 ? "✅ PASS" : "❌ FAIL"}`);

  // Close MongoDB connection
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  if (test1 && test2) {
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
