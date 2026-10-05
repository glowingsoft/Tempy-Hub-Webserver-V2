const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const membershipController = require("../controllers/membershipController");

const router = express.Router();

// Like /branches, these paths carry no organization segment, so the scope
// arrives as the x-org-id header (or ?organizationId=).
router.use(auth, requireMembership());

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get("/:membershipId", membershipController.getMembership);
router.patch(
  "/:membershipId",
  requireRoles(MANAGERS),
  membershipController.updateMembership
);
router.post(
  "/:membershipId/deactivate",
  requireRoles(MANAGERS),
  membershipController.deactivateMembership
);

module.exports = router;
