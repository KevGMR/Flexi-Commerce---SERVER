const rateLimit = require("express-rate-limit");

/**
 * Login rate limiter — IP + email scoped.
 *
 * Rationale:
 *   Multiple attendants behind one office NAT share the same IP. A per-IP
 *   limiter locks out the whole team after a handful of logins.
 *
 * This limiter:
 *   - Keys by (IP, email) so two attendants with different emails have
 *     independent budgets.
 *   - Skips successful requests, so a busy office with correct passwords
 *     never trips the limit.
 *   - Allows 20 attempts per (IP, email) per 15 minutes. Enough for typos,
 *     not enough for a brute-force from one source.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: "Too many login attempts. Please try again in 15 minutes.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // successful logins don't count
  keyGenerator: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const email = (req.body?.email || "").toLowerCase().trim();
    return `${ip}:${email || "no-email"}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many login attempts. Please try again in 15 minutes.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Email-scoped login limiter — brute-force protection for a single account.
 *
 * Runs alongside loginLimiter. Even if an attacker rotates source IPs, they
 * can't exceed 10 failed attempts against one email in 15 minutes.
 *
 * Successful logins don't count — a legit user with a typo can retry.
 */
const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many failed attempts for this account. Try again in 15 minutes.",
    code: "EMAIL_RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = (req.body?.email || "").toLowerCase().trim();
    return email || `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many failed attempts for this account. Try again in 15 minutes.",
      code: "EMAIL_RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Strict rate limiter for registration endpoint
 * 5 registrations per hour per IP
 */
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
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
  windowMs: 5 * 60 * 1000,
  max: 20,
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
 *
 * Scoped: skips /storefront paths so the public storefront has its own
 * dedicated limiter (storefrontLimiter) and doesn't consume admin's budget.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: "Too many requests. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.path.startsWith("/storefront"),
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many requests. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Public storefront rate limiter
 * 300 requests per 15 minutes per IP
 */
const storefrontLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: {
    error: "Too many requests. Please slow down.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
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
  windowMs: 60 * 60 * 1000,
  max: 3,
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
  loginEmailLimiter,
  registrationLimiter,
  refreshLimiter,
  apiLimiter,
  storefrontLimiter,
  passwordResetLimiter,
};