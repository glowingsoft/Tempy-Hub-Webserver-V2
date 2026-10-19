const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireAudience } = require("@middlewares/audienceMiddleware");
const { AuthAudience } = require("@models/domainEnums");
const {
  requireFamilyAccess,
  requireNextOfKin,
} = require("@middlewares/familyMiddleware");
const familyController = require("../controllers/familyController");

const router = express.Router();

router.use(auth, requireAudience([AuthAudience.FAMILY]));

// Usable before the member has an active link, so the Join A Family screen works.
router.get("/relationships", familyController.listRelationships);
router.get("/residents", familyController.listMyResidents);

// Join A Family: for members who have no active link yet.
router.get("/join/preview", familyController.previewJoinCode);
router.post("/join", familyController.requestToJoin);
router.get("/join-requests/current", familyController.getCurrentJoinRequest);
router.post("/join-requests/:id/cancel", familyController.cancelJoinRequest);

// My Family. The next of kin reviews requests and removes members; the
// request or member id in the path is checked against the caller's own families.
router.get(
  "/members",
  requireFamilyAccess({ param: "residentId", in: "query" }),
  familyController.listMembers
);
router.delete("/members/:memberId", familyController.removeMember);
router.get(
  "/join-requests",
  requireFamilyAccess({ param: "residentId", in: "query" }),
  requireNextOfKin,
  familyController.listJoinRequests
);
router.post("/join-requests/:id/approve", familyController.approveJoinRequest);
router.post("/join-requests/:id/reject", familyController.rejectJoinRequest);

// Family code: next of kin only; the resident comes in the query or the body.
router.get(
  "/codes/current",
  requireFamilyAccess({ param: "residentId", in: "query" }),
  requireNextOfKin,
  familyController.getCurrentFamilyCode
);
router.post(
  "/codes",
  requireFamilyAccess({ param: "residentId", in: "body" }),
  requireNextOfKin,
  familyController.createFamilyCode
);

module.exports = router;
