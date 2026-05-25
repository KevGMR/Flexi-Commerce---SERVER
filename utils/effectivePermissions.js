const UserOrganization = require("../models/UserOrganization");
const Role = require("../models/Role");
const { getPermissionsForRole } = require("../config/permissions");

const uniqueStrings = (values) => [...new Set((values || []).filter(Boolean))];

const getEffectivePermissionsForMembership = async ({ userId, organizationId }) => {
  const membership = await UserOrganization.findOne({
    userId,
    organizationId,
    status: "active",
  }).lean();

  if (!membership) {
    return null;
  }

  const roleDoc = membership.role
    ? await Role.findOne({ name: membership.role }).lean()
    : null;

  return {
    membership,
    role: roleDoc,
    permissions: uniqueStrings([
      ...(roleDoc?.permissions || []),
      ...(membership.permissions || []),
    ]),
  };
};

/**
 * Get current permissions for a role name (live from Role doc or config fallback)
 * Used for membership creation to ensure Owner/Manager get all current permissions
 */
const getMembershipPermissionsForRole = async (roleName) => {
  try {
    // Primary: check database for live role definition
    const role = await Role.findOne({ name: roleName }).lean();
    if (role && role.permissions && role.permissions.length > 0) {
      return role.permissions;
    }
  } catch (err) {
    console.warn(`Failed to fetch role ${roleName} from database:`, err.message);
  }

  // Fallback: config-defined permissions (safest default)
  return getPermissionsForRole(roleName);
};

module.exports = {
  getEffectivePermissionsForMembership,
  getMembershipPermissionsForRole,
};
