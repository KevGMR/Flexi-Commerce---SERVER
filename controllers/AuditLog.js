const express = require("express");
const TokenAuditLog = require("../models/TokenAuditLog");
const PermissionHistory = require("../models/PermissionHistory");
const { requirePermission } = require("../middleware/permissionCheck");
const { PERMISSIONS } = require("../config/permissions");
const { Parser } = require("json2csv");

const router = express.Router();

/**
 * Get audit logs with filtering and pagination
 * GET /audit-logs
 */
router.get("/", requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS), async (req, res) => {
  try {
    const {
      userId,
      eventType,
      permission,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    const query = {};

    if (userId) query.userId = userId;
    if (eventType) query.eventType = eventType;
    if (permission) query.permission = permission;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const logs = await TokenAuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "fullname email")
      .populate("adminId", "fullname email");

    const total = await TokenAuditLog.countDocuments(query);

    res.status(200).json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get audit logs error:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

/**
 * Download audit logs older than 120 days
 * POST /audit-logs/download
 */
router.post("/download", requirePermission(PERMISSIONS.EXPORT_AUDIT_LOGS), async (req, res) => {
  try {
    const { format = "csv" } = req.body;

    // Get logs older than 120 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 120);

    const logs = await TokenAuditLog.find({
      createdAt: { $lt: cutoffDate },
    })
      .sort({ createdAt: -1 })
      .populate("userId", "fullname email")
      .populate("adminId", "fullname email")
      .lean();

    if (logs.length === 0) {
      return res.status(404).json({ error: "No logs older than 120 days found" });
    }

    // Format logs for export
    const formattedLogs = logs.map((log) => ({
      timestamp: log.createdAt,
      userId: log.userId?._id || log.email || "N/A",
      userName: log.userId?.fullname || "N/A",
      userEmail: log.userId?.email || log.email || "N/A",
      eventType: log.eventType,
      permission: log.permission || "N/A",
      oldPermissions: log.oldPermissions?.join(", ") || "N/A",
      newPermissions: log.newPermissions?.join(", ") || "N/A",
      ipAddress: log.ipAddress,
      deviceId: log.deviceId || "N/A",
      adminId: log.adminId?._id || "N/A",
      adminName: log.adminId?.fullname || "N/A",
      endpoint: log.endpoint || "N/A",
      details: log.details || "N/A",
      success: log.success,
    }));

    if (format === "csv") {
      const parser = new Parser();
      const csv = parser.parse(formattedLogs);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=audit-logs-${Date.now()}.csv`
      );
      res.status(200).send(csv);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=audit-logs-${Date.now()}.json`
      );
      res.status(200).json(formattedLogs);
    }
  } catch (error) {
    console.error("Download audit logs error:", error);
    res.status(500).json({ error: "Failed to download audit logs" });
  }
});

/**
 * Purge audit logs older than 120 days
 * POST /audit-logs/purge
 */
router.post("/purge", requirePermission(PERMISSIONS.PURGE_AUDIT_LOGS), async (req, res) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 120);

    const result = await TokenAuditLog.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    // Log the purge operation
    const { logTokenEvent } = require("../services/auditLogger");
    await logTokenEvent(
      req.user.userId,
      req.deviceId,
      "audit_logs_purged",
      req.ip,
      req.get("user-agent"),
      {
        details: `Purged ${result.deletedCount} audit logs older than 120 days`,
      }
    );

    res.status(200).json({
      message: `Successfully purged ${result.deletedCount} audit logs`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Purge audit logs error:", error);
    res.status(500).json({ error: "Failed to purge audit logs" });
  }
});

/**
 * Get audit log summary/statistics
 * GET /audit-logs/summary
 */
router.get("/summary", requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS), async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const [
      totalLogs,
      failedLogins,
      permissionDenied,
      tokenRotations,
      userDeactivations,
      permissionChanges,
    ] = await Promise.all([
      TokenAuditLog.countDocuments({ createdAt: { $gte: startDate } }),
      TokenAuditLog.countDocuments({
        eventType: "login_failed",
        createdAt: { $gte: startDate },
      }),
      TokenAuditLog.countDocuments({
        eventType: "permission_denied",
        createdAt: { $gte: startDate },
      }),
      TokenAuditLog.countDocuments({
        eventType: "token_rotated",
        createdAt: { $gte: startDate },
      }),
      TokenAuditLog.countDocuments({
        eventType: { $in: ["user_deactivated", "user_banned"] },
        createdAt: { $gte: startDate },
      }),
      TokenAuditLog.countDocuments({
        eventType: { $in: ["permission_granted", "permission_revoked"] },
        createdAt: { $gte: startDate },
      }),
    ]);

    // Get most denied permissions
    const deniedPermissions = await TokenAuditLog.aggregate([
      {
        $match: {
          eventType: "permission_denied",
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: "$permission",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get most active IPs
    const topIPs = await TokenAuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: "$ipAddress",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.status(200).json({
      period: `Last ${days} days`,
      summary: {
        totalLogs,
        failedLogins,
        permissionDenied,
        tokenRotations,
        userDeactivations,
        permissionChanges,
      },
      deniedPermissions,
      topIPs,
    });
  } catch (error) {
    console.error("Get audit summary error:", error);
    res.status(500).json({ error: "Failed to fetch audit summary" });
  }
});

/**
 * Get permission denied events
 * GET /audit-logs/permission-denied
 */
router.get(
  "/permission-denied",
  requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS),
  async (req, res) => {
    try {
      const { userId, permission, startDate, endDate, page = 1, limit = 50 } = req.query;

      const query = { eventType: "permission_denied" };

      if (userId) query.userId = userId;
      if (permission) query.permission = permission;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const logs = await TokenAuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("userId", "fullname email role");

      const total = await TokenAuditLog.countDocuments(query);

      res.status(200).json({
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Get permission denied logs error:", error);
      res.status(500).json({ error: "Failed to fetch permission denied logs" });
    }
  }
);

/**
 * Get full audit trail for specific user
 * GET /audit-logs/user/:userId
 */
router.get("/user/:userId", requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS), async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const logs = await TokenAuditLog.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("adminId", "fullname email");

    const total = await TokenAuditLog.countDocuments({ userId });

    res.status(200).json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get user audit trail error:", error);
    res.status(500).json({ error: "Failed to fetch user audit trail" });
  }
});

/**
 * Get permission history for user
 * GET /audit-logs/permission-history/:userId
 */
router.get(
  "/permission-history/:userId",
  requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const history = await PermissionHistory.find({ userId })
        .sort({ createdAt: -1 })
        .populate("adminId", "fullname email")
        .populate("restoredBy", "fullname email");

      res.status(200).json({ history });
    } catch (error) {
      console.error("Get permission history error:", error);
      res.status(500).json({ error: "Failed to fetch permission history" });
    }
  }
);

module.exports = router;
