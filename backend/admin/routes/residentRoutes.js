const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const residentController = require("../controllers/residentController");

const router = express.Router();

router.use(auth, requireMembership());

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.use(requireRoles(MANAGERS));

router.get("/", residentController.listResidents);
router.post("/", residentController.createResident);
router.get("/:residentId", residentController.getResident);
router.patch("/:residentId", residentController.updateResident);
router.put(
  "/:residentId/visitor-passcode",
  residentController.setVisitorPasscode
);
router.post(
  "/:residentId/verify-passcode",
  residentController.verifyVisitorPasscode
);

module.exports = router;
