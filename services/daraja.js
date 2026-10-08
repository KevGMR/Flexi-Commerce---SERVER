const axios = require("axios");
const crypto = require("crypto");

/**
 * Safaricom Daraja M-Pesa client.
 *
 * Per-org credentials are passed in on every call (extracted from the
 * Organization model after decrypting its daraja subdocument).
 *
 * No global state besides a small in-memory token cache keyed by
 * organizationId + environment.
 */

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

function baseUrlFor(environment) {
  return environment === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

// ---------------------------------------------------------------------------
// OAuth token cache
// ---------------------------------------------------------------------------

const tokenCache = new Map(); // key: `${orgId}:${env}` → { token, expiresAt }

function tokenCacheKey(organizationId, environment) {
  return `${String(organizationId)}:${environment}`;
}

async function getAccessToken({ organizationId, environment, consumerKey, consumerSecret }) {
  const key = tokenCacheKey(organizationId, environment);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const url = `${baseUrlFor(environment)}/oauth/v1/generate?grant_type=client_credentials`;

  const res = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 15_000,
  });

  const token = res.data?.access_token;
  const expiresIn = Number(res.data?.expires_in) || 3599;

  if (!token) {
    throw new Error("Daraja: no access_token in OAuth response");
  }

  tokenCache.set(key, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return token;
}

/**
 * Invalidate a cached token — call after a 401 so the next request re-fetches.
 */
function invalidateToken(organizationId, environment) {
  tokenCache.delete(tokenCacheKey(organizationId, environment));
}

// ---------------------------------------------------------------------------
// STK password + timestamp
// ---------------------------------------------------------------------------

/**
 * Daraja requires the password to be base64(shortcode + passkey + timestamp)
 * where timestamp is YYYYMMDDHHmmss in East Africa Time (UTC+3).
 */
function generateStkPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/**
 * Generates the Daraja timestamp string in EAT (UTC+3), no DST.
 */
function generateTimestamp(date = new Date()) {
  // Shift to EAT, then format in UTC components.
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    String(eat.getUTCFullYear()) +
    pad(eat.getUTCMonth() + 1) +
    pad(eat.getUTCDate()) +
    pad(eat.getUTCHours()) +
    pad(eat.getUTCMinutes()) +
    pad(eat.getUTCSeconds())
  );
}

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

/**
 * Daraja expects MSISDN in the format 2547XXXXXXXX or 2541XXXXXXXX (12 digits).
 * Accepts: 07XXXXXXXX, 01XXXXXXXX, +254..., 254..., 00254...
 */
function normalizePhone(input) {
  if (!input) return null;
  let s = String(input).replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("0")) s = "254" + s.slice(1);
  if (s.startsWith("7") || s.startsWith("1")) s = "254" + s;
  if (!/^254\d{9}$/.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// STK Push
// ---------------------------------------------------------------------------

/**
 * Initiate an STK push.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.organizationId
 * @param {"sandbox"|"production"} params.environment
 * @param {string} params.consumerKey       (decrypted)
 * @param {string} params.consumerSecret    (decrypted)
 * @param {string} params.shortcode         e.g. "174379"
 * @param {string} params.passkey           (decrypted)
 * @param {string} params.phone             any format; normalized internally
 * @param {number} params.amount            integer KES
 * @param {string} params.accountReference  short string, shown on the STK prompt
 * @param {string} params.transactionDesc   short string
 * @param {string} params.callbackUrl       full public HTTPS URL
 *
 * @returns {Promise<{ checkoutRequestId, merchantRequestId, responseCode, responseDescription, customerMessage, raw }>}
 */
async function initiateStkPush({
  organizationId,
  environment,
  consumerKey,
  consumerSecret,
  shortcode,
  passkey,
  phone,
  amount,
  accountReference,
  transactionDesc,
  callbackUrl,
}) {
  if (!organizationId) throw new Error("daraja: organizationId required");
  if (!consumerKey || !consumerSecret) throw new Error("daraja: missing consumer credentials");
  if (!shortcode || !passkey) throw new Error("daraja: missing shortcode or passkey");
  if (!callbackUrl || !callbackUrl.startsWith("https://")) {
    throw new Error("daraja: callbackUrl must be https");
  }

  const msisdn = normalizePhone(phone);
  if (!msisdn) throw new Error(`daraja: invalid phone number "${phone}"`);

  const amountInt = Math.round(Number(amount));
  if (!Number.isFinite(amountInt) || amountInt <= 0) {
    throw new Error("daraja: amount must be a positive integer");
  }

  const timestamp = generateTimestamp();
  const password = generateStkPassword(shortcode, passkey, timestamp);

  const token = await getAccessToken({
    organizationId,
    environment,
    consumerKey,
    consumerSecret,
  });

  const url = `${baseUrlFor(environment)}/mpesa/stkpush/v1/processrequest`;

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amountInt,
    PartyA: msisdn,
    PartyB: shortcode,
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference || "Order").slice(0, 12),
    TransactionDesc: String(transactionDesc || "Payment").slice(0, 13),
  };

  let res;
  try {
    res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
  } catch (err) {
    // 401 → drop cached token so the next attempt re-fetches
    if (err?.response?.status === 401) {
      invalidateToken(organizationId, environment);
    }
    const detail = err?.response?.data || err.message;
    const wrapped = new Error(
      `daraja STK push failed: ${
        typeof detail === "object" ? JSON.stringify(detail) : detail
      }`,
    );
    wrapped.raw = err?.response?.data;
    wrapped.status = err?.response?.status;
    throw wrapped;
  }

  const data = res.data || {};

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    responseCode: data.ResponseCode,
    responseDescription: data.ResponseDescription,
    customerMessage: data.CustomerMessage,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Callback payload parsing
// ---------------------------------------------------------------------------

/**
 * Normalize the STK callback body into a flat shape we can act on.
 *
 * Shape of a typical callback:
 *   { Body: { stkCallback: {
 *       MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc,
 *       CallbackMetadata: { Item: [{ Name, Value }, ...] }
 *   }}}
 */
function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb) {
    return { ok: false, error: "Missing Body.stkCallback" };
  }

  const resultCode = Number(cb.ResultCode);
  const items = Array.isArray(cb.CallbackMetadata?.Item)
    ? cb.CallbackMetadata.Item
    : [];

  const meta = {};
  for (const item of items) {
    if (item?.Name) meta[item.Name] = item.Value;
  }

  return {
    ok: resultCode === 0,
    resultCode,
    resultDesc: cb.ResultDesc || "",
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    amount: meta.Amount,
    mpesaReceiptNumber: meta.MpesaReceiptNumber,
    transactionDate: meta.TransactionDate, // numeric YYYYMMDDHHmmss
    phoneNumber: meta.PhoneNumber,
    raw: body,
  };
}

module.exports = {
  getAccessToken,
  initiateStkPush,
  parseStkCallback,
  normalizePhone,
  generateStkPassword,
  generateTimestamp,
};