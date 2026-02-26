const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const User = require("./models/User");
const Organization = require("./models/Organization");
const Location = require("./models/Location");

async function testDeliveryFee() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Get an active user with owner role
    const user = await User.findOne({ status: "active" }).select(
      "_id email fullname"
    );
    if (!user) {
      console.error("❌ No active user found");
      process.exit(1);
    }
    console.log(`✅ Found user: ${user.fullname} (${user._id})`);

    // Get user's organization
    const org = await Organization.findOne({}).select("_id");
    if (!org) {
      console.error("❌ No organization found");
      process.exit(1);
    }
    console.log(`✅ Found organization: ${org._id}`);

    // Get a location
    const location = await Location.findOne({
      organizationId: org._id,
    }).select("_id deliveryFeeSettings");
    if (!location) {
      console.error("❌ No location found");
      process.exit(1);
    }
    console.log(`✅ Found location: ${location._id}`);
    console.log(
      `   Delivery settings enabled: ${location.deliveryFeeSettings?.enableDeliveryFees}`
    );

    // Get JWT token using axios
    console.log("\n📝 Getting JWT token...");
    const loginRes = await axios.post(
      "http://localhost:9200/users/login",
      {
        email: user.email,
        password: "TestPassword123!", // You may need to update this
      },
      {
        headers: {
          "X-Device-ID": "test-device-123",
        },
      }
    );

    if (!loginRes.data.token) {
      console.error("❌ Failed to get token");
      console.log("Response:", loginRes.data);
      process.exit(1);
    }

    const token = loginRes.data.token;
    console.log(`✅ Got JWT token`);

    // Test POST /delivery-fees
    console.log("\n🚀 Testing POST /delivery-fees...");
    const deliveryRes = await axios.post(
      "http://localhost:9200/delivery-fees",
      {
        locationId: location._id.toString(),
        feeType: "standard",
        recipientName: "Test Recipient",
        recipientPhone: "+254712345678",
        recipientEmail: "test@example.com",
        deliveryAddress: {
          street: "123 Main Street",
          city: "Nairobi",
          country: "Kenya",
        },
        notes: "Test delivery",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Delivery fee created successfully!");
    console.log("Response:", JSON.stringify(deliveryRes.data, null, 2));
    console.log(
      `\n✅ Tracking Number: ${deliveryRes.data.data.trackingNumber}`
    );
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.connection.close();
      console.log("\n✅ Database connection closed");
    } catch (e) {
      // Ignore
    }
  }
}

testDeliveryFee();
