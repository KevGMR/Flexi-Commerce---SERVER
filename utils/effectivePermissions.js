const UserOrganization = require("../models/UserOrganization");
const Role = require("../models/Role");
const { getPermissionsForRole, ROLE_PERMISSIONS } = require("../config/permissions");

const uniqueStrings = (values) => [...new Set((values || []).filter(Boolean))];

/**
 * Ensure a Role document is in sync with the config.
 * If the role doesn't exist, create it with config permissions.
 * If it exists, merge any missing permissions from the config.
 */
const syncRoleWithConfig = async (roleName) => {
  try {
    let role = await Role.findOne({ name: roleName });
    const configPermissions = getPermissionsForRole(roleName) || [];

    if (!role) {
      // Create a new role document with config permissions
      role = new Role({
        name: roleName,
        permissions: configPermissions,
      });
      await role.save();
      console.log(`[Sync] Created Role document for ${roleName}`);
      return role;
    }

    // Merge missing permissions from config
    const currentPermissions = role.permissions || [];
    const missing = configPermissions.filter((p) => !currentPermissions.includes(p));
    if (missing.length > 0) {
      role.permissions = uniqueStrings([...currentPermissions, ...missing]);
      await role.save();
      console.log(`[Sync] Added missing permissions to Role ${roleName}:`, missing);
    }
    return role;
  } catch (err) {
    console.error(`[Sync] Failed to sync role ${roleName}:`, err.message);
    throw err;
  }
};

/**
 * Get effective permissions for a user in an organization.
 * Merges role-based permissions (from the Role document or config)
 * with any custom permissions stored on the membership.
 */
const getEffectivePermissionsForMembership = async ({ userId, organizationId }) => {
  const membership = await UserOrganization.findOne({
    userId,
    organizationId,
    status: "active",
  }).lean();

  if (!membership) {
    return null;
  }

  // Get role-based permissions
  let rolePermissions = [];
  if (membership.role) {
    // Try to get from Role collection first (live)
    const roleDoc = await Role.findOne({ name: membership.role }).lean();
    if (roleDoc && roleDoc.permissions) {
      rolePermissions = roleDoc.permissions;
    } else {
      // Fallback to config-defined permissions
      rolePermissions = getPermissionsForRole(membership.role) || [];
    }
  }

  // Custom permissions (if any)
  const customPermissions = membership.customPermissions || [];

  // Merge and deduplicate
  const mergedPermissions = uniqueStrings([
    ...rolePermissions,
    ...(membership.permissions || []), // legacy field, keep for backward compatibility
    ...customPermissions,
  ]);

  return {
    membership,
    role: membership.role ? await Role.findOne({ name: membership.role }).lean() : null,
    permissions: mergedPermissions,
  };
};

/**
 * Get current permissions for a role name (live from Role doc or config fallback)
 * Used for membership creation to ensure Owner/Manager get all current permissions
 */
const getMembershipPermissionsForRole = async (roleName) => {
  try {
    const role = await Role.findOne({ name: roleName }).lean();
    if (role && role.permissions && role.permissions.length > 0) {
      return role.permissions;
    }
  } catch (err) {
    console.warn(`Failed to fetch role ${roleName} from database:`, err.message);
  }
  return getPermissionsForRole(roleName);
};

module.exports = {
  getEffectivePermissionsForMembership,
  getMembershipPermissionsForRole,
  syncRoleWithConfig,
};