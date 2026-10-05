const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const staffController = require("../controllers/staffController");

const router = express.Router();

router.use(auth, requireMembership());

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get("/:departmentId", staffController.getDepartment);
router.patch(
  "/:departmentId",
  requireRoles(MANAGERS),
  staffController.updateDepartment
);

module.exports = router;
