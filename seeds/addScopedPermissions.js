/**
 * Seed/Migration: Add scoped permissions to existing roles
 *
 * - Default behavior: dry-run (prints changes, creates backup file)
 * - To apply changes: pass `--apply`
 * - Requires MONGO_URI in environment
 * - Optional: ADMIN_ID for audit logging (objectId string)
 *
 * Usage:
 *   # Dry run (default)
 *   node seeds/addScopedPermissions.js
 *
 *   # Apply changes
 *   node seeds/addScopedPermissions.js --apply
 *
 */

require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Role = require("../models/Role");
const { PERMISSIONS } = require("../config/permissions");
const auditLogger = require("../services/auditLogger");

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID || null; // optional admin id for audit logs

const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes("--apply");

// Roles to update by default
const TARGET_ROLES = ["Owner", "Manager"];

// Extra permissions for Cashier role (per user request)
const CASHIER_EXTRAS = [
  PERMISSIONS.CREATE_SALE,
  PERMISSIONS.CREATE_EXPENSES,
  PERMISSIONS.VIEW_EXPENSES,
  // Add MANAGE_FINANCE so cashiers can close shifts when business requires it
  PERMISSIONS.MANAGE_FINANCE,
];

async function run() {
  if (!MONGO_URI) {
    console.error("MONGO_URI is not configured in environment");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const roles = await Role.find({ name: { $in: [...TARGET_ROLES, "Cashier"] } });

  // Build backup object
  const backup = {
    createdAt: new Date().toISOString(),
    env: {
      MONGO_URI: !!MONGO_URI,
      ADMIN_ID: !!ADMIN_ID,
    },
    roles: {},
  };

  const allPermissions = Object.values(PERMISSIONS);

  for (const roleName of [...TARGET_ROLES, "Cashier"]) {
    const role = roles.find((r) => r.name === roleName);
    if (!role) {
      console.warn(`⚠️ Role not found: ${roleName} — skipping`);
      continue;
    }

    backup.roles[roleName] = {
      id: role._id.toString(),
      before: role.permissions || [],
    };

    let toAdd = [];

    if (TARGET_ROLES.includes(roleName)) {
      // Add any missing permissions (all permissions requested)
      toAdd = allPermissions.filter((p) => !(role.permissions || []).includes(p));
    } else if (roleName === "Cashier") {
      toAdd = CASHIER_EXTRAS.filter((p) => !(role.permissions || []).includes(p));
    }

    backup.roles[roleName].toAdd = toAdd;
    backup.roles[roleName].after = [...new Set([...(role.permissions || []), ...toAdd])];
  }

  // Write backup file
  const backupsDir = path.join(__dirname, "backups");
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
  } catch (err) {}

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupsDir, `role_permissions_backup_${timestamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`🗄  Backup written: ${backupPath}`);

  // Dry-run output
  console.log("\n--- Proposed changes (dry-run) ---\n");
  for (const [roleName, info] of Object.entries(backup.roles)) {
    console.log(`Role: ${roleName}`);
    console.log(`  id: ${info.id}`);
    console.log(`  will add: ${info.toAdd.length} permission(s)`);
    if (info.toAdd.length > 0) {
      console.log(`    ${info.toAdd.join(", ")}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY RUN complete. To apply changes, re-run with --apply (and ensure DB backup).\n");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Apply changes
  console.log("Applying changes to roles...");
  for (const [roleName, info] of Object.entries(backup.roles)) {
    const role = roles.find((r) => r.name === roleName);
    if (!role) continue;

    const before = role.permissions || [];
    const newPermissions = [...new Set([...(before || []), ...(info.toAdd || [])])];

    if (newPermissions.length === before.length) {
      console.log(`No change for ${roleName}`);
      continue;
    }

    role.permissions = newPermissions;
    await role.save();
    console.log(`✅ Updated ${roleName}: +${newPermissions.length - before.length} permission(s)`);

    // Log role change for auditability
    try {
      await auditLogger.logRoleChange(ADMIN_ID, role._id.toString(), "updated_permissions", "system", {
        oldPermissions: before,
        newPermissions,
      });
    } catch (err) {
      console.warn("Warning: failed to write audit log for role change:", err.message || err);
    }
  }

  console.log("\n🎉 Permission update applied.");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Migration failed:", err.message || err);
  try {
    await mongoose.disconnect();
  } catch (e) {}
  process.exit(1);
});
