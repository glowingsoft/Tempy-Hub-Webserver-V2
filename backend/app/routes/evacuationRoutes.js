const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const evacuationController = require("../controllers/evacuationController");
const adminEvacuationController = require("../../admin/controllers/evacuationController");
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

router.get("/active", evacuationController.getActiveEvacuation);
router.get("/me/drills", evacuationController.myDrills);
router.post("/me/check", evacuationController.markMyself);

const SITE_MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

// A site manager raises for their own site, so the app does not have to send it.
const ownSite = (req, res, next) => {
  const own = req.membership?.role === MembershipRole.SITE_MANAGER && req.membership.branchId;
  if (own && !req.body?.branchId) req.body = { ...req.body, branchId: String(own) };
  next();
};

router.get(
  "/",
  requireRoles(SITE_MANAGERS),
  requirePermission(EVAC_VIEW),
  evacuationController.getFireDrills
);
router.post(
  "/",
  requireRoles(SITE_MANAGERS),
  requirePermission(EVAC_MANAGE),
  ownSite,
  evacuationController.raiseEvacuation
);
router.post(
  "/log",
  requireRoles(SITE_MANAGERS),
  requirePermission(EVAC_MANAGE),
  evacuationController.logDrill
);
router.post(
  "/:evacuationEventId/checks",
  requireRoles(SITE_MANAGERS),
  requirePermission(EVAC_MANAGE),
  adminEvacuationController.upsertEvacCheck
);
router.post(
  "/:evacuationEventId/close",
  requireRoles(SITE_MANAGERS),
  requirePermission(EVAC_MANAGE),
  adminEvacuationController.closeEvacuation
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
