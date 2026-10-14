const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const floorPlanController = require("../controllers/floorPlanController");
const {
  PEEP_VIEW,
  PEEP_MANAGE,
} = require("@adminServices/peep/floorPlanAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN)
);

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get(
  "/:floorPlanId",
  requirePermission(PEEP_VIEW),
  floorPlanController.getFloorPlan
);
router.patch(
  "/:floorPlanId",
  requireRoles(MANAGERS),
  requirePermission(PEEP_MANAGE),
  floorPlanController.updateFloorPlan
);
router.put(
  "/:floorPlanId/pins",
  requireRoles(MANAGERS),
  requirePermission(PEEP_MANAGE),
  floorPlanController.upsertFloorPlanPin
);
router.delete(
  "/:floorPlanId/pins/:pinId",
  requireRoles(MANAGERS),
  requirePermission(PEEP_MANAGE),
  floorPlanController.deleteFloorPlanPin
);

module.exports = router;
