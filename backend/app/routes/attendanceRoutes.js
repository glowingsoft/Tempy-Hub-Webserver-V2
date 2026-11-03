const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const attendanceController = require("../controllers/attendanceController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE)
);

router.get("/today", attendanceController.getTodayAttendance);
router.post("/clock-in", attendanceController.clockIn);
router.post("/clock-out", attendanceController.clockOut);
router.post("/break-in", attendanceController.startBreak);
router.post("/break-out", attendanceController.endBreak);
router.get("/", attendanceController.listMyAttendance);
router.post("/change-requests", attendanceController.createChangeRequest);
router.post("/:dayId/roster-request", attendanceController.requestRoster);

module.exports = router;
