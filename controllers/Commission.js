const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const User = require("../models/User");
const { requirePermission } = require("../middleware/permissionCheck");

/**
 * GET /commissions
 */
router.get("/", requirePermission("view_reports"), async (req, res) => {
  try {
    const { organizationId } = req.user;
    const {
      startDate,
      endDate,
      locationId,
      status,
      userId,
      page = 1,
      limit = 50,
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use ISO strings.",
      });
    }

    // Build match stage for sales
    const match = {
      organizationId: new mongoose.Types.ObjectId(organizationId),
      createdAt: { $gte: start, $lte: end },
      status: { $in: ["completed", "partial_refund"] },
    };
    if (locationId) match.locationId = new mongoose.Types.ObjectId(locationId);
    if (status) match.status = status;

    const pipeline = [
      { $match: match },
      { $unwind: "$items" },
      {
        $match: {
          "items.type": "service",
          "items.commissionAmount": { $gt: 0 },
        },
      },
      // Ensure assignedUser exists (should be validated at sale creation)
      {
        $match: {
          "items.assignedUser": { $ne: null },
        },
      },
    ];

    if (userId) {
      pipeline.push({
        $match: { "items.assignedUser": new mongoose.Types.ObjectId(userId) },
      });
    }

    let groupStage, projectStage, sortStage, paginationStage = [];

    if (userId) {
      // Breakdown by sale for a specific user
      groupStage = {
        $group: {
          _id: {
            saleId: "$_id",
            saleDate: "$createdAt",
            saleTotal: "$totalAmount",
            receiptNumber: "$receiptNumber",
          },
          totalCommission: { $sum: "$items.commissionAmount" },
          serviceItems: {
            $push: {
              serviceName: "$items.productName",
              commissionAmount: "$items.commissionAmount",
              serviceId: "$items.productId",
              commissionType: "$items.commissionType",
              commissionValue: "$items.commissionValue",
            },
          },
        },
      };
      projectStage = {
        $project: {
          _id: 0,
          saleId: "$_id.saleId",
          saleDate: "$_id.saleDate",
          saleTotal: "$_id.saleTotal",
          receiptNumber: "$_id.receiptNumber",
          totalCommission: 1,
          serviceItems: 1,
        },
      };
      sortStage = { $sort: { saleDate: -1 } };
      const skip = (parseInt(page) - 1) * parseInt(limit);
      paginationStage = [
        { $skip: skip },
        { $limit: parseInt(limit) },
      ];
    } else {
      // Summary by user
      groupStage = {
        $group: {
          _id: "$items.assignedUser",
          totalCommission: { $sum: "$items.commissionAmount" },
          salesCount: { $addToSet: "$_id" },
          serviceBreakdown: {
            $push: {
              serviceId: "$items.productId",
              serviceName: "$items.productName",
              commissionAmount: "$items.commissionAmount",
            },
          },
        },
      };
      projectStage = {
        $project: {
          _id: 0,
          userId: "$_id",
          totalCommission: 1,
          salesCount: { $size: "$salesCount" },
          serviceBreakdown: 1,
        },
      };
      sortStage = { $sort: { totalCommission: -1 } };
    }

    pipeline.push(groupStage);
    if (projectStage) pipeline.push(projectStage);
    if (sortStage) pipeline.push(sortStage);
    if (paginationStage.length) pipeline.push(...paginationStage);

    const results = await Sale.aggregate(pipeline);

    let total = 0;
    if (userId) {
      const countPipeline = [
        { $match: match },
        { $unwind: "$items" },
        {
          $match: {
            "items.type": "service",
            "items.commissionAmount": { $gt: 0 },
            "items.assignedUser": new mongoose.Types.ObjectId(userId),
          },
        },
        { $group: { _id: "$_id" } },
        { $count: "total" },
      ];
      const countResult = await Sale.aggregate(countPipeline);
      total = countResult[0]?.total || 0;
    }

    if (!userId) {
      const userIds = results.map((r) => r.userId).filter(Boolean);
      const users = await User.find({ _id: { $in: userIds } })
        .select("_id fullname email")
        .lean();
      const userMap = {};
      users.forEach((u) => (userMap[u._id.toString()] = u));

      const enriched = results.map((r) => {
        const user = r.userId ? userMap[r.userId.toString()] : null;
        return {
          ...r,
          user: user
            ? { _id: user._id, fullname: user.fullname, email: user.email }
            : null,
        };
      });

      return res.status(200).json({
        success: true,
        data: {
          users: enriched,
          totals: {
            totalCommission: enriched.reduce(
              (sum, u) => sum + u.totalCommission,
              0
            ),
            totalUsers: enriched.length,
          },
        },
      });
    } else {
      return res.status(200).json({
        success: true,
        data: {
          sales: results,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    }
  } catch (error) {
    console.error("Commissions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch commissions",
      error: error.message,
    });
  }
});

module.exports = router;