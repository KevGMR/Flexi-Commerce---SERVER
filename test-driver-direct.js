require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const UserOrganization = require('./models/UserOrganization');
const Organization = require('./models/Organization');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  // Get existing user
  const user = await User.findOne({email: 'gatamukevin7@gmail.com'});
  const org = await Organization.findOne({name: 'House of Queens KE'});

  if(user && org) {
    console.log('✓ Found existing user and org');
    const Driver = require('./models/Driver');
    const driver = new Driver({
      name: 'John Delivery Driver',
      phone: '+254712345678',
      organizationId: org._id,
      status: 'active',
    });
    
    await driver.save();
    console.log('✓ Test driver created successfully!');
    console.log('  Driver ID:', driver._id);
    console.log('  Name:', driver.name);
    console.log('  Phone:', driver.phone);
    console.log('  Organization:', org.name);
  } else {
    console.log('❌ Could not find user or organization');
    if(!user) console.log('  - User not found');
    if(!org) console.log('  - Organization not found');
  }
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
