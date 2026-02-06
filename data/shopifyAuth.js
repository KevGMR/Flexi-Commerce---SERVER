const axios = require("axios");
const ShopifySyncLog = require('../models/ShopifySyncLog');

// Per-organization token cache: Map<organizationId, {token, expiresAt}>
const tokenCache = new Map();

/**
 * Get Shopify access token using client credentials grant (OAuth 2.0)
 * Tokens are cached per organization with 60-second expiry buffer
 * 
 * @param {string} storeUrl - Shopify store URL (e.g., "mystore.myshopify.com")
 * @param {string} clientId - Shopify app client ID
 * @param {string} clientSecret - Shopify app client secret
 * @param {string} organizationId - Organization ID for caching and logging
 * @returns {Promise<{accessToken: string, expiresAt: Date}>}
 */
async function getAccessToken(storeUrl, clientId, clientSecret, organizationId) {
  const now = Date.now();
  const orgId = organizationId.toString();

  // Check cache first (with 60-second buffer)
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

    // Update cache
    tokenCache.set(orgId, {
      token: data.access_token,
      expiresAt,
    });

    // Log successful token refresh
    await ShopifySyncLog.create({
      organizationId,
      syncType: 'token_refresh',
      status: 'success',
      requestPayload: { storeUrl, clientId: clientId.substring(0, 8) + '***' },
      responsePayload: { expiresIn: data.expires_in, scope: data.scope },
      duration: Date.now() - now,
    }).catch(err => console.error('Failed to log token refresh:', err));

    console.log(`[Shopify Auth] Token refreshed for org ${orgId}, expires in ${data.expires_in}s`);

    return {
      accessToken: data.access_token,
      expiresAt: new Date(expiresAt),
    };
  } catch (error) {
    console.error(`[Shopify Auth] Token refresh failed for org ${orgId}:`, error.message);
    
    // Log failure
    await ShopifySyncLog.create({
      organizationId,
      syncType: 'token_refresh',
      status: 'failed',
      requestPayload: { storeUrl, clientId: clientId.substring(0, 8) + '***' },
      responsePayload: { error: error.message },
      duration: Date.now() - now,
    }).catch(err => console.error('Failed to log token refresh error:', err));

    throw error;
  }
}

/**
 * Clear cached token for an organization (useful when disconnecting)
 */
function clearTokenCache(organizationId) {
  tokenCache.delete(organizationId.toString());
}

module.exports = { getAccessToken, clearTokenCache };
