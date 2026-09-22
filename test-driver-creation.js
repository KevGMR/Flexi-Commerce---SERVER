const axios = require("axios");

// Test the driver creation endpoint
const testDriverCreation = async () => {
  try {
    // First, login to get a token
    const loginResponse = await axios.post(
      "http://localhost:9200/users/login",
      {
        email: "gatamukevin7@gmail.com",
        password: "password123",
      },
      {
        headers: {
          "X-Device-ID": "test-device-123",
        },
      }
    );

    if (!loginResponse.data.success) {
      console.log("❌ Login failed");
      return;
    }

    const token = loginResponse.data.token;
    const { organizationId } = loginResponse.data.organization;

    console.log("✓ Login successful");
    console.log(`✓ Organization ID: ${organizationId}`);

    // Create a driver
    const createDriverResponse = await axios.post(
      "http://localhost:9200/drivers",
      {
        name: "John Driver",
        phone: "+254712345678",
        status: "active",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (createDriverResponse.data.success) {
      console.log("✓ Driver created successfully");
      console.log(`  Driver ID: ${createDriverResponse.data.data._id}`);
      console.log(`  Name: ${createDriverResponse.data.data.name}`);
      console.log(`  Phone: ${createDriverResponse.data.data.phone}`);
      return createDriverResponse.data.data._id;
    } else {
      console.log("❌ Driver creation failed");
      console.log(createDriverResponse.data);
    }
  } catch (error) {
    console.log("❌ Error:", error.response?.data || error.message);
  }
};

// Test get drivers endpoint
const testGetDrivers = async (token, organizationId) => {
  try {
    const getResponse = await axios.get("http://localhost:9200/drivers", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (getResponse.data.success) {
      console.log("\n✓ Drivers retrieved successfully");
      console.log(`  Total drivers: ${getResponse.data.data.length}`);
      getResponse.data.data.forEach((driver, index) => {
        console.log(`  ${index + 1}. ${driver.name} (${driver.phone})`);
      });
    } else {
      console.log("❌ Get drivers failed");
    }
  } catch (error) {
    console.log("❌ Error fetching drivers:", error.response?.data || error.message);
  }
};

console.log("Testing Driver API Implementation...\n");
testDriverCreation();
