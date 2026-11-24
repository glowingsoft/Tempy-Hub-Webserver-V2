const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const { FAMILY_APPROVE } = require("@adminServices/family/familyAccess");
const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const {
  listApprovals,
  getApprovalDetail,
  decideJoinRequest,
} = require("../controllers/approvalsController");

const router = express.Router();

router.get(
  "/detail",
  auth,
  requireMembership(),
  requireRoles(MANAGER_ROLES),
  getApprovalDetail,
);

router.put(
  "/join-requests/:requestId",
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(MANAGER_ROLES),
  requirePermission(FAMILY_APPROVE),
  decideJoinRequest,
);

router.get(
  "/",
  auth,
  requireMembership(),
  requireRoles(MANAGER_ROLES),
  listApprovals,
);

module.exports = router;
