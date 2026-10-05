const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const attendanceController = require("../controllers/attendanceController");
const {
  ATTENDANCE_MANAGE,
  ATTENDANCE_APPROVE,
} = require("@adminServices/attendance/attendanceAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE)
);

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get("/:attendanceDayId", attendanceController.getAttendanceDay);
router.patch(
  "/:attendanceDayId",
  requireRoles(MANAGERS),
  requirePermission(ATTENDANCE_MANAGE),
  attendanceController.updateAttendanceDay
);

module.exports = router;
