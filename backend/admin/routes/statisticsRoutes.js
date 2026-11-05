const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireRoles } = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const statisticsController = require("../controllers/statisticsController");

const router = express.Router();
router.use(auth, requireMembership());
router.get(
  "/",
  requireRoles([MembershipRole.SUPER_ADMIN, MembershipRole.OWNER, MembershipRole.SITE_MANAGER]),
  statisticsController.getStatistics,
);

module.exports = router;
