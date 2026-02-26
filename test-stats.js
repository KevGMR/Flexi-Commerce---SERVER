const mongoose = require("mongoose");
const DeliveryFee = require("./models/DeliveryFee");
require("dotenv").config();

async function testStats() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Get the first organization from the database
    const firstDelivery = await DeliveryFee.findOne().select("organizationId");
    
    if (!firstDelivery) {
      console.log("⏳ No delivery fees exist yet. Creating test data...");
      
      const Organization = require("./models/Organization");
      const Location = require("./models/Location");
      const User = require("./models/User");
      
      // Find an organization and user
      const org = await Organization.findOne().select("_id");
      const location = await Location.findOne({ organizationId: org._id }).select("_id");
      const user = await User.findOne().select("_id");
      
      if (!org || !location || !user) {
        console.error("❌ Missing required data (org, location, or user)");
        process.exit(1);
      }
      
      // Create test delivery fees
      const testFees = [
        {
          organizationId: org._id,
          locationId: location._id,
          feeType: "standard",
          amount: 5.0,
          taxAmount: 0.8,
          totalAmount: 5.8,
          deliveryAddress: { street: "123 Main", city: "Nairobi", country: "Kenya" },
          recipientName: "Test 1",
          recipientPhone: "+254712345678",
          createdBy: user._id,
          status: "pending",
        },
        {
          organizationId: org._id,
          locationId: location._id,
          feeType: "express",
          amount: 10.0,
          taxAmount: 1.6,
          totalAmount: 11.6,
          deliveryAddress: { street: "456 Oak", city: "Nairobi", country: "Kenya" },
          recipientName: "Test 2",
          recipientPhone: "+254712345679",
          createdBy: user._id,
          status: "assigned",
        },
        {
          organizationId: org._id,
          locationId: location._id,
          feeType: "standard",
          amount: 5.0,
          taxAmount: 0.8,
          totalAmount: 5.8,
          deliveryAddress: { street: "789 Pine", city: "Nairobi", country: "Kenya" },
          recipientName: "Test 3",
          recipientPhone: "+254712345680",
          createdBy: user._id,
          status: "delivered",
          deliveredAt: new Date(),
        },
      ];
      
      await DeliveryFee.insertMany(testFees);
      console.log("✅ Created 3 test delivery fees");
    }
    
    // Now test the aggregation
    const orgId = firstDelivery ? firstDelivery.organizationId : (await DeliveryFee.findOne().select("organizationId")).organizationId;
    
    console.log("\n📊 Testing Stats Aggregation for Organization:", orgId);
    
    // Test 1: Count by status
    console.log("\n1️⃣ Status Counts:");
    const statusCounts = await DeliveryFee.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(orgId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    console.log("   Result:", statusCounts);
    
    // Test 2: Revenue by type
    console.log("\n2️⃣ Revenue by Fee Type:");
    const revenueByType = await DeliveryFee.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(orgId) } },
      {
        $group: {
          _id: "$feeType",
          totalRevenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
          avgFee: { $avg: "$totalAmount" },
        },
      },
    ]);
    console.log("   Result:", revenueByType);
    
    // Test 3: Total revenue
    console.log("\n3️⃣ Total Revenue:");
    const totalRevenue = await DeliveryFee.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(orgId) } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    console.log("   Result:", totalRevenue);
    
    console.log("\n✅ All aggregations working correctly!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

testStats();
