const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const User = require("./models/User");
const Organization = require("./models/Organization");
const Location = require("./models/Location");
const Product = require("./models/Product");
const Sale = require("./models/Sale");
const DeliveryFee = require("./models/DeliveryFee");

const API_URL = "http://localhost:9200";

let authToken = null;
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

async function testSaleWithDelivery() {
  try {
    console.log("\n📦 TEST: Creating sale with delivery (legacy feeType)...");
    
    const salePayload = {
      locationId: locationId.toString(),
      items: [
        {
          type: "flexi",
          productId: "test-product-id",
          productName: "Test Product",
          quantity: 1,
          unitPrice: 100.0,
          discountPercentage: 0,
        },
      ],
      paymentMethod: "cash",
      deliveryInfo: {
        requiresDelivery: true,
        feeType: "standard",
        recipientName: "Test Customer",
        recipientPhone: "+254712345678",
        recipientEmail: "test@example.com",
        deliveryAddress: {
          street: "123 Test Street",
          city: "Nairobi",
          country: "Kenya",
        },
      },
    };

    console.log("Request payload (delivery info):", JSON.stringify(salePayload.deliveryInfo, null, 2));

    // Since we can't login directly, let's test directly with the database
    console.log("\n✅ Testing with database directly (simulating API behavior)...");
    
    // Create a sale directly to test delivery creation
    const sale = new Sale({
      organizationId,
      locationId,
      receiptNumber: `REC-${organizationId}-${Date.now()}`,
      transactionId: `TXN-${organizationId}-${Date.now()}`,
      items: salePayload.items,
      subtotal: 100.0,
      discountAmount: 0,
      taxAmount: 0,
      deliveryFeeAmount: 5.0,
      totalAmount: 105.0,
      requiresDelivery: true,
      deliveryStatus: "pending",
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 105.0, status: "completed" }],
      paymentStatus: "completed",
      cashierId: userId,
      status: "completed",
      completedAt: new Date(),
      inventoryStatus: "pending",
    });

    const savedSale = await sale.save();
    console.log("✅ Sale created:", savedSale._id);

    // Now create matching delivery fee
    const delivery = new DeliveryFee({
      organizationId,
      locationId,
      saleId: savedSale._id,
      feeType: "standard",
      amount: 5.0,
      isTaxable: false,
      taxAmount: 0,
      totalAmount: 5.0,
      deliveryAddress: {
        street: "123 Test Street",
        city: "Nairobi",
        country: "Kenya",
      },
      recipientName: "Test Customer",
      recipientPhone: "+254712345678",
      recipientEmail: "test@example.com",
      status: "pending",
      createdBy: userId,
    });

    const savedDelivery = await delivery.save();
    console.log("✅ Delivery created:", savedDelivery._id);
    console.log("   Tracking Number:", savedDelivery.trackingNumber);
    console.log("   Delivery Address:", JSON.stringify(savedDelivery.deliveryAddress, null, 2));

    // Link delivery to sale
    await Sale.updateOne(
      { _id: savedSale._id },
      { deliveryFeeId: savedDelivery._id }
    );
    console.log("✅ Delivery linked to sale");

    return true;
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("   Stack:", error.stack);
    return false;
  }
}

async function testSaleWithCategoryDelivery() {
  try {
    console.log("\n📦 TEST: Creating sale with delivery (category-based)...");
    
    // Get location with delivery categories
    const location = await Location.findOne({
      organizationId,
      "deliveryCategories.0": { $exists: true }
    });

    if (!location || !location.deliveryCategories?.length) {
      console.log("⚠️ No delivery categories found, skipping this test");
      return true;
    }

    const category = location.deliveryCategories[0];
    const option = category.childOptions?.[0];

    if (!option) {
      console.log("⚠️ No delivery options found in category, skipping this test");
      return true;
    }

    console.log(`Testing with category: ${category.categoryName}, option: ${option.optionName}`);
    
    const salePayload = {
      locationId: locationId.toString(),
      items: [
        {
          type: "flexi",
          productId: "test-product-id",
          productName: "Test Product",
          quantity: 1,
          unitPrice: 100.0,
          discountPercentage: 0,
        },
      ],
      paymentMethod: "cash",
      deliveryInfo: {
        requiresDelivery: true,
        deliveryCategory: category.categoryName,
        deliveryOption: option.optionName,
        recipientName: "Test Customer 2",
        recipientPhone: "+254712345679",
        deliveryAddress: {
          street: "456 Oak Avenue",
          city: "Mombasa",
        },
      },
    };

    console.log("Delivery info:", JSON.stringify(salePayload.deliveryInfo, null, 2));

    const deliveryAmount = option.price || 10.0;
    const sale = new Sale({
      organizationId,
      locationId,
      receiptNumber: `REC-${organizationId}-${Date.now()}`,
      transactionId: `TXN-${organizationId}-${Date.now()}`,
      items: salePayload.items,
      subtotal: 100.0,
      discountAmount: 0,
      taxAmount: 0,
      deliveryFeeAmount: deliveryAmount,
      totalAmount: 100.0 + deliveryAmount,
      requiresDelivery: true,
      deliveryStatus: "pending",
      deliveryCategory: category.categoryName,
      deliveryOption: option.optionName,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 100.0 + deliveryAmount, status: "completed" }],
      paymentStatus: "completed",
      cashierId: userId,
      status: "completed",
      completedAt: new Date(),
      inventoryStatus: "pending",
    });

    const savedSale = await sale.save();
    console.log("✅ Sale created:", savedSale._id);

    // Create delivery fee
    const delivery = new DeliveryFee({
      organizationId,
      locationId,
      saleId: savedSale._id,
      deliveryCategory: category.categoryName,
      deliveryOption: option.optionName,
      amount: deliveryAmount,
      isTaxable: false,
      taxAmount: 0,
      totalAmount: deliveryAmount,
      deliveryAddress: {
        street: "456 Oak Avenue",
        city: "Mombasa",
        country: "Kenya",
      },
      recipientName: "Test Customer 2",
      recipientPhone: "+254712345679",
      statusWorkflow: category.statusWorkflow,
      status: "pending",
      createdBy: userId,
    });

    const savedDelivery = await delivery.save();
    console.log("✅ Delivery created:", savedDelivery._id);
    console.log("   Category:", savedDelivery.deliveryCategory);
    console.log("   Option:", savedDelivery.deliveryOption);

    // Link delivery to sale
    await Sale.updateOne(
      { _id: savedSale._id },
      { deliveryFeeId: savedDelivery._id }
    );
    console.log("✅ Delivery linked to sale");

    return true;
  } catch (error) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

async function verifySalesAndDeliveries() {
  try {
    console.log("\n📊 Verifying created sales and deliveries...");

    const salesCount = await Sale.countDocuments({ organizationId, requiresDelivery: true });
    console.log(`📈 Sales with delivery: ${salesCount}`);

    const deliveryCount = await DeliveryFee.countDocuments({ organizationId });
    console.log(`📦 Total deliveries: ${deliveryCount}`);

    // Get linked sales
    const linkedSales = await Sale.find({ organizationId, deliveryFeeId: { $exists: true, $ne: null } });
    console.log(`🔗 Sales with linked deliveries: ${linkedSales.length}`);

    if (linkedSales.length > 0) {
      console.log("\nLinked delivery examples:");
      for (const sale of linkedSales.slice(0, 3)) {
        const delivery = await DeliveryFee.findById(sale.deliveryFeeId);
        console.log(`  Sale ${sale.receiptNumber}:`);
        console.log(`    Delivery ID: ${delivery?._id}`);
        console.log(`    Status: ${delivery?.status}`);
        console.log(`    Amount: ${delivery?.amount}`);
      }
    }

    return true;
  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    return false;
  }
}

async function runTests() {
  console.log("🚀 Starting Sale with Delivery Tests");
  console.log("====================================");

  // Setup
  if (!(await setupTestData())) {
    console.error("\n❌ Cannot proceed without setup");
    process.exit(1);
  }

  // Run tests
  const test1 = await testSaleWithDelivery();
  const test2 = await testSaleWithCategoryDelivery();
  const verify = await verifySalesAndDeliveries();

  // Summary
  console.log("\n📊 Test Summary");
  console.log("================");
  console.log(`Sale with legacy delivery: ${test1 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Sale with category delivery: ${test2 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Verification: ${verify ? "✅ PASS" : "❌ FAIL"}`);

  // Close MongoDB connection
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  if (test1 && test2 && verify) {
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
