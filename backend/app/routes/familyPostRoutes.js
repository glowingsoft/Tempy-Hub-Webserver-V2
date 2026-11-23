const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const { FAMILY_MANAGE } = require("@adminServices/family/familyAccess");
const familyPostController = require("../controllers/familyPostController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles([
    MembershipRole.SUPER_ADMIN,
    MembershipRole.OWNER,
    MembershipRole.SITE_MANAGER,
  ]),
);

router.put(
  "/:postId/pin",
  requirePermission(FAMILY_MANAGE),
  familyPostController.setPinned,
);

module.exports = router;
