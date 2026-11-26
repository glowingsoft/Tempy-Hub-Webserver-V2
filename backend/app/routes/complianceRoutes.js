const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const complianceController = require("../controllers/complianceController");

const router = express.Router();

// The signed token is a short-lived bearer link, so this download route is public.
router.get(
  "/team/download/:token",
  complianceController.downloadTeamComplianceExport,
);

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL)
);

router.get("/", complianceController.getMyCompliance);

// Team Compliance: line managers see their direct reports (scoped in the service).
const asTeamManager = requireRoles([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
]);
router.get("/team", asTeamManager, complianceController.getTeamCompliance);
router.get(
  "/team/export",
  asTeamManager,
  complianceController.exportTeamCompliance,
);

module.exports = router;
