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
  FAMILY_MANAGE,
  FAMILY_APPROVE,
} = require("@adminServices/family/familyAccess");
const { PEEP_VIEW } = require("@adminServices/peep/floorPlanAccess");
const { FAMILY_VIEW } = require("@adminServices/family/familyAccess");
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
router.get(
  "/:residentId/peep-record",
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_VIEW),
  controller.getPeepRecord,
);
router.post("/:residentId/deactivate", controller.deactivateResident);
router.post(
  "/:residentId/account-invitation",
  controller.sendAccountInvitation,
);
router.delete("/:residentId/account", controller.removeAccount);

const family = [requireFamilyModule];
const screenTabAccess = (req, res, next) => {
  const tab = String(req.query.tab || "profile")
    .trim()
    .toLowerCase();
  const gates =
    tab === "peep"
      ? [
          requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
          requirePermission(PEEP_VIEW),
        ]
      : tab === "family"
        ? [requireFamilyModule, requirePermission(FAMILY_VIEW)]
        : [];
  const run = (index) => {
    if (index >= gates.length) return next();
    return gates[index](req, res, (error) =>
      error ? next(error) : run(index + 1),
    );
  };
  return run(0);
};

router.get(
  "/:residentId/screen",
  screenTabAccess,
  controller.getResidentScreen,
);
router.get(
  "/:residentId/family",
  ...family,
  requirePermission(FAMILY_VIEW),
  controller.getFamily,
);
router.put(
  "/:residentId/family/next-of-kin",
  ...family,
  requirePermission(FAMILY_MANAGE),
  controller.setNextOfKin,
);
router.delete(
  "/:residentId/family/members/:memberId",
  ...family,
  requirePermission(FAMILY_MANAGE),
  controller.removeFamilyMember,
);
router.get(
  "/:residentId/family/code",
  ...family,
  requirePermission(FAMILY_VIEW),
  controller.getFamilyCode,
);
router.post(
  "/:residentId/family/code",
  ...family,
  requirePermission(FAMILY_MANAGE),
  controller.createFamilyCode,
);
router.put(
  "/:residentId/family/visiting-password",
  ...family,
  requirePermission(FAMILY_MANAGE),
  controller.setVisitingPassword,
);
router.put(
  "/:residentId/family/photos/:uploadId",
  ...family,
  requirePermission(FAMILY_APPROVE),
  controller.updateFamilyPhoto,
);

module.exports = router;
