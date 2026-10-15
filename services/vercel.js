// server/services/vercel.js
//
// Thin wrapper over the Vercel REST API for attaching/removing custom
// domains on the storefront project. Single shared token — this server
// owns one storefront Vercel project that all tenants point at.
//
// Env vars required:
//   VERCEL_API_TOKEN      — https://vercel.com/account/tokens
//   STOREFRONT_PROJECT_ID — Vercel project → Settings → General → Project ID

const axios = require("axios");

const BASE = "https://api.vercel.com";
const TIMEOUT_MS = 12000;

function requireEnv() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.STOREFRONT_PROJECT_ID;
  if (!token || !projectId) {
    const missing = [];
    if (!token) missing.push("VERCEL_API_TOKEN");
    if (!projectId) missing.push("STOREFRONT_PROJECT_ID");
    const err = new Error(
      `Vercel integration not configured (missing: ${missing.join(", ")})`,
    );
    err.code = "VERCEL_NOT_CONFIGURED";
    throw err;
  }
  return { token, projectId };
}

function client() {
  const { token } = requireEnv();
  return axios.create({
    baseURL: BASE,
    timeout: TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Normalize a Vercel domain response into our shape.
 * Vercel returns different shapes for add vs get; we only care about
 * verification, cname target, and error state.
 */
function normalizeDomain(d, projectDomainName) {
  const verification = (d.verification || []).map((v) => ({
    type: v.type,
    domain: v.domain,
    value: v.value,
    reason: v.reason,
  }));

  // Vercel's canonical CNAME for a project domain is "<project>.vercel.app"
  // but for custom domains on our project it's the cname target they
  // return in `cname` or fall back to the well-known value.
  const cnameTarget =
    d.cname ||
    d.configuredBy === "CNAME" && d.cnameTarget ||
    "cname.vercel-dns-0.com";

  return {
    name: d.name || projectDomainName,
    verified: d.verified === true,
    verification,
    cnameTarget,
    error: d.error || null,
  };
}

/**
 * Add a domain to the storefront project.
 * Returns { verified, verification: [{type,domain,value}], cnameTarget, error }
 * Throws on network/config errors; caller catches and falls back to manual.
 */
async function addDomain(domain) {
  const { projectId } = requireEnv();
  const c = client();
  try {
    const res = await c.post(
      `/v10/projects/${projectId}/domains`,
      { name: domain },
    );
    return normalizeDomain(res.data, domain);
  } catch (err) {
    // 409 = already exists on the project; treat as success and fetch state
    if (err.response?.status === 409) {
      return getDomain(domain);
    }
    const msg =
      err.response?.data?.error?.message ||
      err.message ||
      "Failed to add domain on Vercel";
    const e = new Error(msg);
    e.status = err.response?.status;
    e.code = err.response?.data?.error?.code;
    throw e;
  }
}

/**
 * Get current state of a domain on the project.
 */
async function getDomain(domain) {
  const { projectId } = requireEnv();
  const c = client();
  const res = await c.get(
    `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
  );
  return normalizeDomain(res.data, domain);
}

/**
 * Ask Vercel to re-verify a domain (polls DNS).
 * Returns updated state; never throws on "not yet verified" — only on
 * network/config errors.
 */
async function verifyDomain(domain) {
  const { projectId } = requireEnv();
  const c = client();
  try {
    const res = await c.post(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify`,
    );
    return normalizeDomain(res.data, domain);
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 409) {
      // Verification still pending — return current state instead
      return getDomain(domain);
    }
    throw err;
  }
}

/**
 * Remove a domain from the project.
 * Idempotent: 404 is treated as success.
 */
async function removeDomain(domain) {
  const { projectId } = requireEnv();
  const c = client();
  try {
    await c.delete(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
    );
    return { removed: true };
  } catch (err) {
    if (err.response?.status === 404) return { removed: true };
    throw err;
  }
}

function isConfigured() {
  return Boolean(
    process.env.VERCEL_API_TOKEN && process.env.STOREFRONT_PROJECT_ID,
  );
}

module.exports = {
  addDomain,
  getDomain,
  verifyDomain,
  removeDomain,
  isConfigured,
};