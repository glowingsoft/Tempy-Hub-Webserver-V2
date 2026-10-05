const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
  hasReportsIf,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const attendanceController = require("../controllers/attendanceController");
const {
  ATTENDANCE_APPROVE,
  TEAM_APPROVER_ROLES,
} = require("@adminServices/attendance/attendanceAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE)
);

router.post(
  "/:requestId/approve",
  requireRoles(TEAM_APPROVER_ROLES),
  hasReportsIf([MembershipRole.LINE_MANAGER]),
  requirePermission(ATTENDANCE_APPROVE),
  attendanceController.approveChangeRequest
);
router.post(
  "/:requestId/reject",
  requireRoles(TEAM_APPROVER_ROLES),
  hasReportsIf([MembershipRole.LINE_MANAGER]),
  requirePermission(ATTENDANCE_APPROVE),
  attendanceController.rejectChangeRequest
);

module.exports = router;
