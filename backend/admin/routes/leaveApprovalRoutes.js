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
const leaveController = require("../controllers/leaveController");
const {
  LEAVE_APPROVE,
  TEAM_APPROVER_ROLES,
} = require("@adminServices/leave/leaveAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.LEAVE)
);

router.post(
  "/:requestId/approve",
  requireRoles(TEAM_APPROVER_ROLES),
  hasReportsIf([MembershipRole.LINE_MANAGER]),
  requirePermission(LEAVE_APPROVE),
  leaveController.approveLeaveRequest
);
router.post(
  "/:requestId/reject",
  requireRoles(TEAM_APPROVER_ROLES),
  hasReportsIf([MembershipRole.LINE_MANAGER]),
  requirePermission(LEAVE_APPROVE),
  leaveController.rejectLeaveRequest
);

module.exports = router;
