const { verifyAccessToken, verifyRefreshToken } = require("../utils/tokenManager");
const { logTokenEvent } = require("../services/auditLogger");

/**
 * Verify JWT Access Token Middleware
 */
const verifyToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Access denied. No token provided.",
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      permissions: decoded.permissions || [],
      deviceId: decoded.deviceId,
      organizationId: decoded.organizationId,
    };

    next();
  } catch (error) {
    if (error.message === "Access token expired") {
      return res.status(401).json({
        error: "Access token expired",
        code: "TOKEN_EXPIRED",
      });
    }

    return res.status(401).json({
      error: "Invalid token",
    });
  }
};

/**
 * Verify Refresh Token from Cookie Middleware
 */
const verifyRefreshTokenMiddleware = async (req, res, next) => {
  try {
    // Get refresh token from cookie
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        error: "No refresh token provided",
        code: "REFRESH_TOKEN_MISSING",
      });
    }

    // Verify refresh token
    const tokenDoc = await verifyRefreshToken(refreshToken);

    // Attach token info to request
    req.refreshTokenDoc = tokenDoc;
    req.refreshToken = refreshToken;

    next();
  } catch (error) {
    // Log attempted use of invalid/revoked token
    await logTokenEvent(
      null,
      null,
      "attempted_use_revoked_token",
      req.ip,
      req.get("user-agent"),
      {
        details: error.message,
      }
    );

    return res.status(401).json({
      error: error.message,
      code: error.message === "Refresh token expired"
        ? "REFRESH_TOKEN_EXPIRED"
        : "REFRESH_TOKEN_INVALID",
    });
  }
};

/**
 * Extract and validate Device ID from request headers
 */
const extractDeviceId = (req, res, next) => {
  // Try to get device ID from header
  const deviceId = req.headers["x-device-id"];

  if (!deviceId) {
    return res.status(400).json({
      error: "Device ID is required. Please include X-Device-ID header.",
      code: "DEVICE_ID_REQUIRED",
    });
  }

  // Validate device ID format (should be UUID or similar)
  if (deviceId.length < 10 || deviceId.length > 100) {
    return res.status(400).json({
      error: "Invalid device ID format",
      code: "DEVICE_ID_INVALID_FORMAT",
    });
  }

  req.deviceId = deviceId;
  req.deviceName = req.headers["x-device-name"] || "Unknown Device";

  next();
};

/**
 * Global error handling middleware
 */
const handleErrors = (err, req, res, next) => {
  console.error("Error:", err);

  // Log error
  if (req.user) {
    logTokenEvent(
      req.user.userId,
      req.deviceId,
      "error",
      req.ip,
      req.get("user-agent"),
      {
        details: err.message,
        endpoint: req.originalUrl,
      }
    );
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      error: "Validation failed",
      details: errors,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      error: `${field} already exists`,
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "Invalid token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "Token expired",
      code: "TOKEN_EXPIRED",
    });
  }

  // Default error
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
};

/**
 * Require Organization Context Middleware
 * Ensures user has selected an organization (token includes organizationId)
 */
const requireOrganization = (req, res, next) => {
  if (!req.user?.organizationId) {
    return res.status(400).json({
      error: "Organization context required. Please select an organization.",
      code: "ORG_REQUIRED",
    });
  }
  next();
};

module.exports = {
  verifyToken,
  verifyRefreshTokenMiddleware,
  extractDeviceId,
  handleErrors,
  requireOrganization,
};
