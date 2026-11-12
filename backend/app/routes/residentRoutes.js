const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const controller = require("../controllers/residentController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.RESIDENTS),
  requireRoles([
    MembershipRole.SUPER_ADMIN,
    MembershipRole.OWNER,
    MembershipRole.SITE_MANAGER,
  ]),
);

router.get("/", controller.listResidents);
router.get("/:residentId", controller.getResident);
router.post("/:residentId/deactivate", controller.deactivateResident);

module.exports = router;
