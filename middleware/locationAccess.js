const UserOrganization = require("../models/UserOrganization");

/**
 * Middleware to validate user has access to specified location
 * Checks req.body.locationId or req.params.locationId
 * Bypasses check if:
 * - User has no location restrictions (empty locations array)
 * - User is Owner or Manager
 */
const validateLocationAccess = async (req, res, next) => {
  try {
    const { userId, organizationId, role } = req.user;
    
    // Get locationId from body or params
    const locationId = req.body.locationId || req.params.locationId;

    if (!locationId) {
      return res.status(400).json({ error: "locationId is required" });
    }

    // Bypass check for Owner and Manager
    if (["Owner", "Manager"].includes(role)) {
      return next();
    }

    // Get user's organization membership
    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "active",
    }).select("locations").lean();

    if (!membership) {
      return res.status(403).json({ error: "No access to this organization" });
    }

    // If locations array is empty, user has access to all locations
    if (!membership.locations || membership.locations.length === 0) {
      return next();
    }

    // Check if user has access to this specific location
    const hasAccess = membership.locations.some(
      loc => String(loc) === String(locationId)
    );

    if (!hasAccess) {
      return res.status(403).json({ 
        error: "Access denied. You do not have access to this location.",
        code: "LOCATION_ACCESS_DENIED"
      });
    }

    next();
  } catch (error) {
    console.error("Location access validation error:", error);
    return res.status(500).json({ error: "Failed to validate location access" });
  }
};

module.exports = { validateLocationAccess };
