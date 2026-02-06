const nodemailer = require("nodemailer");

// Create email transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.MAILER_ADDRESS,
    pass: process.env.MAILER_PASS,
  },
  tls: {
    rejectUnauthorized: true,
  },
});

/**
 * Send email verification
 * @param {String} email - Recipient email
 * @param {String} token - Verification token
 * @param {String} userName - User's name
 */
const sendEmailVerification = async (email, token, userName) => {

  console.log({email, token, userName});

  try {
    const verificationUrl = `${process.env.CLIENT_URL}/auth/verify-email/${token}`;

    console.log({ verificationUrl });
    

    const mailOptions = {
      from:`FLEXI-COMMERCE ${process.env.MAILER_ADDRESS}`,
      to: email,
      subject: "Verify Your Email - FLEXI-COMMERCE",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Hi ${userName},</p>
          <p>Thank you for registering with FLEXI-COMMERCE. Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">Verify Email</a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account, please ignore this email.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">FLEXI-COMMERCE - Modular E-Commerce Platform Built for businesses that need flexibility</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email verification sent to ${email}`);
  } catch (error) {
    console.error("Error sending email verification:", error);
    throw error;
  }
};

/**
 * Send password reset email
 * @param {String} email - Recipient email
 * @param {String} token - Reset token
 * @param {String} userName - User's name
 */
const sendPasswordReset = async (email, token, userName) => {
  try {
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${token}`;

    const mailOptions = {
      from:`FLEXI-COMMERCE ${process.env.MAILER_ADDRESS}`,
      to: email,
      subject: "Password Reset Request - FLEXI-COMMERCE",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset</h2>
          <p>Hi ${userName},</p>
          <p>We received a request to reset your password. Click the button below to reset it:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #2196F3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">Reset Password</a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="color: #666; word-break: break-all;">${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p style="color: #d32f2f; font-weight: bold;">If you didn't request a password reset, please ignore this email and ensure your account is secure.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">FLEXI-COMMERCE - Point of Sale System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${email}`);
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw error;
  }
};

/**
 * Send permission change notification
 * @param {String} email - Recipient email
 * @param {String} userName - User's name
 * @param {Object} permissionChange - Permission change details
 * @param {String} adminName - Admin who made the change
 */
const sendPermissionChangeNotification = async (
  email,
  userName,
  permissionChange,
  adminName
) => {
  try {
    const { type, permission, oldPermissions, newPermissions } =
      permissionChange;

    let changeDescription = "";
    if (type === "granted") {
      changeDescription = `<p style="color: #4CAF50;">✓ Permission <strong>${permission}</strong> has been granted to your account.</p>`;
    } else if (type === "revoked") {
      changeDescription = `<p style="color: #d32f2f;">✗ Permission <strong>${permission}</strong> has been revoked from your account.</p>`;
    } else {
      changeDescription = `<p>Your permissions have been updated.</p>`;
    }

    const mailOptions = {
      from: `FLEXI-COMMERCE ${process.env.MAILER_ADDRESS}`,
      to: email,
      subject: "Permission Change Notification - FLEXI-COMMERCE",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Permission Change Notification</h2>
          <p>Hi ${userName},</p>
          <p>Your account permissions have been modified by ${adminName}.</p>
          ${changeDescription}
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>Change Details:</strong></p>
            <p><strong>Changed by:</strong> ${adminName}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <p>You may need to log out and log back in for changes to take effect.</p>
          <p>If you have questions about this change, please contact your administrator.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">FLEXI-COMMERCE - Point of Sale System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Permission change notification sent to ${email}`);
  } catch (error) {
    console.error("Error sending permission change notification:", error);
    throw error;
  }
};

/**
 * Send status change notification (deactivation, ban, reactivation)
 * @param {String} email - Recipient email
 * @param {String} userName - User's name
 * @param {String} newStatus - New status
 * @param {String} reason - Reason for change
 */
const sendStatusChangeNotification = async (
  email,
  userName,
  newStatus,
  reason
) => {
  try {
    let statusMessage = "";
    let statusColor = "";

    if (newStatus === "banned") {
      statusMessage = "Your account has been banned";
      statusColor = "#d32f2f";
    } else if (newStatus === "inactive") {
      statusMessage = "Your account has been deactivated";
      statusColor = "#ff9800";
    } else if (newStatus === "active") {
      statusMessage = "Your account has been reactivated";
      statusColor = "#4CAF50";
    }

    const mailOptions = {
      from: `FLEXI-COMMERCE ${process.env.MAILER_ADDRESS}`,
      to: email,
      subject: `Account Status Change - FLEXI-COMMERCE`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${statusColor};">Account Status Update</h2>
          <p>Hi ${userName},</p>
          <p style="font-size: 16px;"><strong>${statusMessage}</strong></p>
          ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>New Status:</strong> ${newStatus.toUpperCase()}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
          ${
            newStatus === "active"
              ? "<p>You can now log in to your account.</p>"
              : "<p>You will not be able to access your account until it is reactivated.</p>"
          }
          <p>If you have questions about this change, please contact your administrator.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">FLEXI-COMMERCE - Point of Sale System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Status change notification sent to ${email}`);
  } catch (error) {
    console.error("Error sending status change notification:", error);
    throw error;
  }
};

/**
 * Send role change notification
 * @param {String} email - Recipient email
 * @param {String} userName - User's name
 * @param {String} oldRole - Old role
 * @param {String} newRole - New role
 * @param {String} adminName - Admin who made the change
 */
const sendRoleChangeNotification = async (
  email,
  userName,
  oldRole,
  newRole,
  adminName
) => {
  try {
    const mailOptions = {
      from: `FLEXI-COMMERCE ${process.env.MAILER_ADDRESS}`,
      to: email,
      subject: "Role Change Notification - FLEXI-COMMERCE",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Role Change Notification</h2>
          <p>Hi ${userName},</p>
          <p>Your role has been changed by ${adminName}.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>Old Role:</strong> ${oldRole}</p>
            <p><strong>New Role:</strong> <span style="color: #4CAF50; font-weight: bold;">${newRole}</span></p>
            <p><strong>Changed by:</strong> ${adminName}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <p>Your permissions may have changed. Please log out and log back in for changes to take effect.</p>
          <p>If you have questions about this change, please contact your administrator.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">FLEXI-COMMERCE - Point of Sale System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Role change notification sent to ${email}`);
  } catch (error) {
    console.error("Error sending role change notification:", error);
    throw error;
  }
};

/**
 * Send organization invitation
 * @param {String} email - Recipient email
 * @param {String} inviterName - Name of person inviting
 * @param {String} organizationName - Organization name
 * @param {String} role - Role being assigned
 * @param {String} invitationUrl - Invitation acceptance URL
 */
const sendOrganizationInvitation = async (
  email,
  inviterName,
  organizationName,
  role,
  invitationUrl
) => {
  try {
    const mailOptions = {
      from: `FLEXI-COMMERCE ${process.env.MAILER_ADDRESS}`,
      to: email,
      subject: `You're invited to join ${organizationName} - FLEXI-COMMERCE`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">You're Invited!</h2>
          <p>Hi,</p>
          <p>${inviterName} has invited you to join <strong>${organizationName}</strong> as a <strong>${role}</strong>.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${invitationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
          </div>
          <p>Or copy and paste this link:</p>
          <p style="color: #666; word-break: break-all;">${invitationUrl}</p>
          <p>This invitation expires in 7 days.</p>
          <p style="color: #999; font-size: 12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">FLEXI-COMMERCE - Point of Sale System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Organization invitation sent to ${email}`);
  } catch (error) {
    console.error("Error sending organization invitation:", error);
    throw error;
  }
};

module.exports = {
  sendEmailVerification,
  sendPasswordReset,
  sendPermissionChangeNotification,
  sendStatusChangeNotification,
  sendRoleChangeNotification,
  sendOrganizationInvitation,
};
