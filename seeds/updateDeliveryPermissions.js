/**
 * Migration Script: Add Delivery Fee Permissions to Existing Roles
 * 
 * This script adds delivery fee permissions to existing roles based on their tier.
 * Run with: node server/seeds/updateDeliveryPermissions.js
 * 
 * Permission Distribution:
 * - Owner/Manager: All 6 permissions (full access)
 * - Cashier: create + read (can create deliveries with sales, view history)
 * - Employee: read + update_status (can view and track deliveries)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Role = require("../models/Role");
const { PERMISSIONS } = require("../config/permissions");

const MONGO_URI = process.env.MONGO_URI;

const ROLE_DELIVERY_PERMISSIONS = {
  Owner: [
    PERMISSIONS.DELIVERY_FEES_CREATE,
    PERMISSIONS.DELIVERY_FEES_READ,
    PERMISSIONS.DELIVERY_FEES_UPDATE,
    PERMISSIONS.DELIVERY_FEES_DELETE,
    PERMISSIONS.DELIVERY_FEES_ASSIGN_DRIVER,
    PERMISSIONS.DELIVERY_FEES_UPDATE_STATUS,
  ],
  Manager: [
    PERMISSIONS.DELIVERY_FEES_CREATE,
    PERMISSIONS.DELIVERY_FEES_READ,
    PERMISSIONS.DELIVERY_FEES_UPDATE,
    PERMISSIONS.DELIVERY_FEES_DELETE,
    PERMISSIONS.DELIVERY_FEES_ASSIGN_DRIVER,
    PERMISSIONS.DELIVERY_FEES_UPDATE_STATUS,
  ],
  Cashier: [
    PERMISSIONS.DELIVERY_FEES_CREATE,
    PERMISSIONS.DELIVERY_FEES_READ,
  ],
  Employee: [
    PERMISSIONS.DELIVERY_FEES_READ,
    PERMISSIONS.DELIVERY_FEES_UPDATE_STATUS,
  ],
};

async function updateDeliveryPermissions() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    console.log("\n📋 Fetching roles...");
    const roles = await Role.find({});
    console.log(`📊 Found ${roles.length} roles`);

    if (roles.length === 0) {
      console.log("⚠️  No roles found");
      await mongoose.connection.close();
      return;
    }

    console.log("\n🔄 Updating permissions for each role...\n");

    let totalAdded = 0;
    let rolesUpdated = 0;

    for (const [roleName, permsToAdd] of Object.entries(
      ROLE_DELIVERY_PERMISSIONS
    )) {
      const role = roles.find((r) => r.name === roleName);

      if (!role) {
        console.log(`⚠️  Role "${roleName}" not found, skipping`);
        continue;
      }

      // Filter permissions that aren't already in the role
      const newPermissions = permsToAdd.filter(
        (perm) => !role.permissions.includes(perm)
      );

      if (newPermissions.length === 0) {
        console.log(`✅ ${roleName}: Already has all delivery permissions`);
        continue;
      }

      // Add new permissions (avoid duplicates by using Set)
      role.permissions = [...new Set([...role.permissions, ...permsToAdd])];
      await role.save();

      totalAdded += newPermissions.length;
      rolesUpdated++;

      console.log(
        `✅ ${roleName}: Added ${newPermissions.length} permission(s)`
      );
      newPermissions.forEach((perm) => {
        console.log(`   • ${perm}`);
      });
    }

    console.log("\n📊 Permission Summary:");
    console.log(
      "┌───────────────────────────────────────────────────────┐"
    );

    for (const [roleName, perms] of Object.entries(
      ROLE_DELIVERY_PERMISSIONS
    )) {
      const role = roles.find((r) => r.name === roleName);
      const count = perms.length;
      console.log(`│ ${roleName.padEnd(50)} (${count}) │`);
      perms.forEach((perm) => {
        console.log(`│   • ${perm.padEnd(50)}│`);
      });
    }
    console.log(
      "└───────────────────────────────────────────────────────┘"
    );

    console.log(`\n📈 Statistics:`);
    console.log(`   Roles updated: ${rolesUpdated}`);
    console.log(`   Permissions added: ${totalAdded}`);

    await mongoose.connection.close();
    console.log("\n✅ Permissions updated successfully!");
    console.log("\n💡 Next step: Run the delivery settings initialization script");
    console.log("   node seeds/initializeDeliverySettings.js");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("Stack:", error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
updateDeliveryPermissions();
