require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const UserOrganization = require('./models/UserOrganization');
const Organization = require('./models/Organization');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const user = await User.findOne({email: 'testdriver@example.com'});
  const org = await Organization.findOne({name: 'Test Driver Organization'});
  
  if(user && org) {
    await UserOrganization.findOneAndUpdate(
      {userId: user._id, organizationId: org._id},
      {userId: user._id, organizationId: org._id, role: 'Manager', status: 'active'},
      {upsert: true}
    );
    console.log('✓ User added to organization');
  } else {
    console.log('User exists:', !!user, '| Org exists:', !!org);
  }
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
