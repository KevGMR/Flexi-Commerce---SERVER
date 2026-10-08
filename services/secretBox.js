const crypto = require("crypto");

/**
 * AES-256-GCM symmetric encryption for secrets at rest.
 *
 * Storage format (single string, safe for Mongo):
 *   v1:<iv_base64>:<ciphertext_base64>:<authTag_base64>
 *
 * The "v1:" prefix is a format version. If we ever rotate algorithms,
 * old values can still be decrypted by branching on the prefix.
 *
 * Env: APP_ENCRYPTION_KEY  (32-byte key, base64-encoded)
 *      Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const PREFIX = "v1";
const KEY_ENV = "APP_ENCRYPTION_KEY";

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Generate one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  let key;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${KEY_ENV} is not valid base64`);
  }

  if (key.length !== 32) {
    throw new Error(
      `${KEY_ENV} must decode to exactly 32 bytes (got ${key.length}). ` +
        `Generate a new one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Encrypt a plaintext string. Returns a single string with prefix + parts.
 * Returns null/undefined unchanged so you can round-trip optional fields.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (typeof plaintext !== "string") {
    throw new Error("secretBox.encrypt expects a string");
  }
  if (plaintext === "") return "";

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a value previously produced by encrypt().
 * Returns null for null/undefined; "" for "".
 * Throws on tampered ciphertext or malformed input.
 */
function decrypt(payload) {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== "string") {
    throw new Error("secretBox.decrypt expects a string");
  }
  if (payload === "") return "";

  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("secretBox: malformed payload (expected 4 parts)");
  }

  const [version, ivB64, ctB64, tagB64] = parts;
  if (version !== PREFIX) {
    throw new Error(`secretBox: unsupported version "${version}"`);
  }

  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");

  if (iv.length !== IV_LENGTH) {
    throw new Error("secretBox: invalid IV length");
  }
  if (authTag.length !== 16) {
    throw new Error("secretBox: invalid auth tag length");
  }

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new Error("secretBox: decryption failed (tampered or wrong key)");
  }
}

/**
 * Convenience: encrypt an object's named fields in place, returning a new
 * object. Useful when persisting a "daraja" subdocument.
 *
 *   const safe = encryptFields(payload, ["consumerKey", "consumerSecret", "passkey"]);
 */
function encryptFields(obj, fields) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  for (const field of fields) {
    if (field in out) out[field] = encrypt(out[field]);
  }
  return out;
}

/**
 * Inverse of encryptFields.
 */
function decryptFields(obj, fields) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  for (const field of fields) {
    if (field in out) {
      try {
        out[field] = decrypt(out[field]);
      } catch {
        // Leave the raw value if it wasn't encrypted (e.g. legacy record)
        // so the caller can decide how to handle it.
      }
    }
  }
  return out;
}

/**
 * Quick health check for startup — call once on boot to fail fast if
 * APP_ENCRYPTION_KEY is missing or malformed.
 */
function selfTest() {
  const probe = `probe-${Date.now()}`;
  const enc = encrypt(probe);
  const dec = decrypt(enc);
  if (dec !== probe) {
    throw new Error("secretBox self-test failed: round-trip mismatch");
  }
  return true;
}

module.exports = {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields,
  selfTest,
  ENCRYPTED_FIELDS: Object.freeze([
    "consumerKey",
    "consumerSecret",
    "passkey",
  ]),
};