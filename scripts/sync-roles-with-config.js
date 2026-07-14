/**
 * server/scripts/sync-roles-with-config.js
 * 
 * Updates the Role collection with the latest permissions from config/permissions.js.
 * Run with: node server/scripts/sync-roles-with-config.js
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const Role = require("../models/Role");
const { ROLE_PERMISSIONS } = require("../config/permissions");

const syncRoles = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const roles = Object.keys(ROLE_PERMISSIONS);

    for (const roleName of roles) {
      const permissions = ROLE_PERMISSIONS[roleName] || [];
      const result = await Role.findOneAndUpdate(
        { name: roleName },
        {
          name: roleName,
          permissions,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      console.log(`✅ Synced role: ${roleName} (${permissions.length} permissions)`);
    }

    console.log("✅ All roles synced successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error syncing roles:", error);
    process.exit(1);
  }
};

syncRoles();