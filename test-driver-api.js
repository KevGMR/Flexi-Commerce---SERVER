require("dotenv").config();
const axios = require("axios");

const testRegistration = async () => {
  try {
    const response = await axios.post(
      "http://localhost:9200/users/new",
      {
        fullname: "Test Driver User",
        email: "testdriver@example.com",
        password: "TestPassword123!",
        phone: "+254700000000",
        organizationName: "Test Driver Organization",
      },
      {
        headers: {
          "X-Device-ID": "test-device-123",
        },
      }
    );

    if (response.data.success) {
      console.log(
        "✓ Test user created successfully:",
        response.data.data.email
      );
      console.log("  Token:", response.data.token.substring(0, 20) + "...");
      return response.data;
    } else {
      console.log("Registration response:", response.data);
    }
  } catch (error) {
    if (
      error.response?.status === 409 ||
      error.response?.data?.message?.includes("already exists")
    ) {
      console.log(
        "ℹ  Test user already exists, attempting to login..."
      );
      return await loginTestUser();
    } else {
      console.log("❌ Error:", error.response?.data || error.message);
      throw error;
    }
  }
};

const loginTestUser = async () => {
  try {
    const response = await axios.post(
      "http://localhost:9200/users/login",
      {
        email: "testdriver@example.com",
        password: "TestPassword123!",
      },
      {
        headers: {
          "X-Device-ID": "test-device-123",
        },
      }
    );

    if (response.data.success) {
      console.log("✓ Login successful");
      return response.data;
    } else {
      console.log("❌ Login failed:", response.data);
    }
  } catch (error) {
    console.log("❌ Login error:", error.response?.data || error.message);
  }
};

const createDriver = async (token, organizationId) => {
  try {
    const response = await axios.post(
      "http://localhost:9200/drivers",
      {
        name: "John Delivery Driver",
        phone: "+254712345678",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data.success) {
      console.log("\n✓ Driver created successfully!");
      console.log("  Driver ID:", response.data.data._id);
      console.log("  Name:", response.data.data.name);
      console.log("  Phone:", response.data.data.phone);
      console.log("  Status:", response.data.data.status);
      console.log("  Organization:", response.data.data.organizationId);
      return response.data.data;
    } else {
      console.log("❌ Driver creation failed:", response.data);
    }
  } catch (error) {
    console.log("❌ Error creating driver:", error.response?.data || error.message);
  }
};

const getDrivers = async (token) => {
  try {
    const response = await axios.get("http://localhost:9200/drivers", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.data.success) {
      console.log("\n✓ Drivers list retrieved:");
      if (response.data.data.length === 0) {
        console.log("  (No drivers yet)");
      } else {
        response.data.data.forEach((driver, idx) => {
          console.log(
            `  ${idx + 1}. ${driver.name} (${driver.phone}) - ${driver.status}`
          );
        });
      }
    } else {
      console.log("❌ Failed to fetch drivers:", response.data);
    }
  } catch (error) {
    console.log("❌ Error fetching drivers:", error.response?.data || error.message);
  }
};

const runTests = async () => {
  console.log("🚀 Testing Driver API Implementation\n");
  console.log("Step 1: Ensure test user exists");
  console.log("================================");
  const userData = await testRegistration();

  if (!userData || !userData.token || !userData.user?.organizationId) {
    console.log("❌ Failed to get user data for testing");
    return;
  }

  const token = userData.token;
  const organizationId = userData.user.organizationId;

  console.log("\nStep 2: Create a new driver");
  console.log("================================");
  const driver = await createDriver(token, organizationId);

  console.log("\nStep 3: List all drivers");
  console.log("================================");
  await getDrivers(token);

  console.log("\n✅ All tests completed!");
};

runTests().catch((error) => {
  console.error("Test suite error:", error.message);
  process.exit(1);
});
