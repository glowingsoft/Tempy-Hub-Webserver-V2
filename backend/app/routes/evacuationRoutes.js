const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const evacuationController = require("../controllers/evacuationController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION)
);

router.get("/active", evacuationController.getActiveEvacuation);
router.post("/me/check", evacuationController.markMyself);

const SITE_MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get(
  "/:evacuationEventId/rollcall",
  requireRoles(SITE_MANAGERS),
  evacuationController.getRollcall
);
router.post(
  "/:evacuationEventId/alert-families",
  requireRoles(SITE_MANAGERS),
  evacuationController.alertFamilies
);
router.post(
  "/:evacuationEventId/update-families",
  requireRoles(SITE_MANAGERS),
  evacuationController.updateFamilies
);
router.post(
  "/:evacuationEventId/all-clear",
  requireRoles(SITE_MANAGERS),
  evacuationController.allClearFamilies
);

module.exports = router;
