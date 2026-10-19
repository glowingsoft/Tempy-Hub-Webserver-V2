const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const {
  RESIDENT_HANDLER_ROLES,
} = require("@adminServices/residents/residentAccess");
const familyInvitationController = require("../controllers/familyInvitationController");

const router = express.Router();

// Scope arrives as the x-org-id header (or ?organizationId=).
router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.RESIDENTS),
  requireRoles(RESIDENT_HANDLER_ROLES)
);

router.post("/", familyInvitationController.inviteFamilyMember);
router.get("/", familyInvitationController.listInvitations);
router.get("/:invitationId", familyInvitationController.getInvitation);
router.post(
  "/:invitationId/resend",
  familyInvitationController.resendInvitation
);
router.post(
  "/:invitationId/revoke",
  familyInvitationController.revokeInvitation
);

module.exports = router;
