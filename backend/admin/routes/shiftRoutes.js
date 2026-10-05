const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const shiftController = require("../controllers/shiftController");
const { ROTA_MANAGE, ROTA_APPROVE } = require("@adminServices/rota/shiftAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.ROTA_SCHEDULING)
);

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get("/:shiftId", shiftController.getShift);
router.patch(
  "/:shiftId",
  requireRoles(MANAGERS),
  requirePermission(ROTA_MANAGE),
  shiftController.updateShift
);

module.exports = router;
