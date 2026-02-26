require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('./models/Organization');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const orgs = await Organization.find().limit(1);
  const users = require('./models/User');
  const allUsers = await users.find().limit(1);
  
  console.log('Organizations:', orgs.map(o => ({id: o._id, name: o.name})));
  console.log('Users:', allUsers.map(u => ({id: u._id, email: u.email})));
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
