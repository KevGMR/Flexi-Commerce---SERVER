/**
 * Initialize Default Roles
 * Run once on first server startup to create system roles
 * Usage: node seeds/initializeRoles.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Role = require("../models/Role");
const { PERMISSIONS, ROLE_PERMISSIONS } = require("../config/permissions");

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI not set in .env file");
  process.exit(1);
}

async function initializeRoles() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✓ Connected to MongoDB");

    // Define default system roles with their permissions
    const defaultRoles = [
      {
        name: "Owner",
        description: "Full system access - owner of the store",
        permissions: Object.keys(PERMISSIONS),
        isSystem: true,
      },
      {
        name: "Manager",
        description: "Elevated access - can manage sales, inventory, and staff",
        permissions: ROLE_PERMISSIONS.Manager,
        isSystem: true,
      },
      {
        name: "Cashier",
        description: "Can process sales and view invoices",
        permissions: ROLE_PERMISSIONS.Cashier,
        isSystem: true,
      },
      {
        name: "Employee",
        description: "View-only access to system",
        permissions: ROLE_PERMISSIONS.Employee,
        isSystem: true,
      },
    ];

    for (const roleData of defaultRoles) {
      const existingRole = await Role.findOne({ name: roleData.name });

      if (existingRole) {
        // Update existing role with latest permissions
        existingRole.permissions = roleData.permissions;
        existingRole.description = roleData.description;
        await existingRole.save();
        console.log(`✓ Updated role: ${roleData.name}`);
      } else {
        // Create new role
        const role = new Role(roleData);
        await role.save();
        console.log(`✓ Created role: ${roleData.name}`);
      }
    }

    console.log("\n✓ Roles initialization complete!");
    console.log("\nAvailable roles:");
    const allRoles = await Role.find();
    allRoles.forEach((role) => {
      console.log(`  - ${role.name}: ${role.permissions.length} permissions`);
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Error initializing roles:", error.message);
    process.exit(1);
  }
}

initializeRoles();
