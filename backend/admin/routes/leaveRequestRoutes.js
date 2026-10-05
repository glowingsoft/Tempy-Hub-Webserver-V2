const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const leaveController = require("../controllers/leaveController");
const {
  LEAVE_MANAGE,
  LEAVE_APPROVE,
} = require("@adminServices/leave/leaveAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.LEAVE)
);

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get("/:requestId", leaveController.getLeaveRequest);
router.post(
  "/:requestId/close",
  requireRoles(MANAGERS),
  requirePermission(LEAVE_MANAGE),
  leaveController.closeLeaveRequest
);

module.exports = router;
