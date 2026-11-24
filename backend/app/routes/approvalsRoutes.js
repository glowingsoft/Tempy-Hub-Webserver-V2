const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const { listApprovals } = require("../controllers/approvalsController");

const router = express.Router();

router.get(
  "/",
  auth,
  requireMembership(),
  requireRoles(MANAGER_ROLES),
  listApprovals,
);

module.exports = router;
