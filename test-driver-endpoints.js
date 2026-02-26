require('dotenv').config();
const axios = require('axios');

const testAPI = async () => {
  try {
    // Login first
    const loginRes = await axios.post('http://localhost:9200/users/login', {
      email: 'kevingatamumuthoni@gmail.com',
      password: 'password123',
    }, {
        headers: { 'X-Device-ID': 'test-device-123456' }
    });

    if (!loginRes.data.success) {
      console.log('❌ Login failed:', loginRes.data);
      return;
    }

    const token = loginRes.data.token;
    console.log('✓ Logged in successfully');

    // Create a driver via API
    console.log('\n--- Creating Driver via API ---');
    const createRes = await axios.post('http://localhost:9200/drivers', {
      name: 'Jane Smith Driver',
      phone: '+254798765432',
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (createRes.data.success) {
      console.log('✓ Driver created successfully');
      console.log('  ID:', createRes.data.data._id);
      console.log('  Name:', createRes.data.data.name);
      console.log('  Phone:', createRes.data.data.phone);
      console.log('  Status:', createRes.data.data.status);
    } else {
      console.log('❌ Driver creation failed:', createRes.data);
    }

    // Get all drivers
    console.log('\n--- Fetching All Drivers ---');
    const listRes = await axios.get('http://localhost:9200/drivers', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (listRes.data.success) {
      console.log(`✓ Retrieved ${listRes.data.data.length} driver(s)`);
      listRes.data.data.forEach((driver, idx) => {
        console.log(`  ${idx + 1}. ${driver.name} (${driver.phone})`);
      });
    } else {
      console.log('❌ Failed to fetch drivers:', listRes.data);
    }

    console.log('\n✅ All API tests passed!');
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
};

testAPI();
