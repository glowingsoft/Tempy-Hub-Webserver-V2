const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
const peepRecordController = require("../controllers/peepRecordController");
const {
  PEEP_VIEW,
  PEEP_MANAGE,
} = require("@adminServices/peep/floorPlanAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN)
);

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get(
  "/:peepRecordId",
  requirePermission(PEEP_VIEW),
  peepRecordController.getPeepRecord
);
router.patch(
  "/:peepRecordId",
  requireRoles(MANAGERS),
  requirePermission(PEEP_MANAGE),
  peepRecordController.updatePeepRecord
);

module.exports = router;
