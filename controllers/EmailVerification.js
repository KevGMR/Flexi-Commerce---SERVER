const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const { sendEmailVerification } = require("../services/emailNotifier");
const { logTokenEvent } = require("../services/auditLogger");

const router = express.Router();

/**
 * Send email verification
 * POST /email-verification/send
 */
router.post("/send", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: "Email already verified" });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 24); // 24 hour expiry

    // Save token to user
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpiry = expiryDate;
    await user.save();

    // Send verification email
    await sendEmailVerification(email, verificationToken, user.fullname);

    await logTokenEvent(
      user._id,
      null,
      "email_verification_sent",
      req.ip,
      req.get("user-agent"),
      {
        details: "Email verification sent",
      }
    );

    res.status(200).json({
      message: "Verification email sent successfully",
    });
  } catch (error) {
    console.error("Send verification error:", error);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});

/**
 * Verify email with token
 * POST /email-verification/verify/:token
 */
router.post("/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: "Verification token is required" });
    }

    // Find user with this token
    const user = await User.findOne({
      emailVerificationToken: token,
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid verification token" });
    }

    // Check if token expired
    if (user.emailVerificationExpiry < new Date()) {
      return res.status(400).json({
        error: "Verification token expired. Please request a new one.",
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpiry = undefined;
    await user.save();

    await logTokenEvent(
      user._id,
      null,
      "email_verified",
      req.ip,
      req.get("user-agent"),
      {
        details: "Email successfully verified",
      }
    );

    res.status(200).json({
      message: "Email verified successfully. You can now log in.",
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({ error: "Failed to verify email" });
  }
});

/**
 * Resend verification email
 * POST /email-verification/resend
 */
router.post("/resend", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: "Email already verified" });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 24);

    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpiry = expiryDate;
    await user.save();

    // Send verification email
    await sendEmailVerification(email, verificationToken, user.fullname);

    await logTokenEvent(
      user._id,
      null,
      "email_verification_resent",
      req.ip,
      req.get("user-agent"),
      {
        details: "Email verification resent",
      }
    );

    res.status(200).json({
      message: "Verification email resent successfully",
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({ error: "Failed to resend verification email" });
  }
});

module.exports = router;
