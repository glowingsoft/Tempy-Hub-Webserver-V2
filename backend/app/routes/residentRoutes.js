const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const { requirePermission } = require("@middlewares/membershipMiddleware");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_APPROVE,
} = require("@adminServices/family/familyAccess");
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

const family = [requireFamilyModule];
router.get("/:residentId/family", ...family, requirePermission(FAMILY_VIEW), controller.getFamily);
router.put("/:residentId/family/next-of-kin", ...family, requirePermission(FAMILY_MANAGE), controller.setNextOfKin);
router.delete("/:residentId/family/members/:memberId", ...family, requirePermission(FAMILY_MANAGE), controller.removeFamilyMember);
router.post("/:residentId/family/code", ...family, requirePermission(FAMILY_MANAGE), controller.createFamilyCode);
router.put("/:residentId/family/visiting-password", ...family, requirePermission(FAMILY_MANAGE), controller.setVisitingPassword);
router.put("/:residentId/family/photos/:uploadId", ...family, requirePermission(FAMILY_APPROVE), controller.updateFamilyPhoto);

module.exports = router;
