const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const residentController = require("../controllers/residentController");
const {
  RESIDENT_HANDLER_ROLES,
  RESIDENT_READER_ROLES,
} = require("@adminServices/residents/residentAccess");

const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const { PEEP_MANAGE } = require("@adminServices/peep/floorPlanAccess");

const router = express.Router();

router.use(auth, requireMembership(), requireModule(ModuleSlug.RESIDENTS));

const handlers = requireRoles(RESIDENT_HANDLER_ROLES);

// Same guards as the PEEP routes, but only when the body carries a PEEP.
const peepGuards = [
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requireRoles(MANAGER_ROLES),
  requirePermission(PEEP_MANAGE),
].map((guard) => (req, res, next) =>
  req.body?.peep == null ? next() : guard(req, res, next)
);

router.get("/", requireRoles(RESIDENT_READER_ROLES), residentController.listResidents);
router.post("/", handlers, peepGuards, residentController.createResident);
router.get("/:residentId", requireRoles(RESIDENT_READER_ROLES), residentController.getResident);
router.patch("/:residentId", handlers, peepGuards, residentController.updateResident);
router.put(
  "/:residentId/restriction",
  handlers,
  residentController.setRestriction
);
router.put("/:residentId/out", handlers, residentController.setOut);
router.put(
  "/:residentId/visitor-passcode",
  handlers,
  residentController.setVisitorPasscode
);
router.post(
  "/:residentId/verify-passcode",
  handlers,
  residentController.verifyVisitorPasscode
);

module.exports = router;
