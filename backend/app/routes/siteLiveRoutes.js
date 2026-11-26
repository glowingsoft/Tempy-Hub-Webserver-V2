const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const {
  getSiteLive,
  getSiteLiveActivity,
  listPeople,
  checkOutPerson,
  listDirectory,
  getStatistics,
  getCompliance,
  exportCompliance,
  downloadComplianceExport,
} = require("../controllers/siteLiveController");

const router = express.Router();

// The signed token is a short-lived bearer link, so this download route is public.
router.get("/compliance/download/:token", downloadComplianceExport);

const SITE_MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];
const asSiteManager = requireRoles(SITE_MANAGERS);
// Line managers see compliance for their own team only (scoped in the service).
const asTeamManager = requireRoles([
  ...SITE_MANAGERS,
  MembershipRole.LINE_MANAGER,
]);

router.use(auth, requireMembership());

router.get("/compliance", asTeamManager, getCompliance);
router.get("/compliance/export", asTeamManager, exportCompliance);
router.get("/activity", asSiteManager, getSiteLiveActivity);
router.get("/people", asSiteManager, listPeople);
router.get("/directory", asSiteManager, listDirectory);
router.get("/statistics", asSiteManager, getStatistics);
router.post(
  "/people/:personKind/:recordId/check-out",
  asSiteManager,
  checkOutPerson,
);
router.get("/", asSiteManager, getSiteLive);

module.exports = router;
