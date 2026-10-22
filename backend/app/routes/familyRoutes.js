const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireAudience } = require("@middlewares/audienceMiddleware");
const { AuthAudience } = require("@models/domainEnums");
const {
  requireFamilyAccess,
  requireNextOfKin,
} = require("@middlewares/familyMiddleware");
const { receivePhoto } = require("@middlewares/familyPhotoMiddleware");
const familyController = require("../controllers/familyController");

const router = express.Router();

const residentInQuery = requireFamilyAccess({ param: "residentId", from: "query" });
const residentInBody = requireFamilyAccess({ param: "residentId", from: "body" });

router.use(auth, requireAudience([AuthAudience.FAMILY]));

router.get("/relationships", familyController.listRelationships);
router.get("/residents", familyController.listMyResidents);

router.get("/codes/current", residentInQuery, requireNextOfKin, familyController.getCurrentFamilyCode);
router.post("/codes", residentInBody, requireNextOfKin, familyController.createFamilyCode);

router.get("/member-invitations", residentInQuery, requireNextOfKin, familyController.listSentInvitations);
router.post("/member-invitations", residentInBody, requireNextOfKin, familyController.inviteRelative);

router.get("/join/preview", familyController.previewJoinCode);
router.post("/join", familyController.requestToJoin);
router.get("/join-requests/current", familyController.getCurrentJoinRequest);

router.get("/join-requests", residentInQuery, requireNextOfKin, familyController.listJoinRequests);
router.put("/join-requests/:id", familyController.updateJoinRequest);

router.get("/members", residentInQuery, familyController.listMembers);
router.delete("/members/:memberId", familyController.removeMember);

router.get("/handover/candidates", residentInQuery, requireNextOfKin, familyController.listHandoverCandidates);
router.post("/handover", residentInBody, requireNextOfKin, familyController.requestHandover);
router.get("/handover/current", familyController.getCurrentHandover);
router.put("/handover/:id", familyController.updateHandover);

router.post("/media", requireFamilyAccess(), receivePhoto, familyController.uploadPhoto);
router.post("/uploads", residentInBody, familyController.createUpload);
router.get("/uploads", requireFamilyAccess(), familyController.listMyUploads);
router.put("/uploads/:id", requireFamilyAccess(), familyController.updateUpload);

router.post("/leave", residentInBody, familyController.leaveFamily);

module.exports = router;
