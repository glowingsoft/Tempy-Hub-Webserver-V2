const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const requirementController = require("../controllers/requirementController");

const router = express.Router();

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL)
);

router.patch(
  "/:requirementId",
  requireRoles(MANAGERS),
  requirementController.updateRequirement
);

module.exports = router;
