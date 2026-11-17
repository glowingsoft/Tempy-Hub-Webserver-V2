const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const { getHome } = require("../../admin/controllers/lineHomeController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireRoles([MembershipRole.LINE_MANAGER]),
);

router.get("/", getHome);

module.exports = router;
