const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const Organization = require("../models/Organization");
const UserOrganization = require("../models/UserOrganization");
const Invitation = require("../models/Invitation");
const User = require("../models/User");
const { getPermissionsForRole, PERMISSIONS } = require("../config/permissions");
const { verifyToken, requireOrganization } = require("../middleware/auth");
const { getEffectivePermissionsForMembership, getMembershipPermissionsForRole } = require("../utils/effectivePermissions");
const { logTokenEvent } = require("../services/auditLogger");
const { sendOrganizationInvitation } = require("../services/emailNotifier");
const { loginLimiter } = require("../middleware/rateLimiter");
const vercel = require("../services/vercel");
const secretBox = require("../services/secretBox");


const VALID_TAX_MODES = ["inclusive", "exclusive"];

const HOMEPAGE_SECTION_TYPES = [
  "hero",
  "featured-products",
  "collection",
  "rich-text",
  "trust-strip",
  "banner",
  "featured-category",
  "image-text",
  "announcement",
];
/**
 * Validate the homepage.sections array. Returns { ok: true, sections } on
 * success, { ok: false, error } on failure. Rejects unknown types and
 * validates per-type config shapes. Never trusts client input.
 */
function validateHomepageSections(input) {
  if (input === undefined) return { ok: true, sections: undefined };
  if (!Array.isArray(input)) {
    return { ok: false, error: "homepage.sections must be an array" };
  }
  if (input.length > 30) {
    return { ok: false, error: "Maximum 30 sections allowed" };
  }

  const seenIds = new Set();
  const sections = [];

  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    if (!s || typeof s !== "object") {
      return { ok: false, error: `Section ${i} is not an object` };
    }
    if (!s.id || typeof s.id !== "string") {
      return { ok: false, error: `Section ${i} is missing an id` };
    }
    if (seenIds.has(s.id)) {
      return { ok: false, error: `Section id "${s.id}" is duplicated` };
    }
    seenIds.add(s.id);

    if (!HOMEPAGE_SECTION_TYPES.includes(s.type)) {
      return {
        ok: false,
        error: `Section ${i} has an invalid type "${s.type}"`,
      };
    }

    const config = s.config || {};
    const check = validateSectionConfig(s.type, config, i);
    if (!check.ok) return check;

    sections.push({
      id: s.id,
      type: s.type,
      config: check.config,
    });
  }

  return { ok: true, sections };
}

function validateSectionConfig(type, config, i) {
  const str = (v, max = 500) =>
    typeof v === "string" ? v.slice(0, max) : "";
  const num = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  switch (type) {
        case "hero": {
      const align = ["left", "center", "right"].includes(config.align)
        ? config.align
        : "left";
      return {
        ok: true,
        config: {
          heading: str(config.heading, 120),
          subheading: str(config.subheading, 240),
          ctaLabel: str(config.ctaLabel, 40),
          ctaHref: str(config.ctaHref, 300),
          imageUrl: str(config.imageUrl, 600),
          imageUrlMobile: str(config.imageUrlMobile, 600),
          align,
          fullHeight: config.fullHeight === true,
        },
      };
    }

    case "featured-products": {
      const mode = config.mode === "manual" ? "manual" : "latest";
      const manualIds = Array.isArray(config.productIds)
        ? config.productIds.filter((id) => typeof id === "string").slice(0, 24)
        : [];
      return {
        ok: true,
        config: {
          heading: str(config.heading, 120),
          subheading: str(config.subheading, 240),
          mode,
          productIds: manualIds,
          limit: num(config.limit, 1, 24, 8),
        },
      };
    }

    case "collection": {
      return {
        ok: true,
        config: {
          heading: str(config.heading, 120),
          subheading: str(config.subheading, 240),
          collectionSlug: str(config.collectionSlug, 200),
          limit: num(config.limit, 1, 24, 8),
        },
      };
    }

    case "rich-text": {
      return {
        ok: true,
        config: {
          heading: str(config.heading, 120),
          body: str(config.body, 4000),
        },
      };
    }

    case "trust-strip": {
      const items = Array.isArray(config.items)
        ? config.items.slice(0, 4).map((it) => ({
            title: str(it?.title, 80),
            body: str(it?.body, 240),
          }))
        : [];
      return {
        ok: true,
        config: { items },
      };
    }

    case "banner": {
      return {
        ok: true,
        config: {
          imageUrl: str(config.imageUrl, 600),
          imageUrlMobile: str(config.imageUrlMobile, 600),
          href: str(config.href, 300),
          alt: str(config.alt, 120),
        },
      };
    }

    case "featured-category": {
      const slugs = Array.isArray(config.categorySlugs)
        ? config.categorySlugs
            .filter((s) => typeof s === "string")
            .slice(0, 6)
        : [];
      return {
        ok: true,
        config: {
          heading: str(config.heading, 120),
          subheading: str(config.subheading, 240),
          categorySlugs: slugs,
        },
      };
    }

    case "image-text": {
      const position = config.imagePosition === "right" ? "right" : "left";
      return {
        ok: true,
        config: {
          heading: str(config.heading, 120),
          subheading: str(config.subheading, 240),
          body: str(config.body, 2000),
          imageUrl: str(config.imageUrl, 600),
          imageUrlMobile: str(config.imageUrlMobile, 600),
          imagePosition: position,
          ctaLabel: str(config.ctaLabel, 40),
          ctaHref: str(config.ctaHref, 300),
        },
      };
    }

    case "announcement": {
      const tone = ["brand", "ink", "muted"].includes(config.tone)
        ? config.tone
        : "muted";
      return {
        ok: true,
        config: {
          text: str(config.text, 200),
          href: str(config.href, 300),
          tone,
        },
      };
    }

    default:
      return { ok: false, error: `Unknown section type "${type}"` };
  }
}

/**
 * Get current organization details
 * GET /organizations/:organizationId
 */
router.get("/:organizationId", verifyToken, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.organizationId)
      .populate("ownerId", "fullname email")
      .lean();

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    // Verify user has access to this org
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership) {
      return res.status(403).json({ error: "No access to this organization" });
    }

    const effectiveMembership = await getEffectivePermissionsForMembership({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    });

    // Mask Daraja secret fields before returning.
    // Secret fields are: consumerKey, consumerSecret, passkey.
    // We never expose them, only whether they're set + a short preview.
    const orgForClient = { ...org };
    if (orgForClient.daraja) {
      const d = orgForClient.daraja;
      const preview = (val) => {
        if (!val || typeof val !== "string") return { set: false, preview: "" };
        // Show last 4 of the ciphertext — it's an opaque blob to the client
        // but gives the admin a visual "yes something is stored" cue.
        return { set: true, preview: `…${val.slice(-4)}` };
      };
      orgForClient.daraja = {
        enabled: d.enabled === true,
        environment: d.environment || "sandbox",
        shortcode: d.shortcode || "",
        transactionType: d.transactionType || "CustomerPayBillOnline",
        mpesaStkEnabled: d.mpesaStkEnabled === true,
        consumerKey: preview(d.consumerKey),
        consumerSecret: preview(d.consumerSecret),
        passkey: preview(d.passkey),
        callbackSecret: preview(d.callbackSecret),
      };
    }

    return res.status(200).json({
      organization: {
        ...orgForClient,
        role: effectiveMembership?.membership?.role || membership.role,
        permissions: effectiveMembership?.permissions || membership.permissions || [],
        locations: effectiveMembership?.membership?.locations || membership.locations || [],
      },
    });
  } catch (error) {
    console.error("Error fetching organization:", error);
    return res.status(500).json({ error: "Failed to fetch organization" });
  }
});

/**
 * Update organization settings
 * PUT /organizations/:organizationId
 */
router.put("/:organizationId", verifyToken, async (req, res) => {
  try {
    const { name, slug, settings, website } = req.body;

    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership || !["Owner", "Manager"].includes(membership.role)) {
      return res.status(403).json({
        error: "Only Owner or Manager can update organization",
      });
    }

    const org = await Organization.findById(req.params.organizationId);
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    if (
      settings &&
      settings.taxMode !== undefined &&
      !VALID_TAX_MODES.includes(settings.taxMode)
    ) {
      return res.status(400).json({
        error: "Invalid taxMode. Allowed values: inclusive, exclusive",
      });
    }

    const updateDoc = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ error: "name cannot be empty" });
      }
      updateDoc.name = trimmed;
    }

    if (slug !== undefined) {
      const cleanSlug = String(slug).toLowerCase().trim();
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(cleanSlug)) {
        return res.status(400).json({
          error:
            "slug must be lowercase alphanumeric with hyphens, and cannot start or end with a hyphen",
        });
      }
      const conflict = await Organization.findOne({
        slug: cleanSlug,
        _id: { $ne: org._id },
      })
        .select("_id")
        .lean();
      if (conflict) {
        return res
          .status(409)
          .json({ error: "That slug is already taken by another organization" });
      }
      updateDoc.slug = cleanSlug;
    }

    if (settings !== undefined) {
      updateDoc.settings = {
        ...(org.settings || {}),
        ...settings,
      };
    }

    // Daraja credentials — top-level field, not under website.
    // Secrets are encrypted at rest. Reads are masked in GET handler.
    if (req.body.daraja !== undefined) {
      const incoming = req.body.daraja || {};
      const current = org.daraja || {};

      const nextDaraja = { ...current };

      // Hardening: if callbackSecret exists but isn't a valid encrypted
      // payload, re-encrypt it. Catches orgs whose callbackSecret was
      // written as plaintext by an earlier script.
      if (nextDaraja.callbackSecret) {
        let needsReencrypt = false;
        try {
          secretBox.decrypt(nextDaraja.callbackSecret);
        } catch {
          needsReencrypt = true;
        }
        if (needsReencrypt) {
          nextDaraja.callbackSecret = secretBox.encrypt(
            String(nextDaraja.callbackSecret),
          );
        }
      }

      if (incoming.enabled !== undefined) {
        nextDaraja.enabled = incoming.enabled === true;
      }
      if (incoming.environment !== undefined) {
        if (!["sandbox", "production"].includes(incoming.environment)) {
          return res
            .status(400)
            .json({ error: "daraja.environment must be sandbox or production" });
        }
        nextDaraja.environment = incoming.environment;
      }
      if (incoming.shortcode !== undefined) {
        nextDaraja.shortcode = String(incoming.shortcode).trim().slice(0, 20);
      }
      if (incoming.transactionType !== undefined) {
        if (
          !["CustomerPayBillOnline", "CustomerBuyGoodsOnline"].includes(
            incoming.transactionType,
          )
        ) {
          return res.status(400).json({
            error:
              "daraja.transactionType must be CustomerPayBillOnline or CustomerBuyGoodsOnline",
          });
        }
        nextDaraja.transactionType = incoming.transactionType;
      }
      if (incoming.mpesaStkEnabled !== undefined) {
        nextDaraja.mpesaStkEnabled = incoming.mpesaStkEnabled === true;
      }

      // Secret fields: only re-encrypt if a non-empty string is provided.
      // Sending "" or null clears the field. Omitting the field keeps it.
      const secretFields = ["consumerKey", "consumerSecret", "passkey"];
      for (const field of secretFields) {
        if (incoming[field] === undefined) continue;
        if (incoming[field] === null || incoming[field] === "") {
          nextDaraja[field] = "";
          continue;
        }
        if (typeof incoming[field] !== "string") {
          return res
            .status(400)
            .json({ error: `daraja.${field} must be a string` });
        }
        nextDaraja[field] = secretBox.encrypt(incoming[field]);
      }

      // Generate a callback secret if enabling Daraja and none exists.
      const willBeEnabled = nextDaraja.enabled === true;
      if (willBeEnabled && !nextDaraja.callbackSecret) {
        nextDaraja.callbackSecret = secretBox.encrypt(
          require("crypto").randomBytes(32).toString("hex"),
        );
      }

      updateDoc.daraja = nextDaraja;
    }

    if (website !== undefined) {
      const current = org.website || {};

      // Only allow known keys — prevents accidentally writing arbitrary fields
      const allowed = [
        "subdomain",
        "domain",
        "domainVerified",
        "domainVerification",
        "published",
        "logoUrl",
        "faviconUrl",
        "tagline",
        "primaryColor",
        "accentColor",
        "headerLayout",
        "homepage",
        "announcement",
        "paymentMethods",
      ];

      const nextWebsite = { ...current };
      for (const key of allowed) {
        if (website[key] !== undefined) {
          nextWebsite[key] = website[key];
        }
      }

      // Homepage sections validation
      if (website.homepage !== undefined) {
        const sectionsResult = validateHomepageSections(website.homepage?.sections);
        if (!sectionsResult.ok) {
          return res.status(400).json({ error: sectionsResult.error });
        }
        nextWebsite.homepage = { sections: sectionsResult.sections };
      }

      // Site-wide announcement validation
      if (website.announcement !== undefined) {
        const raw = website.announcement || {};
        const text =
          typeof raw.text === "string" ? raw.text.slice(0, 200).trim() : "";
        const href =
          typeof raw.href === "string" ? raw.href.slice(0, 300).trim() : "";
        // Allow empty href; if non-empty, must start with / or http(s)://
        if (href && !/^\/|^https?:\/\//.test(href)) {
          return res.status(400).json({
            error:
              "announcement.href must start with '/' or 'http://' or 'https://'",
          });
        }
        nextWebsite.announcement = {
          text,
          href,
          isActive: raw.isActive !== false,
        };
      }

      // Payment methods — array of { key, label, icon, enabled, isDefault, custom }
      if (website.paymentMethods !== undefined) {
        if (!Array.isArray(website.paymentMethods)) {
          return res
            .status(400)
            .json({ error: "website.paymentMethods must be an array" });
        }
        if (website.paymentMethods.length > 20) {
          return res
            .status(400)
            .json({ error: "Maximum 20 payment methods" });
        }
        const seen = new Set();
        const cleaned = [];
        let defaultCount = 0;
        for (let i = 0; i < website.paymentMethods.length; i++) {
          const pm = website.paymentMethods[i];
          if (!pm || typeof pm !== "object") {
            return res
              .status(400)
              .json({ error: `paymentMethods[${i}] is not an object` });
          }
          const key =
            typeof pm.key === "string" ? pm.key.toLowerCase().trim() : "";
          if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
            return res.status(400).json({
              error: `paymentMethods[${i}].key must be lowercase alphanumeric with underscores, starting with a letter`,
            });
          }
          if (seen.has(key)) {
            return res
              .status(400)
              .json({ error: `paymentMethods key "${key}" is duplicated` });
          }
          seen.add(key);
          const label =
            typeof pm.label === "string" ? pm.label.trim().slice(0, 40) : "";
          if (!label) {
            return res
              .status(400)
              .json({ error: `paymentMethods[${i}].label is required` });
          }
          const icon =
            typeof pm.icon === "string" ? pm.icon.trim().slice(0, 300) : "";
          const isDefault = pm.isDefault === true;
          if (isDefault) defaultCount += 1;
          cleaned.push({
            key,
            label,
            icon,
            enabled: pm.enabled !== false,
            isDefault,
            custom: pm.custom === true,
          });
        }
        if (defaultCount > 1) {
          return res
            .status(400)
            .json({ error: "Only one payment method can be marked as default" });
        }
        nextWebsite.paymentMethods = cleaned;
      }

      // Validate color hex if provided
      const hexPattern = /^#[0-9a-fA-F]{6}$/;
      if (
        nextWebsite.primaryColor &&
        !hexPattern.test(nextWebsite.primaryColor)
      ) {
        return res.status(400).json({
          error: "primaryColor must be a 6-digit hex color (e.g. #111111)",
        });
      }
      if (
        nextWebsite.accentColor &&
        !hexPattern.test(nextWebsite.accentColor)
      ) {
        return res.status(400).json({
          error: "accentColor must be a 6-digit hex color (e.g. #2563eb)",
        });
      }

      // Validate headerLayout enum
      if (
        nextWebsite.headerLayout !== undefined &&
        !["centered", "left"].includes(nextWebsite.headerLayout)
      ) {
        return res.status(400).json({
          error: "headerLayout must be 'centered' or 'left'",
        });
      }

      // Validate subdomain if provided
      if (nextWebsite.subdomain !== undefined) {
        const clean = String(nextWebsite.subdomain).toLowerCase().trim();
        if (clean && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(clean)) {
          return res.status(400).json({
            error:
              "subdomain must be lowercase alphanumeric with hyphens, and cannot start or end with a hyphen",
          });
        }
        nextWebsite.subdomain = clean;
      }

      // Validate domain if provided (loose — full validation at verification time)
      if (nextWebsite.domain !== undefined) {
        const clean = String(nextWebsite.domain).toLowerCase().trim();
        if (clean && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
          return res.status(400).json({
            error: "domain is not a valid hostname",
          });
        }
        nextWebsite.domain = clean;
      }

      updateDoc.website = nextWebsite;
    }

    const updatedOrg = await Organization.findByIdAndUpdate(
      req.params.organizationId,
      updateDoc,
      { new: true, runValidators: true },
    );

    await logTokenEvent(
      req.user.userId,
      req.params.organizationId,
      "org_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Organization updated: ${org.name}`,
      },
    );

    return res.status(200).json({
      message: "Organization updated successfully",
      organization: updatedOrg,
    });
  } catch (error) {
    console.error("Error updating organization:", error);
    return res.status(500).json({ error: "Failed to update organization" });
  }
});

/**
 * Add a custom domain via Vercel.
 * POST /organizations/:organizationId/website/domain
 * Body: { domain: "shop.example.com" }
 *
 * On Vercel success: saves website.domain + DNS hints, domainVerified=false.
 * On Vercel failure: still saves website.domain so the user can configure
 *   manually, and surfaces the error alongside DNS hints we can compute
 *   locally.
 */
router.post("/:organizationId/website/domain", verifyToken, async (req, res) => {
  try {
    const { domain } = req.body || {};

    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership || !["Owner", "Manager"].includes(membership.role)) {
      return res.status(403).json({
        error: "Only Owner or Manager can manage domains",
      });
    }

    const clean = String(domain || "").toLowerCase().trim();
    if (!clean) {
      return res.status(400).json({ error: "domain is required" });
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
      return res.status(400).json({ error: "domain is not a valid hostname" });
    }
    if (clean.endsWith("flexisolutions.tech")) {
      return res.status(400).json({
        error:
          "Use the Subdomain field for *.flexisolutions.tech — the custom domain field is for external domains.",
      });
    }
    if (clean.endsWith(".vercel.app")) {
      return res.status(400).json({
        error: "vercel.app hostnames cannot be attached as custom domains.",
      });
    }

    const org = await Organization.findById(req.params.organizationId);
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    // Guard against another org already owning this domain
    const conflict = await Organization.findOne({
      "website.domain": clean,
      _id: { $ne: org._id },
    })
      .select("_id name website.subdomain")
      .lean();
    if (conflict) {
      return res.status(409).json({
        error: "That domain is already attached to another organization",
      });
    }

    let vercelState = null;
    let vercelError = null;

    if (vercel.isConfigured()) {
      try {
        vercelState = await vercel.addDomain(clean);
      } catch (err) {
        vercelError = err.message || "Vercel API error";
        console.error("[domains] Vercel addDomain failed:", vercelError);
      }
    } else {
      vercelError =
        "Vercel integration not configured on the server. Set VERCEL_API_TOKEN and STOREFRONT_PROJECT_ID, or configure the domain manually.";
    }

    // Merge the domain into the existing website doc
    const current = org.website || {};
    const nextWebsite = { ...current };
    nextWebsite.domain = clean;
    nextWebsite.domainVerified = vercelState?.verified === true;

    if (vercelState) {
      const txt = (vercelState.verification || []).find(
        (v) => v.type === "TXT",
      );
      nextWebsite.domainVerification = {
        txtName: txt?.domain || "",
        txtValue: txt?.value || "",
        cnameTarget: vercelState.cnameTarget || "",
        lastCheckedAt: new Date(),
        error: "",
      };
    } else {
      // Manual fallback — we can't ask Vercel for the exact TXT challenge.
      // Provide the well-known verification CNAME target so the customer
      // can at least point DNS correctly; verification will require an
      // admin follow-up once Vercel is configured.
      nextWebsite.domainVerification = {
        txtName: "",
        txtValue: "",
        cnameTarget: "cname.vercel-dns-0.com",
        lastCheckedAt: new Date(),
        error: vercelError || "",
      };
    }

    const updated = await Organization.findByIdAndUpdate(
      req.params.organizationId,
      { website: nextWebsite },
      { new: true, runValidators: true },
    );

    await logTokenEvent(
      req.user.userId,
      req.params.organizationId,
      "domain_added",
      req.ip,
      req.get("user-agent"),
      { details: `Added domain ${clean}${vercelError ? " (manual fallback)" : ""}` },
    );

    return res.status(200).json({
      message: vercelError
        ? "Domain saved. Configure DNS manually — automatic verification is unavailable."
        : "Domain added. Configure DNS to complete verification.",
      organization: updated,
      vercelError,
    });
  } catch (error) {
    console.error("Error adding domain:", error);
    return res.status(500).json({ error: "Failed to add domain" });
  }
});

/**
 * Check verification status against Vercel.
 * GET /organizations/:organizationId/website/domain/status
 */
router.get(
  "/:organizationId/website/domain/status",
  verifyToken,
  async (req, res) => {
    try {
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();
      if (!membership) {
        return res.status(403).json({ error: "No access to this organization" });
      }

      const org = await Organization.findById(req.params.organizationId);
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      const domain = org.website?.domain;
      if (!domain) {
        return res.status(400).json({ error: "No custom domain set" });
      }

      if (!vercel.isConfigured()) {
        return res.status(200).json({
          verified: false,
          error: "Vercel integration not configured on the server.",
          domainVerification: org.website?.domainVerification || null,
        });
      }

      let state;
      try {
        state = await vercel.verifyDomain(domain);
      } catch (err) {
        return res.status(502).json({
          error: err.message || "Failed to check domain status with Vercel",
        });
      }

      const current = org.website || {};
      const nextWebsite = { ...current };
      nextWebsite.domainVerified = state.verified === true;
      const txt = (state.verification || []).find((v) => v.type === "TXT");
      nextWebsite.domainVerification = {
        txtName: txt?.domain || current.domainVerification?.txtName || "",
        txtValue: txt?.value || current.domainVerification?.txtValue || "",
        cnameTarget:
          state.cnameTarget ||
          current.domainVerification?.cnameTarget ||
          "cname.vercel-dns-0.com",
        lastCheckedAt: new Date(),
        error: state.error || "",
      };

      await Organization.findByIdAndUpdate(
        req.params.organizationId,
        { website: nextWebsite },
        { runValidators: true },
      );

      return res.status(200).json({
        verified: state.verified === true,
        domainVerification: nextWebsite.domainVerification,
      });
    } catch (error) {
      console.error("Error checking domain status:", error);
      return res.status(500).json({ error: "Failed to check domain status" });
    }
  },
);

/**
 * Remove the custom domain.
 * DELETE /organizations/:organizationId/website/domain
 */
router.delete(
  "/:organizationId/website/domain",
  verifyToken,
  async (req, res) => {
    try {
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();
      if (!membership || !["Owner", "Manager"].includes(membership.role)) {
        return res
          .status(403)
          .json({ error: "Only Owner or Manager can remove domains" });
      }

      const org = await Organization.findById(req.params.organizationId);
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      const domain = org.website?.domain;
      if (!domain) {
        return res.status(400).json({ error: "No custom domain to remove" });
      }

      let vercelError = null;
      if (vercel.isConfigured()) {
        try {
          await vercel.removeDomain(domain);
        } catch (err) {
          vercelError = err.message || "Vercel API error";
          console.error("[domains] Vercel removeDomain failed:", vercelError);
        }
      }

      const current = org.website || {};
      const nextWebsite = {
        ...current,
        domain: "",
        domainVerified: false,
        domainVerification: {
          txtName: "",
          txtValue: "",
          cnameTarget: "",
          lastCheckedAt: null,
          error: "",
        },
      };

      const updated = await Organization.findByIdAndUpdate(
        req.params.organizationId,
        { website: nextWebsite },
        { new: true, runValidators: true },
      );

      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "domain_removed",
        req.ip,
        req.get("user-agent"),
        { details: `Removed domain ${domain}` },
      );

      return res.status(200).json({
        message: vercelError
          ? "Domain removed locally, but Vercel API call failed. Remove it from the Vercel dashboard manually."
          : "Domain removed.",
        organization: updated,
        vercelError,
      });
    } catch (error) {
      console.error("Error removing domain:", error);
      return res.status(500).json({ error: "Failed to remove domain" });
    }
  },
);

/**
 * Invite user to organization
 * POST /organizations/:organizationId/invite
 */
router.post("/:organizationId/invite", verifyToken, async (req, res) => {
  try {
    const { email, role = "Employee", locations = [] } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify user has permission to invite (Owner/Manager or MANAGE_USERS permission)
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    const hasPermission = membership && 
      (["Owner", "Manager"].includes(membership.role) || 
       membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

    if (!hasPermission) {
      return res.status(403).json({
        error: "You don't have permission to invite users",
      });
    }

    const org = await Organization.findById(req.params.organizationId);
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    // Validate locations if provided
    if (locations.length > 0) {
      const Location = require("../models/Location");
      const validLocations = await Location.countDocuments({
        _id: { $in: locations },
        organizationId: req.params.organizationId,
      });

      if (validLocations !== locations.length) {
        return res
          .status(400)
          .json({ error: "One or more location IDs are invalid" });
      }
    }

    // Check if user already member
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      const existingMembership = await UserOrganization.findOne({
        userId: existingUser._id,
        organizationId: req.params.organizationId,
      });

      if (existingMembership) {
        return res.status(409).json({
          error: "User is already a member of this organization",
        });
      }
    }

    // Check for pending invitation
    const existingInvite = await Invitation.findOne({
      email: email.toLowerCase(),
      organizationId: req.params.organizationId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (existingInvite) {
      return res.status(409).json({
        error: "An invitation is already pending for this email",
      });
    }

    // Create invitation
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

    // Use live role permissions for invitations
    const permissions = await getMembershipPermissionsForRole(role);

    const invitation = new Invitation({
      organizationId: req.params.organizationId,
      email: email.toLowerCase(),
      role,
      permissions,
      locations,
      invitedBy: req.user.userId,
      token,
      expiresAt,
    });

    await invitation.save();

    // Send invitation email with accept URL
    const inviter = await User.findById(req.user.userId).lean();
    const invitationUrl = `${process.env.CLIENT_URL}/auth/signup?invitation=${encodeURIComponent(token)}`;
    await sendOrganizationInvitation(
      email,
      inviter.fullname,
      org.name,
      role,
      invitationUrl,
    );

    await logTokenEvent(
      req.user.userId,
      req.params.organizationId,
      "user_invited",
      req.ip,
      req.get("user-agent"),
      {
        details: `Invited ${email} to organization`,
      },
    );

    return res.status(201).json({
      message: "Invitation sent successfully",
      invitation: {
        _id: invitation._id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error inviting user:", error);
    return res.status(500).json({ error: "Failed to send invitation" });
  }
});

/**
 * Get organization invitations
 * GET /organizations/:organizationId/invitations
 */
router.get("/:organizationId/invitations", verifyToken, async (req, res) => {
  try {
    const { status } = req.query;

    // Verify user has permission
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    const hasPermission = membership && 
      (["Owner", "Manager"].includes(membership.role) || 
       membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

    if (!hasPermission) {
      return res.status(403).json({
        error: "You don't have permission to view invitations",
      });
    }

    // Build query
    const query = { organizationId: req.params.organizationId };

    // Handle status filter
    if (status && status !== "all") {
      if (status === "expired") {
        // Get pending invitations that have expired
        query.status = "pending";
        query.expiresAt = { $lt: new Date() };
      } else {
        query.status = status;
      }
    }

    // Fetch invitations
    const invitations = await Invitation.find(query)
      .populate("invitedBy", "fullname email")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      invitations,
    });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    return res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

/**
 * Revoke an invitation
 * DELETE /organizations/:organizationId/invitations/:invitationId
 */
router.delete(
  "/:organizationId/invitations/:invitationId",
  verifyToken,
  async (req, res) => {
    try {
      const mongoose = require("mongoose");

      // Validate invitationId format
      if (!mongoose.isValidObjectId(req.params.invitationId)) {
        return res.status(400).json({ error: "Invalid invitation ID" });
      }

      // Verify user has permission
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      const hasPermission = membership && 
        (["Owner", "Manager"].includes(membership.role) || 
         membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

      if (!hasPermission) {
        return res.status(403).json({
          error: "You don't have permission to revoke invitations",
        });
      }

      // Find invitation
      const invitation = await Invitation.findOne({
        _id: req.params.invitationId,
        organizationId: req.params.organizationId,
      });

      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      // Can only revoke pending invitations
      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: `Cannot revoke ${invitation.status} invitation`,
        });
      }

      // Update status to revoked
      invitation.status = "revoked";
      await invitation.save();

      // Log audit event
      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "invitation_revoked",
        req.ip,
        req.get("user-agent"),
        {
          details: `Revoked invitation for ${invitation.email} with role ${invitation.role}`,
        },
      );

      return res.status(200).json({
        message: "Invitation revoked successfully",
        invitation,
      });
    } catch (error) {
      console.error("Error revoking invitation:", error);
      return res.status(500).json({ error: "Failed to revoke invitation" });
    }
  },
);

/**
 * Resend an invitation
 * POST /organizations/:organizationId/invitations/:invitationId/resend
 */
router.post(
  "/:organizationId/invitations/:invitationId/resend",
  verifyToken,
  async (req, res) => {
    try {
      const mongoose = require("mongoose");

      // Validate invitationId format
      if (!mongoose.isValidObjectId(req.params.invitationId)) {
        return res.status(400).json({ error: "Invalid invitation ID" });
      }

      // Verify user has permission
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      const hasPermission = membership && 
        (["Owner", "Manager"].includes(membership.role) || 
         membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

      if (!hasPermission) {
        return res.status(403).json({
          error: "You don't have permission to resend invitations",
        });
      }

      // Find invitation
      const invitation = await Invitation.findOne({
        _id: req.params.invitationId,
        organizationId: req.params.organizationId,
      });

      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      // Can only resend pending invitations
      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: `Cannot resend ${invitation.status} invitation`,
        });
      }

      // Extend expiry by 7 days
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);
      invitation.expiresAt = newExpiresAt;
      await invitation.save();

      // Get organization and inviter details
      const org = await Organization.findById(req.params.organizationId);
      const inviter = await User.findById(invitation.invitedBy).lean();

      // Send invitation email
      const invitationUrl = `${process.env.CLIENT_URL}/auth/signup?invitation=${encodeURIComponent(invitation.token)}`;
      await sendOrganizationInvitation(
        invitation.email,
        inviter?.fullname || "Team member",
        org.name,
        invitation.role,
        invitationUrl,
      );

      // Log audit event
      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "invitation_resent",
        req.ip,
        req.get("user-agent"),
        {
          details: `Resent invitation to ${invitation.email}`,
        },
      );

      return res.status(200).json({
        message: "Invitation resent successfully",
        invitation,
      });
    } catch (error) {
      console.error("Error resending invitation:", error);
      return res.status(500).json({ error: "Failed to resend invitation" });
    }
  },
);

/**
 * Get organization members
 * GET /organizations/:organizationId/members
 */
router.get("/:organizationId/members", verifyToken, async (req, res) => {
  try {
    // Verify user has access
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership) {
      return res.status(403).json({ error: "No access to this organization" });
    }

    const members = await UserOrganization.find({
      organizationId: req.params.organizationId,
      status: "active",
    })
      .populate("userId", "fullname email")
      .lean();

    const cleanedMembers = members
      .filter((m) => m.userId) // skip records where user is missing
      .map((m) => ({
        userId: m.userId._id,
        fullname: m.userId.fullname,
        email: m.userId.email,
        role: m.role,
        joinedAt: m.joinedAt,
      }));

    return res.status(200).json({
      members: cleanedMembers,
    });
  } catch (error) {
    console.error("Error fetching members:", error);
    return res.status(500).json({ error: "Failed to fetch members" });
  }
});

/**
 * Remove member from organization
 * DELETE /organizations/:organizationId/members/:userId
 */
router.delete(
  "/:organizationId/members/:userId",
  verifyToken,
  async (req, res) => {
    try {
      // Verify user is owner/manager
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      if (!membership || !["Owner", "Manager"].includes(membership.role)) {
        return res.status(403).json({
          error: "Only Owner or Manager can remove members",
        });
      }

      // Cannot remove owner
      const targetMembership = await UserOrganization.findOne({
        userId: req.params.userId,
        organizationId: req.params.organizationId,
      });

      if (targetMembership.role === "Owner") {
        return res.status(400).json({
          error: "Cannot remove organization owner",
        });
      }

      await UserOrganization.updateOne(
        {
          userId: req.params.userId,
          organizationId: req.params.organizationId,
        },
        { status: "inactive" },
      );

      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "member_removed",
        req.ip,
        req.get("user-agent"),
        {
          details: `Removed user from organization`,
        },
      );

      return res.status(200).json({
        message: "Member removed successfully",
      });
    } catch (error) {
      console.error("Error removing member:", error);
      return res.status(500).json({ error: "Failed to remove member" });
    }
  },
);

/**
 * Update member's assigned locations
 * PUT /organizations/:organizationId/members/:userId/locations
 */
router.put(
  "/:organizationId/members/:userId/locations",
  verifyToken,
  async (req, res) => {
    try {
      const { locations = [] } = req.body;

      // Verify user is owner/manager
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      if (!membership || !["Owner", "Manager"].includes(membership.role)) {
        return res.status(403).json({
          error: "Only Owner or Manager can assign locations",
        });
      }

      // Validate locations if provided
      if (locations.length > 0) {
        const Location = require("../models/Location");
        const validLocations = await Location.countDocuments({
          _id: { $in: locations },
          organizationId: req.params.organizationId,
        });

        if (validLocations !== locations.length) {
          return res
            .status(400)
            .json({ error: "One or more location IDs are invalid" });
        }
      }

      // Update user's locations
      const targetMembership = await UserOrganization.findOneAndUpdate(
        {
          userId: req.params.userId,
          organizationId: req.params.organizationId,
        },
        { locations },
        { new: true },
      );

      if (!targetMembership) {
        return res.status(404).json({ error: "Member not found" });
      }

      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "member_locations_updated",
        req.ip,
        req.get("user-agent"),
        {
          details: `Updated location assignments for user ${req.params.userId}`,
        },
      );

      return res.status(200).json({
        message: "Locations updated successfully",
        locations: targetMembership.locations,
      });
    } catch (error) {
      console.error("Error updating locations:", error);
      return res.status(500).json({ error: "Failed to update locations" });
    }
  },
);

/**
 * GET /organizations/:organizationId/daraja/callback-url
 * Return the full callback URL (with decrypted secret) for the admin to
 * paste into Safaricom's Daraja portal. This is the only endpoint that
 * decrypts the callback secret; all other reads are masked.
 */
router.get(
  "/:organizationId/daraja/callback-url",
  verifyToken,
  async (req, res) => {
    try {
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();
      if (!membership || !["Owner", "Manager"].includes(membership.role)) {
        return res.status(403).json({
          error: "Only Owner or Manager can view Daraja callback URL",
        });
      }

      const org = await Organization.findById(req.params.organizationId)
        .select("daraja.callbackSecret")
        .lean();

      if (!org?.daraja?.callbackSecret) {
        return res.status(404).json({
          error: "No callback secret set. Enable Daraja first.",
        });
      }

      let secret;
      try {
        secret = secretBox.decrypt(org.daraja.callbackSecret);
      } catch (e) {
        return res.status(500).json({
          error: "Failed to decrypt callback secret. Re-enable Daraja.",
        });
      }

      const apiUrl = process.env.PUBLIC_API_URL || "";
      const url = apiUrl
        ? `${apiUrl}/storefront/mpesa/callback?key=${encodeURIComponent(secret)}`
        : "";

      return res.status(200).json({ url, hasApiUrl: Boolean(apiUrl) });
    } catch (error) {
      console.error("Get Daraja callback URL error:", error);
      return res.status(500).json({ error: "Failed to generate callback URL" });
    }
  },
);

module.exports = router;
