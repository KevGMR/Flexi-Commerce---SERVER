const axios = require("axios");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");

require("dotenv").config();

const userRouter = require("./controllers/User");
const emailVerificationRouter = require("./controllers/EmailVerification");
const organizationRouter = require("./controllers/Organization");
const rolePermissionRouter = require("./controllers/RolePermission");
const auditLogRouter = require("./controllers/AuditLog");

// E-commerce Controllers (Week 3)
const productRouter = require("./controllers/Product");
const variantRouter = require("./controllers/Variant");
const collectionRouter = require("./controllers/Collection");
const locationRouter = require("./controllers/Location");
const inventoryRouter = require("./controllers/Inventory");
const inventoryAuditRouter = require("./controllers/InventoryAudit");
const supplierRouter = require("./controllers/Supplier");
const purchaseOrderRouter = require("./controllers/PurchaseOrder");
const transferRouter = require("./controllers/Transfer");
const giftCardRouter = require("./controllers/GiftCard");
const shopifyRouter = require("./controllers/ShopifyController");
const salesRouter = require("./controllers/Sales");
const deliveryFeeRouter = require("./controllers/DeliveryFee");
const driverRouter = require("./controllers/Driver");

const { verifyToken } = require("./middleware/auth");
const { checkUserStatus } = require("./middleware/userStatusCheck");
const { requirePermission } = require("./middleware/permissionCheck");
const { apiLimiter } = require("./middleware/rateLimiter");
const { handleErrors } = require("./middleware/auth");
const { PERMISSIONS } = require("./config/permissions");
const shopifyRetryWorker = require("./workers/shopifyRetryWorker");
const { startDeliveryStatusSync } = require("./workers/syncDeliveryStatus");
const { startLinkOfflineDeliveriesToSales } = require("./workers/linkOfflineDeliveriesToSales");

const app = express();
const port = process.env.PORT || 9200;

// Security & Performance Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses

// CORS Configuration
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies
  })
);

app.use(express.json({ limit: "10mb" })); // Body parser with size limit
app.use(cookieParser()); // Parse cookies
app.use(morgan("dev")); // Logging

// Apply general rate limiting to all routes
app.use(apiLimiter);

// Database Connection
mongoose
  .connect(`${process.env.MONGO_URI}`)
  .then(() => {
    app.listen(port, () => {
      console.log(`MongoDB connection is active 👌`);
      console.log(`Server active on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      
      // Start background workers
      shopifyRetryWorker.start();
      startDeliveryStatusSync();
      startLinkOfflineDeliveriesToSales();
    });
  })
  .catch((err) => console.log({ databaseConnect: err }));

// Health Check Endpoint (Public)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Public Routes (No Authentication Required)
app.use("/email-verification", emailVerificationRouter);

// User Routes (mixed public/protected - handled in controller)
app.use("/users", userRouter);

// Protected Routes (Authentication Required)
app.use("/organizations", verifyToken, checkUserStatus, organizationRouter);

// Admin Routes (Requires Specific Permissions)
app.use("/role-permission", verifyToken, checkUserStatus, rolePermissionRouter);
app.use("/audit-logs", verifyToken, checkUserStatus, auditLogRouter);

// E-commerce Routes (Protected - Authentication & Organization Required)
app.use("/products", verifyToken, checkUserStatus, productRouter);
app.use("/variants", verifyToken, checkUserStatus, variantRouter);
app.use("/collections", verifyToken, checkUserStatus, collectionRouter);
app.use("/locations", verifyToken, checkUserStatus, locationRouter);
app.use("/inventory", verifyToken, checkUserStatus, inventoryRouter);
app.use("/inventory-audit", verifyToken, checkUserStatus, inventoryAuditRouter);
app.use("/suppliers", verifyToken, checkUserStatus, supplierRouter);
app.use("/purchase-orders", verifyToken, checkUserStatus, purchaseOrderRouter);
app.use("/transfers", verifyToken, checkUserStatus, transferRouter);
app.use("/gift-cards", verifyToken, checkUserStatus, giftCardRouter);

// Shopify Integration Routes (Protected)
app.use("/shopify", verifyToken, checkUserStatus, shopifyRouter);

// POS Routes (Protected)
app.use("/sales", verifyToken, checkUserStatus, salesRouter);

// Delivery Fee Routes (Protected)
app.use("/delivery-fees", verifyToken, checkUserStatus, deliveryFeeRouter);

// Driver Routes (Protected)
app.use("/drivers", verifyToken, checkUserStatus, driverRouter);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Global Error Handler (Must be last)
app.use(handleErrors);
