const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const {
  FAMILY_MANAGE,
  FAMILY_STAFF_ROLES,
} = require("@adminServices/family/familyAccess");
const createRateLimiter = require("@utils/rateLimiter");
const familyInvitationController = require("../controllers/familyInvitationController");

const inviteLimiter = createRateLimiter("family-staff-invites", 15, 30);
const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(FAMILY_STAFF_ROLES)
);

router.post("/", inviteLimiter, requirePermission(FAMILY_MANAGE), familyInvitationController.inviteFamilyMember);
router.put("/:invitationId", inviteLimiter, requirePermission(FAMILY_MANAGE), familyInvitationController.updateInvitation);

module.exports = router;
