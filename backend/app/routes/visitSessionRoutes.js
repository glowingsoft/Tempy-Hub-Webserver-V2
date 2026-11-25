const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const visitSessionController = require("../../admin/controllers/visitSessionController");
const { VISIT_MANAGE } = require("@adminServices/visitors/visitorAccess");

const router = express.Router();
const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION)
);

router.post(
  "/:visitSessionId/approve",
  requireRoles(MANAGERS),
  requirePermission(VISIT_MANAGE),
  visitSessionController.approve
);
router.post(
  "/:visitSessionId/deny",
  requireRoles(MANAGERS),
  requirePermission(VISIT_MANAGE),
  visitSessionController.deny
);

module.exports = router;
