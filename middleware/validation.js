const { body, validationResult } = require("express-validator");

/**
 * Validation middleware helper
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((err) => ({
        field: err.path || err.param,
        message: err.msg,
      })),
    });
  }
  next();
};

/**
 * Registration validation rules
 */
const validateRegistration = [
  body("fullname")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Full name must be between 2 and 100 characters"),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email format")
    .normalizeEmail(),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter")
    .matches(/[a-z]/)
    .withMessage("Password must contain at least one lowercase letter")
    .matches(/[0-9]/)
    .withMessage("Password must contain at least one number")
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage("Password must contain at least one special character"),

  body("company")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Company name too long"),

  body("phone")
    .optional()
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/)
    .withMessage("Invalid phone number format"),

  body("role")
    .optional()
    .isIn(["Owner", "Manager", "Cashier", "Employee"])
    .withMessage("Invalid role"),

  validate,
];

/**
 * Login validation rules
 */
const validateLogin = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email format")
    .normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required"),

  validate,
];

/**
 * Email validation rules
 */
const validateEmail = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email format")
    .normalizeEmail(),

  validate,
];

/**
 * Password reset validation rules
 */
const validatePasswordReset = [
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter")
    .matches(/[a-z]/)
    .withMessage("Password must contain at least one lowercase letter")
    .matches(/[0-9]/)
    .withMessage("Password must contain at least one number")
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage("Password must contain at least one special character"),

  body("confirmPassword")
    .notEmpty()
    .withMessage("Confirm password is required")
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),

  validate,
];

/**
 * Permission grant/revoke validation
 */
const validatePermission = [
  body("permission")
    .notEmpty()
    .withMessage("Permission is required")
    .isString()
    .withMessage("Permission must be a string"),

  body("reason")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Reason too long"),

  validate,
];

/**
 * User ID validation (for params)
 */
const validateUserId = [
  body("userId")
    .optional()
    .isMongoId()
    .withMessage("Invalid user ID"),

  validate,
];

module.exports = {
  validateRegistration,
  validateLogin,
  validateEmail,
  validatePasswordReset,
  validatePermission,
  validateUserId,
  validate,
};
