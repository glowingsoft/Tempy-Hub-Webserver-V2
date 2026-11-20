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
const shiftController = require("../controllers/shiftController");
const {
  ROTA_APPROVE,
  TEAM_APPROVER_ROLES,
} = require("@adminServices/rota/shiftAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.ROTA_SCHEDULING)
);

router.post(
  "/:claimId/approve",
  requireRoles(TEAM_APPROVER_ROLES),
  hasReportsIf([MembershipRole.LINE_MANAGER]),
  requirePermission(ROTA_APPROVE),
  shiftController.approveClaim
);
router.post(
  "/:claimId/reject",
  requireRoles(TEAM_APPROVER_ROLES),
  hasReportsIf([MembershipRole.LINE_MANAGER]),
  requirePermission(ROTA_APPROVE),
  shiftController.rejectClaim
);

module.exports = router;
