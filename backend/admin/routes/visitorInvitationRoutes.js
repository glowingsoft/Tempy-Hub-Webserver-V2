const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const visitorInvitationController = require("../controllers/visitorInvitationController");
const {
  VISIT_MANAGE,
} = require("@adminServices/visitors/visitorAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION)
);

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.post(
  "/:invitationId/resend",
  requireRoles(MANAGERS),
  requirePermission(VISIT_MANAGE),
  visitorInvitationController.resendVisitorInvitation
);

module.exports = router;
