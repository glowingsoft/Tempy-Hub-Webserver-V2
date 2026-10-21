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

const residentInQuery = requireFamilyAccess({ param: "residentId", from: "query" });
const residentInBody = requireFamilyAccess({ param: "residentId", from: "body" });

router.use(auth, requireAudience([AuthAudience.FAMILY]));

router.get("/relationships", familyController.listRelationships);
router.get("/residents", familyController.listMyResidents);

router.get("/codes/current", residentInQuery, requireNextOfKin, familyController.getCurrentFamilyCode);
router.post("/codes", residentInBody, requireNextOfKin, familyController.createFamilyCode);

router.post("/member-invitations", residentInBody, requireNextOfKin, familyController.inviteRelative);

router.get("/join/preview", familyController.previewJoinCode);
router.post("/join", familyController.requestToJoin);
router.get("/join-requests/current", familyController.getCurrentJoinRequest);
router.post("/join-requests/:id/cancel", familyController.cancelJoinRequest);

router.get("/join-requests", residentInQuery, requireNextOfKin, familyController.listJoinRequests);
router.post("/join-requests/:id/approve", familyController.approveJoinRequest);
router.post("/join-requests/:id/reject", familyController.rejectJoinRequest);

router.get("/members", residentInQuery, familyController.listMembers);
router.delete("/members/:memberId", familyController.removeMember);

router.get("/handover/candidates", residentInQuery, requireNextOfKin, familyController.listHandoverCandidates);
router.post("/handover", residentInBody, requireNextOfKin, familyController.requestHandover);
router.get("/handover/current", familyController.getCurrentHandover);
router.post("/handover/:id/accept", familyController.acceptHandover);
router.post("/handover/:id/decline", familyController.declineHandover);
router.post("/handover/:id/cancel", familyController.cancelHandover);

router.post("/leave", residentInBody, familyController.leaveFamily);

module.exports = router;
