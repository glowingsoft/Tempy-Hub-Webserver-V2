const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const residentController = require("../controllers/residentController");
const {
  RESIDENT_HANDLER_ROLES,
} = require("@adminServices/residents/residentAccess");

const router = express.Router();

router.use(auth, requireMembership(), requireRoles(RESIDENT_HANDLER_ROLES));

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
