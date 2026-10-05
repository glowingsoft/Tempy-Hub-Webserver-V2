const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const externalPersonController = require("../controllers/externalPersonController");
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
  "/:externalPersonId",
  requirePermission(VISIT_VIEW),
  externalPersonController.getExternalPerson
);
router.patch(
  "/:externalPersonId",
  requireRoles(MANAGERS),
  requirePermission(VISIT_MANAGE),
  externalPersonController.updateExternalPerson
);

module.exports = router;
