const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership } = require("@middlewares/membershipMiddleware");
const staffDashboardSettingsController = require("../controllers/staffDashboardSettingsController");
const staffAppDashboardController = require("../controllers/staffAppDashboardController");

const router = express.Router();
router.use(auth, requireMembership());

router.get("/dashboard", staffAppDashboardController.getDashboard);
router.get(
  "/dashboard-settings",
  staffDashboardSettingsController.getStaffDashboardSettings
);

module.exports = router;
