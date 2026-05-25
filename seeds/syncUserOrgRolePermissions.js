/**
 * Backfill Script: Sync Owner/Manager UserOrganization permissions with live Role definitions
 *
 * Problem: When new permissions are added to Owner/Manager roles, existing UserOrganization
 * records don't automatically pick them up because they have static permission snapshots
 * from the time they were created.
 *
 * Solution: This script queries all Owner/Manager UserOrganization records and merges
 * the current Role.permissions into each membership.
 *
 * Usage:
 *   node seeds/syncUserOrgRolePermissions.js          # Dry-run (shows changes, creates backup)
 *   node seeds/syncUserOrgRolePermissions.js --apply  # Applies changes to database
 */

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const UserOrganization = require("../models/UserOrganization");
const Role = require("../models/Role");
const { ROLE_PERMISSIONS } = require("../config/permissions");

const MONGO_URI = process.env.MONGO_URI;
const APPLY = process.argv.slice(2).includes("--apply");

const backupsDir = path.join(__dirname, "backups");
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const uniqueStrings = (values) => [...new Set((values || []).filter(Boolean))];

async function syncUserOrgRolePermissions() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    // Query all Owner/Manager UserOrganization records
    const userOrgs = await UserOrganization.find({
      role: { $in: ["Owner", "Manager"] },
      status: "active",
    });

    console.log(`📊 Found ${userOrgs.length} Owner/Manager membership records\n`);

    const changes = [];
    const backup = {
      timestamp: new Date().toISOString(),
      dryRun: !APPLY,
      targetRoles: ["Owner", "Manager"],
      recordsProcessed: userOrgs.length,
      changes: [],
    };

    // Process each membership
    for (const userOrg of userOrgs) {
      const roleDoc = await Role.findOne({ name: userOrg.role }).lean();
      const rolePermissions = roleDoc?.permissions || ROLE_PERMISSIONS[userOrg.role] || [];
      const existingPerms = userOrg.permissions || [];

      // Merge: unique set of existing + role permissions
      const mergedPerms = uniqueStrings([...existingPerms, ...rolePermissions]);

      // Check if any permissions were added
      const newPermissions = mergedPerms.filter((p) => !existingPerms.includes(p));

      if (newPermissions.length === 0) {
        continue;
      }

      changes.push({
        userId: String(userOrg.userId),
        role: userOrg.role,
        organizationId: String(userOrg.organizationId),
        before: existingPerms.length,
        after: mergedPerms.length,
        added: newPermissions.length,
        addedPermissions: newPermissions,
      });

      backup.changes.push({
        userId: String(userOrg.userId),
        role: userOrg.role,
        organizationId: String(userOrg.organizationId),
        before: existingPerms,
        after: mergedPerms,
      });

      // Update in database if --apply flag is set
      if (APPLY) {
        userOrg.permissions = mergedPerms;
        await userOrg.save();
        console.log(
          `✅ Updated ${userOrg.role} membership (user ${String(userOrg.userId).slice(-6)}): +${newPermissions.length} permission(s)`
        );
        newPermissions.forEach((p) => {
          console.log(`   • ${p}`);
        });
      }
    }

    // Write backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupsDir, `userorg_role_permissions_backup_${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\n💾 Backup written: ${backupPath}`);

    // Print summary
    if (changes.length === 0) {
      console.log("\n✅ All Owner/Manager memberships already have current permissions");
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log(`\n${"—".repeat(60)}`);
    console.log(`📋 Summary: ${changes.length} membership(s) need permission updates`);
    console.log(`${"—".repeat(60)}\n`);

    if (!APPLY) {
      console.log("--- Proposed changes (dry-run) ---\n");
      changes.forEach((change) => {
        console.log(
          `${change.role} (${String(change.userId).slice(-6)}): ${change.before} → ${change.after} permissions (+${change.added})`
        );
        change.addedPermissions.forEach((p) => {
          console.log(`   • ${p}`);
        });
      });

      console.log(`\n${"—".repeat(60)}`);
      console.log(
        "DRY RUN complete. To apply changes, re-run with --apply (and ensure DB backup)."
      );
      console.log(`${"—".repeat(60)}\n`);
    } else {
      console.log(`${"—".repeat(60)}`);
      console.log(`🎉 Permission sync applied to ${changes.length} membership(s)`);
      console.log(`${"—".repeat(60)}\n`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Stack:", error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

syncUserOrgRolePermissions();
