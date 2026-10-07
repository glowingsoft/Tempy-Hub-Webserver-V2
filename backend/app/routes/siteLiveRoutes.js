const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const { getSiteLive } = require("../controllers/siteLiveController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireRoles([
    MembershipRole.SUPER_ADMIN,
    MembershipRole.OWNER,
    MembershipRole.SITE_MANAGER,
  ])
);

router.get("/", getSiteLive);

module.exports = router;
