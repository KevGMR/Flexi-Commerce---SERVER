const UserOrganization = require("../models/UserOrganization");
const Role = require("../models/Role");

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

module.exports = {
  getEffectivePermissionsForMembership,
};
