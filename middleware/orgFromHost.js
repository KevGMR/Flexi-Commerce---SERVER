const Organization = require("../models/Organization");

/**
 * Middleware for public storefront endpoints.
 *
 * Verifies the request came from the trusted Next.js storefront (via a
 * shared secret header), then resolves the organization from the
 * X-Organization-Slug header.
 *
 * Attaches req.storefrontOrg. Does NOT require a user JWT.
 *
 * Required env: STOREFRONT_API_KEY
 * Required headers:
 *   X-Storefront-Key: <shared secret>
 *   X-Organization-Slug: <org slug>
 */
async function orgFromHost(req, res, next) {
  try {
    const expectedKey = process.env.STOREFRONT_API_KEY;

    if (!expectedKey) {
      console.error(
        "[orgFromHost] STOREFRONT_API_KEY is not configured on the server",
      );
      return res.status(500).json({
        error: "Storefront not configured",
        code: "STOREFRONT_NOT_CONFIGURED",
      });
    }

    const apiKey = req.headers["x-storefront-key"];

    if (!apiKey || apiKey !== expectedKey) {
      return res.status(401).json({
        error: "Unauthorized",
        code: "STOREFRONT_KEY_INVALID",
      });
    }

    const slug = req.headers["x-organization-slug"];

    if (!slug) {
      return res.status(400).json({
        error: "X-Organization-Slug header is required",
        code: "ORG_SLUG_REQUIRED",
      });
    }

    const cleanSlug = String(slug).toLowerCase().trim();

    const org = await Organization.findOne({
      slug: cleanSlug,
      status: "active",
    })
      .select("_id name slug settings website")
      .lean();

    if (!org) {
      return res.status(404).json({
        error: "Organization not found",
        code: "ORG_NOT_FOUND",
      });
    }

    req.storefrontOrg = org;
    next();
  } catch (error) {
    console.error("[orgFromHost] error:", error);
    return res.status(500).json({
      error: "Failed to resolve organization",
    });
  }
}

module.exports = { orgFromHost };