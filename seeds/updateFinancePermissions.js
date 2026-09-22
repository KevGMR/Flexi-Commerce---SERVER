/**
 * Migration Script: Add Finance Permissions to Existing Roles
 *
 * Usage:
 *   node seeds/updateFinancePermissions.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Role = require("../models/Role");
const { PERMISSIONS } = require("../config/permissions");

const MONGO_URI = process.env.MONGO_URI;

const ROLE_FINANCE_PERMISSIONS = {
  Owner: [
    PERMISSIONS.MANAGE_FINANCE,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.CREATE_EXPENSES,
    PERMISSIONS.APPROVE_EXPENSES,
  ],
  Manager: [
    PERMISSIONS.MANAGE_FINANCE,
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.CREATE_EXPENSES,
    PERMISSIONS.APPROVE_EXPENSES,
  ],
  Cashier: [
    PERMISSIONS.VIEW_EXPENSES,
    PERMISSIONS.CREATE_EXPENSES,
  ],
  Employee: [],
};

async function updateFinancePermissions() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not configured");
    }

    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const roles = await Role.find({});

    for (const role of roles) {
      const permissionsToAdd = ROLE_FINANCE_PERMISSIONS[role.name] || [];
      if (permissionsToAdd.length === 0) {
        continue;
      }

      const before = role.permissions.length;
      role.permissions = [...new Set([...(role.permissions || []), ...permissionsToAdd])];
      const after = role.permissions.length;

      if (after > before) {
        await role.save();
        console.log(`✅ Updated ${role.name}: +${after - before} finance permission(s)`);
      }
    }

    console.log("🎉 Finance permission migration completed.");
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Finance permission migration failed:", error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

updateFinancePermissions();
