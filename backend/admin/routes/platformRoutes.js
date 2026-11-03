const express = require("express");
const auth = require("@middlewares/authMiddleware");
const roleMiddleware = require("@middlewares/roleMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const superAdminDashboardController = require("../controllers/superAdminDashboardController");

const router = express.Router();

const readLimiter = createRateLimiter("platform-reads", 10, 120);

router.get(
  "/dashboard",
  auth,
  roleMiddleware(["admin"]),
  readLimiter,
  superAdminDashboardController.getDashboard,
);

module.exports = router;
