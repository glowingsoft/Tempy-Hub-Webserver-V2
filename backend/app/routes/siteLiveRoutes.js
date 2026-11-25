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

router.use(
  auth,
  requireMembership(),
  requireRoles([
    MembershipRole.SUPER_ADMIN,
    MembershipRole.OWNER,
    MembershipRole.SITE_MANAGER,
  ]),
);

router.get("/activity", getSiteLiveActivity);
router.get("/people", listPeople);
router.get("/directory", listDirectory);
router.get("/statistics", getStatistics);
router.get("/compliance", getCompliance);
router.get("/compliance/export", exportCompliance);
router.post("/people/:personKind/:recordId/check-out", checkOutPerson);
router.get("/", getSiteLive);

module.exports = router;
