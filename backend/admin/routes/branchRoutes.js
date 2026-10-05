const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const branchController = require("../controllers/branchController");

const router = express.Router();

// These paths carry no organization segment, so the scope arrives as the
// x-org-id header (or ?organizationId=) and every query is pinned to it.
router.use(auth, requireMembership());

const OWNER_OR_SM = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];
const OWNER_ONLY = [MembershipRole.SUPER_ADMIN, MembershipRole.OWNER];

router.get("/:branchId", branchController.getBranch);
router.patch("/:branchId", requireRoles(OWNER_OR_SM), branchController.updateBranch);

router.post(
  "/:branchId/activation-codes",
  requireRoles(OWNER_ONLY),
  branchController.issueActivationCode
);
router.get(
  "/:branchId/activation-codes",
  requireRoles(OWNER_OR_SM),
  branchController.listActivationCodes
);
router.post(
  "/:branchId/activation-codes/:activationCodeId/revoke",
  requireRoles(OWNER_ONLY),
  branchController.revokeActivationCode
);

module.exports = router;
