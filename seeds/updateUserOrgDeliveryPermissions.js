/**
 * Migration Script: Add Delivery Fee Permissions to UserOrganization Records
 */

require("dotenv").config();
const mongoose = require("mongoose");
const UserOrganization = require("../models/UserOrganization");

const MONGO_URI = process.env.MONGO_URI;

const ROLE_DELIVERY_PERMISSIONS = {
  Owner: [
    "delivery_fees.create",
    "delivery_fees.read",
    "delivery_fees.update",
    "delivery_fees.delete",
    "delivery_fees.assign_driver",
    "delivery_fees.update_status",
  ],
  Manager: [
    "delivery_fees.create",
    "delivery_fees.read",
    "delivery_fees.update",
    "delivery_fees.delete",
    "delivery_fees.assign_driver",
    "delivery_fees.update_status",
  ],
  Cashier: [
    "delivery_fees.create",
    "delivery_fees.read",
  ],
  Employee: [
    "delivery_fees.read",
    "delivery_fees.update_status",
  ],
};

async function updateUserOrgDeliveryPermissions() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const userOrgs = await UserOrganization.find({});
    console.log(`📊 Found ${userOrgs.length} UserOrganization records\n`);

    let totalUpdated = 0;
    let totalAdded = 0;

    for (const userOrg of userOrgs) {
      const permsToAdd = ROLE_DELIVERY_PERMISSIONS[userOrg.role] || [];
      const existingPerms = userOrg.permissions || [];
      const newPermissions = permsToAdd.filter(p => !existingPerms.includes(p));

      if (newPermissions.length === 0) {
        console.log(`✅ User ${userOrg.userId} (${userOrg.role}): Already has permissions`);
        continue;
      }

      userOrg.permissions = [...new Set([...existingPerms, ...permsToAdd])];
      await userOrg.save();

      totalUpdated++;
      totalAdded += newPermissions.length;
      console.log(`✅ User ${userOrg.userId} (${userOrg.role}): Added ${newPermissions.length} permissions`);
      newPermissions.forEach(p => console.log(`   • ${p}`));
    }

    console.log(`\n📈 Statistics:`);
    console.log(`   UserOrganization records updated: ${totalUpdated}`);
    console.log(`   Total permissions added: ${totalAdded}`);
    console.log("\n✅ Done!");
    console.log("\n💡 IMPORTANT: Log out and log back in to refresh tokens!\n");
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

updateUserOrgDeliveryPermissions();
