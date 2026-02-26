const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const Organization = require("../models/Organization");
const UserOrganization = require("../models/UserOrganization");
const Invitation = require("../models/Invitation");
const User = require("../models/User");
const { getPermissionsForRole, PERMISSIONS } = require("../config/permissions");
const { verifyToken, requireOrganization } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");
const { sendOrganizationInvitation } = require("../services/emailNotifier");
const { loginLimiter } = require("../middleware/rateLimiter");

/**
 * Get current organization details
 * GET /organizations/:organizationId
 */
router.get("/:organizationId", verifyToken, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.organizationId)
      .populate("ownerId", "fullname email")
      .lean();

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    // Verify user has access to this org
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership) {
      return res.status(403).json({ error: "No access to this organization" });
    }

    return res.status(200).json({
      organization: org,
    });
  } catch (error) {
    console.error("Error fetching organization:", error);
    return res.status(500).json({ error: "Failed to fetch organization" });
  }
});

/**
 * Update organization settings
 * PUT /organizations/:organizationId
 */
router.put("/:organizationId", verifyToken, async (req, res) => {
  try {
    const { name, settings } = req.body;

    // Verify user is owner or manager
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership || !["Owner", "Manager"].includes(membership.role)) {
      return res.status(403).json({
        error: "Only Owner or Manager can update organization",
      });
    }

    const org = await Organization.findByIdAndUpdate(
      req.params.organizationId,
      { name, settings },
      { new: true, runValidators: true },
    );

    await logTokenEvent(
      req.user.userId,
      req.params.organizationId,
      "org_updated",
      req.ip,
      req.get("user-agent"),
      {
        details: `Organization updated: ${org.name}`,
      },
    );

    return res.status(200).json({
      message: "Organization updated successfully",
      organization: org,
    });
  } catch (error) {
    console.error("Error updating organization:", error);
    return res.status(500).json({ error: "Failed to update organization" });
  }
});

/**
 * Invite user to organization
 * POST /organizations/:organizationId/invite
 */
router.post("/:organizationId/invite", verifyToken, async (req, res) => {
  try {
    const { email, role = "Employee", locations = [] } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify user has permission to invite (Owner/Manager or MANAGE_USERS permission)
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    const hasPermission = membership && 
      (["Owner", "Manager"].includes(membership.role) || 
       membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

    if (!hasPermission) {
      return res.status(403).json({
        error: "You don't have permission to invite users",
      });
    }

    const org = await Organization.findById(req.params.organizationId);
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    // Validate locations if provided
    if (locations.length > 0) {
      const Location = require("../models/Location");
      const validLocations = await Location.countDocuments({
        _id: { $in: locations },
        organizationId: req.params.organizationId,
      });

      if (validLocations !== locations.length) {
        return res
          .status(400)
          .json({ error: "One or more location IDs are invalid" });
      }
    }

    // Check if user already member
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      const existingMembership = await UserOrganization.findOne({
        userId: existingUser._id,
        organizationId: req.params.organizationId,
      });

      if (existingMembership) {
        return res.status(409).json({
          error: "User is already a member of this organization",
        });
      }
    }

    // Check for pending invitation
    const existingInvite = await Invitation.findOne({
      email: email.toLowerCase(),
      organizationId: req.params.organizationId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (existingInvite) {
      return res.status(409).json({
        error: "An invitation is already pending for this email",
      });
    }

    // Create invitation
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

    const permissions = getPermissionsForRole(role);

    const invitation = new Invitation({
      organizationId: req.params.organizationId,
      email: email.toLowerCase(),
      role,
      permissions,
      locations,
      invitedBy: req.user.userId,
      token,
      expiresAt,
    });

    await invitation.save();

    // Send invitation email with accept URL
    const inviter = await User.findById(req.user.userId).lean();
    const invitationUrl = `${process.env.CLIENT_URL}/auth/signup?invitation=${encodeURIComponent(token)}`;
    await sendOrganizationInvitation(
      email,
      inviter.fullname,
      org.name,
      role,
      invitationUrl,
    );

    await logTokenEvent(
      req.user.userId,
      req.params.organizationId,
      "user_invited",
      req.ip,
      req.get("user-agent"),
      {
        details: `Invited ${email} to organization`,
      },
    );

    return res.status(201).json({
      message: "Invitation sent successfully",
      invitation: {
        _id: invitation._id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error inviting user:", error);
    return res.status(500).json({ error: "Failed to send invitation" });
  }
});

/**
 * Get organization invitations
 * GET /organizations/:organizationId/invitations
 */
router.get("/:organizationId/invitations", verifyToken, async (req, res) => {
  try {
    const { status } = req.query;

    // Verify user has permission
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    const hasPermission = membership && 
      (["Owner", "Manager"].includes(membership.role) || 
       membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

    if (!hasPermission) {
      return res.status(403).json({
        error: "You don't have permission to view invitations",
      });
    }

    // Build query
    const query = { organizationId: req.params.organizationId };

    // Handle status filter
    if (status && status !== "all") {
      if (status === "expired") {
        // Get pending invitations that have expired
        query.status = "pending";
        query.expiresAt = { $lt: new Date() };
      } else {
        query.status = status;
      }
    }

    // Fetch invitations
    const invitations = await Invitation.find(query)
      .populate("invitedBy", "fullname email")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      invitations,
    });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    return res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

/**
 * Revoke an invitation
 * DELETE /organizations/:organizationId/invitations/:invitationId
 */
router.delete(
  "/:organizationId/invitations/:invitationId",
  verifyToken,
  async (req, res) => {
    try {
      const mongoose = require("mongoose");

      // Validate invitationId format
      if (!mongoose.isValidObjectId(req.params.invitationId)) {
        return res.status(400).json({ error: "Invalid invitation ID" });
      }

      // Verify user has permission
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      const hasPermission = membership && 
        (["Owner", "Manager"].includes(membership.role) || 
         membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

      if (!hasPermission) {
        return res.status(403).json({
          error: "You don't have permission to revoke invitations",
        });
      }

      // Find invitation
      const invitation = await Invitation.findOne({
        _id: req.params.invitationId,
        organizationId: req.params.organizationId,
      });

      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      // Can only revoke pending invitations
      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: `Cannot revoke ${invitation.status} invitation`,
        });
      }

      // Update status to revoked
      invitation.status = "revoked";
      await invitation.save();

      // Log audit event
      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "invitation_revoked",
        req.ip,
        req.get("user-agent"),
        {
          details: `Revoked invitation for ${invitation.email} with role ${invitation.role}`,
        },
      );

      return res.status(200).json({
        message: "Invitation revoked successfully",
        invitation,
      });
    } catch (error) {
      console.error("Error revoking invitation:", error);
      return res.status(500).json({ error: "Failed to revoke invitation" });
    }
  },
);

/**
 * Resend an invitation
 * POST /organizations/:organizationId/invitations/:invitationId/resend
 */
router.post(
  "/:organizationId/invitations/:invitationId/resend",
  verifyToken,
  async (req, res) => {
    try {
      const mongoose = require("mongoose");

      // Validate invitationId format
      if (!mongoose.isValidObjectId(req.params.invitationId)) {
        return res.status(400).json({ error: "Invalid invitation ID" });
      }

      // Verify user has permission
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      const hasPermission = membership && 
        (["Owner", "Manager"].includes(membership.role) || 
         membership.permissions?.includes(PERMISSIONS.MANAGE_USERS));

      if (!hasPermission) {
        return res.status(403).json({
          error: "You don't have permission to resend invitations",
        });
      }

      // Find invitation
      const invitation = await Invitation.findOne({
        _id: req.params.invitationId,
        organizationId: req.params.organizationId,
      });

      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      // Can only resend pending invitations
      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: `Cannot resend ${invitation.status} invitation`,
        });
      }

      // Extend expiry by 7 days
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);
      invitation.expiresAt = newExpiresAt;
      await invitation.save();

      // Get organization and inviter details
      const org = await Organization.findById(req.params.organizationId);
      const inviter = await User.findById(invitation.invitedBy).lean();

      // Send invitation email
      const invitationUrl = `${process.env.CLIENT_URL}/auth/signup?invitation=${encodeURIComponent(invitation.token)}`;
      await sendOrganizationInvitation(
        invitation.email,
        inviter?.fullname || "Team member",
        org.name,
        invitation.role,
        invitationUrl,
      );

      // Log audit event
      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "invitation_resent",
        req.ip,
        req.get("user-agent"),
        {
          details: `Resent invitation to ${invitation.email}`,
        },
      );

      return res.status(200).json({
        message: "Invitation resent successfully",
        invitation,
      });
    } catch (error) {
      console.error("Error resending invitation:", error);
      return res.status(500).json({ error: "Failed to resend invitation" });
    }
  },
);

/**
 * Get organization members
 * GET /organizations/:organizationId/members
 */
router.get("/:organizationId/members", verifyToken, async (req, res) => {
  try {
    // Verify user has access
    const membership = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: req.params.organizationId,
    }).lean();

    if (!membership) {
      return res.status(403).json({ error: "No access to this organization" });
    }

    const members = await UserOrganization.find({
      organizationId: req.params.organizationId,
      status: "active",
    })
      .populate("userId", "fullname email")
      .lean();

    const cleanedMembers = members
      .filter((m) => m.userId) // skip records where user is missing
      .map((m) => ({
        userId: m.userId._id,
        fullname: m.userId.fullname,
        email: m.userId.email,
        role: m.role,
        joinedAt: m.joinedAt,
      }));

    return res.status(200).json({
      members: cleanedMembers,
    });
  } catch (error) {
    console.error("Error fetching members:", error);
    return res.status(500).json({ error: "Failed to fetch members" });
  }
});

/**
 * Remove member from organization
 * DELETE /organizations/:organizationId/members/:userId
 */
router.delete(
  "/:organizationId/members/:userId",
  verifyToken,
  async (req, res) => {
    try {
      // Verify user is owner/manager
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      if (!membership || !["Owner", "Manager"].includes(membership.role)) {
        return res.status(403).json({
          error: "Only Owner or Manager can remove members",
        });
      }

      // Cannot remove owner
      const targetMembership = await UserOrganization.findOne({
        userId: req.params.userId,
        organizationId: req.params.organizationId,
      });

      if (targetMembership.role === "Owner") {
        return res.status(400).json({
          error: "Cannot remove organization owner",
        });
      }

      await UserOrganization.updateOne(
        {
          userId: req.params.userId,
          organizationId: req.params.organizationId,
        },
        { status: "inactive" },
      );

      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "member_removed",
        req.ip,
        req.get("user-agent"),
        {
          details: `Removed user from organization`,
        },
      );

      return res.status(200).json({
        message: "Member removed successfully",
      });
    } catch (error) {
      console.error("Error removing member:", error);
      return res.status(500).json({ error: "Failed to remove member" });
    }
  },
);

/**
 * Update member's assigned locations
 * PUT /organizations/:organizationId/members/:userId/locations
 */
router.put(
  "/:organizationId/members/:userId/locations",
  verifyToken,
  async (req, res) => {
    try {
      const { locations = [] } = req.body;

      // Verify user is owner/manager
      const membership = await UserOrganization.findOne({
        userId: req.user.userId,
        organizationId: req.params.organizationId,
      }).lean();

      if (!membership || !["Owner", "Manager"].includes(membership.role)) {
        return res.status(403).json({
          error: "Only Owner or Manager can assign locations",
        });
      }

      // Validate locations if provided
      if (locations.length > 0) {
        const Location = require("../models/Location");
        const validLocations = await Location.countDocuments({
          _id: { $in: locations },
          organizationId: req.params.organizationId,
        });

        if (validLocations !== locations.length) {
          return res
            .status(400)
            .json({ error: "One or more location IDs are invalid" });
        }
      }

      // Update user's locations
      const targetMembership = await UserOrganization.findOneAndUpdate(
        {
          userId: req.params.userId,
          organizationId: req.params.organizationId,
        },
        { locations },
        { new: true },
      );

      if (!targetMembership) {
        return res.status(404).json({ error: "Member not found" });
      }

      await logTokenEvent(
        req.user.userId,
        req.params.organizationId,
        "member_locations_updated",
        req.ip,
        req.get("user-agent"),
        {
          details: `Updated location assignments for user ${req.params.userId}`,
        },
      );

      return res.status(200).json({
        message: "Locations updated successfully",
        locations: targetMembership.locations,
      });
    } catch (error) {
      console.error("Error updating locations:", error);
      return res.status(500).json({ error: "Failed to update locations" });
    }
  },
);

module.exports = router;
