const rateLimit = require("express-rate-limit");

/**
 * Strict rate limiter for login endpoint
 * 5 attempts per 15 minutes per IP
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: "Too many login attempts. Please try again in 15 minutes.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many login attempts. Please try again in 15 minutes.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Strict rate limiter for registration endpoint
 * 5 registrations per hour per IP
 */
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per window
  message: {
    error: "Too many registration attempts. Please try again in 1 hour.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many registration attempts. Please try again in 1 hour.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Rate limiter for token refresh endpoint
 * 20 attempts per 5 minutes per IP
 */
const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 requests per window
  message: {
    error: "Too many refresh requests. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many refresh requests. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    error: "Too many requests. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many requests. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Strict rate limiter for password reset
 * 3 attempts per hour per IP
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window
  message: {
    error: "Too many password reset attempts. Please try again in 1 hour.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many password reset attempts. Please try again in 1 hour.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

module.exports = {
  loginLimiter,
  registrationLimiter,
  refreshLimiter,
  apiLimiter,
  passwordResetLimiter,
};
