const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const RefreshToken = require("../models/RefreshToken");

// In-flight refresh request tracking for deduplication
const refreshLocks = new Map();
const LOCK_TTL = 100; // milliseconds

/**
 * Generate Access Token (JWT)
 * @param {String} userId - User ID
 * @param {String} role - User role
 * @param {Array} permissions - User permissions
 * @param {String} deviceId - Device ID
 * @param {String} organizationId - Organization ID (tenant context)
 * @returns {String} JWT access token
 */
const generateAccessToken = (userId, role, permissions, deviceId, organizationId) => {
  const expiryMinutes = parseInt(process.env.ACCESS_TOKEN_EXPIRY || "15");
  
  const payload = {
    userId,
    role,
    permissions,
    deviceId,
    organizationId,
    type: "access",
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: `${expiryMinutes}m`,
  });
};

/**
 * Generate Refresh Token
 * @param {String} userId - User ID
 * @param {String} deviceId - Device ID
 * @param {String} ipAddress - User IP address
 * @param {String} userAgent - User agent string
 * @param {String} organizationId - Organization ID (tenant context)
 * @param {String} deviceName - Optional device name
 * @returns {Object} { token, tokenDoc }
 */
const generateRefreshToken = async (
  userId,
  deviceId,
  ipAddress,
  userAgent,
  organizationId,
  deviceName = "Unknown Device"
) => {
  const expiryDays = parseInt(process.env.REFRESH_TOKEN_EXPIRY || "7");
  const requestId = crypto.randomBytes(16).toString("hex");
  
  // Generate random token
  const token = crypto.randomBytes(64).toString("hex");
  
  // Hash token for storage
  const hashedToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  const tokenDoc = new RefreshToken({
    token: hashedToken,
    userId,
    organizationId,
    deviceId,
    deviceName,
    ipAddress,
    userAgent,
    requestId,
    issuedAt: new Date(),
    expiresAt,
  });

  await tokenDoc.save();

  return { token, tokenDoc };
};

/**
 * Rotate Refresh Token with deduplication
 * @param {String} oldToken - Old refresh token
 * @param {String} userId - User ID
 * @param {Array} permissions - Updated permissions
 * @param {String} deviceId - Device ID
 * @param {String} ipAddress - IP address
 * @param {String} userAgent - User agent
 * @returns {Object} { accessToken, refreshToken, tokenDoc }
 */
const rotateRefreshToken = async (
  oldToken,
  userId,
  permissions,
  deviceId,
  ipAddress,
  userAgent
) => {
  // Deduplication lock key
  const lockKey = `${userId}:${deviceId}`;
  
  // Check if there's an in-flight request
  if (refreshLocks.has(lockKey)) {
    const existingLock = refreshLocks.get(lockKey);
    
    // If lock is still valid (within TTL), return cached result
    if (Date.now() - existingLock.timestamp < LOCK_TTL) {
      return existingLock.result;
    }
  }

  // Create promise for this refresh operation
  const refreshPromise = (async () => {
    // Hash the old token
    const hashedOldToken = crypto
      .createHash("sha256")
      .update(oldToken)
      .digest("hex");

    // Find old token
    const oldTokenDoc = await RefreshToken.findOne({
      token: hashedOldToken,
      userId,
      deviceId,
      revoked: false,
    });

    if (!oldTokenDoc) {
      throw new Error("Invalid refresh token");
    }

    // Check if expired
    if (oldTokenDoc.expiresAt < new Date()) {
      throw new Error("Refresh token expired");
    }

    // Revoke old token
    oldTokenDoc.revoked = true;
    oldTokenDoc.revokedAt = new Date();
    oldTokenDoc.revokedReason = "token_rotated";
    await oldTokenDoc.save();

    // Generate new refresh token
    const { token: newRefreshToken, tokenDoc: newTokenDoc } =
      await generateRefreshToken(
        userId,
        deviceId,
        ipAddress,
        userAgent,
        oldTokenDoc.organizationId,
        oldTokenDoc.deviceName
      );

    // Link to old token
    newTokenDoc.rotatedFrom = oldTokenDoc._id;
    await newTokenDoc.save();

    // Generate new access token
    const User = require("../models/User");
    const user = await User.findById(userId);
    
    const newAccessToken = generateAccessToken(
      userId,
      user.role,
      permissions,
      deviceId
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenDoc: newTokenDoc,
    };
  })();

  // Store in lock with timestamp
  refreshLocks.set(lockKey, {
    timestamp: Date.now(),
    result: refreshPromise,
  });

  // Clean up lock after TTL
  setTimeout(() => {
    refreshLocks.delete(lockKey);
  }, LOCK_TTL);

  return refreshPromise;
};

/**
 * Verify Access Token
 * @param {String} token - JWT access token
 * @returns {Object} Decoded token payload
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Access token expired");
    }
    throw new Error("Invalid access token");
  }
};

/**
 * Verify Refresh Token
 * @param {String} token - Refresh token
 * @returns {Object} Token document from database
 */
const verifyRefreshToken = async (token) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const tokenDoc = await RefreshToken.findOne({
    token: hashedToken,
    revoked: false,
  });

  if (!tokenDoc) {
    throw new Error("Invalid refresh token");
  }

  if (tokenDoc.expiresAt < new Date()) {
    throw new Error("Refresh token expired");
  }

  return tokenDoc;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
