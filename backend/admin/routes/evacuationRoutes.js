const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const evacuationController = require("../controllers/evacuationController");
const {
  EVAC_VIEW,
  EVAC_MANAGE,
} = require("@adminServices/evacuation/evacuationAccess");

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
  "/:evacuationEventId",
  requirePermission(EVAC_VIEW),
  evacuationController.getEvacuationEvent
);

router.post(
  "/:evacuationEventId/close",
  requireRoles(MANAGERS),
  requirePermission(EVAC_MANAGE),
  evacuationController.closeEvacuation
);

router.get(
  "/:evacuationEventId/checks",
  requirePermission(EVAC_VIEW),
  evacuationController.listEvacChecks
);

router.post(
  "/:evacuationEventId/checks",
  requireRoles(MANAGERS),
  requirePermission(EVAC_MANAGE),
  evacuationController.upsertEvacCheck
);

module.exports = router;
