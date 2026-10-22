const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_STAFF_ROLES,
} = require("@adminServices/family/familyAccess");
const familyInvitationController = require("../controllers/familyInvitationController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(FAMILY_STAFF_ROLES)
);

router.post("/", requirePermission(FAMILY_MANAGE), familyInvitationController.inviteFamilyMember);
router.get("/:invitationId", requirePermission(FAMILY_VIEW), familyInvitationController.getInvitation);
router.patch("/:invitationId", requirePermission(FAMILY_MANAGE), familyInvitationController.updateInvitation);

module.exports = router;
