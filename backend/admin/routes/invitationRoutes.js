const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const membershipController = require("../controllers/membershipController");

const router = express.Router();

// Scope arrives as the x-org-id header (or ?organizationId=).
router.use(auth, requireMembership());

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.post(
  "/:invitationId/resend",
  requireRoles(MANAGERS),
  membershipController.resendInvitation
);
router.post(
  "/:invitationId/revoke",
  requireRoles(MANAGERS),
  membershipController.revokeInvitation
);

module.exports = router;
