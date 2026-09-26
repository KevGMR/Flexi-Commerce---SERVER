const axios = require("axios");
const ShopifySyncLog = require("../models/ShopifySyncLog");

// Per-organization token cache: Map<organizationId, {token, expiresAt}>
const tokenCache = new Map();

const ENV_CACHE_KEY = "__env__";

/**
 * Get Shopify access token using client credentials grant (OAuth 2.0)
 * Tokens are cached per organization (or per "__env__") with 60s buffer.
 */
async function getAccessToken(storeUrl, clientId, clientSecret, organizationId) {
  const now = Date.now();
  const orgId = String(organizationId);

  const cached = tokenCache.get(orgId);
  if (cached && now < cached.expiresAt - 60_000) {
    return {
      accessToken: cached.token,
      expiresAt: new Date(cached.expiresAt),
    };
  }

  try {
    const url = `https://${storeUrl}/admin/oauth/access_token`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const { data } = await axios.post(url, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const expiresAt = now + data.expires_in * 1000;

    tokenCache.set(orgId, {
      token: data.access_token,
      expiresAt,
    });

    // Only log org-scoped refreshes — env refreshes are not tied to a Mongo org
    if (orgId !== ENV_CACHE_KEY) {
      await ShopifySyncLog.create({
        organizationId,
        syncType: "token_refresh",
        status: "success",
        requestPayload: { storeUrl, clientId: clientId.substring(0, 8) + "***" },
        responsePayload: { expiresIn: data.expires_in, scope: data.scope },
        duration: Date.now() - now,
      }).catch((err) => console.error("Failed to log token refresh:", err));
    }

    console.log(
      `[Shopify Auth] Token refreshed for ${orgId === ENV_CACHE_KEY ? "env store" : "org " + orgId}, expires in ${data.expires_in}s`,
    );

    return {
      accessToken: data.access_token,
      expiresAt: new Date(expiresAt),
    };
  } catch (error) {
    console.error(
      `[Shopify Auth] Token refresh failed for ${orgId === ENV_CACHE_KEY ? "env store" : "org " + orgId}:`,
      error.message,
    );

    if (orgId !== ENV_CACHE_KEY) {
      await ShopifySyncLog.create({
        organizationId,
        syncType: "token_refresh",
        status: "failed",
        requestPayload: { storeUrl, clientId: clientId.substring(0, 8) + "***" },
        responsePayload: { error: error.message },
        duration: Date.now() - now,
      }).catch((err) => console.error("Failed to log token refresh error:", err));
    }

    throw error;
  }
}

/**
 * Get a token for the env-configured store.
 * Uses DOMAIN + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET from .env.
 * Cached under a fixed key so it's refreshed once per process lifetime.
 */
async function getEnvAccessToken() {
  const storeUrl = process.env.DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!storeUrl || !clientId || !clientSecret) {
    const err = new Error(
      "Env Shopify credentials missing: DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET required",
    );
    err.code = "ENV_SHOPIFY_CREDENTIALS_MISSING";
    throw err;
  }

  return getAccessToken(storeUrl, clientId, clientSecret, ENV_CACHE_KEY);
}

/**
 * Clear cached token for an organization (or the env store).
 */
function clearTokenCache(organizationId) {
  tokenCache.delete(String(organizationId));
}

module.exports = { getAccessToken, getEnvAccessToken, clearTokenCache, ENV_CACHE_KEY };