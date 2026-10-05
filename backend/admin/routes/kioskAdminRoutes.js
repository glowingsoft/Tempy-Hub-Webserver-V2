const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const kioskAdminController = require("../controllers/kioskAdminController");

const router = express.Router();

router.use(auth, requireMembership());

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.use(requireRoles(MANAGERS));

router.get("/", kioskAdminController.listKiosks);
router.post("/", kioskAdminController.createKiosk);
router.get("/:kioskId", kioskAdminController.getKiosk);
router.patch("/:kioskId", kioskAdminController.updateKiosk);
router.post("/:kioskId/toggle-lock", kioskAdminController.toggleLock);

module.exports = router;
