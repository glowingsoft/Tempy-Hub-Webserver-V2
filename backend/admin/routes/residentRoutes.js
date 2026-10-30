const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const residentController = require("../controllers/residentController");
const {
  RESIDENT_HANDLER_ROLES,
  RESIDENT_READER_ROLES,
} = require("@adminServices/residents/residentAccess");

const router = express.Router();

router.use(auth, requireMembership(), requireModule(ModuleSlug.RESIDENTS));

const handlers = requireRoles(RESIDENT_HANDLER_ROLES);

router.get("/", requireRoles(RESIDENT_READER_ROLES), residentController.listResidents);
router.post("/", handlers, residentController.createResident);
router.get("/:residentId", handlers, residentController.getResident);
router.patch("/:residentId", handlers, residentController.updateResident);
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
