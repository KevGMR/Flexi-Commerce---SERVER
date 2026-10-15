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

    // Parse dates as local (not UTC)
    const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
    const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
    const start = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
    const end = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD.",
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

/**
 * GET /commissions/me
 * Current user's own commissions.
 * Requires VIEW_OWN_COMMISSIONS. Scoped to req.user.userId — a user can
 * only ever see their own data through this endpoint.
 */
router.get(
  "/me",
  requirePermission("view_own_commissions"),
  async (req, res) => {
    try {
      const { organizationId, userId } = req.user;
      const {
        startDate,
        endDate,
        locationId,
        page = 1,
        limit = 50,
      } = req.query;

      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ error: "startDate and endDate are required" });
      }

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
      const skip = (pageNum - 1) * limitNum;

      const dateFilter = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`),
      };

      // Matches either sale-level assignment or item-level assignment.
      // - sale-level: sale.assignedUser === userId (POS "sale-assigned user")
      // - item-level: sale.items[].assignedUser === userId (per-service override)
      const assigneeFilter = {
        $or: [
          { assignedUser: userId },
          { "items.assignedUser": userId },
        ],
      };

      const matchFilter = {
        organizationId,
        status: { $in: ["completed", "partial_refund"] },
        createdAt: dateFilter,
        ...assigneeFilter,
      };

      if (locationId) matchFilter.locationId = locationId;

      const [sales, totalSales] = await Promise.all([
        Sale.find(matchFilter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .select(
            "_id receiptNumber createdAt items assignedUser",
          )
          .lean(),
        Sale.countDocuments(matchFilter),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalSales / limitNum));

      let periodTotal = 0;
      let periodServiceCount = 0;
      const payload = [];

      for (const sale of sales) {
        // Filter to only the items this user earned on
        const myItems = (sale.items || []).filter((item) => {
          if (item.type !== "service") return false;
          // Prefer explicit per-item assignment; fall back to sale-level
          if (item.assignedUser) {
            return String(item.assignedUser) === String(userId);
          }
          // If the sale was assigned to this user and the item has no
          // explicit assignment, count it too.
          if (sale.assignedUser) {
            return String(sale.assignedUser) === String(userId);
          }
          return false;
        });

        if (myItems.length === 0) continue;

        let saleCommission = 0;
        const serviceItems = [];

        for (const item of myItems) {
          const commission = Number(item.commissionAmount) || 0;
          const alreadyRefunded = Number(item.quantityRefunded) || 0;
          const totalQty = Number(item.quantity) || 1;

          // Prorate commission for refunded quantity
          const effectiveCommission =
            alreadyRefunded > 0
              ? commission * ((totalQty - alreadyRefunded) / totalQty)
              : commission;

          saleCommission += effectiveCommission;
          periodTotal += effectiveCommission;
          periodServiceCount += 1;

          serviceItems.push({
            serviceName: item.productName || item.name || "Service",
            commissionAmount: effectiveCommission,
            commissionType: item.commissionType || "percentage",
            commissionValue: Number(item.commissionValue) || 0,
            quantity: totalQty,
            quantityRefunded: alreadyRefunded,
          });
        }

        payload.push({
          saleId: sale._id,
          saleDate: sale.createdAt,
          receiptNumber: sale.receiptNumber,
          totalCommission: saleCommission,
          serviceItems,
        });
      }

      // Note: periodTotal above only sums this page. For the totals display
      // we need the whole period. Do a second pass over all matching sales,
      // but only pulling items + assignedUser fields.
      let overallTotal = 0;
      let overallServiceCount = 0;

      const allSales = await Sale.find(matchFilter)
        .select("items assignedUser")
        .lean();

      for (const sale of allSales) {
        const items = (sale.items || []).filter((item) => {
          if (item.type !== "service") return false;
          if (item.assignedUser) {
            return String(item.assignedUser) === String(userId);
          }
          if (sale.assignedUser) {
            return String(sale.assignedUser) === String(userId);
          }
          return false;
        });

        for (const item of items) {
          const commission = Number(item.commissionAmount) || 0;
          const alreadyRefunded = Number(item.quantityRefunded) || 0;
          const totalQty = Number(item.quantity) || 1;
          const effectiveCommission =
            alreadyRefunded > 0
              ? commission * ((totalQty - alreadyRefunded) / totalQty)
              : commission;
          overallTotal += effectiveCommission;
          overallServiceCount += 1;
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          sales: payload,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: totalSales,
            pages: totalPages,
          },
          totals: {
            totalCommission: overallTotal,
            serviceCount: overallServiceCount,
            salesCount: totalSales,
          },
          period: { startDate, endDate },
        },
      });
    } catch (error) {
      console.error("Get own commissions error:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch commissions" });
    }
  },
);

module.exports = router;