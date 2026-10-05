const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const visitSessionController = require("../controllers/visitSessionController");
const {
  VISIT_VIEW,
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

router.get(
  "/:visitSessionId",
  requirePermission(VISIT_VIEW),
  visitSessionController.getVisitSession
);
router.post(
  "/:visitSessionId/check-out",
  requireRoles(MANAGERS),
  requirePermission(VISIT_MANAGE),
  visitSessionController.checkOut
);
router.post(
  "/:visitSessionId/approve",
  requireRoles(MANAGERS),
  requirePermission(VISIT_MANAGE),
  visitSessionController.approve
);

module.exports = router;
